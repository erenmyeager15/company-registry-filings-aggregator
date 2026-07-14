export function normalizeText(value: unknown): string | null {
  const text = String(value ?? '').replace(/\s+/g, ' ').trim();
  return text || null;
}

export function uniqueStrings(values: Array<unknown>): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const text = normalizeText(value);
    if (!text) continue;
    const key = text.toLocaleLowerCase('en-US');
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(text);
  }
  return result;
}

export function normalizeDate(value: unknown): string | null {
  const text = normalizeText(value);
  if (!text) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return isValidCalendarDate(text) ? text : null;
  const parsed = new Date(text);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString().slice(0, 10);
}

function isValidCalendarDate(value: string): boolean {
  const [yearText, monthText, dayText] = value.split('-');
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return (
    parsed.getUTCFullYear() === year
    && parsed.getUTCMonth() === month - 1
    && parsed.getUTCDate() === day
  );
}

export async function delay(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

const RETRYABLE_HTTP_STATUSES = new Set([408, 425, 429, 500, 502, 503, 504]);
const DEFAULT_REQUEST_TIMEOUT_MS = 20_000;
const MAX_RETRY_DELAY_MS = 30_000;
const hostNextRequestAt = new Map<string, number>();

export class HttpError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly retryAfterMs: number | null,
  ) {
    super(message);
    this.name = 'HttpError';
  }
}

export function isHttpStatus(error: unknown, status: number): boolean {
  return error instanceof HttpError && error.status === status;
}

export function minimumRequestIntervalMs(url: string): number {
  const hostname = new URL(url).hostname.toLowerCase();
  if (hostname === 'api.company-information.service.gov.uk') return 500;
  if (hostname === 'www.sec.gov' || hostname === 'data.sec.gov') return 125;
  return 0;
}

async function waitForHostSlot(url: string): Promise<void> {
  const intervalMs = minimumRequestIntervalMs(url);
  if (intervalMs === 0) return;
  const hostname = new URL(url).hostname.toLowerCase();
  const now = Date.now();
  const nextAllowedAt = hostNextRequestAt.get(hostname) ?? now;
  if (nextAllowedAt > now) await delay(nextAllowedAt - now);
  hostNextRequestAt.set(hostname, Math.max(nextAllowedAt, Date.now()) + intervalMs);
}

function parseRetryAfter(value: string | null): number | null {
  if (!value) return null;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) {
    return Math.min(seconds * 1000, MAX_RETRY_DELAY_MS);
  }
  const timestamp = Date.parse(value);
  if (Number.isNaN(timestamp)) return null;
  return Math.min(Math.max(timestamp - Date.now(), 0), MAX_RETRY_DELAY_MS);
}

function isRetryable(error: unknown): boolean {
  return !(error instanceof HttpError) || RETRYABLE_HTTP_STATUSES.has(error.status);
}

export interface FetchJsonOptions {
  retries?: number;
  timeoutMs?: number;
  pace?: boolean;
}

export async function fetchJson<T>(
  url: string,
  options: RequestInit = {},
  fetchOptions: FetchJsonOptions = {},
): Promise<T> {
  const retries = Math.min(Math.max(fetchOptions.retries ?? 3, 1), 5);
  const timeoutMs = Math.min(Math.max(fetchOptions.timeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS, 1000), 60_000);
  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= retries; attempt += 1) {
    try {
      if (fetchOptions.pace !== false) await waitForHostSlot(url);
      const timeoutSignal = AbortSignal.timeout(timeoutMs);
      const signal = options.signal ? AbortSignal.any([options.signal, timeoutSignal]) : timeoutSignal;
      const response = await fetch(url, {
        ...options,
        signal,
        headers: {
          accept: 'application/json',
          ...(options.headers ?? {}),
        },
      });
      const text = await response.text();
      if (!response.ok) {
        throw new HttpError(
          `${response.status} ${response.statusText}: ${text.slice(0, 500)}`,
          response.status,
          parseRetryAfter(response.headers.get('retry-after')),
        );
      }
      try {
        return JSON.parse(text) as T;
      } catch {
        throw new Error(`Official API returned invalid JSON: ${text.slice(0, 200)}`);
      }
    } catch (error) {
      lastError = error as Error;
      if (attempt >= retries || !isRetryable(error)) break;
      const retryAfterMs = error instanceof HttpError ? error.retryAfterMs : null;
      await delay(retryAfterMs ?? Math.min(650 * 2 ** (attempt - 1), MAX_RETRY_DELAY_MS));
    }
  }

  throw lastError ?? new Error(`Failed to fetch ${url}`);
}

export function basicAuthHeader(username: string): string {
  return `Basic ${Buffer.from(`${username}:`).toString('base64')}`;
}
