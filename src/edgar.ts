import type {
  CompanyLookupResult,
  CompanyRecord,
  RecentFiling,
  SecAddressValue,
  SecCompanyAddress,
  SecSubmissions,
  SecTickerEntry,
} from './types.js';
import {
  fetchJson,
  fetchText,
  isHttpStatus,
  normalizeDate,
  normalizeDateTime,
  normalizePublicWebsite,
  normalizeText,
  uniqueStrings,
} from './utils.js';

const TICKERS_URL = 'https://www.sec.gov/files/company_tickers.json';
const SUBMISSIONS_BASE = 'https://data.sec.gov/submissions';
const ARCHIVES_BASE = 'https://www.sec.gov/Archives/edgar/data';
const ATTRIBUTION = 'SEC EDGAR public company submissions data.';
const EXCLUDED_PERSON_OR_OWNERSHIP_FORMS = new Set(['3', '3/A', '4', '4/A', '5', '5/A', '144', '144/A']);
const WEBSITE_IDENTITY_STOP_WORDS = new Set([
  'company',
  'corporation',
  'corp',
  'incorporated',
  'inc',
  'limited',
  'ltd',
  'plc',
  'holdings',
  'holding',
  'group',
  'the',
]);
const EXCLUDED_WEBSITE_DOMAINS = [
  'sec.gov',
  'xbrl.org',
  'w3.org',
  'fasb.org',
  'irs.gov',
  'youtube.com',
  'youtu.be',
  'facebook.com',
  'instagram.com',
  'linkedin.com',
  'twitter.com',
  'x.com',
];

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

function secFilingChangeType(formType: string | null): string {
  const form = formType?.toUpperCase().replace(/\/A$/, '') ?? '';
  if (['10-K', '20-F', '40-F'].includes(form)) return 'annual_report';
  if (form === '10-Q') return 'quarterly_report';
  if (['8-K', '6-K'].includes(form)) return 'material_event';
  if (/^(?:S-|F-|POS |424B|FWP)/.test(form)) return 'securities_offering';
  if (/^(?:DEF|PRE) 14A/.test(form)) return 'proxy_statement';
  if (/^(?:8-A|10-12)/.test(form)) return 'securities_registration';
  if (/^13F/.test(form)) return 'institutional_holdings';
  if (/^N-/.test(form)) return 'fund_report';
  return 'other_filing';
}

function normalizeFilingItems(value: unknown): string[] {
  const text = normalizeText(value);
  return text ? uniqueStrings(text.split(',').map((item) => item.trim())) : [];
}

export function normalizeRecentFilings(submissions: SecSubmissions, maximum = 20): RecentFiling[] {
  const recent = submissions.filings?.recent;
  const forms = recent?.form ?? [];
  const dates = recent?.filingDate ?? [];
  const reportDates = recent?.reportDate ?? [];
  const acceptedDates = recent?.acceptanceDateTime ?? [];
  const accessionNumbers = recent?.accessionNumber ?? [];
  const items = recent?.items ?? [];
  const primaryDocuments = recent?.primaryDocument ?? [];
  const primaryDocumentDescriptions = recent?.primaryDocDescription ?? [];

  return forms.reduce<RecentFiling[]>((filings, form, index) => {
    if (filings.length >= maximum) return filings;
    const formType = normalizeText(form);
    if (formType && EXCLUDED_PERSON_OR_OWNERSHIP_FORMS.has(formType.toUpperCase())) return filings;
    if (formType && /^(SC |SCHEDULE )13[DG]/i.test(formType)) return filings;
    const accessionNumber = normalizeText(accessionNumbers[index]);
    filings.push({
      formType,
      filingDate: normalizeDate(dates[index]),
      reportDate: normalizeDate(reportDates[index]),
      acceptedAt: normalizeDateTime(acceptedDates[index]),
      accessionNumber,
      category: secFilingChangeType(formType),
      subcategory: null,
      description: normalizeText(primaryDocumentDescriptions[index]),
      changeType: secFilingChangeType(formType),
      isAmendment: /\/A$/i.test(formType ?? ''),
      filingItems: normalizeFilingItems(items[index]),
      paperFiled: null,
      pageCount: null,
      documentUrl: archiveDocumentUrl(String(submissions.cik ?? ''), accessionNumber, normalizeText(primaryDocuments[index])),
    });
    return filings;
  }, []);
}

function normalizeSecAddress(address: SecAddressValue | undefined): SecCompanyAddress | null {
  if (!address) return null;
  const street1 = normalizeText(address.street1);
  const street2 = normalizeText(address.street2);
  const city = normalizeText(address.city);
  const stateOrCountry = normalizeText(address.stateOrCountry);
  const stateOrCountryDescription = normalizeText(address.stateOrCountryDescription);
  const postalCode = normalizeText(address.zipCode);
  const normalized = {
    street1,
    street2,
    city,
    stateOrCountry,
    stateOrCountryDescription,
    postalCode,
    formattedAddress: uniqueStrings([
      street1,
      street2,
      city,
      stateOrCountryDescription ?? stateOrCountry,
      postalCode,
    ]).join(', ') || null,
  };
  return Object.values(normalized).some(Boolean) ? normalized : null;
}

