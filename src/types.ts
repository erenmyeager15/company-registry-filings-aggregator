export type SourceName = 'companies_house' | 'sec_edgar';

export interface ActorInput {
  sources?: SourceName[];
  query?: string;
  companyNames?: string[];
  companyNumbers?: string[];
  ciks?: string[];
  maxResults?: number;
  maxFilingsPerCompany?: number;
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
  maxFilingsPerCompany: number;
  companiesHouseApiKey: string | null;
  secUserAgent: string;
}

export interface RegisteredAddress {
  premises: string | null;
  poBox: string | null;
  addressLine1: string | null;
  addressLine2: string | null;
  locality: string | null;
  region: string | null;
  postalCode: string | null;
  country: string | null;
  formattedAddress: string | null;
}

export interface SecCompanyAddress {
  street1: string | null;
  street2: string | null;
  city: string | null;
  stateOrCountry: string | null;
  stateOrCountryDescription: string | null;
  postalCode: string | null;
  formattedAddress: string | null;
}

export interface PreviousCompanyName {
  name: string;
  effectiveFrom: string | null;
  ceasedOn: string | null;
}

export interface RecentFiling {
  formType: string | null;
  filingDate: string | null;
  reportDate: string | null;
  acceptedAt: string | null;
  accessionNumber: string | null;
  category: string | null;
  subcategory: string | null;
  description: string | null;
  changeType: string;
  isAmendment: boolean;
  filingItems: string[];
  paperFiled: boolean | null;
  pageCount: number | null;
  documentUrl: string | null;
}

export interface CompanyRecord {
  source: SourceName;
  query: string | null;
  entityId: string;
  entityIdType: 'company_number' | 'cik';
  companyNumber: string | null;
  cik: string | null;
  companyName: string;
  previousNames: PreviousCompanyName[];
  status: string | null;
  statusDetail: string | null;
  entityType: string | null;
  entitySubtype: string | null;
  jurisdiction: string | null;
  incorporationDate: string | null;
  legalEntityIdentifier: string | null;
  employerIdentificationNumber: string | null;
  companyCategory: string | null;
  sicCodes: string[];
  officialWebsiteUrl: string | null;
  officialWebsiteDomain: string | null;
  investorRelationsUrl: string | null;
  investorRelationsDomain: string | null;
  websiteSource: 'sec_edgar_submissions' | 'sec_filing_document' | null;
  registeredAddress: RegisteredAddress | null;
  registeredOfficeInDispute: boolean | null;
  registeredOfficeUndeliverable: boolean | null;
  businessAddress: SecCompanyAddress | null;
  mailingAddress: SecCompanyAddress | null;
  tickers: string[];
  exchanges: string[];
  stateOfIncorporation: string | null;
  stateOfIncorporationDescription: string | null;
  accountsNextDue: string | null;
  accountsLastMadeUpTo: string | null;
  confirmationStatementNextDue: string | null;
  confirmationStatementLastMadeUpTo: string | null;
  dissolutionDate: string | null;
  fiscalYearEnd: string | null;
  lastFilingDate: string | null;
  latestFilingChangeType: string | null;
  recentFilingChangeTypes: string[];
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
    premises?: string;
    po_box?: string;
    care_of?: string;
    address_line_1?: string;
    address_line_2?: string;
    locality?: string;
    region?: string;
    postal_code?: string;
    country?: string;
  };
  registered_office_is_in_dispute?: boolean;
  undeliverable_registered_office_address?: boolean;
  company_status_detail?: string;
  subtype?: string;
  previous_company_names?: Array<{
    name?: string;
    effective_from?: string;
    ceased_on?: string;
  }>;
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
  category?: string;
  subcategory?: string;
  description?: string;
  pages?: number;
  paper_filed?: boolean;
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
  ein?: string;
  lei?: string;
  category?: string;
  website?: string;
  investorWebsite?: string;
  ownerOrg?: string;
  insiderTransactionForOwnerExists?: number;
  insiderTransactionForIssuerExists?: number;
  tickers?: string[];
  exchanges?: string[];
  sic?: string | number;
  sicDescription?: string;
  stateOfIncorporation?: string;
  stateOfIncorporationDescription?: string;
  fiscalYearEnd?: string;
  addresses?: {
    business?: SecAddressValue;
    mailing?: SecAddressValue;
  };
  formerNames?: Array<{
    name?: string;
    from?: string;
    to?: string;
  }>;
  filings?: {
    recent?: {
      accessionNumber?: string[];
      filingDate?: string[];
      reportDate?: string[];
      acceptanceDateTime?: string[];
      form?: string[];
      items?: string[];
      primaryDocument?: string[];
      primaryDocDescription?: string[];
    };
  };
}

export interface SecAddressValue {
  street1?: string;
  street2?: string;
  city?: string;
  stateOrCountry?: string;
  zipCode?: string;
  stateOrCountryDescription?: string;
  phone?: string;
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
