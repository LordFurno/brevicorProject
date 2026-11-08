import { FhirError } from './outcome';

/**
 * Provider-neutral FHIR R4 search parsing (hl7.org/fhir/R4/search.html).
 * Used by the gateway (control params) and by providers that evaluate searches
 * themselves (mock, phase-2 adapters).
 */

export const DEFAULT_COUNT = 20;
export const MAX_COUNT = 100;
export const MAX_OFFSET = 10_000;

/** FHIR R4 id datatype. */
export const ID_RE = /^[A-Za-z0-9.-]{1,64}$/;
const TYPE_RE = /^[A-Z][A-Za-z]+$/;

/** Timezone for dates/times that carry none (FHIR: "the server's local timezone"). */
export function defaultTimeZone(): string {
  return process.env.FHIR_TIMEZONE || 'America/Toronto';
}

// --- Control params ---------------------------------------------------------

export interface ParsedQuery {
  params: [string, string][];
  count: number;
  offset: number;
}

const JSON_FORMATS = new Set(['json', 'application/json', 'application/fhir+json']);

/** Splits _count/_offset/_format off the query. Empty-valued params are ignored. */
export function parseControlParams(query: URLSearchParams): ParsedQuery {
  const params: [string, string][] = [];
  let count = DEFAULT_COUNT;
  let offset = 0;
  for (const [name, value] of query) {
    if (value === '') continue;
    if (name === '_count') {
      count = Math.min(parseNonNegativeInt(name, value), MAX_COUNT);
    } else if (name === '_offset') {
      offset = parseNonNegativeInt(name, value);
      if (offset > MAX_OFFSET) throw new FhirError(400, 'too-costly', `_offset may not exceed ${MAX_OFFSET}`);
    } else if (name === '_format') {
      if (!JSON_FORMATS.has(value)) throw new FhirError(406, 'not-supported', 'Only JSON is supported');
    } else {
      params.push([name, value]);
    }
  }
  return { params, count, offset };
}

function parseNonNegativeInt(name: string, value: string): number {
  if (!/^\d{1,9}$/.test(value)) throw new FhirError(400, 'value', `${name} must be a non-negative integer`);
  return Number(value);
}

/** "subject:Patient" -> { base: "subject", modifier: "Patient" } */
export function splitParamName(name: string): { base: string; modifier?: string } {
  const i = name.indexOf(':');
  return i === -1 ? { base: name } : { base: name.slice(0, i), modifier: name.slice(i + 1) };
}

/** Comma means OR. "\," is a literal comma. */
export function splitOrValues(value: string): string[] {
  return value
    .split(/(?<!\\),/)
    .map((v) => v.replace(/\\,/g, ','))
    .filter((v) => v !== '');
}

// --- string -----------------------------------------------------------------

/**
 * Case- and accent-insensitive form used on both sides of a string search.
 * Also removes characters that are special in LIKE patterns or PostgREST filters.
 */