function normalizeFormerNames(submissions: SecSubmissions) {
  return (submissions.formerNames ?? []).flatMap((value) => {
    const name = normalizeText(value?.name);
    if (!name) return [];
    return [{
      name,
      effectiveFrom: normalizeDate(value.from),
      ceasedOn: normalizeDate(value.to),
    }];
  });
}

function isExcludedWebsiteDomain(domain: string): boolean {
  return EXCLUDED_WEBSITE_DOMAINS.some((excluded) => domain === excluded || domain.endsWith(`.${excluded}`));
}

function companyIdentityTokens(companyName: string, tickers: string[]): string[] {
  return uniqueStrings([
    ...companyName.toLowerCase().split(/[^a-z0-9]+/),
    ...tickers.map((ticker) => ticker.toLowerCase()),
  ]).filter((token) => token.length >= 2 && !WEBSITE_IDENTITY_STOP_WORDS.has(token));
}

function decodeHtmlLinkEntities(html: string): string {
  return html
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'");
}

function htmlExternalUrls(html: string): Array<{ rawUrl: string; index: number }> {
  const urls: Array<{ rawUrl: string; index: number }> = [];
  const pattern = /https?:\/\/[^\s"'<>]+/gi;
  for (const match of html.matchAll(pattern)) {
    if (match.index === undefined) continue;
    const rawUrl = match[0].replace(/[),.;\]}]+$/g, '');
    urls.push({ rawUrl, index: match.index });
  }
  return urls;
}

export function extractOfficialWebsiteFromFiling(
  html: string,
  companyName: string,
  tickers: string[],
): { officialWebsite: { url: string; domain: string }; investorWebsite: { url: string; domain: string } | null } | null {
  const decodedHtml = decodeHtmlLinkEntities(html);
  const tokens = companyIdentityTokens(companyName, tickers);
  const candidates = new Map<string, {
    count: number;
    identityMatch: boolean;
    websiteContext: boolean;
    investorContext: boolean;
    firstUrl: { url: string; domain: string };
    investorUrl: { url: string; domain: string } | null;
  }>();

  for (const { rawUrl, index } of htmlExternalUrls(decodedHtml)) {
    const website = normalizePublicWebsite(rawUrl);
    if (!website || isExcludedWebsiteDomain(website.domain)) continue;
    const compactDomain = website.domain.replace(/[^a-z0-9]/g, '');
    const identityMatch = tokens.some((token) => compactDomain.includes(token.replace(/[^a-z0-9]/g, '')));
    const context = decodedHtml.slice(Math.max(0, index - 240), index + rawUrl.length + 240)
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ');
    const websiteContext = /\b(?:company|corporate|our) website\b|\binternet address\b/i.test(context);
    const investorContext = /\binvestor(?:s| relations)?\b/i.test(context);
    if (!identityMatch && !websiteContext && !investorContext) continue;

    const existing = candidates.get(website.domain);
    if (existing) {
      existing.count += 1;
      existing.identityMatch ||= identityMatch;
      existing.websiteContext ||= websiteContext;
      existing.investorContext ||= investorContext;
      if (investorContext && !existing.investorUrl) existing.investorUrl = website;
    } else {
      candidates.set(website.domain, {
        count: 1,
        identityMatch,
        websiteContext,
        investorContext,
        firstUrl: website,
        investorUrl: investorContext ? website : null,
      });
    }
  }

  const ranked = [...candidates.entries()].map(([domain, value]) => ({
    domain,
    value,
    score: Math.min(value.count, 10)
      + (value.identityMatch ? 25 : 0)
      + (value.websiteContext ? 30 : 0)
      + (value.investorContext ? 10 : 0),
  })).filter(({ score }) => score >= 25)
    .sort((left, right) => right.score - left.score || left.domain.localeCompare(right.domain));
  const best = ranked[0]?.value;
  if (!best) return null;
  const parsed = new URL(best.firstUrl.url);
  return {
    officialWebsite: {
      url: `${parsed.protocol}//${parsed.host}/`,
      domain: best.firstUrl.domain,
    },
    investorWebsite: best.investorUrl,
  };
}

