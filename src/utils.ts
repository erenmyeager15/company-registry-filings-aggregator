export function normalizeText(value: unknown): string | null {
  const text = String(value ?? '').replace(/\s+/g, ' ').trim();
  return text || null;
}

export function uniqueStrings(values: Array<unknown>): string[] {
  const seen = new Set<string>();
  for (const value of values) {
    const text = normalizeText(value);
    if (text) seen.add(text);
  }
  return [...seen];
}

export function normalizeDate(value: unknown): string | null {
  const text = normalizeText(value);
  if (!text) return null;
  const dateOnly = text.match(/^\d{4}-\d{2}-\d{2}$/);
  if (dateOnly) return text;
  const parsed = new Date(text);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString().slice(0, 10);
}

export async function delay(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

export async function fetchJson<T>(url: string, options: RequestInit = {}, retries = 3): Promise<T> {
  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= retries; attempt += 1) {
    try {
      const response = await fetch(url, {
        ...options,
        headers: {
          accept: 'application/json',
          ...(options.headers ?? {}),
        },
      });
      const text = await response.text();
      if (!response.ok) throw new Error(`${response.status} ${response.statusText}: ${text.slice(0, 500)}`);
      return JSON.parse(text) as T;
    } catch (error) {
      lastError = error as Error;
      if (attempt < retries) await delay(600 * attempt);
    }
  }

  throw lastError ?? new Error(`Failed to fetch ${url}`);
}

export function basicAuthHeader(username: string): string {
  return `Basic ${Buffer.from(`${username}:`).toString('base64')}`;
}
