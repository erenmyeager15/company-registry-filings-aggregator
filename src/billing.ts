import type { CompanyRecord } from './types.js';

export interface PushDataResult {
  chargedCount: number;
  eventChargeLimitReached: boolean;
}

export type PushRecord = (record: CompanyRecord) => Promise<PushDataResult>;

export async function pushUniqueRecords(
  records: CompanyRecord[],
  seen: Set<string>,
  maximumToSave: number,
  pushRecord: PushRecord,
): Promise<{ saved: number; stopped: boolean }> {
  let saved = 0;
  for (const record of records) {
    if (saved >= maximumToSave) break;
    const key = `${record.source}:${record.entityId}`;
    if (seen.has(key)) continue;

    const result = await pushRecord(record);
    const recordWasSaved = result.chargedCount > 0 || !result.eventChargeLimitReached;
    if (recordWasSaved) {
      seen.add(key);
      saved += 1;
    }
    if (result.eventChargeLimitReached) return { saved, stopped: true };
  }
  return { saved, stopped: false };
}

export function sourceBudget(remainingRecords: number, remainingSources: number): number {
  if (remainingRecords <= 0 || remainingSources <= 0) return 0;
  return Math.max(1, Math.ceil(remainingRecords / remainingSources));
}

export function allOfficialOperationsFailed(completedOperations: number, failedOperations: number): boolean {
  return completedOperations === 0 && failedOperations > 0;
}
