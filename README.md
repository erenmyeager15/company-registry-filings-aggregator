# Company Registry & Filings Aggregator

Collect normalized company identity, official website/domain, registered-office, corporate-address, previous-name, and public filing-change data from official APIs. This Actor is designed for KYC checks, supplier due diligence, market research, finance research, compliance workflows, and business intelligence pipelines that need company facts without collecting personal contacts.

The default source is **US SEC EDGAR**, which works without an API key. **UK Companies House** is also supported when you provide your free Companies House API key.

## Supported Sources

| Source | Coverage | API key required | What it returns |
| --- | --- | --- | --- |
| US SEC EDGAR | US public companies | No | CIK, EIN/LEI when supplied, former names, company-claimed websites/domains from submissions or an official filing, corporate addresses, tickers, exchanges, SIC data, fiscal year end, and filing changes. |
| UK Companies House | UK registered companies | Yes | Company number, previous names, status/type details, richer registered office, office-quality flags, accounts dates, confirmation statement dates, and filing changes. |

This Actor uses official read-only JSON APIs only. It does not use browser scraping, and it does not call Companies House officers or persons-with-significant-control endpoints. Direct SEC CIK results are saved only when the SEC response contains company or issuer evidence; individual-only SEC filers are excluded.

## What It Extracts

- Source and search query
- Company number or SEC CIK with an explicit identifier type
- Company name, previous names, status/detail, type/subtype, jurisdiction, and incorporation date
- SEC EIN, LEI, filer category, and state-of-incorporation description when supplied
- Official website/domain and investor-relations URL/domain when supplied by SEC submissions or conservatively identified in one official SEC annual/quarterly filing
- SIC codes and descriptions where available
- Rich registered office address with premises, PO box, formatted address, dispute flag, and undeliverable flag for Companies House records
- Corporate business and mailing addresses for SEC records, with phone fields excluded
- Tickers, exchanges, state of incorporation, and fiscal year end for SEC records
- UK accounts and confirmation statement dates where available
- Up to 1-100 recent filings per company with normalized change type, filing/report/acceptance dates, category, description code, amendment flag, 8-K items, document metadata, and official document URL
- Source URL, attribution, and scrape timestamp

SEC ownership-oriented forms (`3`, `4`, `5`, `144`, Schedule 13D/G, and amendments) are excluded from `recentFilings` to keep output focused on company/entity-level filings.

## Use Cases

- KYC checks and entity verification
- Supplier and customer due diligence
- Public-company filing monitoring
- Market research and company list enrichment
- Finance, compliance, and business intelligence workflows
- CRM enrichment with official company identifiers and source URLs

## Quick Start

SEC EDGAR company lookup, no API key required:

```json
{
  "sources": ["sec_edgar"],
  "query": "Microsoft",
  "maxResults": 3,
  "maxFilingsPerCompany": 20,
  "secUserAgent": "CompanyRegistryFilingsAggregator/1.0 contact@example.com"
}
```

Direct SEC CIK lookup:

```json
{
  "sources": ["sec_edgar"],
  "ciks": ["0000789019"],
  "maxResults": 1,
  "secUserAgent": "CompanyRegistryFilingsAggregator/1.0 contact@example.com"
}
```

UK Companies House lookup with your API key:

```json
{
  "sources": ["companies_house"],
  "companyNames": ["Tesco"],
  "maxResults": 5,
  "companiesHouseApiKey": "YOUR_COMPANIES_HOUSE_API_KEY"
}
```

## Input Fields

| Field | Type | Default | Description |
| --- | --- | --- | --- |
| `sources` | array | `["sec_edgar"]` | Official APIs to query: `sec_edgar`, `companies_house`, or both. |
| `query` | string | `Microsoft` | Company name, ticker, or broad search term. |
| `companyNames` | string array | empty | Up to 50 company names or tickers to search. Duplicate terms are removed case-insensitively. |
| `companyNumbers` | string array | empty | Up to 1000 direct UK Companies House company numbers. `companies_house` must be selected. |
| `ciks` | string array | empty | Up to 1000 direct SEC CIK identifiers. Values are validated and padded to 10 digits. |
| `maxResults` | integer | `10` | Maximum clean records to save, from 1 to 1000. |
| `maxFilingsPerCompany` | integer | `20` | Recent filing-change records included per company, from 1 to 100. |
| `companiesHouseApiKey` | secret string | empty | Free Companies House API key, required only when `companies_house` is selected. |
| `secUserAgent` | string | `CompanyRegistryFilingsAggregator/1.0 contact@example.com` | SEC requires an application identity and contact email. Replace the placeholder with a monitored email for production use. Line breaks are rejected. |
| `proxyConfiguration` | object | no proxy | Not required for official JSON APIs, included for Apify compatibility. |

