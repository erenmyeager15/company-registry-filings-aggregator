import assert from 'node:assert/strict';
import { test } from 'node:test';
import { allOfficialOperationsFailed, pushUniqueRecords, sourceBudget } from './billing.js';
import {
  getCompaniesHouseRecord,
  normalizeCompaniesHouseRecord,
  searchCompaniesHouse,
} from './companiesHouse.js';
import {
  extractOfficialWebsiteFromFiling,
  normalizeRecentFilings,
  normalizeSecRecord,
  searchSecCiks,
} from './edgar.js';
import { normalizeInput } from './input.js';
import { containsForbiddenField, recordSafetyIssue } from './recordSafety.js';
import type { CompanyRecord, SecSubmissions, SecTickerEntry } from './types.js';
import {
  fetchJson,
  fetchText,
  HttpError,
  minimumRequestIntervalMs,
  normalizeDate,
  normalizeDateTime,
  normalizePublicWebsite,
  normalizeText,
  uniqueStrings,
} from './utils.js';

function companyRecord(overrides: Partial<CompanyRecord> = {}): CompanyRecord {
  return {
    source: 'sec_edgar',
    query: 'Example',
    entityId: '0000000001',
    entityIdType: 'cik',
    companyNumber: null,
    cik: '0000000001',
    companyName: 'EXAMPLE CORP',
    previousNames: [],
    status: null,
    statusDetail: null,
    entityType: 'public_company',
    entitySubtype: 'operating',
    jurisdiction: 'US SEC',
    incorporationDate: null,
    legalEntityIdentifier: null,
    employerIdentificationNumber: null,
    companyCategory: null,
    sicCodes: [],
    officialWebsiteUrl: null,
    officialWebsiteDomain: null,
    investorRelationsUrl: null,
    investorRelationsDomain: null,
    websiteSource: null,
    registeredAddress: null,
    registeredOfficeInDispute: null,
    registeredOfficeUndeliverable: null,
    businessAddress: null,
    mailingAddress: null,
    tickers: ['EXM'],
    exchanges: ['NYSE'],
    stateOfIncorporation: 'DE',
    stateOfIncorporationDescription: 'Delaware',
    accountsNextDue: null,
    accountsLastMadeUpTo: null,
    confirmationStatementNextDue: null,
    confirmationStatementLastMadeUpTo: null,
    dissolutionDate: null,
    fiscalYearEnd: '1231',
    lastFilingDate: null,
    latestFilingChangeType: null,
    recentFilingChangeTypes: [],
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
  assert.equal(normalizeDateTime('2026-08-24T10:30:00Z'), '2026-08-24T10:30:00.000Z');
  assert.deepEqual(normalizePublicWebsite('www.Example.com/about#team'), {
    url: 'https://www.example.com/about',
    domain: 'example.com',
  });
  assert.equal(normalizePublicWebsite('mailto:person@example.com'), null);
  assert.equal(normalizePublicWebsite('https://person@example.com'), null);
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
  assert.equal(input.maxFilingsPerCompany, 20);

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
  assert.throws(
    () => normalizeInput({ query: 'Example', maxFilingsPerCompany: 101 }),
    /maxFilingsPerCompany must be an integer between 1 and 100/,
  );
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
    stateOfIncorporationDescription: 'Washington',
    fiscalYearEnd: '0630',
    ein: '91-1144442',
    lei: 'INR2EJN1ERAN0W5ZP974',
    category: 'Large accelerated filer',
    website: 'https://www.microsoft.com/',
    investorWebsite: 'https://www.microsoft.com/en-us/Investor',
    addresses: {
      business: {
        street1: 'One Microsoft Way',
        city: 'Redmond',
        stateOrCountry: 'WA',
        stateOrCountryDescription: 'Washington',
        zipCode: '98052',
        phone: '+1 555 0100',
      },
    },
    formerNames: [{ name: 'MICROSOFT INC', from: '1981-01-01', to: '1986-01-01' }],
    filings: {
      recent: {
        form: ['4', '10-K', 'SC 13D', '8-K'],
        filingDate: ['2026-07-13', '2026-07-10', '2026-07-09', '2026-07-08'],
        reportDate: ['2026-07-12', '2026-06-30', '2026-07-08', '2026-07-07'],
        acceptanceDateTime: [
          '2026-07-13T12:00:00.000Z',
          '2026-07-10T16:30:00.000Z',
          '2026-07-09T12:00:00.000Z',
          '2026-07-08T15:00:00.000Z',
        ],
        accessionNumber: ['1', '0001-26-000010', '3', '0001-26-000008'],
        items: ['', '', '', '2.02,9.01'],
        primaryDocument: ['owner.xml', 'annual report.htm', 'schedule.htm', 'current.htm'],
        primaryDocDescription: ['Ownership', 'Annual report', 'Schedule', 'Current report'],
      },
    },
  };
  const record = normalizeSecRecord('789019', 'MSFT', submissions);
  assert.ok(record);
  assert.deepEqual(record.recentFilings.map((filing) => filing.formType), ['10-K', '8-K']);
  assert.equal(record.lastFilingDate, '2026-07-10');
  assert.match(record.recentFilings[0]?.documentUrl ?? '', /annual%20report\.htm$/);
  assert.equal(record.officialWebsiteDomain, 'microsoft.com');
  assert.equal(record.investorRelationsDomain, 'microsoft.com');
  assert.equal(record.businessAddress?.formattedAddress, 'One Microsoft Way, Redmond, Washington, 98052');
  assert.equal(record.previousNames[0]?.name, 'MICROSOFT INC');
  assert.equal(record.legalEntityIdentifier, 'INR2EJN1ERAN0W5ZP974');
  assert.equal(record.recentFilings[0]?.changeType, 'annual_report');
  assert.deepEqual(record.recentFilings[1]?.filingItems, ['2.02', '9.01']);
  assert.doesNotMatch(JSON.stringify(record), /555 0100|phone/i);
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

test('SEC filing website fallback accepts a company-linked domain and ignores social links', () => {
  const html = `
    <p>Company website: <a href="https://www.microsoft.com/about">Microsoft</a></p>
    ${'x'.repeat(600)}
    <p>Investor relations: <a href="https://www.microsoft.com/en-us/Investor">Investors</a></p>
    <a href="https://www.linkedin.com/company/microsoft">LinkedIn</a>
    <a href="mailto:person@example.com">Email</a>
  `;
  const result = extractOfficialWebsiteFromFiling(html, 'MICROSOFT CORP', ['MSFT']);
  assert.deepEqual(result, {
    officialWebsite: { url: 'https://www.microsoft.com/', domain: 'microsoft.com' },
    investorWebsite: { url: 'https://www.microsoft.com/en-us/Investor', domain: 'microsoft.com' },
  });
  assert.equal(
    extractOfficialWebsiteFromFiling('<a href="https://vendor.example/tools">Tools</a>', 'MICROSOFT CORP', ['MSFT']),
    null,
  );
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
      subtype: 'community-interest-company',
      jurisdiction: 'england-wales',
      date_of_creation: '1947-11-27',
      previous_company_names: [{ name: 'TESCO STORES LTD', effective_from: '1950-01-01', ceased_on: '1983-01-01' }],
      registered_office_address: {
        premises: 'Tesco House',
        care_of: 'Private Contact Name',
        address_line_1: 'Shire Park',
        locality: 'Welwyn Garden City',
        postal_code: 'AL7 1GA',
      },
      registered_office_is_in_dispute: false,
      undeliverable_registered_office_address: true,
      accounts: { next_due: '2026-02-30' },
    },
    [{
      type: 'AD01',
      date: '2026-06-01',
      transaction_id: 'Mz123',
      category: 'address',
      description: 'change-registered-office-address',
      pages: 2,
      paper_filed: false,
    }],
  );
  assert.equal(record.companyName, 'TESCO PLC');
  assert.equal(record.registeredAddress?.premises, 'Tesco House');
  assert.equal(record.registeredAddress?.formattedAddress, 'Tesco House, Shire Park, Welwyn Garden City, AL7 1GA');
  assert.equal(record.registeredOfficeUndeliverable, true);
  assert.equal(record.previousNames[0]?.name, 'TESCO STORES LTD');
  assert.equal(record.accountsNextDue, null);
  assert.equal(record.recentFilings[0]?.changeType, 'registered_office');
  assert.equal(record.latestFilingChangeType, 'registered_office');
  assert.equal(record.recentFilings[0]?.pageCount, 2);
  assert.doesNotMatch(JSON.stringify(record), /Private Contact Name|careOf/i);
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

test('fetchText stops reading at its configured byte limit', async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = originalFetch;
  });
  globalThis.fetch = (async () => new Response('x'.repeat(20_000), { status: 200 })) as typeof fetch;
  const value = await fetchText('https://example.invalid/report.htm', {}, {
    retries: 1,
    pace: false,
    maxBytes: 10_000,
  });
  assert.equal(Buffer.byteLength(value), 10_000);
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
        reportDate: '2026-06-30',
        acceptedAt: '2026-07-10T10:00:00.000Z',
        accessionNumber: '1',
        category: 'annual_report',
        subcategory: null,
        description: 'Annual report',
        changeType: 'annual_report',
        isAmendment: false,
        filingItems: [],
        paperFiled: null,
        pageCount: null,
        documentUrl: 'https://example.com/file.htm',
      }],
    })) ?? '',
    /filing URL/,
  );
  assert.match(
    recordSafetyIssue(companyRecord({
      officialWebsiteUrl: 'https://example.com/',
      officialWebsiteDomain: 'different.example',
      websiteSource: 'sec_edgar_submissions',
    })) ?? '',
    /website URL and domain/,
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
