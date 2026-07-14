export type SourceName = 'companies_house' | 'sec_edgar';

export interface ActorInput {
  sources?: SourceName[];
  query?: string;
  companyNames?: string[];
  companyNumbers?: string[];
  ciks?: string[];
  maxResults?: number;
  companiesHouseApiKey?: string;
  secUserAgent?: string;
  proxyConfiguration?: Record<string, unknown>;
}

export interface NormalizedInput {
  sources: SourceName[];
  queries: string[];
  companyNumbers: string[];
  ciks: string[];
  maxResults: number;
  companiesHouseApiKey: string | null;
  secUserAgent: string;
}

export interface RegisteredAddress {
  addressLine1: string | null;
  addressLine2: string | null;
  locality: string | null;
  region: string | null;
  postalCode: string | null;
  country: string | null;
}

export interface RecentFiling {
  formType: string | null;
  filingDate: string | null;
  accessionNumber: string | null;
  documentUrl: string | null;
}

export interface CompanyRecord {
  source: SourceName;
  query: string | null;
  entityId: string;
  companyName: string;
  status: string | null;
  entityType: string | null;
  jurisdiction: string | null;
  incorporationDate: string | null;
  sicCodes: string[];
  registeredAddress: RegisteredAddress | null;
  tickers: string[];
  exchanges: string[];
  stateOfIncorporation: string | null;
  accountsNextDue: string | null;
  accountsLastMadeUpTo: string | null;
  confirmationStatementNextDue: string | null;
  confirmationStatementLastMadeUpTo: string | null;
  dissolutionDate: string | null;
  fiscalYearEnd: string | null;
  lastFilingDate: string | null;
  recentFilings: RecentFiling[];
  sourceUrl: string | null;
  attribution: string;
  scrapedAt: string;
}

export interface CompaniesHouseSearchResponse {
  items?: CompaniesHouseSearchItem[];
  total_results?: number;
  start_index?: number;
  items_per_page?: number;
}

export interface CompaniesHouseSearchItem {
  company_number?: string;
  title?: string;
  company_status?: string;
  company_type?: string;
}

export interface CompaniesHouseProfile {
  company_number?: string;
  company_name?: string;
  company_status?: string;
  type?: string;
  jurisdiction?: string;
  date_of_creation?: string;
  date_of_cessation?: string;
  sic_codes?: string[];
  registered_office_address?: {
    address_line_1?: string;
    address_line_2?: string;
    locality?: string;
    region?: string;
    postal_code?: string;
    country?: string;
  };
  accounts?: {
    next_due?: string;
    last_accounts?: {
      made_up_to?: string;
    };
  };
  confirmation_statement?: {
    next_due?: string;
    last_made_up_to?: string;
  };
}

export interface CompaniesHouseFilingHistory {
  items?: CompaniesHouseFiling[];
}

export interface CompaniesHouseFiling {
  type?: string;
  date?: string;
  transaction_id?: string;
  links?: {
    document_metadata?: string;
  };
}

export interface SecTickerEntry {
  cik_str?: number;
  ticker?: string;
  title?: string;
}

export interface SecSubmissions {
  cik?: string;
  name?: string;
  entityType?: string;
  ownerOrg?: string;
  insiderTransactionForOwnerExists?: number;
  insiderTransactionForIssuerExists?: number;
  tickers?: string[];
  exchanges?: string[];
  sic?: string | number;
  sicDescription?: string;
  stateOfIncorporation?: string;
  fiscalYearEnd?: string;
  filings?: {
    recent?: {
      accessionNumber?: string[];
      filingDate?: string[];
      form?: string[];
      primaryDocument?: string[];
    };
  };
}

export interface CompanyLookupResult {
  record: CompanyRecord | null;
  warnings: string[];
}

export interface SourceCollectionResult {
  records: CompanyRecord[];
  completedOperations: number;
  failedOperations: number;
  warnings: string[];
}
