import assert from 'node:assert/strict';
import { test } from 'node:test';
import { allOfficialOperationsFailed, pushUniqueRecords, sourceBudget } from './billing.js';
import {
  getCompaniesHouseRecord,
  normalizeCompaniesHouseRecord,
  searchCompaniesHouse,
} from './companiesHouse.js';
import { normalizeRecentFilings, normalizeSecRecord, searchSecCiks } from './edgar.js';
import { normalizeInput } from './input.js';
import { containsForbiddenField, recordSafetyIssue } from './recordSafety.js';
import type { CompanyRecord, SecSubmissions, SecTickerEntry } from './types.js';
import {
  fetchJson,
  HttpError,
  minimumRequestIntervalMs,
  normalizeDate,
  normalizeText,
  uniqueStrings,
} from './utils.js';

function companyRecord(overrides: Partial<CompanyRecord> = {}): CompanyRecord {
  return {
    source: 'sec_edgar',
    query: 'Example',
    entityId: '0000000001',
    companyName: 'EXAMPLE CORP',
    status: null,
    entityType: 'public_company',
    jurisdiction: 'US SEC',
    incorporationDate: null,
    sicCodes: [],
    registeredAddress: null,
    tickers: ['EXM'],
    exchanges: ['NYSE'],
    stateOfIncorporation: 'DE',
    accountsNextDue: null,
    accountsLastMadeUpTo: null,
    confirmationStatementNextDue: null,
    confirmationStatementLastMadeUpTo: null,
    dissolutionDate: null,
    fiscalYearEnd: '1231',
    lastFilingDate: null,
    recentFilings: [],
    sourceUrl: 'https://www.sec.gov/edgar/browse/?CIK=1&owner=exclude',
    attribution: 'SEC EDGAR public company submissions data.',
    scrapedAt: '2026-07-14T00:00:00.000Z',
    ...overrides,
  };
}

test('text and date normalization are deterministic and reject impossible dates', () => {
  assert.equal(normalizeText('  hello   world  '), 'hello world');
  assert.deepEqual(uniqueStrings(['Microsoft', ' microsoft ', 'Apple']), ['Microsoft', 'Apple']);
  assert.equal(normalizeDate('2026-02-28'), '2026-02-28');
  assert.equal(normalizeDate('2026-02-30'), null);
  assert.equal(normalizeDate('not-a-date'), null);
});

test('input normalization preserves safe defaults and canonicalizes identifiers', () => {
  const input = normalizeInput({
    query: 'Microsoft',
    companyNames: [' microsoft ', 'Apple'],
    ciks: ['789019', 320193],
    maxResults: 4,
  });
  assert.deepEqual(input.sources, ['sec_edgar']);
  assert.deepEqual(input.queries, ['Microsoft', 'Apple']);
  assert.deepEqual(input.ciks, ['0000789019', '0000320193']);
  assert.equal(input.maxResults, 4);

  const uk = normalizeInput({
    sources: ['COMPANIES_HOUSE'],
    companyNumbers: [' 00445790 '],
    companiesHouseApiKey: 'secret',
  });
  assert.deepEqual(uk.sources, ['companies_house']);
  assert.deepEqual(uk.companyNumbers, ['00445790']);
});

test('input normalization rejects malformed, irrelevant, or non-compliant input', (t) => {
  const previousKey = process.env.COMPANIES_HOUSE_API_KEY;
  delete process.env.COMPANIES_HOUSE_API_KEY;
  t.after(() => {
    if (previousKey === undefined) delete process.env.COMPANIES_HOUSE_API_KEY;
    else process.env.COMPANIES_HOUSE_API_KEY = previousKey;
  });

  assert.throws(() => normalizeInput([]), /JSON object/);
  assert.throws(() => normalizeInput({ sources: [] }), /non-empty array/);
  assert.throws(() => normalizeInput({ sources: ['unknown'], query: 'Example' }), /Unsupported source/);
  assert.throws(() => normalizeInput({ query: 'Example', maxResults: 1.5 }), /integer between 1 and 1000/);
  assert.throws(() => normalizeInput({ query: 'Example', ciks: ['ABC'] }), /Invalid SEC CIK/);
  assert.throws(() => normalizeInput({ query: 'Example', companyNames: 'wrong' }), /must be an array/);
  assert.throws(
    () => normalizeInput({ sources: ['companies_house'], query: 'Example' }),
    /companiesHouseApiKey is required/,
  );
  assert.throws(
    () => normalizeInput({ sources: ['sec_edgar'], companyNumbers: ['00445790'], query: 'Example' }),
    /Select companies_house/,
  );
  assert.throws(() => normalizeInput({ query: 'name@example.com' }), /not email or contact identifiers/);
  assert.throws(
    () => normalizeInput({ query: 'Example', secUserAgent: 'anonymous bot' }),
    /include a contact email/,
  );
  assert.throws(
    () => normalizeInput({ query: 'Example', secUserAgent: 'Example bot admin@example.com\r\nX-Test: bad' }),
    /line breaks/,
  );
});

