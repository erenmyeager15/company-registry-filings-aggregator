import type { CompanyRecord } from './types.js';

function csvCell(value: unknown): string {
  const raw = value === null || value === undefined ? '' : String(value);
  const text = /^[\s]*[=+@\-]/.test(raw) ? `'${raw}` : raw;
  return `"${text.replaceAll('"', '""')}"`;
}

function safeMarkdown(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('|', '\\|').replaceAll('\n', ' ');
}

export function buildChangeCsv(records: CompanyRecord[]): string {
  const header = ['source', 'entityId', 'companyName', 'monitoringStatus', 'changeSeverity', 'newFilingCount', 'changedFields', 'changeSignals', 'lastFilingDate', 'sourceUrl', 'scrapedAt'];
  const rows = records.map((record) => [
    record.source,
    record.entityId,
    record.companyName,
    record.monitoringStatus,
    record.changeSeverity,
    record.newFilingCount,
    record.changedFields?.join('; '),
    record.changeSignals?.join('; '),
    record.lastFilingDate,
    record.sourceUrl,
    record.scrapedAt,
  ].map(csvCell).join(','));
  return [header.join(','), ...rows].join('\n');
}

export function buildChangeMarkdown(records: CompanyRecord[], monitorName: string): string {
  const updated = records.filter((record) => record.monitoringStatus === 'updated');
  const partial = records.filter((record) => record.monitoringStatus === 'partial');
  const lines = [
    '# Company filing watchlist',
    '',
    `Monitor: ${safeMarkdown(monitorName)}`,
    `Companies checked: ${records.length}; updated: ${updated.length}; partial: ${partial.length}.`,
    '',
    '| Company | Source | Status | New filings | Signals |',
    '| --- | --- | --- | ---: | --- |',
  ];
  for (const record of records) {
    lines.push(`| ${safeMarkdown(record.companyName)} | ${record.source} | ${record.monitoringStatus ?? 'not tracked'} | ${record.newFilingCount ?? 0} | ${safeMarkdown((record.changeSignals ?? []).join(', '))} |`);
  }
  lines.push('', 'Only official company-level metadata is included. An omitted source field is not reported as a confirmed change.');
  return lines.join('\n');
}