export function normalizeString(value: string): string {
  return value
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[|%_*\\"(),]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// --- token ------------------------------------------------------------------

/** system undefined = any system; system '' = no system ("|code"). */
export interface TokenValue {
  system?: string;
  code: string;
}

export function parseToken(value: string): TokenValue {
  const i = value.indexOf('|');
  const token = i === -1 ? { code: value } : { system: value.slice(0, i), code: value.slice(i + 1) };
  if (token.code === '') throw new FhirError(400, 'not-supported', 'Token searches by system only are not supported');
  return token;
}

// --- reference --------------------------------------------------------------

export interface ReferenceValue {
  type?: string;
  id: string;
}

/**
 * Accepts "123", "Patient/123", "http://any/base/Patient/123" and version-
 * specific forms. `typeModifier` comes from "subject:Patient=123".
 */
export function parseReference(value: string, typeModifier?: string): ReferenceValue {
  const bare = value.replace(/\/_history\/[^/]+$/, '');
  let ref: ReferenceValue | undefined;
  const typed = /(?:^|\/)([A-Z][A-Za-z]+)\/([A-Za-z0-9.-]{1,64})$/.exec(bare);
  if (typed && (bare.includes('://') || bare === `${typed[1]}/${typed[2]}`)) {
    ref = { type: typed[1], id: typed[2] };
  } else if (ID_RE.test(bare)) {
    ref = { type: typeModifier, id: bare };
  }
  if (!ref) throw new FhirError(400, 'value', 'Invalid reference search value');
  if (typeModifier !== undefined) {
    if (!TYPE_RE.test(typeModifier)) throw new FhirError(400, 'value', 'Invalid reference type modifier');
    if (ref.type !== typeModifier) throw new FhirError(400, 'value', 'Reference type does not match its modifier');
  }
  return ref;
}

/**
 * Normalises a stored Reference.reference to "Type/id", or undefined if it
 * isn't a resolvable literal reference (contained, urn:, conditional, ...).
 */
export function localReference(reference: string | undefined): string | undefined {
  if (!reference) return undefined;
  const bare = reference.replace(/\/_history\/[^/]+$/, '');
  const m = /(?:^|\/)([A-Z][A-Za-z]+)\/([A-Za-z0-9.-]{1,64})$/.exec(bare);
  if (!m) return undefined;
  if (!bare.includes('://') && bare !== `${m[1]}/${m[2]}`) return undefined;
  return `${m[1]}/${m[2]}`;
}

// --- date -------------------------------------------------------------------

export type DatePrefix = 'eq' | 'ne' | 'gt' | 'lt' | 'ge' | 'le' | 'sa' | 'eb' | 'ap';
export const SUPPORTED_DATE_PREFIXES: readonly DatePrefix[] = ['eq', 'gt', 'lt', 'ge', 'le'];

/** Half-open interval [lo, hi). */
export interface DateRange {
  lo: Date;
  hi: Date;
}

const DATE_RE =
  /^(\d{4})(?:-(\d{2})(?:-(\d{2})(?:T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,9}))?)?(Z|[+-]\d{2}:\d{2})?)?)?)?$/;

/**
 * The implicit range of a FHIR date/dateTime/instant at its precision:
 * "2026-11-07" is that whole day in `timeZone`; "2026-11-07T10:00Z" is that minute.
 * Returns undefined if the value isn't a valid FHIR date.
 */
export function dateRange(value: string, timeZone: string): DateRange | undefined {
  // An unencoded "+" in a query string arrives as a space.
  const m = DATE_RE.exec(value.replace(/ (\d{2}:\d{2})$/, '+$1'));
  if (!m) return undefined;
  const [, ys, mos, ds, hs, mis, ss, frac, tz] = m;
  const y = Number(ys);
  const mo = mos === undefined ? 1 : Number(mos);
  const d = ds === undefined ? 1 : Number(ds);
  const h = hs === undefined ? 0 : Number(hs);
  const mi = mis === undefined ? 0 : Number(mis);
  const s = ss === undefined ? 0 : Number(ss);
  const ms = frac === undefined ? 0 : Number(frac.slice(0, 3).padEnd(3, '0'));
  if (mo < 1 || mo > 12 || d < 1 || d > daysInMonth(y, mo) || h > 23 || mi > 59 || s > 59) return undefined;

  const lo = [y, mo - 1, d, h, mi, s, ms] as const;
  const hi: [number, number, number, number, number, number, number] = [...lo];
  if (mos === undefined) hi[0] += 1;
  else if (ds === undefined) hi[1] += 1;
  else if (hs === undefined) hi[2] += 1;
  else if (ss === undefined) hi[4] += 1;
  else if (frac === undefined) hi[5] += 1;
  else hi[6] += 1;

  if (tz !== undefined) {
    const offsetMs = tz === 'Z' ? 0 : offsetToMs(tz);
    if (offsetMs === undefined) return undefined;
    return { lo: new Date(utcMs(...lo) - offsetMs), hi: new Date(utcMs(...hi) - offsetMs) };
  }
  return { lo: new Date(zonedMs(lo, timeZone)), hi: new Date(zonedMs(hi, timeZone)) };
}

/** Splits "ge2026-11-07" into prefix + value. No prefix means eq. */
export function splitDatePrefix(value: string): { prefix: DatePrefix; value: string } {
  const m = /^(eq|ne|gt|lt|ge|le|sa|eb|ap)?(.*)$/.exec(value)!;
  return { prefix: (m[1] as DatePrefix | undefined) ?? 'eq', value: m[2] };
}

/** A comparison against the target's stored range: lo (inclusive) or hi (exclusive). */
export interface DateCond {
  bound: 'lo' | 'hi';
  op: 'gt' | 'gte' | 'lt' | 'lte';
  at: Date;
}

