import type { CompanyLookupResult, CompanyRecord, RecentFiling, SecSubmissions, SecTickerEntry } from './types.js';
import { fetchJson, isHttpStatus, normalizeDate, normalizeText, uniqueStrings } from './utils.js';

const TICKERS_URL = 'https://www.sec.gov/files/company_tickers.json';
const SUBMISSIONS_BASE = 'https://data.sec.gov/submissions';
const ARCHIVES_BASE = 'https://www.sec.gov/Archives/edgar/data';
const ATTRIBUTION = 'SEC EDGAR public company submissions data.';
const EXCLUDED_PERSON_OR_OWNERSHIP_FORMS = new Set(['3', '3/A', '4', '4/A', '5', '5/A', '144', '144/A']);

function secHeaders(userAgent: string): HeadersInit {
  return {
    'user-agent': userAgent,
  };
}

function padCik(cik: string): string {
  return cik.replace(/\D/g, '').padStart(10, '0');
}

function plainCik(cik: string): string {
  return String(Number(cik.replace(/\D/g, '') || '0'));
}

function archiveDocumentUrl(cik: string, accessionNumber: string | null, primaryDocument: string | null): string | null {
  if (!accessionNumber || !primaryDocument) return null;
  const pathParts = primaryDocument.replace(/\\/g, '/').split('/');
  if (pathParts.some((part) => !part || part === '.' || part === '..')) return null;
  const accessionPath = accessionNumber.replace(/-/g, '');
  const documentPath = pathParts.map((part) => encodeURIComponent(part)).join('/');
  return `${ARCHIVES_BASE}/${plainCik(cik)}/${accessionPath}/${documentPath}`;
}

export async function loadSecTickerEntries(
  userAgent: string,
  request: typeof fetchJson = fetchJson,
): Promise<SecTickerEntry[]> {
  const data = await request<Record<string, SecTickerEntry>>(TICKERS_URL, { headers: secHeaders(userAgent) });
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw new Error('SEC ticker index returned a malformed response.');
  }
  const entries = Object.values(data).filter((entry) => entry && typeof entry === 'object');
  if (entries.length === 0) throw new Error('SEC ticker index returned no entries.');
  return entries;
}