## Output Overview

Each dataset item represents one official company/entity record.

Records are deduplicated by `source + entityId` before billing. Source and filing URLs must use the matching official HTTPS host. Company-claimed website URLs are normalized and paired with their domain, while credential-bearing, email-bearing, malformed, or inconsistent URLs are rejected. The filing fallback reads at most 2 MB from one official SEC report, requires company-identity or explicit website context, and never opens the discovered website. Nested officer, director, PSC, email, phone, contact, and birth-date fields are blocked before output.

| Field group | Important fields |
| --- | --- |
| Source context | `source`, `query`, `sourceUrl`, `attribution`, `scrapedAt` |
| Company identity | `entityId`, `entityIdType`, `companyNumber`, `cik`, `companyName`, `previousNames`, `status`, `statusDetail`, `entityType`, `entitySubtype`, `jurisdiction`, `incorporationDate` |
| Official web identity | `officialWebsiteUrl`, `officialWebsiteDomain`, `investorRelationsUrl`, `investorRelationsDomain`, `websiteSource` |
| UK Companies House fields | `registeredAddress`, `registeredOfficeInDispute`, `registeredOfficeUndeliverable`, `accountsNextDue`, `accountsLastMadeUpTo`, `confirmationStatementNextDue`, `confirmationStatementLastMadeUpTo`, `dissolutionDate` |
| SEC EDGAR fields | `legalEntityIdentifier`, `employerIdentificationNumber`, `companyCategory`, `businessAddress`, `mailingAddress`, `tickers`, `exchanges`, `stateOfIncorporation`, `stateOfIncorporationDescription`, `fiscalYearEnd`, `sicCodes` |
| Filing changes | `lastFilingDate`, `latestFilingChangeType`, `recentFilingChangeTypes`, plus form, filing/report/acceptance dates, category, description, change type, amendment flag, filing items, document metadata, and document URL in `recentFilings` |

## Verified Sample Output

This shortened record comes from a direct live SEC proof on August 24, 2026. The company website was identified conservatively from Microsoft's official SEC filing; the Actor did not open or crawl the discovered website.

```json
{
  "source": "sec_edgar",
  "query": null,
  "entityId": "0000789019",
  "entityIdType": "cik",
  "companyNumber": null,
  "cik": "0000789019",
  "companyName": "MICROSOFT CORP",
  "previousNames": [],
  "status": null,
  "statusDetail": null,
  "entityType": "public_company",
  "entitySubtype": "operating",
  "jurisdiction": "US SEC",
  "incorporationDate": null,
  "legalEntityIdentifier": null,
  "employerIdentificationNumber": "911144442",
  "companyCategory": "Large accelerated filer",
  "sicCodes": ["SIC:7372", "SIC_DESCRIPTION:Services-Prepackaged Software"],
  "officialWebsiteUrl": "http://www.microsoft.com/",
  "officialWebsiteDomain": "microsoft.com",
  "websiteSource": "sec_filing_document",
  "registeredAddress": null,
  "businessAddress": {
    "street1": "ONE MICROSOFT WAY",
    "city": "REDMOND",
    "stateOrCountry": "WA",
    "postalCode": "98052-6399",
    "formattedAddress": "ONE MICROSOFT WAY, REDMOND, WA, 98052-6399"
  },
  "tickers": ["MSFT"],
  "exchanges": ["Nasdaq"],
  "stateOfIncorporation": "WA",
  "accountsNextDue": null,
  "accountsLastMadeUpTo": null,
  "confirmationStatementNextDue": null,
  "confirmationStatementLastMadeUpTo": null,
  "dissolutionDate": null,
  "fiscalYearEnd": "0630",
  "lastFilingDate": "2026-07-29",
  "latestFilingChangeType": "annual_report",
  "recentFilingChangeTypes": [
    "annual_report",
    "material_event",
    "other_filing",
    "quarterly_report",
    "securities_offering"
  ],
  "recentFilings": [
    {
      "formType": "10-K",
      "filingDate": "2026-07-29",
      "reportDate": "2026-06-30",
      "acceptedAt": "2026-07-29T20:08:01.000Z",
      "accessionNumber": "0001193125-26-323660",
      "category": "annual_report",
      "description": "10-K",
      "changeType": "annual_report",
      "isAmendment": false,
      "filingItems": [],
      "documentUrl": "https://www.sec.gov/Archives/edgar/data/789019/000119312526323660/msft-20260630.htm"
    }
  ],
  "sourceUrl": "https://www.sec.gov/edgar/browse/?CIK=789019&owner=exclude",
  "attribution": "SEC EDGAR public company submissions data.",
  "scrapedAt": "2026-08-24T00:00:00.000Z"
}
```

