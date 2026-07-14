import { Actor, log } from 'apify';
import { allOfficialOperationsFailed, pushUniqueRecords, sourceBudget } from './billing.js';
import { getCompaniesHouseRecord, searchCompaniesHouse } from './companiesHouse.js';
import { getSecRecord, loadSecTickerEntries, searchSecCiks } from './edgar.js';
import { normalizeInput } from './input.js';
import { recordSafetyIssue } from './recordSafety.js';
import type {
  CompanyRecord,
  NormalizedInput,
  SourceCollectionResult,
  SourceName,
} from './types.js';

const COMPANY_RECORD_EVENT = 'company-record-scraped';

function warningMessage(source: SourceName, target: string, error: unknown): string {
  return `${source}:${target}: ${error instanceof Error ? error.message : String(error)}`;
}

async function collectCompaniesHouse(input: NormalizedInput, limit: number): Promise<SourceCollectionResult> {
  const apiKey = input.companiesHouseApiKey;
  if (!apiKey) throw new Error('Companies House API key is missing after input validation.');
  const records: CompanyRecord[] = [];
  const warnings: string[] = [];
  const visited = new Set<string>();
  let completedOperations = 0;
  let failedOperations = 0;

  const lookup = async (companyNumber: string, query: string | null): Promise<void> => {
    if (records.length >= limit || visited.has(companyNumber)) return;
    visited.add(companyNumber);
    try {
      const result = await getCompaniesHouseRecord(companyNumber, query, apiKey);
      completedOperations += 1;
      warnings.push(...result.warnings);
      if (result.record) records.push(result.record);
    } catch (error) {
      failedOperations += 1;
      warnings.push(warningMessage('companies_house', companyNumber, error));
    }
  };

  for (const companyNumber of input.companyNumbers) {
    if (records.length >= limit) break;
    await lookup(companyNumber, null);
  }

  for (const [queryIndex, query] of input.queries.entries()) {
    if (records.length >= limit) break;
    const remainingQueries = input.queries.length - queryIndex;
    const queryLimit = Math.max(1, Math.ceil((limit - records.length) / remainingQueries));
    let companyNumbers: string[];
    try {
      companyNumbers = await searchCompaniesHouse(query, apiKey, queryLimit);
      completedOperations += 1;
    } catch (error) {
      failedOperations += 1;
      warnings.push(warningMessage('companies_house', query, error));
      continue;
    }
    for (const companyNumber of companyNumbers) {
      if (records.length >= limit) break;
      await lookup(companyNumber, query);
    }
  }

  return { records, completedOperations, failedOperations, warnings };
}

async function collectSec(input: NormalizedInput, limit: number): Promise<SourceCollectionResult> {
  const records: CompanyRecord[] = [];
  const warnings: string[] = [];
  const visited = new Set<string>();
  let completedOperations = 0;
  let failedOperations = 0;

  const lookup = async (cik: string, query: string | null): Promise<void> => {
    if (records.length >= limit || visited.has(cik)) return;
    visited.add(cik);
    try {
      const result = await getSecRecord(cik, query, input.secUserAgent);
      completedOperations += 1;
      warnings.push(...result.warnings);
      if (result.record) records.push(result.record);
    } catch (error) {
      failedOperations += 1;
      warnings.push(warningMessage('sec_edgar', cik, error));
    }
  };

  for (const cik of input.ciks) {
    if (records.length >= limit) break;
    await lookup(cik, null);
  }

  if (input.queries.length > 0 && records.length < limit) {
    try {
      const entries = await loadSecTickerEntries(input.secUserAgent);
      completedOperations += 1;
      for (const [queryIndex, query] of input.queries.entries()) {
        if (records.length >= limit) break;
        const remainingQueries = input.queries.length - queryIndex;
        const queryLimit = Math.max(1, Math.ceil((limit - records.length) / remainingQueries));
        for (const cik of searchSecCiks(entries, query, queryLimit)) {
          if (records.length >= limit) break;
          await lookup(cik, query);
        }
      }
    } catch (error) {
      failedOperations += 1;
      warnings.push(warningMessage('sec_edgar', 'ticker-index', error));
    }
  }

  return { records, completedOperations, failedOperations, warnings };
}

await Actor.init();

try {
  const input = normalizeInput((await Actor.getInput<unknown>()) ?? {});
  const seen = new Set<string>();
  let savedCount = 0;
  let warningCount = 0;
  let completedOperations = 0;
  let failedOperations = 0;
  let stoppedByChargeLimit = false;

  log.info('Starting company registry and filings aggregation', {
    sources: input.sources,
    queryCount: input.queries.length,
    companyNumbers: input.companyNumbers.length,
    ciks: input.ciks.length,
    maxResults: input.maxResults,
  });

  for (const [sourceIndex, source] of input.sources.entries()) {
    if (savedCount >= input.maxResults || stoppedByChargeLimit) break;
    const remaining = input.maxResults - savedCount;
    const limit = sourceBudget(remaining, input.sources.length - sourceIndex);
    const result = source === 'companies_house'
      ? await collectCompaniesHouse(input, limit)
      : await collectSec(input, limit);
    completedOperations += result.completedOperations;
    failedOperations += result.failedOperations;
    for (const warning of result.warnings) {
      warningCount += 1;
      log.warning(warning);
    }

    const safeRecords = result.records.filter((record) => {
      const issue = recordSafetyIssue(record);
      if (!issue) return true;
      warningCount += 1;
      log.warning(`Skipped unsafe ${record.source}:${record.entityId}: ${issue}.`);
      return false;
    });
    const pushResult = await pushUniqueRecords(
      safeRecords,
      seen,
      input.maxResults - savedCount,
      (record) => Actor.pushData(record, COMPANY_RECORD_EVENT),
    );
    savedCount += pushResult.saved;
    stoppedByChargeLimit = pushResult.stopped;
  }

  if (!stoppedByChargeLimit && allOfficialOperationsFailed(completedOperations, failedOperations)) {
    throw new Error(`All ${failedOperations} official API operation(s) failed.`);
  }

  if (stoppedByChargeLimit) {
    const message = `Stopped at the user's spending limit after ${savedCount} clean company record(s).`;
    await Actor.setStatusMessage(message);
    log.warning(message);
  } else {
    const warningSuffix = warningCount > 0 ? ` with ${warningCount} warning(s)` : '';
    const message = `Finished with ${savedCount} clean entity record(s)${warningSuffix}.`;
    await Actor.setStatusMessage(message);
    log.info(message, { completedOperations, failedOperations });
  }
} catch (error) {
  log.exception(error as Error, 'Company registry and filings actor failed');
  throw error;
} finally {
  await Actor.exit();
}
