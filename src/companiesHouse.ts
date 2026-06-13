import type {
  CompaniesHouseFiling,
  CompaniesHouseFilingHistory,
  CompaniesHouseProfile,
  CompaniesHouseSearchResponse,
  CompanyRecord,
  RecentFiling,
  RegisteredAddress,
} from './types.js';
import { basicAuthHeader, fetchJson, normalizeDate, normalizeText, uniqueStrings } from './utils.js';

const API_BASE = 'https://api.company-information.service.gov.uk';
const WEB_BASE = 'https://find-and-update.company-information.service.gov.uk';
const ATTRIBUTION = 'Contains public sector information licensed under the Open Government Licence v3.0.';

function authHeaders(apiKey: string): HeadersInit {
  return {
    authorization: basicAuthHeader(apiKey),
    'user-agent': 'CompanyRegistryFilingsAggregator/1.0',
  };
}

function normalizeAddress(address: CompaniesHouseProfile['registered_office_address']): RegisteredAddress | null {
  if (!address) return null;
  return {
    addressLine1: normalizeText(address.address_line_1),
    addressLine2: normalizeText(address.address_line_2),
    locality: normalizeText(address.locality),
    region: normalizeText(address.region),
    postalCode: normalizeText(address.postal_code),
    country: normalizeText(address.country),
  };
}

function filingDocumentUrl(companyNumber: string, filing: CompaniesHouseFiling): string | null {
  const transactionId = normalizeText(filing.transaction_id);
  if (!transactionId) return null;
  return `${WEB_BASE}/company/${encodeURIComponent(companyNumber)}/filing-history/${encodeURIComponent(transactionId)}/document`;
}

function normalizeFilings(companyNumber: string, filings: CompaniesHouseFiling[]): RecentFiling[] {
  return filings.slice(0, 10).map((filing) => ({
    formType: normalizeText(filing.type),
    filingDate: normalizeDate(filing.date),
    accessionNumber: normalizeText(filing.transaction_id),
    documentUrl: filingDocumentUrl(companyNumber, filing),
  }));
}

export async function searchCompaniesHouse(query: string, apiKey: string, limit: number): Promise<string[]> {
  const url = new URL(`${API_BASE}/search/companies`);
  url.searchParams.set('q', query);
  url.searchParams.set('items_per_page', String(Math.min(Math.max(limit, 1), 100)));

  const data = await fetchJson<CompaniesHouseSearchResponse>(url.toString(), { headers: authHeaders(apiKey) });
  return uniqueStrings((data.items ?? []).map((item) => item.company_number));
}

async function getCompanyProfile(companyNumber: string, apiKey: string): Promise<CompaniesHouseProfile> {
  return fetchJson<CompaniesHouseProfile>(`${API_BASE}/company/${encodeURIComponent(companyNumber)}`, {
    headers: authHeaders(apiKey),
  });
}

async function getCompanyFilings(companyNumber: string, apiKey: string): Promise<CompaniesHouseFiling[]> {
  const url = new URL(`${API_BASE}/company/${encodeURIComponent(companyNumber)}/filing-history`);
  url.searchParams.set('items_per_page', '10');

  const data = await fetchJson<CompaniesHouseFilingHistory>(url.toString(), { headers: authHeaders(apiKey) });
  return data.items ?? [];
}

export async function getCompaniesHouseRecord(
  companyNumber: string,
  query: string | null,
  apiKey: string,
): Promise<CompanyRecord | null> {
  const profile = await getCompanyProfile(companyNumber, apiKey);
  const normalizedNumber = normalizeText(profile.company_number ?? companyNumber);
  const companyName = normalizeText(profile.company_name);
  if (!normalizedNumber || !companyName) return null;

  const filings = await getCompanyFilings(normalizedNumber, apiKey);
  const recentFilings = normalizeFilings(normalizedNumber, filings);

  return {
    source: 'companies_house',
    query,
    entityId: normalizedNumber,
    companyName,
    status: normalizeText(profile.company_status),
    entityType: normalizeText(profile.type),
    jurisdiction: normalizeText(profile.jurisdiction),
    incorporationDate: normalizeDate(profile.date_of_creation),
    sicCodes: uniqueStrings(profile.sic_codes ?? []),
    registeredAddress: normalizeAddress(profile.registered_office_address),
    tickers: [],
    exchanges: [],
    stateOfIncorporation: null,
    accountsNextDue: normalizeDate(profile.accounts?.next_due),
    accountsLastMadeUpTo: normalizeDate(profile.accounts?.last_accounts?.made_up_to),
    confirmationStatementNextDue: normalizeDate(profile.confirmation_statement?.next_due),
    confirmationStatementLastMadeUpTo: normalizeDate(profile.confirmation_statement?.last_made_up_to),
    dissolutionDate: normalizeDate(profile.date_of_cessation),
    fiscalYearEnd: null,
    lastFilingDate: recentFilings[0]?.filingDate ?? null,
    recentFilings,
    sourceUrl: `${WEB_BASE}/company/${encodeURIComponent(normalizedNumber)}`,
    attribution: ATTRIBUTION,
    scrapedAt: new Date().toISOString(),
  };
}