async function enrichSecWebsiteFromFiling(
  record: CompanyRecord,
  userAgent: string,
  documentRequest: typeof fetchText,
): Promise<boolean> {
  if (record.officialWebsiteUrl) return false;
  const filing = record.recentFilings.find((item) => (
    /^(?:10-K|20-F|40-F)(?:\/A)?$/i.test(item.formType ?? '') && item.documentUrl
  )) ?? record.recentFilings.find((item) => /^(?:10-Q)(?:\/A)?$/i.test(item.formType ?? '') && item.documentUrl);
  if (!filing?.documentUrl) return false;
  const html = await documentRequest(
    filing.documentUrl,
    { headers: secHeaders(userAgent) },
    { maxBytes: 2_000_000 },
  );
  const websites = extractOfficialWebsiteFromFiling(html, record.companyName, record.tickers);
  if (!websites) return false;
  record.officialWebsiteUrl = websites.officialWebsite.url;
  record.officialWebsiteDomain = websites.officialWebsite.domain;
  record.investorRelationsUrl = websites.investorWebsite?.url ?? null;
  record.investorRelationsDomain = websites.investorWebsite?.domain ?? null;
  record.websiteSource = 'sec_filing_document';
  return true;
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
  maxFilingsPerCompany = 20,
): CompanyRecord | null {
  const entityId = padCik(String(submissions.cik ?? cik));
  const companyName = normalizeText(submissions.name);
  if (!companyName || entityId === '0000000000') throw new Error('SEC submission is missing entity identity fields.');
  if (!isCompanyEntity(submissions)) return null;

  const sicCodes = uniqueStrings([
    submissions.sic ? `SIC:${submissions.sic}` : null,
    submissions.sicDescription ? `SIC_DESCRIPTION:${submissions.sicDescription}` : null,
  ]);
  const recentFilings = normalizeRecentFilings(submissions, maxFilingsPerCompany);
  const officialWebsite = normalizePublicWebsite(submissions.website);
  const investorWebsite = normalizePublicWebsite(submissions.investorWebsite);

  return {
    source: 'sec_edgar',
    query,
    entityId,
    entityIdType: 'cik',
    companyNumber: null,
    cik: entityId,
    companyName,
    previousNames: normalizeFormerNames(submissions),
    status: null,
    statusDetail: null,
    entityType: 'public_company',
    entitySubtype: normalizeText(submissions.entityType),
    jurisdiction: 'US SEC',
    incorporationDate: null,
    legalEntityIdentifier: normalizeText(submissions.lei),
    employerIdentificationNumber: normalizeText(submissions.ein),
    companyCategory: normalizeText(submissions.category),
    sicCodes,
    officialWebsiteUrl: officialWebsite?.url ?? null,
    officialWebsiteDomain: officialWebsite?.domain ?? null,
    investorRelationsUrl: investorWebsite?.url ?? null,
    investorRelationsDomain: investorWebsite?.domain ?? null,
    websiteSource: officialWebsite || investorWebsite ? 'sec_edgar_submissions' : null,
    registeredAddress: null,
    registeredOfficeInDispute: null,
    registeredOfficeUndeliverable: null,
    businessAddress: normalizeSecAddress(submissions.addresses?.business),
    mailingAddress: normalizeSecAddress(submissions.addresses?.mailing),
    tickers: uniqueStrings(submissions.tickers ?? []),
    exchanges: uniqueStrings(submissions.exchanges ?? []),
    stateOfIncorporation: normalizeText(submissions.stateOfIncorporation),
    stateOfIncorporationDescription: normalizeText(submissions.stateOfIncorporationDescription),
    accountsNextDue: null,
    accountsLastMadeUpTo: null,
    confirmationStatementNextDue: null,
    confirmationStatementLastMadeUpTo: null,
    dissolutionDate: null,
    fiscalYearEnd: normalizeText(submissions.fiscalYearEnd),
    lastFilingDate: recentFilings[0]?.filingDate ?? null,
    latestFilingChangeType: recentFilings[0]?.changeType ?? null,
    recentFilingChangeTypes: uniqueStrings(recentFilings.map((filing) => filing.changeType)),
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
  maxFilingsPerCompany = 20,
  documentRequest: typeof fetchText = fetchText,
): Promise<CompanyLookupResult> {
  try {
    const submissions = await request<SecSubmissions>(`${SUBMISSIONS_BASE}/CIK${padCik(cik)}.json`, {
      headers: secHeaders(userAgent),
    });
    if (!submissions || typeof submissions !== 'object') {
      throw new Error('SEC submissions endpoint returned a malformed response.');
    }
    const record = normalizeSecRecord(cik, query, submissions, maxFilingsPerCompany);
    const warnings: string[] = [];
    if (record && !record.officialWebsiteUrl) {
      try {
        await enrichSecWebsiteFromFiling(record, userAgent, documentRequest);
      } catch (error) {
        warnings.push(`Official website filing fallback unavailable for ${record.entityId}: ${(error as Error).message}`);
      }
    }
    return {
      record,
      warnings: record ? warnings : [`Skipped CIK ${padCik(cik)} because SEC does not classify it as a company or issuer.`],
    };
  } catch (error) {
    if (isHttpStatus(error, 404)) return { record: null, warnings: [] };
    throw error;
  }
}
