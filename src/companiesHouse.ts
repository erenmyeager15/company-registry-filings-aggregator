import type {
  CompaniesHouseFiling,
  CompaniesHouseFilingHistory,
  CompaniesHouseProfile,
  CompaniesHouseSearchResponse,
  CompanyLookupResult,
  CompanyRecord,
  RecentFiling,
  RegisteredAddress,
} from './types.js';
import {
  basicAuthHeader,
  fetchJson,
  isHttpStatus,
  normalizeDate,
  normalizeText,
  uniqueStrings,
} from './utils.js';

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
  const premises = normalizeText(address.premises);
  const poBox = normalizeText(address.po_box);
  const addressLine1 = normalizeText(address.address_line_1);
  const addressLine2 = normalizeText(address.address_line_2);
  const locality = normalizeText(address.locality);
  const region = normalizeText(address.region);
  const postalCode = normalizeText(address.postal_code);
  const country = normalizeText(address.country);
  const normalized = {
    premises,
    poBox,
    addressLine1,
    addressLine2,
    locality,
    region,
    postalCode,
    country,
    formattedAddress: uniqueStrings([
      premises,
      poBox ? `PO Box ${poBox}` : null,
      addressLine1,
      addressLine2,
      locality,
      region,
      postalCode,
      country,
    ]).join(', ') || null,
  };
  return Object.values(normalized).some(Boolean) ? normalized : null;
}

function normalizePreviousNames(profile: CompaniesHouseProfile) {
  return (profile.previous_company_names ?? []).flatMap((value) => {
    const name = normalizeText(value?.name);
    if (!name) return [];
    return [{
      name,
      effectiveFrom: normalizeDate(value.effective_from),
      ceasedOn: normalizeDate(value.ceased_on),
    }];
  });
}

function filingDocumentUrl(companyNumber: string, filing: CompaniesHouseFiling): string | null {
  const transactionId = normalizeText(filing.transaction_id);
  if (!transactionId) return null;
  return `${WEB_BASE}/company/${encodeURIComponent(companyNumber)}/filing-history/${encodeURIComponent(transactionId)}/document`;
}

function companiesHouseChangeType(filing: CompaniesHouseFiling): string {
  const category = normalizeText(filing.category)?.toLowerCase() ?? '';
  const description = normalizeText(filing.description)?.toLowerCase() ?? '';
  const type = normalizeText(filing.type)?.toLowerCase() ?? '';
  const combined = `${category} ${description} ${type}`;
  if (/address|registered.office/.test(combined)) return 'registered_office';
  if (/change.of.name|name.change/.test(combined)) return 'company_identity';
  if (/accounts/.test(combined)) return 'accounts';
  if (/confirmation.statement|annual.return|\breturn\b/.test(combined)) return 'confirmation_statement';
  if (/capital|share/.test(combined)) return 'share_capital';
  if (/mortgage|charge/.test(combined)) return 'charges';
  if (/insolvency|liquidation|administration/.test(combined)) return 'insolvency';
  if (/incorporation|reregistration|restoration|dissolution|strike.off/.test(combined)) return 'company_lifecycle';
  if (/officer|persons.with.significant.control|resolution|constitution/.test(combined)) return 'governance';
  return category.replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '') || 'other_filing';
}

function normalizeFilings(
  companyNumber: string,
  filings: CompaniesHouseFiling[],
  maximum: number,
): RecentFiling[] {
  return filings.slice(0, maximum).map((filing) => {
    const formType = normalizeText(filing.type);
    const description = normalizeText(filing.description);
    const pageCount = Number(filing.pages);
    return {
      formType,
      filingDate: normalizeDate(filing.date),
      reportDate: null,
      acceptedAt: null,
      accessionNumber: normalizeText(filing.transaction_id),
      category: normalizeText(filing.category),
      subcategory: normalizeText(filing.subcategory),
      description,
      changeType: companiesHouseChangeType(filing),
      isAmendment: /amend|correct|replacement|annotation/i.test(`${formType ?? ''} ${description ?? ''}`),
      filingItems: [],
      paperFiled: typeof filing.paper_filed === 'boolean' ? filing.paper_filed : null,
      pageCount: Number.isInteger(pageCount) && pageCount >= 0 ? pageCount : null,
      documentUrl: filingDocumentUrl(companyNumber, filing),
    };
  });
}

