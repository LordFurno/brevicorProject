// Time helpers. All clinic scheduling happens in Ontario time; these work the
// same on server and client (no Node-only APIs).

export const CLINIC_TZ = 'America/Toronto';
export const CLINIC_TZ_LABEL = 'Eastern Time';

type At = Date | number | string;
const toDate = (a: At) => (a instanceof Date ? a : new Date(a));
export const pad = (n: number) => String(n).padStart(2, '0');

const partFormatters = new Map<string, Intl.DateTimeFormat>();
function partFormatter(tz: string) {
  let f = partFormatters.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    partFormatters.set(tz, f);
  }
  return f;
}

function zonedParts(ms: number, tz: string) {
  const out = { year: 0, month: 0, day: 0, hour: 0, minute: 0, second: 0 };
  for (const p of partFormatter(tz).formatToParts(new Date(ms))) {
    if (p.type in out) (out as Record<string, number>)[p.type] = Number(p.value);
  }
  out.hour %= 24;
  return out;
}

function tzOffset(ms: number, tz: string) {
  const base = Math.floor(ms / 1000) * 1000;
  const p = zonedParts(base, tz);
  return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - base;
}

/** The instant that is `minutes` after local midnight on `ymd` in `tz`. */
export function zonedDate(ymd: string, minutes: number, tz = CLINIC_TZ): Date {
  const [y, m, d] = ymd.split('-').map(Number);
  const naive = Date.UTC(y, m - 1, d, 0, minutes);
  const first = naive - tzOffset(naive, tz);
  return new Date(naive - tzOffset(first, tz));
}

export function ymdInTz(at: At, tz = CLINIC_TZ): string {
  const p = zonedParts(toDate(at).getTime(), tz);
  return `${p.year}-${pad(p.month)}-${pad(p.day)}`;
}

export function minutesInTz(at: At, tz = CLINIC_TZ): number {
  const p = zonedParts(toDate(at).getTime(), tz);
  return p.hour * 60 + p.minute;
}

export function addDays(ymd: string, n: number): string {
  const [y, m, d] = ymd.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

/** 0 = Sunday … 6 = Saturday */
export function weekday(ymd: string): number {
  const [y, m, d] = ymd.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

export function daysInMonth(month: string): number {
  const [y, m] = month.split('-').map(Number);
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

export function addMonths(month: string, n: number): string {
  const [y, m] = month.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 + n, 1));
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}`;
}

// Node and browsers disagree on whether "9:40 AM" uses a narrow no-break
// space; normalising avoids hydration mismatches.
const clean = (s: string) => s.replace(/[  ]/g, ' ');

function fmt(opts: Intl.DateTimeFormatOptions, tz = CLINIC_TZ) {
  return new Intl.DateTimeFormat('en-US', { timeZone: tz, ...opts });
}

export const formatTime = (at: At) => clean(fmt({ hour: 'numeric', minute: '2-digit' }).format(toDate(at)));
export const formatDateLong = (at: At) =>
  clean(fmt({ weekday: 'long', month: 'long', day: 'numeric' }).format(toDate(at)));
export const formatDateShort = (at: At) =>
  clean(fmt({ weekday: 'short', month: 'short', day: 'numeric' }).format(toDate(at)));

/** Format a plain calendar date ("1988-03-14") without timezone drift. */
export function formatYmd(ymd: string, opts: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric', year: 'numeric' }) {
  const [y, m, d] = ymd.slice(0, 10).split('-').map(Number);
  if (!y || !m || !d) return ymd;
  return clean(fmt(opts, 'UTC').format(new Date(Date.UTC(y, m - 1, d, 12))));
}

export function formatMonth(month: string) {
  return formatYmd(`${month}-01`, { month: 'long', year: 'numeric' });
}

export function formatWait(ms: number) {
  const m = Math.max(0, Math.floor(ms / 60000));
  if (m < 1) return 'under a minute';
  if (m < 60) return `${m} min`;
  return `${Math.floor(m / 60)} h ${m % 60} min`;
}

export function formatClock(ms: number) {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return h ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
}

export function ageFrom(birthDate: string, now: At = new Date()): number | undefined {
  const [y, m, d] = birthDate.split('-').map(Number);
  if (!y) return undefined;
  const today = ymdInTz(now).split('-').map(Number);
  let age = today[0] - y;
  if (today[1] < m || (today[1] === m && today[2] < (d || 1))) age--;
  return age;
}
