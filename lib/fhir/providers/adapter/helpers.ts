import { utcToWallTime, wallTimeToUtc } from '../../search';

/**
 * Functions available inside vendor JSONata expressions as $name(...).
 * Missing input (undefined/null) gives undefined, so optional vendor fields
 * simply drop out of the mapped resource. Malformed input throws MappingError,
 * whose message never contains the value itself (it may be PHI).
 */

export class MappingError extends Error {}

export type CodeTables = Record<string, Record<string, string>>;

/** FHIR instant without milliseconds: 2026-11-07T15:00:00Z */
export function formatInstant(d: Date): string {
  return d.toISOString().replace(/\.\d{3}Z$/, 'Z');
}

const LOCAL = /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?$/;
const TIME = /^(\d{2}):(\d{2})(?::(\d{2}))?$/;

/**
 * Vendor local date/time -> FHIR instant (UTC), DST-correct in `timeZone`.
 * localToUtc('2026-11-07', '10:00') or localToUtc('2026-11-07 10:00:00').
 */
export function localToUtc(timeZone: string, date: unknown, time?: unknown): string | undefined {
  if (date === undefined || date === null) return undefined;
  const text = time === undefined || time === null ? String(date) : `${String(date)} ${String(time)}`;
  const m = LOCAL.exec(text);
  if (!m || (time !== undefined && time !== null && !TIME.test(String(time)))) {
    throw new MappingError('localToUtc expects "YYYY-MM-DD" and "HH:MM[:SS]" (or "YYYY-MM-DD HH:MM[:SS]")');
  }
  const [, y, mo, d, h = '0', mi = '0', s = '0'] = m;
  const n = [y, mo, d, h, mi, s].map(Number);
  if (n[1] < 1 || n[1] > 12 || n[2] < 1 || n[2] > 31 || n[3] > 23 || n[4] > 59 || n[5] > 59) {
    throw new MappingError('localToUtc got an out-of-range date or time');
  }
  return formatInstant(wallTimeToUtc(timeZone, n[0], n[1], n[2], n[3], n[4], n[5]));
}

export function addMinutes(instant: unknown, minutes: unknown): string | undefined {
  if (instant === undefined || instant === null || minutes === undefined || minutes === null) return undefined;
  const t = Date.parse(String(instant));
  const n = Number(minutes);
  if (Number.isNaN(t) || !Number.isFinite(n)) throw new MappingError('addMinutes expects an instant and a number');
  return formatInstant(new Date(t + n * 60_000));
}

/** Code-table lookup. An unknown code is a mapping error, never a guess. */
export function lookup(codes: CodeTables, table: unknown, code: unknown): string | undefined {
  if (code === undefined || code === null || code === '') return undefined;
  const t = codes[String(table)];
  if (!t) throw new MappingError(`unknown code table '${String(table)}'`);
  const value = t[String(code)];
  if (value === undefined) throw new MappingError(`a code is missing from table '${String(table)}'`);
  return value;
}

export function reference(type: unknown, id: unknown): { reference: string } | undefined {
  if (id === undefined || id === null || id === '') return undefined;
  return { reference: `${String(type)}/${String(id)}` };
}

/** Vendor date in `format` (tokens DD, MM, YYYY) -> FHIR date YYYY-MM-DD. */
export function parseDate(value: unknown, format: unknown): string | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  const fmt = String(format ?? 'YYYY-MM-DD');
  const tokens: string[] = [];
  const pattern = fmt.replace(/YYYY|MM|DD|[.*+?^${}()|[\]\\]/g, (t) => {
    if (t === 'YYYY' || t === 'MM' || t === 'DD') {
      tokens.push(t);
      return t === 'YYYY' ? '(\\d{4})' : '(\\d{2})';
    }
    return `\\${t}`;
  });
  const m = new RegExp(`^${pattern}$`).exec(String(value));
  if (!m) throw new MappingError(`a date does not match the format '${fmt}'`);
  const part = (t: string) => m[tokens.indexOf(t) + 1];
  return `${part('YYYY')}-${part('MM')}-${part('DD')}`;
}

/** Instant -> local wall time in `timeZone`, formatted with YYYY MM DD HH mm ss. */
export function formatLocal(instant: unknown, timeZone: string, format = 'YYYY-MM-DD'): string | undefined {
  if (instant === undefined || instant === null || instant === '') return undefined;
  const t = Date.parse(String(instant));
  if (Number.isNaN(t)) throw new MappingError('expected an instant');
  const w = utcToWallTime(new Date(t), timeZone);
  const pad = (n: number, len = 2) => String(n).padStart(len, '0');
  const values: Record<string, string> = {
    YYYY: pad(w.year, 4),
    MM: pad(w.month),
    DD: pad(w.day),
    HH: pad(w.hour),
    mm: pad(w.minute),
    ss: pad(w.second),
  };
  return format.replace(/YYYY|MM|DD|HH|mm|ss/g, (token) => values[token]);
}

/** The last local day before an exclusive end instant (for vendors with inclusive "to" dates). */
export function lastLocalDate(exclusiveEnd: unknown, timeZone: string, format = 'YYYY-MM-DD'): string | undefined {
  if (exclusiveEnd === undefined || exclusiveEnd === null) return undefined;
  return formatLocal(new Date(Date.parse(String(exclusiveEnd)) - 1).toISOString(), timeZone, format);
}

/** Bindings handed to JSONata: `$config` plus the helper functions. */
export function helperBindings(timeZone: string, codes: CodeTables, config: Record<string, string>): Record<string, unknown> {
  return {
    config,
    localToUtc: (date: unknown, time?: unknown) => localToUtc(timeZone, date, time),
    addMinutes,
    lookup: (table: unknown, code: unknown) => lookup(codes, table, code),
    reference,
    date: parseDate,
    localDate: (instant: unknown, format?: string) => formatLocal(instant, timeZone, format),
    lastLocalDate: (instant: unknown, format?: string) => lastLocalDate(instant, timeZone, format),
  };
}