export async function searchCompaniesHouse(
  query: string,
  apiKey: string,
  limit: number,
  request: typeof fetchJson = fetchJson,
): Promise<string[]> {
  const maximum = Math.min(Math.max(limit, 1), 1000);
  const numbers: string[] = [];
  const seenNumbers = new Set<string>();
  const seenOffsets = new Set<number>();
  let startIndex = 0;
  let pageCount = 0;

  while (numbers.length < maximum) {
    pageCount += 1;
    if (pageCount > 10) throw new Error('Companies House search exceeded the 10-page safety limit.');
    if (seenOffsets.has(startIndex)) throw new Error('Companies House pagination repeated an offset.');
    seenOffsets.add(startIndex);
    const pageSize = Math.min(100, maximum - numbers.length);
    const url = new URL(`${API_BASE}/search/companies`);
    url.searchParams.set('q', query);
    url.searchParams.set('items_per_page', String(pageSize));
    url.searchParams.set('start_index', String(startIndex));

    const data = await request<CompaniesHouseSearchResponse>(url.toString(), { headers: authHeaders(apiKey) });
    if (!data || typeof data !== 'object' || (data.items !== undefined && !Array.isArray(data.items))) {
      throw new Error('Companies House search returned a malformed response.');
    }
    const items = data.items ?? [];
    const countBeforePage = numbers.length;
    for (const item of items) {
      const number = normalizeText(item?.company_number)?.replace(/\s+/g, '').toUpperCase();
      if (!number || seenNumbers.has(number)) continue;
      seenNumbers.add(number);
      numbers.push(number);
      if (numbers.length >= maximum) break;
    }

    const nextIndex = startIndex + items.length;
    const totalResults = Number(data.total_results);
    if (items.length === 0 || nextIndex <= startIndex) break;
    if (Number.isFinite(totalResults)) {
      if (nextIndex >= totalResults) break;
    } else if (items.length < pageSize) {
      break;
    }
    if (numbers.length === countBeforePage) throw new Error('Companies House pagination repeated the same companies.');
    startIndex = nextIndex;
  }

  return numbers;
}

async function getCompanyProfile(
  companyNumber: string,
  apiKey: string,
  request: typeof fetchJson,
): Promise<CompaniesHouseProfile | null> {
  try {
    const profile = await request<CompaniesHouseProfile>(`${API_BASE}/company/${encodeURIComponent(companyNumber)}`, {
      headers: authHeaders(apiKey),
    });
    if (!profile || typeof profile !== 'object') throw new Error('Companies House profile returned a malformed response.');
    return profile;
  } catch (error) {
    if (isHttpStatus(error, 404)) return null;
    throw error;
  }
}

async function getCompanyFilings(
  companyNumber: string,
  apiKey: string,
  request: typeof fetchJson,
  maximum: number,
): Promise<CompaniesHouseFiling[]> {
  const url = new URL(`${API_BASE}/company/${encodeURIComponent(companyNumber)}/filing-history`);
  url.searchParams.set('items_per_page', String(Math.min(Math.max(maximum, 1), 100)));

  const data = await request<CompaniesHouseFilingHistory>(url.toString(), { headers: authHeaders(apiKey) });
  if (!data || typeof data !== 'object' || (data.items !== undefined && !Array.isArray(data.items))) {
    throw new Error('Companies House filing history returned a malformed response.');
  }
  return data.items ?? [];
}

