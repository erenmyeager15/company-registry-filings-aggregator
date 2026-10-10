import { createHash } from 'node:crypto';
import type { CompanyMonitoringState, CompanyObservation, CompanyRecord, RecentFiling } from './types.js';

function hash(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

export function monitoringStoreName(monitorName: string): string {
  return `company-filings-monitor-${hash(monitorName.trim().toLowerCase()).slice(0, 24)}`;
}

export function monitoringRecordKey(record: Pick<CompanyRecord, 'source' | 'entityId'>): string {
  return `ENTITY_${hash(`${record.source}:${record.entityId}`).slice(0, 40)}`;
}

function filingKey(filing: RecentFiling): string | null {
  return filing.accessionNumber ?? (filing.filingDate && filing.formType
    ? `${filing.filingDate}:${filing.formType}:${filing.documentUrl ?? ''}`
    : null);
}

function observationFor(record: CompanyRecord): CompanyObservation {
  return {
    checkedAt: record.scrapedAt,
    companyName: record.companyName,
    status: record.status,
    officialWebsiteDomain: record.officialWebsiteDomain,
    registeredAddress: record.registeredAddress?.formattedAddress ?? null,
    businessAddress: record.businessAddress?.formattedAddress ?? null,
    filingAccessions: record.recentFilings.map(filingKey).filter((key): key is string => Boolean(key)).slice(0, 100),
    lastFilingDate: record.lastFilingDate,
  };
}

function retainedObservation(current: CompanyObservation, previous: CompanyObservation | null): CompanyObservation {
  if (!previous) return current;
  return {
    ...current,
    status: current.status ?? previous.status,
    officialWebsiteDomain: current.officialWebsiteDomain ?? previous.officialWebsiteDomain,
    registeredAddress: current.registeredAddress ?? previous.registeredAddress,
    businessAddress: current.businessAddress ?? previous.businessAddress,
    filingAccessions: [...new Set([...current.filingAccessions, ...previous.filingAccessions])].slice(0, 100),
    lastFilingDate: current.lastFilingDate ?? previous.lastFilingDate,
  };
}

export interface MonitoringResult {
  record: CompanyRecord;
  nextState: CompanyMonitoringState;
}

export function applyMonitoring(
  record: CompanyRecord,
  previousState: CompanyMonitoringState | null,
  monitorName: string,
  historyLimit: number,
): MonitoringResult {
  const current = observationFor(record);
  const previous = previousState?.history.at(-1) ?? null;
  const changedFields: string[] = [];
  const changeSignals: string[] = [];
  const previousFilings = new Set(previous?.filingAccessions ?? []);
  const newFilings = previous
    ? record.recentFilings.filter((filing) => {
      const key = filingKey(filing);
      return key !== null && !previousFilings.has(key);
    })
    : [];

  if (previous) {
    if (current.companyName !== previous.companyName) {
      changedFields.push('companyName');
      changeSignals.push('company_name_changed');
    }
    if (current.status !== null && current.status !== previous.status) {
      changedFields.push('status');
      changeSignals.push('company_status_changed');
    }
    if (current.officialWebsiteDomain !== null && current.officialWebsiteDomain !== previous.officialWebsiteDomain) {
      changedFields.push('officialWebsiteDomain');
      changeSignals.push('website_domain_changed');
    }
    if (current.registeredAddress !== null && current.registeredAddress !== previous.registeredAddress) {
      changedFields.push('registeredAddress');
      changeSignals.push('registered_office_changed');
    }
    if (current.businessAddress !== null && current.businessAddress !== previous.businessAddress) {
      changedFields.push('businessAddress');
      changeSignals.push('business_address_changed');
    }
    if (newFilings.length) {
      changedFields.push('recentFilings');
      changeSignals.push('new_filings');
      if (newFilings.some((filing) => filing.changeType === 'material_event')) {
        changeSignals.push('new_material_event_filing');
      }
      if (newFilings.some((filing) => filing.changeType === 'annual_report')) {
        changeSignals.push('new_annual_report');
      }
    }
  }

  const partial = previous !== null && (
    (previous.status !== null && current.status === null)
    || (previous.officialWebsiteDomain !== null && current.officialWebsiteDomain === null)
    || (previous.filingAccessions.length > 0 && current.filingAccessions.length === 0)
  );
  const monitoringStatus = !previous ? 'baseline' : partial ? 'partial' : changedFields.length ? 'updated' : 'unchanged';
  const changeSeverity = monitoringStatus === 'baseline' || monitoringStatus === 'unchanged'
    ? 'info'
    : monitoringStatus === 'partial'
      ? 'low'
      : changeSignals.includes('new_material_event_filing') || changeSignals.includes('company_status_changed')
        ? 'high'
        : 'medium';
  const changeSummary = monitoringStatus === 'baseline'
    ? 'First company observation saved for this watchlist.'
    : monitoringStatus === 'unchanged'
      ? 'No monitored company identity or filing changes were observed.'
      : monitoringStatus === 'partial'
        ? 'The current source response omitted previously available fields; prior values remain only in private history.'
        : `${newFilings.length} newly observed filing(s); changed fields: ${changedFields.join(', ')}.`;
  const firstSeenAt = previousState?.firstSeenAt ?? record.scrapedAt;
  const observationCount = (previousState?.observationCount ?? 0) + 1;

  return {
    record: {
      ...record,
      monitorName,
      monitoringStatus,
      changeSeverity,
      changeSummary,
      firstSeenAt,
      previousSeenAt: previous?.checkedAt ?? null,
      observationCount,
      previousCompanyName: previous?.companyName ?? null,
      previousStatus: previous?.status ?? null,
      previousWebsiteDomain: previous?.officialWebsiteDomain ?? null,
      previousLastFilingDate: previous?.lastFilingDate ?? null,
      changedFields,
      changeSignals,
      newFilings,
      newFilingCount: newFilings.length,
    },
    nextState: {
      schemaVersion: 1,
      firstSeenAt,
      observationCount,
      history: [...(previousState?.history ?? []), retainedObservation(current, previous)].slice(-historyLimit),
    },
  };
}