test('SEC ticker search ranks exact tickers first and deduplicates CIKs', () => {
  const entries: SecTickerEntry[] = [
    { cik_str: 1, ticker: 'MSFTH', title: 'MSFT HOLDINGS INC' },
    { cik_str: 789019, ticker: 'MSFT', title: 'MICROSOFT CORP' },
    { cik_str: 789019, ticker: 'MSFT.A', title: 'MICROSOFT CORP' },
  ];
  assert.deepEqual(searchSecCiks(entries, 'MSFT', 10), ['0000789019', '0000000001']);
});

test('SEC mapper keeps entity filings and excludes ownership-oriented forms', () => {
  const submissions: SecSubmissions = {
    cik: '0000789019',
    name: 'MICROSOFT CORP',
    entityType: 'operating',
    insiderTransactionForIssuerExists: 1,
    sic: '7372',
    sicDescription: 'Services-Prepackaged Software',
    tickers: ['MSFT'],
    exchanges: ['Nasdaq'],
    stateOfIncorporation: 'WA',
    fiscalYearEnd: '0630',
    filings: {
      recent: {
        form: ['4', '10-K', 'SC 13D', '8-K'],
        filingDate: ['2026-07-13', '2026-07-10', '2026-07-09', '2026-07-08'],
        accessionNumber: ['1', '0001-26-000010', '3', '0001-26-000008'],
        primaryDocument: ['owner.xml', 'annual report.htm', 'schedule.htm', 'current.htm'],
      },
    },
  };
  const record = normalizeSecRecord('789019', 'MSFT', submissions);
  assert.ok(record);
  assert.deepEqual(record.recentFilings.map((filing) => filing.formType), ['10-K', '8-K']);
  assert.equal(record.lastFilingDate, '2026-07-10');
  assert.match(record.recentFilings[0]?.documentUrl ?? '', /annual%20report\.htm$/);
});

test('SEC mapper rejects individual filers from entity-level output', () => {
  const individual: SecSubmissions = {
    cik: '0001494730',
    name: 'Musk Elon',
    entityType: 'other',
    insiderTransactionForOwnerExists: 1,
    insiderTransactionForIssuerExists: 0,
    tickers: [],
    exchanges: [],
  };
  assert.equal(normalizeSecRecord('1494730', null, individual), null);
});

test('SEC filing mapper refuses traversal-like document paths', () => {
  const filings = normalizeRecentFilings({
    cik: '0000789019',
    filings: {
      recent: {
        form: ['10-K'],
        filingDate: ['2026-07-10'],
        accessionNumber: ['0001-26-000010'],
        primaryDocument: ['../unsafe.htm'],
      },
    },
  });
  assert.equal(filings[0]?.documentUrl, null);
});

test('Companies House mapper normalizes entity fields and registered office data', () => {
  const record = normalizeCompaniesHouseRecord(
    '00445790',
    'Tesco',
    {
      company_number: '00445790',
      company_name: 'TESCO PLC',
      company_status: 'active',
      type: 'plc',
      jurisdiction: 'england-wales',
      date_of_creation: '1947-11-27',
      registered_office_address: { address_line_1: 'Tesco House', locality: 'Welwyn Garden City' },
      accounts: { next_due: '2026-02-30' },
    },
    [{ type: 'AA', date: '2026-06-01', transaction_id: 'Mz123' }],
  );
  assert.equal(record.companyName, 'TESCO PLC');
  assert.equal(record.registeredAddress?.addressLine1, 'Tesco House');
  assert.equal(record.accountsNextDue, null);
  assert.match(record.recentFilings[0]?.documentUrl ?? '', /Mz123\/document$/);
});

