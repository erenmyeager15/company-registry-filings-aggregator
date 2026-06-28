# Company Registry & Filings Aggregator

Collect normalized, entity-level company registry and filing data from official public APIs. This Actor is designed for KYC, due diligence, finance research, sales/market research, and compliance workflows that need company facts without collecting personal data.

## Sources

- UK Companies House Public Data API: company search, company profile, and filing history.
- US SEC EDGAR submissions data: company identity, tickers, exchanges, SIC information, and recent filings.

This Actor uses official JSON APIs only. It does not use browser scraping and it does not call Companies House officers or persons-with-significant-control endpoints.

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

## Input

| Field | Type | Description |
| --- | --- | --- |
| `sources` | array | `companies_house`, `sec_edgar`, or both. |
| `query` | string | Company name, ticker, or broad search term. |
| `companyNames` | array | Optional list of names or tickers to search. |
| `companyNumbers` | array | Optional direct UK Companies House company numbers. |
| `ciks` | array | Optional direct SEC CIK identifiers. |
| `maxResults` | integer | Maximum clean records to save, 1 to 1000. |
| `companiesHouseApiKey` | secret string | Free Companies House API key, required only for `companies_house`. |
| `secUserAgent` | string | Descriptive SEC User-Agent. Replace the default contact email for production use. |

## Sample Input

```json
{
  "sources": ["sec_edgar"],
  "query": "Microsoft",
  "maxResults": 3,
  "secUserAgent": "CompanyRegistryFilingsAggregator/1.0 contact@example.com"
}
```

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

## Use Cases

- KYC checks and entity verification
- Supplier and customer due diligence
- Public-company filing monitoring
- Market research and company list enrichment
- Finance, compliance, and business intelligence workflows

## Pricing

This Actor uses pay per event pricing.

| Event | When charged | Price |
| --- | --- | --- |
| `company-record-scraped` | Each clean company/entity record saved to the dataset | `$0.004` |

Each unique company record is saved and charged atomically. Empty searches and failed records are not billed, and later sources stop when the user's spending limit is reached.

## Attribution

Companies House data: Contains public sector information licensed under the Open Government Licence v3.0.

SEC EDGAR data is sourced from public SEC submissions endpoints. Follow SEC fair access rules and provide a descriptive User-Agent.

## Responsible Use

This Actor is intended for lawful collection of publicly available information only. Users are responsible for ensuring their use complies with the source website's terms, robots.txt, applicable privacy laws, including India's DPDP Act, and all local regulations.

Do not use this Actor to collect, store, sell, or misuse personal data without a lawful basis. The Actor author is not responsible for misuse by end users.

## License

Apache-2.0
