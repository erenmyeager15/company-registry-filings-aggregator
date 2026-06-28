# Company Registry Promotion Notes

## YouTube Tutorial Title Options

- How to Scrape Official Company Registry and SEC Filing Data with Apify
- Company Registry & Filings Aggregator: Export SEC EDGAR and Companies House Data
- Build a Company Due Diligence Dataset from Official Public APIs

## 60-Second Tutorial Script

1. Show the actor page: "This actor collects official entity-level company facts from SEC EDGAR and UK Companies House."
2. Open the input form and keep `sec_edgar` selected.
3. Search for `Microsoft` or use a direct CIK such as `0000789019`.
4. Set `maxResults` to `3`.
5. Use a descriptive SEC User-Agent.
6. Run the actor.
7. Show the dataset fields: `entityId`, `companyName`, `tickers`, `exchanges`, `sicCodes`, `lastFilingDate`, and `recentFilings`.
8. Open the `sourceUrl` and one filing document URL.
9. Closing line: "Use this when you need official company facts and filing metadata without collecting officer or personal-contact data."

## Short Post Copy

I polished a Company Registry & Filings Aggregator on Apify.

It uses official public APIs to collect entity-level company data from SEC EDGAR by default, and UK Companies House when you provide your API key.

The output includes official identifiers, company names, status, jurisdiction, SIC data, tickers, exchanges, filing dates, recent filing metadata, source URLs, and attribution.

It intentionally avoids Companies House officer/PSC endpoints and filters SEC ownership-oriented forms from recent filings.

Example input:

```json
{
  "sources": ["sec_edgar"],
  "query": "Microsoft",
  "maxResults": 3,
  "secUserAgent": "CompanyRegistryFilingsAggregator/1.0 contact@example.com"
}
```

## SEO Keywords

- company registry scraper
- SEC EDGAR scraper
- Companies House scraper
- company filings scraper
- public company data API
- due diligence data scraper
- KYC company data
- Apify company registry actor

## Promotion Guard

Use only entity-level examples. Do not position this as a people, officer, owner, or personal-contact scraper.