## Pricing

This Actor uses pay per event pricing.

| Event | When charged | Price |
| --- | --- | --- |
| `apify-actor-start` | When the Actor starts; one event per GB of memory, minimum one | `$0.00005` |
| `company-record-scraped` | Each clean company/entity record saved to the dataset | `$0.002` |

Each unique company record is saved and charged atomically. Empty searches and failed records are not billed, and later sources stop when the user's spending limit is reached.

## Reliability And API Limits

- Requests time out after 20 seconds and retry only network failures, `408`, `425`, `429`, and `5xx` responses. Permanent `4xx` errors are not replayed.
- SEC requests are paced below the official 10 requests-per-second fair-access ceiling, and the ticker/company index is downloaded only once per run.
- When SEC submissions omits a website, the Actor may make one bounded request to the latest available official annual or quarterly filing. Failure to enrich this optional field never removes an otherwise valid company record.
- Companies House requests are paced for its default 600 requests per 5 minutes allowance. Company search pagination is capped at 10 pages.
- `maxFilingsPerCompany` changes the filing-history page size but remains capped at 100 records per company; it does not trigger officer or PSC requests.
- When both sources are selected, the result budget reserves capacity for each source and reallocates unused capacity to later sources.
- A Companies House profile remains usable when only its optional filing-history request fails; the run logs a warning and saves the profile without filings.
- A successful no-match response finishes with zero records. Partial source failures finish with warnings when another official request succeeds. If every official API operation fails, the run fails clearly instead of presenting a misleading healthy empty dataset.

## Tips For Better Results

- Start with SEC EDGAR because it does not require an API key.
- Use exact tickers such as `MSFT` or direct CIKs when you want precise SEC records.
- Use direct Companies House company numbers when you need exact UK entities.
- Replace the default SEC User-Agent contact email before production or scheduled use.
- Keep `maxResults` small for first runs, then increase it after checking the output.

## Known Limits

- UK Companies House requires `companiesHouseApiKey` or the `COMPANIES_HOUSE_API_KEY` environment variable.
- SEC company search uses the SEC ticker/company index, so private companies without SEC records will not appear.
- SEC direct CIK lookups that represent individual-only filers are intentionally skipped.
- Recent filings are capped to the configured latest 1-100 filing records per company and do not fetch older SEC submissions files beyond the current submissions payload.
- Official website/domain fields use SEC submissions first, then a conservative company-link fallback from one official SEC filing. `websiteSource` distinguishes `sec_edgar_submissions` from `sec_filing_document`. Companies House does not provide an official company website in its company-profile response, so those fields remain `null` rather than being guessed.
- Website URLs are registry metadata only. The Actor does not crawl company websites or extract their emails, phone numbers, staff, or contact pages.
- SEC ownership-oriented forms and Companies House officer/PSC data are intentionally excluded.
- A Companies House registered office is an official entity field, but some companies use a residential location as that office. Treat address data accordingly.

## Attribution

Companies House data: Contains public sector information licensed under the Open Government Licence v3.0.

SEC EDGAR data is sourced from public SEC submissions endpoints. Follow SEC fair access rules and provide an application name plus a monitored contact email in `secUserAgent`.

## Responsible Use

This Actor is intended for lawful collection of publicly available information only. Users are responsible for ensuring their use complies with the source website's terms, robots.txt, applicable privacy laws, including India's DPDP Act, and all local regulations.

Do not use this Actor to collect, store, sell, or misuse personal data without a lawful basis. The Actor author is not responsible for misuse by end users.

## License

Apache-2.0
