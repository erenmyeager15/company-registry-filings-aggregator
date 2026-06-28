import { Actor, log } from 'apify';
import { getCompaniesHouseRecord, searchCompaniesHouse } from './companiesHouse.js';
import { getSecRecord, searchSecCiks } from './edgar.js';
import type { ActorInput, CompanyRecord, NormalizedInput, SourceName } from './types.js';
import { normalizeText, uniqueStrings } from './utils.js';

const DEFAULT_SOURCES: SourceName[] = ['sec_edgar'];
const COMPANY_RECORD_EVENT = 'company-record-scraped';
const DEFAULT_SEC_USER_AGENT = 'CompanyRegistryFilingsAggregator/1.0 contact@example.com';

function normalizeInput(rawInput: ActorInput | null): NormalizedInput {
  const sources = uniqueStrings(rawInput?.sources ?? DEFAULT_SOURCES)
    .filter((source): source is SourceName => source === 'companies_house' || source === 'sec_edgar');
  const queries = uniqueStrings([
    rawInput?.query,
    ...(rawInput?.companyNames ?? []),
  ]);

  return {
    sources: sources.length ? sources : DEFAULT_SOURCES,
    queries,
    companyNumbers: uniqueStrings(rawInput?.companyNumbers ?? []).map((value) => value.replace(/\s+/g, '').toUpperCase()),
    ciks: uniqueStrings(rawInput?.ciks ?? []).map((value) => value.replace(/\D/g, '').padStart(10, '0')),
    maxResults: Math.min(Math.max(rawInput?.maxResults ?? 10, 1), 1000),
    companiesHouseApiKey: normalizeText(rawInput?.companiesHouseApiKey) ?? normalizeText(process.env.COMPANIES_HOUSE_API_KEY),
    secUserAgent: normalizeText(rawInput?.secUserAgent) ?? normalizeText(process.env.SEC_USER_AGENT) ?? DEFAULT_SEC_USER_AGENT,
  };
}

function matchesQuery(record: CompanyRecord, query: string | null): boolean {
  if (!query) return true;
  const term = query.toLowerCase();
  const haystack = [
    record.entityId,
    record.companyName,
    record.status,
    record.entityType,
    record.jurisdiction,
    record.stateOfIncorporation,
    ...record.sicCodes,
    ...record.tickers,
    ...record.exchanges,
  ].filter(Boolean).join(' ').toLowerCase();
  return haystack.includes(term);
}

async function collectCompaniesHouse(input: NormalizedInput, remaining: () => number): Promise<CompanyRecord[]> {
  const records: CompanyRecord[] = [];
  if (!input.companiesHouseApiKey) {
    log.warning('Companies House selected but no API key was provided; skipping companies_house.');
    return records;
  }

  const candidates = new Map<string, string | null>();
  for (const companyNumber of input.companyNumbers) candidates.set(companyNumber, null);
  for (const query of input.queries) {
    if (remaining() - records.length <= 0) break;
    let numbers: string[] = [];
    try {
      numbers = await searchCompaniesHouse(query, input.companiesHouseApiKey, input.maxResults);
    } catch (error) {
      log.warning('Skipping Companies House search query after request failure', {
        query,
        reason: error instanceof Error ? error.message : String(error),
      });
      continue;
    }
    for (const number of numbers) {
      if (!candidates.has(number)) candidates.set(number, query);
    }
  }

  for (const [companyNumber, query] of candidates) {
    if (records.length >= remaining()) break;
    let record: CompanyRecord | null = null;
    try {
      record = await getCompaniesHouseRecord(companyNumber, query, input.companiesHouseApiKey);
    } catch (error) {
      log.warning('Skipping Companies House company after request failure', {
        companyNumber,
        reason: error instanceof Error ? error.message : String(error),
      });
      continue;
    }
    if (record && matchesQuery(record, query)) records.push(record);
  }

  return records;
}