function searchableText(value: unknown): string {
  return (normalizeText(value) ?? '')
    .toLocaleLowerCase('en-US')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

export function searchSecCiks(entries: SecTickerEntry[], query: string, limit: number): string[] {
  const term = searchableText(query);
  if (!term) return [];
  const termTokens = term.split(' ');
  const ranked = entries.flatMap((entry) => {
    const title = searchableText(entry.title);
    const ticker = searchableText(entry.ticker);
    const cik = padCik(String(entry.cik_str ?? ''));
    if (cik === '0000000000') return [];
    let score: number | null = null;
    if (ticker === term) score = 0;
    else if (title === term) score = 1;
    else if (title.startsWith(`${term} `)) score = 2;
    else if (termTokens.every((token) => title.includes(token))) score = 3;
    else if (title.includes(term)) score = 4;
    else if (ticker.includes(term)) score = 5;
    return score === null ? [] : [{ cik, score, title, ticker }];
  }).sort((a, b) => a.score - b.score || a.title.localeCompare(b.title) || a.ticker.localeCompare(b.ticker));

  const ciks: string[] = [];
  const seen = new Set<string>();
  for (const entry of ranked) {
    if (seen.has(entry.cik)) continue;
    seen.add(entry.cik);
    ciks.push(entry.cik);
    if (ciks.length >= Math.min(Math.max(limit, 1), 1000)) break;
  }
  return ciks;
}

export function normalizeRecentFilings(submissions: SecSubmissions): RecentFiling[] {
  const recent = submissions.filings?.recent;
  const forms = recent?.form ?? [];
  const dates = recent?.filingDate ?? [];
  const accessionNumbers = recent?.accessionNumber ?? [];
  const primaryDocuments = recent?.primaryDocument ?? [];

  return forms.reduce<RecentFiling[]>((filings, form, index) => {
    if (filings.length >= 10) return filings;
    const formType = normalizeText(form);
    if (formType && EXCLUDED_PERSON_OR_OWNERSHIP_FORMS.has(formType.toUpperCase())) return filings;
    if (formType && /^(SC |SCHEDULE )13[DG]/i.test(formType)) return filings;
    const accessionNumber = normalizeText(accessionNumbers[index]);
    filings.push({
      formType,
      filingDate: normalizeDate(dates[index]),
      accessionNumber,
      documentUrl: archiveDocumentUrl(String(submissions.cik ?? ''), accessionNumber, normalizeText(primaryDocuments[index])),
    });
    return filings;
  }, []);
}

function isCompanyEntity(submissions: SecSubmissions): boolean {
  const entityType = normalizeText(submissions.entityType)?.toLowerCase();
  return (
    entityType === 'operating'
    || entityType === 'investment'
    || Number(submissions.insiderTransactionForIssuerExists) === 1
    || Boolean(normalizeText(submissions.sic))
    || (submissions.tickers?.length ?? 0) > 0
    || (submissions.exchanges?.length ?? 0) > 0
  );
}

export function normalizeSecRecord(
  cik: string,
  query: string | null,
  submissions: SecSubmissions,
): CompanyRecord | null {
  const entityId = padCik(String(submissions.cik ?? cik));
  const companyName = normalizeText(submissions.name);
  if (!companyName || entityId === '0000000000') throw new Error('SEC submission is missing entity identity fields.');
  if (!isCompanyEntity(submissions)) return null;

  const sicCodes = uniqueStrings([
    submissions.sic ? `SIC:${submissions.sic}` : null,
    submissions.sicDescription ? `SIC_DESCRIPTION:${submissions.sicDescription}` : null,
  ]);
  const recentFilings = normalizeRecentFilings(submissions);

  return {
    source: 'sec_edgar',
    query,
    entityId,
    companyName,
    status: null,
    entityType: 'public_company',
    jurisdiction: 'US SEC',
    incorporationDate: null,
    sicCodes,
    registeredAddress: null,
    tickers: uniqueStrings(submissions.tickers ?? []),
    exchanges: uniqueStrings(submissions.exchanges ?? []),
    stateOfIncorporation: normalizeText(submissions.stateOfIncorporation),
    accountsNextDue: null,
    accountsLastMadeUpTo: null,
    confirmationStatementNextDue: null,
    confirmationStatementLastMadeUpTo: null,
    dissolutionDate: null,
    fiscalYearEnd: normalizeText(submissions.fiscalYearEnd),
    lastFilingDate: recentFilings[0]?.filingDate ?? null,
    recentFilings,
    sourceUrl: `https://www.sec.gov/edgar/browse/?CIK=${encodeURIComponent(plainCik(entityId))}&owner=exclude`,
    attribution: ATTRIBUTION,
    scrapedAt: new Date().toISOString(),
  };
}

export async function getSecRecord(
  cik: string,
  query: string | null,
  userAgent: string,
  request: typeof fetchJson = fetchJson,
): Promise<CompanyLookupResult> {
  try {
    const submissions = await request<SecSubmissions>(`${SUBMISSIONS_BASE}/CIK${padCik(cik)}.json`, {
      headers: secHeaders(userAgent),
    });
    if (!submissions || typeof submissions !== 'object') {
      throw new Error('SEC submissions endpoint returned a malformed response.');
    }
    const record = normalizeSecRecord(cik, query, submissions);
    return {
      record,
      warnings: record ? [] : [`Skipped CIK ${padCik(cik)} because SEC does not classify it as a company or issuer.`],
    };
  } catch (error) {
    if (isHttpStatus(error, 404)) return { record: null, warnings: [] };
    throw error;
  }
}
