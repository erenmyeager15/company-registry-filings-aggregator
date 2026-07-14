import type { NormalizedInput, SourceName } from './types.js';
import { normalizeText, uniqueStrings } from './utils.js';

const DEFAULT_SOURCES: SourceName[] = ['sec_edgar'];
export const DEFAULT_SEC_USER_AGENT = 'CompanyRegistryFilingsAggregator/1.0 contact@example.com';
const VALID_SOURCES = new Set<SourceName>(['companies_house', 'sec_edgar']);
const MAX_QUERY_COUNT = 50;
const MAX_IDENTIFIER_COUNT = 1000;

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readString(value: unknown, field: string, maxLength: number): string | null {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string') throw new Error(`${field} must be a string.`);
  const text = normalizeText(value);
  if (!text) return null;
  if (text.length > maxLength) throw new Error(`${field} must be at most ${maxLength} characters.`);
  if (/\r|\n/.test(value)) throw new Error(`${field} must not contain line breaks.`);
  return text;
}

function readArray(value: unknown, field: string, maxItems: number): unknown[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) throw new Error(`${field} must be an array.`);
  if (value.length > maxItems) throw new Error(`${field} must contain at most ${maxItems} items.`);
  return value;
}

function readTextArray(value: unknown, field: string, maxItems: number, maxLength: number): string[] {
  return uniqueStrings(readArray(value, field, maxItems).map((item, index) => {
    if (typeof item !== 'string') throw new Error(`${field}[${index}] must be a string.`);
    const text = readString(item, `${field}[${index}]`, maxLength);
    if (!text) throw new Error(`${field}[${index}] must not be empty.`);
    return text;
  }));
}

function normalizeCompanyNumbers(value: unknown): string[] {
  const values = readTextArray(value, 'companyNumbers', MAX_IDENTIFIER_COUNT, 20)
    .map((item) => item.replace(/\s+/g, '').toUpperCase());
  for (const companyNumber of values) {
    if (!/^[A-Z0-9]{1,10}$/.test(companyNumber)) {
      throw new Error(`Invalid Companies House company number: ${companyNumber}.`);
    }
  }
  return uniqueStrings(values);
}

function normalizeCiks(value: unknown): string[] {
  const rawValues = readArray(value, 'ciks', MAX_IDENTIFIER_COUNT);
  const ciks = rawValues.map((item, index) => {
    if (typeof item !== 'string' && typeof item !== 'number') {
      throw new Error(`ciks[${index}] must be a string or integer.`);
    }
    const text = String(item).replace(/\s+/g, '');
    if (!/^\d{1,10}$/.test(text) || /^0+$/.test(text)) {
      throw new Error(`Invalid SEC CIK: ${String(item)}.`);
    }
    return text.padStart(10, '0');
  });
  return uniqueStrings(ciks);
}

function normalizeSources(value: unknown): SourceName[] {
  if (value === undefined || value === null) return [...DEFAULT_SOURCES];
  const values = readArray(value, 'sources', 2);
  if (values.length === 0) throw new Error('sources must be a non-empty array.');
  const sources = uniqueStrings(values.map((item, index) => {
    if (typeof item !== 'string') throw new Error(`sources[${index}] must be a string.`);
    return item.toLowerCase();
  }));
  for (const source of sources) {
    if (!VALID_SOURCES.has(source as SourceName)) throw new Error(`Unsupported source: ${source}.`);
  }
  return sources as SourceName[];
}

function containsContactIdentifier(value: string): boolean {
  return /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i.test(value) || /\b(?:mailto|tel):/i.test(value);
}

export function normalizeInput(rawInput: unknown): NormalizedInput {
  if (!isObject(rawInput)) throw new Error('Input must be a JSON object.');

  const sources = normalizeSources(rawInput.sources);
  const query = readString(rawInput.query, 'query', 200);
  const companyNames = readTextArray(rawInput.companyNames, 'companyNames', MAX_QUERY_COUNT, 200);
  const queries = uniqueStrings([query, ...companyNames]);
  if (queries.length > MAX_QUERY_COUNT) throw new Error(`Provide at most ${MAX_QUERY_COUNT} total company queries.`);
  for (const term of queries) {
    if (containsContactIdentifier(term)) {
      throw new Error('Company queries must be company names or tickers, not email or contact identifiers.');
    }
  }

  const companyNumbers = normalizeCompanyNumbers(rawInput.companyNumbers);
  const ciks = normalizeCiks(rawInput.ciks);
  const maxResultsValue = rawInput.maxResults ?? 10;
  if (!Number.isInteger(maxResultsValue) || Number(maxResultsValue) < 1 || Number(maxResultsValue) > 1000) {
    throw new Error('maxResults must be an integer between 1 and 1000.');
  }

  const inputApiKey = readString(rawInput.companiesHouseApiKey, 'companiesHouseApiKey', 200);
  const envApiKey = readString(process.env.COMPANIES_HOUSE_API_KEY, 'COMPANIES_HOUSE_API_KEY', 200);
  const companiesHouseApiKey = inputApiKey ?? envApiKey;
  const inputUserAgent = readString(rawInput.secUserAgent, 'secUserAgent', 255);
  const envUserAgent = readString(process.env.SEC_USER_AGENT, 'SEC_USER_AGENT', 255);
  const secUserAgent = inputUserAgent ?? envUserAgent ?? DEFAULT_SEC_USER_AGENT;
  if (!/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i.test(secUserAgent)) {
    throw new Error('secUserAgent must identify the application and include a contact email for SEC fair access.');
  }

  if (sources.includes('companies_house') && !companiesHouseApiKey) {
    throw new Error('companiesHouseApiKey is required when companies_house is selected.');
  }
  if (companyNumbers.length > 0 && !sources.includes('companies_house')) {
    throw new Error('Select companies_house when companyNumbers are provided.');
  }
  if (ciks.length > 0 && !sources.includes('sec_edgar')) {
    throw new Error('Select sec_edgar when ciks are provided.');
  }
  if (queries.length === 0 && companyNumbers.length === 0 && ciks.length === 0) {
    throw new Error('Provide at least one query, companyNames item, companyNumbers item, or ciks item.');
  }
  if (sources.includes('companies_house') && queries.length === 0 && companyNumbers.length === 0) {
    throw new Error('companies_house requires a company query or companyNumbers item.');
  }
  if (sources.includes('sec_edgar') && queries.length === 0 && ciks.length === 0) {
    throw new Error('sec_edgar requires a company query or ciks item.');
  }

  return {
    sources,
    queries,
    companyNumbers,
    ciks,
    maxResults: Number(maxResultsValue),
    companiesHouseApiKey,
    secUserAgent,
  };
}
