import type { CompanyRecord } from './types.js';

const FORBIDDEN_FIELD_KEYS = new Set([
  'contact',
  'contactname',
  'dateofbirth',
  'director',
  'directors',
  'email',
  'emails',
  'officer',
  'officers',
  'personwithsignificantcontrol',
  'personswithsignificantcontrol',
  'phone',
  'phones',
  'psc',
  'telephone',
]);

function normalizedKey(value: string): string {
  return value.replace(/[^a-z0-9]/gi, '').toLowerCase();
}

export function containsForbiddenField(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(containsForbiddenField);
  if (typeof value !== 'object' || value === null) return false;
  return Object.entries(value).some(([key, nested]) => (
    FORBIDDEN_FIELD_KEYS.has(normalizedKey(key)) || containsForbiddenField(nested)
  ));
}

function isOfficialUrl(value: string | null, allowedHostname: string): boolean {
  if (!value) return false;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && url.hostname === allowedHostname;
  } catch {
    return false;
  }
}

export function recordSafetyIssue(record: CompanyRecord): string | null {
  if (containsForbiddenField(record)) return 'record contains a forbidden personal-data field';
  const allowedHostname = record.source === 'sec_edgar'
    ? 'www.sec.gov'
    : 'find-and-update.company-information.service.gov.uk';
  if (!isOfficialUrl(record.sourceUrl, allowedHostname)) return 'record sourceUrl is not an official HTTPS URL';
  for (const filing of record.recentFilings) {
    if (filing.documentUrl && !isOfficialUrl(filing.documentUrl, allowedHostname)) {
      return 'record contains a non-official filing URL';
    }
  }
  return null;
}