export function normalizeCompaniesHouseRecord(
  companyNumber: string,
  query: string | null,
  profile: CompaniesHouseProfile,
  filings: CompaniesHouseFiling[],
  maxFilingsPerCompany = 20,
): CompanyRecord {
  const normalizedNumber = normalizeText(profile.company_number ?? companyNumber)?.replace(/\s+/g, '').toUpperCase();
  const companyName = normalizeText(profile.company_name);
  if (!normalizedNumber || !companyName) throw new Error('Companies House profile is missing company identity fields.');
  const recentFilings = normalizeFilings(normalizedNumber, filings, maxFilingsPerCompany);

  return {
    source: 'companies_house',
    query,
    entityId: normalizedNumber,
    entityIdType: 'company_number',
    companyNumber: normalizedNumber,
    cik: null,
    companyName,
    previousNames: normalizePreviousNames(profile),
    status: normalizeText(profile.company_status),
    statusDetail: normalizeText(profile.company_status_detail),
    entityType: normalizeText(profile.type),
    entitySubtype: normalizeText(profile.subtype),
    jurisdiction: normalizeText(profile.jurisdiction),
    incorporationDate: normalizeDate(profile.date_of_creation),
    legalEntityIdentifier: null,
    employerIdentificationNumber: null,
    companyCategory: null,
    sicCodes: uniqueStrings(profile.sic_codes ?? []),
    officialWebsiteUrl: null,
    officialWebsiteDomain: null,
    investorRelationsUrl: null,
    investorRelationsDomain: null,
    websiteSource: null,
    registeredAddress: normalizeAddress(profile.registered_office_address),
    registeredOfficeInDispute: typeof profile.registered_office_is_in_dispute === 'boolean'
      ? profile.registered_office_is_in_dispute
      : null,
    registeredOfficeUndeliverable: typeof profile.undeliverable_registered_office_address === 'boolean'
      ? profile.undeliverable_registered_office_address
      : null,
    businessAddress: null,
    mailingAddress: null,
    tickers: [],
    exchanges: [],
    stateOfIncorporation: null,
    stateOfIncorporationDescription: null,
    accountsNextDue: normalizeDate(profile.accounts?.next_due),
    accountsLastMadeUpTo: normalizeDate(profile.accounts?.last_accounts?.made_up_to),
    confirmationStatementNextDue: normalizeDate(profile.confirmation_statement?.next_due),
    confirmationStatementLastMadeUpTo: normalizeDate(profile.confirmation_statement?.last_made_up_to),
    dissolutionDate: normalizeDate(profile.date_of_cessation),
    fiscalYearEnd: null,
    lastFilingDate: recentFilings[0]?.filingDate ?? null,
    latestFilingChangeType: recentFilings[0]?.changeType ?? null,
    recentFilingChangeTypes: uniqueStrings(recentFilings.map((filing) => filing.changeType)),
    recentFilings,
    sourceUrl: `${WEB_BASE}/company/${encodeURIComponent(normalizedNumber)}`,
    attribution: ATTRIBUTION,
    scrapedAt: new Date().toISOString(),
  };
}

export async function getCompaniesHouseRecord(
  companyNumber: string,
  query: string | null,
  apiKey: string,
  request: typeof fetchJson = fetchJson,
  maxFilingsPerCompany = 20,
): Promise<CompanyLookupResult> {
  const profile = await getCompanyProfile(companyNumber, apiKey, request);
  if (!profile) return { record: null, warnings: [] };
  const normalizedNumber = normalizeText(profile.company_number ?? companyNumber)?.replace(/\s+/g, '').toUpperCase();
  if (!normalizedNumber) throw new Error('Companies House profile is missing a company number.');

  let filings: CompaniesHouseFiling[] = [];
  const warnings: string[] = [];
  try {
    filings = await getCompanyFilings(normalizedNumber, apiKey, request, maxFilingsPerCompany);
  } catch (error) {
    warnings.push(`Filing history unavailable for ${normalizedNumber}: ${(error as Error).message}`);
  }
  return {
    record: normalizeCompaniesHouseRecord(normalizedNumber, query, profile, filings, maxFilingsPerCompany),
    warnings,
  };
}