/**
 * R4 prefix semantics as OR-of-ANDs over the target range [lo, hi), for a
 * search value range [L, H). See hl7.org/fhir/R4/search.html#prefix.
 */
export function dateConditions(prefix: DatePrefix, { lo: L, hi: H }: DateRange): DateCond[][] {
  const within: DateCond[] = [
    { bound: 'lo', op: 'gte', at: L },
    { bound: 'hi', op: 'lte', at: H },
  ];
  switch (prefix) {
    case 'eq':
      return [within];
    case 'gt':
      return [[{ bound: 'hi', op: 'gt', at: H }]];
    case 'lt':
      return [[{ bound: 'lo', op: 'lt', at: L }]];
    case 'ge':
      return [[{ bound: 'hi', op: 'gt', at: H }], within];
    case 'le':
      return [[{ bound: 'lo', op: 'lt', at: L }], within];
    default:
      throw new FhirError(400, 'not-supported', `Date prefix '${prefix}' is not supported`);
  }
}

/** Parses one date search value (after OR-splitting) into conditions. */
export function parseDateSearch(value: string, timeZone: string): DateCond[][] {
  const { prefix, value: raw } = splitDatePrefix(value);
  if (!SUPPORTED_DATE_PREFIXES.includes(prefix)) {
    throw new FhirError(400, 'not-supported', `Date prefix '${prefix}' is not supported`);
  }
  const range = dateRange(raw, timeZone);
  if (!range) throw new FhirError(400, 'value', 'Invalid date search value');
  return dateConditions(prefix, range);
}

function daysInMonth(y: number, mo: number): number {
  return new Date(utcMs(y, mo, 0, 0, 0, 0, 0)).getUTCDate();
}

function offsetToMs(tz: string): number | undefined {
  const [hh, mm] = tz.slice(1).split(':').map(Number);
  if (hh > 14 || mm > 59) return undefined;
  return (tz[0] === '-' ? -1 : 1) * (hh * 60 + mm) * 60_000;
}

/** Date.UTC that handles years < 100 and normalises overflow (month 12 -> next year). */
function utcMs(y: number, mo: number, d: number, h: number, mi: number, s: number, ms: number): number {
  const t = new Date(0);
  t.setUTCFullYear(y, mo, d);
  t.setUTCHours(h, mi, s, ms);
  return t.getTime();
}

const DAY_MS = 86_400_000;

/**
 * Wall-clock time in `timeZone` -> epoch ms. A time that happens twice (clocks
 * going back) resolves to the earlier instant; a time skipped when clocks go
 * forward moves forward by the gap (02:30 -> 03:30), like Temporal's "compatible".
 */
function zonedMs(parts: readonly [number, number, number, number, number, number, number], timeZone: string): number {
  const wall = utcMs(...parts);
  const before = tzOffsetMs(wall - DAY_MS, timeZone);
  const after = tzOffsetMs(wall + DAY_MS, timeZone);
  const valid = [wall - before, wall - after]
    .filter((t) => t + tzOffsetMs(t, timeZone) === wall)
    .sort((a, b) => a - b);
  return valid[0] ?? wall - before;
}

/** Local wall time in `timeZone` -> instant. Month is 1-based. DST handling as in zonedMs. */
export function wallTimeToUtc(
  timeZone: string,
  year: number,
  month: number,
  day: number,
  hour = 0,
  minute = 0,
  second = 0,
): Date {
  return new Date(zonedMs([year, month - 1, day, hour, minute, second, 0], timeZone));
}

export interface WallTime {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

/** Instant -> wall-clock time in `timeZone` (month 1-based). */
export function utcToWallTime(instant: Date, timeZone: string): WallTime {
  const p: Record<string, number> = {};
  for (const { type, value } of formatter(timeZone).formatToParts(instant)) p[type] = Number(value);
  return { year: p.year, month: p.month, day: p.day, hour: p.hour, minute: p.minute, second: p.second };
}

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatter(timeZone: string): Intl.DateTimeFormat {
  let f = formatters.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
      second: 'numeric',
    });
    formatters.set(timeZone, f);
  }
  return f;
}

function tzOffsetMs(instant: number, timeZone: string): number {
  const p = utcToWallTime(new Date(instant), timeZone);
  const wall = utcMs(p.year, p.month - 1, p.day, p.hour, p.minute, p.second, 0);
  return wall - Math.floor(instant / 1000) * 1000;
}
