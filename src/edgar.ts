import type { CompanyRecord, RecentFiling, SecSubmissions, SecTickerEntry } from './types.js';
import { delay, fetchJson, normalizeDate, normalizeText, uniqueStrings } from './utils.js';

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
  const accessionPath = accessionNumber.replace(/-/g, '');
  return `${ARCHIVES_BASE}/${plainCik(cik)}/${accessionPath}/${encodeURI(primaryDocument)}`;
}

async function getTickerMap(userAgent: string): Promise<SecTickerEntry[]> {
  const data = await fetchJson<Record<string, SecTickerEntry>>(TICKERS_URL, { headers: secHeaders(userAgent) });
  return Object.values(data);
}

export async function searchSecCiks(query: string, userAgent: string, limit: number): Promise<string[]> {
  const term = query.toLowerCase();
  const entries = await getTickerMap(userAgent);
  return entries
    .filter((entry) =>
      normalizeText(entry.title)?.toLowerCase().includes(term)
      || normalizeText(entry.ticker)?.toLowerCase() === term
      || normalizeText(entry.ticker)?.toLowerCase().includes(term),
    )
    .slice(0, Math.min(Math.max(limit, 1), 100))
    .map((entry) => padCik(String(entry.cik_str ?? '')))
    .filter((cik) => cik !== '0000000000');
}

async function getSubmissions(cik: string, userAgent: string): Promise<SecSubmissions> {
  await delay(150);
  return fetchJson<SecSubmissions>(`${SUBMISSIONS_BASE}/CIK${padCik(cik)}.json`, { headers: secHeaders(userAgent) });
}

function normalizeRecentFilings(submissions: SecSubmissions): RecentFiling[] {
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

export async function getSecRecord(cik: string, query: string | null, userAgent: string): Promise<CompanyRecord | null> {
  const submissions = await getSubmissions(cik, userAgent);
  const entityId = padCik(String(submissions.cik ?? cik));
  const companyName = normalizeText(submissions.name);
  if (!companyName || entityId === '0000000000') return null;

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
