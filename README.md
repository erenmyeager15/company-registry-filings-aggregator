# Company Registry & Filings Aggregator

Collect normalized, entity-level company registry and public filing data from official APIs. This Actor is designed for KYC checks, supplier due diligence, market research, finance research, compliance workflows, and business intelligence pipelines that need company facts without collecting personal contact data.

The default source is **US SEC EDGAR**, which works without an API key. **UK Companies House** is also supported when you provide your free Companies House API key.

## Supported Sources

| Source | Coverage | API key required | What it returns |
| --- | --- | --- | --- |
| US SEC EDGAR | US public companies | No | Company identity, CIK, tickers, exchanges, SIC data, fiscal year end, and recent filings. |
| UK Companies House | UK registered companies | Yes | Company profile, status, type, jurisdiction, registered office, accounts dates, confirmation statement dates, and filing history. |

This Actor uses official JSON APIs only. It does not use browser scraping, and it does not call Companies House officers or persons-with-significant-control endpoints.

## What It Extracts

- Source and search query
- Company number or SEC CIK
- Company name, status, type, jurisdiction, incorporation date
- SIC codes and descriptions where available
- Registered office address for Companies House records
- Tickers, exchanges, state of incorporation, fiscal year end for SEC records
- UK accounts and confirmation statement dates where available
- Recent filing metadata and document URLs
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
| `companyNames` | string array | empty | Optional list of company names or tickers to search. |
| `companyNumbers` | string array | empty | Optional direct UK Companies House company numbers. |
| `ciks` | string array | empty | Optional direct SEC CIK identifiers. |
| `maxResults` | integer | `10` | Maximum clean records to save, from 1 to 1000. |
| `companiesHouseApiKey` | secret string | empty | Free Companies House API key, required only when `companies_house` is selected. |
| `secUserAgent` | string | `CompanyRegistryFilingsAggregator/1.0 contact@example.com` | SEC requires a descriptive User-Agent. Replace the default contact email for production use. |
| `proxyConfiguration` | object | no proxy | Not required for official JSON APIs, included for Apify compatibility. |

## Output Overview

Each dataset item represents one official company/entity record.

| Field group | Important fields |
| --- | --- |
| Source context | `source`, `query`, `sourceUrl`, `attribution`, `scrapedAt` |
| Company identity | `entityId`, `companyName`, `status`, `entityType`, `jurisdiction`, `incorporationDate` |
| UK Companies House fields | `registeredAddress`, `accountsNextDue`, `accountsLastMadeUpTo`, `confirmationStatementNextDue`, `confirmationStatementLastMadeUpTo`, `dissolutionDate` |
| SEC EDGAR fields | `tickers`, `exchanges`, `stateOfIncorporation`, `fiscalYearEnd`, `sicCodes` |
| Filing metadata | `lastFilingDate`, `recentFilings.formType`, `recentFilings.filingDate`, `recentFilings.accessionNumber`, `recentFilings.documentUrl` |

## Sample Output

```json
{
  "source": "sec_edgar",
  "query": "Microsoft",
  "entityId": "0000789019",
  "companyName": "MICROSOFT CORP",
  "status": null,
  "entityType": "public_company",
  "jurisdiction": "US SEC",
  "incorporationDate": null,
  "sicCodes": ["SIC:7372", "SIC_DESCRIPTION:Services-Prepackaged Software"],
  "registeredAddress": null,
  "tickers": ["MSFT"],
  "exchanges": ["Nasdaq"],
  "stateOfIncorporation": "WA",
  "accountsNextDue": null,
  "accountsLastMadeUpTo": null,
  "confirmationStatementNextDue": null,
  "confirmationStatementLastMadeUpTo": null,
  "dissolutionDate": null,
  "fiscalYearEnd": "0630",
  "lastFilingDate": "2026-04-24",
  "recentFilings": [
    {
      "formType": "10-Q",
      "filingDate": "2026-04-24",
      "accessionNumber": "0000950170-26-000000",
      "documentUrl": "https://www.sec.gov/Archives/edgar/data/789019/000095017026000000/example.htm"
    }
  ],
  "sourceUrl": "https://www.sec.gov/edgar/browse/?CIK=789019&owner=exclude",
  "attribution": "SEC EDGAR public company submissions data.",
  "scrapedAt": "2026-06-14T00:00:00.000Z"
}
```

## Pricing

This Actor uses pay per event pricing.

| Event | When charged | Price |
| --- | --- | --- |
| `company-record-scraped` | Each clean company/entity record saved to the dataset | `$0.004` |

Each unique company record is saved and charged atomically. Empty searches and failed records are not billed, and later sources stop when the user's spending limit is reached.

## Tips For Better Results

- Start with SEC EDGAR because it does not require an API key.
- Use exact tickers such as `MSFT` or direct CIKs when you want precise SEC records.
- Use direct Companies House company numbers when you need exact UK entities.
- Replace the default SEC User-Agent contact email before production or scheduled use.
- Keep `maxResults` small for first runs, then increase it after checking the output.

## Known Limits

- UK Companies House requires `companiesHouseApiKey` or the `COMPANIES_HOUSE_API_KEY` environment variable.
- SEC company search uses the SEC ticker/company index, so private companies without SEC records will not appear.
- Recent filings are capped to the latest 10 filing records per company.
- SEC ownership-oriented forms and Companies House officer/PSC data are intentionally excluded.

## Attribution

Companies House data: Contains public sector information licensed under the Open Government Licence v3.0.

SEC EDGAR data is sourced from public SEC submissions endpoints. Follow SEC fair access rules and provide a descriptive User-Agent.

## Responsible Use

This Actor is intended for lawful collection of publicly available information only. Users are responsible for ensuring their use complies with the source website's terms, robots.txt, applicable privacy laws, including India's DPDP Act, and all local regulations.

Do not use this Actor to collect, store, sell, or misuse personal data without a lawful basis. The Actor author is not responsible for misuse by end users.

## License

Apache-2.0