async function collectSec(input: NormalizedInput, remaining: () => number): Promise<CompanyRecord[]> {
  const records: CompanyRecord[] = [];
  const candidates = new Map<string, string | null>();
  for (const cik of input.ciks) candidates.set(cik, null);
  for (const query of input.queries) {
    if (remaining() - records.length <= 0) break;
    let ciks: string[] = [];
    try {
      ciks = await searchSecCiks(query, input.secUserAgent, input.maxResults);
    } catch (error) {
      log.warning('Skipping SEC EDGAR search query after request failure', {
        query,
        reason: error instanceof Error ? error.message : String(error),
      });
      continue;
    }
    for (const cik of ciks) {
      if (!candidates.has(cik)) candidates.set(cik, query);
    }
  }

  for (const [cik, query] of candidates) {
    if (records.length >= remaining()) break;
    let record: CompanyRecord | null = null;
    try {
      record = await getSecRecord(cik, query, input.secUserAgent);
    } catch (error) {
      log.warning('Skipping SEC EDGAR company after request failure', {
        cik,
        reason: error instanceof Error ? error.message : String(error),
      });
      continue;
    }
    if (record && matchesQuery(record, query)) records.push(record);
  }

  return records;
}

async function pushUnique(records: CompanyRecord[], seen: Set<string>, remaining: () => number): Promise<{ saved: number; stopped: boolean }> {
  let saved = 0;
  for (const record of records) {
    if (remaining() <= 0) break;
    const key = `${record.source}:${record.entityId}`;
    if (seen.has(key)) continue;

    const chargeResult = await Actor.pushData(record, COMPANY_RECORD_EVENT);
    const recordWasSaved = chargeResult.chargedCount > 0 || !chargeResult.eventChargeLimitReached;
    if (recordWasSaved) {
      seen.add(key);
      saved += 1;
    }

    if (chargeResult.eventChargeLimitReached) {
      return { saved, stopped: true };
    }
  }

  return { saved, stopped: false };
}

await Actor.init();

try {
  const input = normalizeInput(await Actor.getInput<ActorInput>());
  const seen = new Set<string>();
  let savedCount = 0;
  let stoppedByChargeLimit = false;
  const remaining = () => input.maxResults - savedCount;

  if (!input.queries.length && !input.companyNumbers.length && !input.ciks.length) {
    throw new Error('Provide at least one query, companyNames item, companyNumbers item, or ciks item.');
  }

  log.info('Starting company registry and filings aggregation', {
    sources: input.sources,
    queries: input.queries,
    companyNumbers: input.companyNumbers.length,
    ciks: input.ciks.length,
    maxResults: input.maxResults,
  });

  for (const source of input.sources) {
    if (remaining() <= 0 || stoppedByChargeLimit) break;
    let records: CompanyRecord[] = [];

    try {
      if (source === 'companies_house') {
        records = await collectCompaniesHouse(input, remaining);
      } else if (source === 'sec_edgar') {
        records = await collectSec(input, remaining);
      }
    } catch (error) {
      log.warning('Skipping company registry source after request failure', {
        source,
        reason: error instanceof Error ? error.message : String(error),
      });
      continue;
    }

    const pushResult = await pushUnique(records, seen, remaining);
    savedCount += pushResult.saved;
    stoppedByChargeLimit = pushResult.stopped;
  }

  if (stoppedByChargeLimit) {
    const message = `Stopped at the user's spending limit after ${savedCount} company record(s).`;
    await Actor.setStatusMessage(message);
    log.warning(message);
  } else {
    await Actor.setStatusMessage(`Finished with ${savedCount} unique company record(s).`);
    log.info('Company registry and filings aggregation finished', { savedCount, stoppedByChargeLimit });
  }
} catch (error) {
  log.exception(error as Error, 'Company registry and filings actor failed');
  throw error;
} finally {
  await Actor.exit();
}