test('Companies House search follows bounded pagination', async () => {
  const offsets: string[] = [];
  const request = (async <T>(url: string): Promise<T> => {
    const parsed = new URL(url);
    offsets.push(parsed.searchParams.get('start_index') ?? '');
    if (offsets.length === 1) {
      return {
        items: [{ company_number: '00000001' }, { company_number: '00000002' }],
        total_results: 3,
      } as T;
    }
    return { items: [{ company_number: '00000003' }], total_results: 3 } as T;
  }) as typeof fetchJson;

  const numbers = await searchCompaniesHouse('Example', 'secret', 3, request);
  assert.deepEqual(numbers, ['00000001', '00000002', '00000003']);
  assert.deepEqual(offsets, ['0', '2']);
});

test('Companies House keeps a profile when optional filing history fails', async () => {
  const request = (async <T>(url: string): Promise<T> => {
    if (url.includes('/filing-history')) throw new Error('temporary filing endpoint failure');
    return { company_number: '00445790', company_name: 'TESCO PLC' } as T;
  }) as typeof fetchJson;

  const result = await getCompaniesHouseRecord('00445790', null, 'secret', request);
  assert.equal(result.record?.companyName, 'TESCO PLC');
  assert.equal(result.record?.recentFilings.length, 0);
  assert.equal(result.warnings.length, 1);
});

test('fetchJson does not retry permanent HTTP errors', async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = originalFetch;
  });
  let calls = 0;
  globalThis.fetch = (async () => {
    calls += 1;
    return new Response('{"error":"bad query"}', { status: 400, statusText: 'Bad Request' });
  }) as typeof fetch;

  await assert.rejects(
    fetchJson('https://example.invalid', {}, { retries: 3, pace: false }),
    (error: unknown) => error instanceof HttpError && error.status === 400,
  );
  assert.equal(calls, 1);
});

test('fetchJson retries transient HTTP errors and honors Retry-After', async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = originalFetch;
  });
  let calls = 0;
  globalThis.fetch = (async () => {
    calls += 1;
    if (calls === 1) {
      return new Response('busy', { status: 503, statusText: 'Unavailable', headers: { 'retry-after': '0' } });
    }
    return new Response('{"ok":true}', { status: 200 });
  }) as typeof fetch;

  const value = await fetchJson<{ ok: boolean }>('https://example.invalid', {}, { retries: 2, pace: false });
  assert.deepEqual(value, { ok: true });
  assert.equal(calls, 2);
});

test('official API pacing stays within published source limits', () => {
  assert.equal(minimumRequestIntervalMs('https://api.company-information.service.gov.uk/company/1'), 500);
  assert.equal(minimumRequestIntervalMs('https://data.sec.gov/submissions/CIK1.json'), 125);
  assert.equal(minimumRequestIntervalMs('https://www.sec.gov/files/company_tickers.json'), 125);
});

test('record safety scans nested fields and permits only matching official hosts', () => {
  assert.equal(containsForbiddenField({ nested: { officer: 'Example Person' } }), true);
  assert.equal(recordSafetyIssue(companyRecord()), null);
  assert.match(recordSafetyIssue(companyRecord({ sourceUrl: 'https://example.com/company/1' })) ?? '', /sourceUrl/);
  assert.match(
    recordSafetyIssue(companyRecord({
      recentFilings: [{
        formType: '10-K',
        filingDate: '2026-07-10',
        accessionNumber: '1',
        documentUrl: 'https://example.com/file.htm',
      }],
    })) ?? '',
    /filing URL/,
  );
});

test('atomic save helper deduplicates free-user records and honors spending limits', async () => {
  const record = companyRecord();
  let calls = 0;
  const freeResult = await pushUniqueRecords([record, record], new Set(), 2, async () => {
    calls += 1;
    return { chargedCount: 0, eventChargeLimitReached: false };
  });
  assert.deepEqual(freeResult, { saved: 1, stopped: false });
  assert.equal(calls, 1);

  const limitedResult = await pushUniqueRecords([record], new Set(), 1, async () => ({
    chargedCount: 0,
    eventChargeLimitReached: true,
  }));
  assert.deepEqual(limitedResult, { saved: 0, stopped: true });
});

test('source budgets reserve capacity for later selected sources', () => {
  assert.equal(sourceBudget(10, 2), 5);
  assert.equal(sourceBudget(9, 1), 9);
  assert.equal(sourceBudget(0, 1), 0);
});

test('run outcome distinguishes a genuine empty result from a total API outage', () => {
  assert.equal(allOfficialOperationsFailed(1, 0), false);
  assert.equal(allOfficialOperationsFailed(1, 2), false);
  assert.equal(allOfficialOperationsFailed(0, 2), true);
  assert.equal(allOfficialOperationsFailed(0, 0), false);
});
