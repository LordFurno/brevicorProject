import { describe, expect, it } from 'vitest';
import { FhirError } from '@/lib/fhir/outcome';
import {
  dateRange,
  localReference,
  normalizeString,
  parseControlParams,
  parseDateSearch,
  parseReference,
  parseToken,
  splitOrValues,
  splitParamName,
  utcToWallTime,
  wallTimeToUtc,
  type DateCond,
} from '@/lib/fhir/search';

const TZ = 'America/Toronto';
const iso = (d: Date) => d.toISOString();

function fhirError(fn: () => unknown): FhirError {
  try {
    fn();
  } catch (err) {
    if (err instanceof FhirError) return err;
    throw err;
  }
  throw new Error('expected a FhirError');
}

describe('parseControlParams', () => {
  it('defaults and passes other params through in order', () => {
    const q = parseControlParams(new URLSearchParams('family=smith&date=ge2026-11-07&date=lt2026-11-08'));
    expect(q).toEqual({
      count: 20,
      offset: 0,
      params: [
        ['family', 'smith'],
        ['date', 'ge2026-11-07'],
        ['date', 'lt2026-11-08'],
      ],
    });
  });

  it('clamps _count and reads _offset', () => {
    expect(parseControlParams(new URLSearchParams('_count=500&_offset=40'))).toMatchObject({ count: 100, offset: 40 });
    expect(parseControlParams(new URLSearchParams('_count=0'))).toMatchObject({ count: 0 });
  });

  it('rejects bad control values', () => {
    expect(fhirError(() => parseControlParams(new URLSearchParams('_count=abc'))).status).toBe(400);
    expect(fhirError(() => parseControlParams(new URLSearchParams('_count=-1'))).status).toBe(400);
    expect(fhirError(() => parseControlParams(new URLSearchParams('_offset=99999'))).status).toBe(400);
    expect(fhirError(() => parseControlParams(new URLSearchParams('_format=xml'))).status).toBe(406);
  });

  it('accepts JSON _format and ignores empty values', () => {
    expect(parseControlParams(new URLSearchParams('_format=json&family=&given=jo')).params).toEqual([['given', 'jo']]);
  });
});

describe('names and values', () => {
  it('splits modifiers', () => {
    expect(splitParamName('subject:Patient')).toEqual({ base: 'subject', modifier: 'Patient' });
    expect(splitParamName('family')).toEqual({ base: 'family' });
  });

  it('splits OR values on unescaped commas', () => {
    expect(splitOrValues('booked,cancelled')).toEqual(['booked', 'cancelled']);
    expect(splitOrValues('a\\,b,c')).toEqual(['a,b', 'c']);
  });

  it('normalises strings for case/accent-insensitive matching', () => {
    expect(normalizeString('  Éloïse  ')).toBe('eloise');
    expect(normalizeString("O'Brien")).toBe("o'brien");
    expect(normalizeString('a%b_c|d*e')).toBe('a b c d e');
  });
});

describe('parseToken', () => {
  it('handles system|code, |code and code', () => {
    expect(parseToken('http://sys|123')).toEqual({ system: 'http://sys', code: '123' });
    expect(parseToken('|123')).toEqual({ system: '', code: '123' });
    expect(parseToken('123')).toEqual({ code: '123' });
  });

  it('rejects system-only tokens', () => {
    expect(fhirError(() => parseToken('http://sys|')).status).toBe(400);
  });
});

describe('parseReference', () => {
  it('accepts id, Type/id and absolute URLs', () => {
    expect(parseReference('123')).toEqual({ type: undefined, id: '123' });
    expect(parseReference('Patient/123')).toEqual({ type: 'Patient', id: '123' });
    expect(parseReference('https://ehr.example/fhir/Patient/abc-1/_history/3')).toEqual({ type: 'Patient', id: 'abc-1' });
  });

  it('applies a :Type modifier', () => {
    expect(parseReference('123', 'Patient')).toEqual({ type: 'Patient', id: '123' });
    expect(fhirError(() => parseReference('Practitioner/123', 'Patient')).status).toBe(400);
  });

  it('rejects junk', () => {
    expect(fhirError(() => parseReference('not a ref!')).status).toBe(400);
    expect(fhirError(() => parseReference('Patient/')).status).toBe(400);
  });
});

describe('localReference (stored references)', () => {
  it('normalises literal references', () => {
    expect(localReference('Patient/1')).toBe('Patient/1');
    expect(localReference('Patient/1/_history/2')).toBe('Patient/1');
    expect(localReference('http://x/fhir/Encounter/e1')).toBe('Encounter/e1');
  });

  it('ignores non-literal references', () => {
    expect(localReference('urn:uuid:4b1e8b38-0000-0000-0000-000000000000')).toBeUndefined();
    expect(localReference('Practitioner?identifier=http://hl7.org/fhir/sid/us-npi|999')).toBeUndefined();
    expect(localReference('#contained')).toBeUndefined();
    expect(localReference(undefined)).toBeUndefined();
  });
});

describe('dateRange', () => {
  it('reads a date in the clinic timezone', () => {
    // EST (UTC-5): DST ended 2026-11-01.
    const r = dateRange('2026-11-07', TZ)!;
    expect([iso(r.lo), iso(r.hi)]).toEqual(['2026-11-07T05:00:00.000Z', '2026-11-08T05:00:00.000Z']);
  });

  it('resolves DST gaps forward and overlaps to the earlier instant', () => {
    // 02:30 doesn't exist on 2026-03-08 (clocks jump 02:00 EST -> 03:00 EDT): becomes 03:30 EDT.
    expect(iso(wallTimeToUtc(TZ, 2026, 3, 8, 2, 30))).toBe('2026-03-08T07:30:00.000Z');
    // 01:30 happens twice on 2026-11-01: the first (EDT) occurrence wins.
    expect(iso(wallTimeToUtc(TZ, 2026, 11, 1, 1, 30))).toBe('2026-11-01T05:30:00.000Z');
    expect(utcToWallTime(new Date('2026-11-01T06:30:00Z'), TZ)).toEqual({ year: 2026, month: 11, day: 1, hour: 1, minute: 30, second: 0 });
  });

  it('handles the 23-hour day when DST starts', () => {
    const r = dateRange('2026-03-08', TZ)!;
    expect([iso(r.lo), iso(r.hi)]).toEqual(['2026-03-08T05:00:00.000Z', '2026-03-09T04:00:00.000Z']);
  });

  it('uses the precision of the value', () => {
    const year = dateRange('2026', TZ)!;
    expect([iso(year.lo), iso(year.hi)]).toEqual(['2026-01-01T05:00:00.000Z', '2027-01-01T05:00:00.000Z']);
    const dec = dateRange('2026-12', TZ)!;
    expect(iso(dec.hi)).toBe('2027-01-01T05:00:00.000Z');
    const minute = dateRange('2026-11-07T10:30Z', TZ)!;
    expect([iso(minute.lo), iso(minute.hi)]).toEqual(['2026-11-07T10:30:00.000Z', '2026-11-07T10:31:00.000Z']);
    const second = dateRange('2026-11-07T10:30:15+01:00', TZ)!;
    expect([iso(second.lo), iso(second.hi)]).toEqual(['2026-11-07T09:30:15.000Z', '2026-11-07T09:30:16.000Z']);
    const ms = dateRange('2026-11-07T10:30:15.25Z', TZ)!;
    expect([iso(ms.lo), iso(ms.hi)]).toEqual(['2026-11-07T10:30:15.250Z', '2026-11-07T10:30:15.251Z']);
  });

  it('treats a time without offset as clinic-local', () => {
    expect(iso(dateRange('2026-11-07T09:00', TZ)!.lo)).toBe('2026-11-07T14:00:00.000Z');
  });

  it('repairs a "+" that arrived as a space', () => {
    expect(iso(dateRange('2026-11-07T10:30:00 05:00', TZ)!.lo)).toBe('2026-11-07T05:30:00.000Z');
  });

  it('rejects invalid dates', () => {
    for (const bad of ['2026-02-30', '2026-13', 'abc', '2026-11-07T25:00Z', '26-11-07', '2026-11-07T10:00+15:00']) {
      expect(dateRange(bad, TZ), bad).toBeUndefined();
    }
  });
});

/** Evaluates conditions the way the mock's SQL does, over a target [lo, hi). */
function matches(conds: DateCond[][], lo: string, hi: string): boolean {
  const target = { lo: new Date(lo).getTime(), hi: new Date(hi).getTime() };
  return conds.some((conj) =>
    conj.every((c) => {
      const v = target[c.bound];
      const at = c.at.getTime();
      return c.op === 'gt' ? v > at : c.op === 'gte' ? v >= at : c.op === 'lt' ? v < at : v <= at;
    }),
  );
}

describe('date prefixes (R4 semantics)', () => {
  // An appointment at 10:00 local on 2026-11-07 (instant, second precision).
  const appt = ['2026-11-07T15:00:00Z', '2026-11-07T15:00:01Z'] as const;
  const day = '2026-11-07';

  it.each([
    ['eq', day, true],
    ['ge', day, true],
    ['le', day, true],
    ['gt', day, false],
    ['lt', day, false],
    ['lt', '2026-11-08', true],
    ['gt', '2026-11-06', true],
    ['ge', '2026-11-08', false],
    ['le', '2026-11-06', false],
  ])('%s%s -> %s', (prefix, value, expected) => {
    expect(matches(parseDateSearch(`${prefix}${value}`, TZ), ...appt)).toBe(expected);
  });

  it('no prefix means eq', () => {
    expect(matches(parseDateSearch(day, TZ), ...appt)).toBe(true);
    expect(matches(parseDateSearch('2026-11-08', TZ), ...appt)).toBe(false);
  });

  it('the done-when query: ge today & lt tomorrow', () => {
    const conds = [parseDateSearch('ge2026-11-07', TZ), parseDateSearch('lt2026-11-08', TZ)];
    const inDay = conds.every((c) => matches(c, ...appt));
    const nextDay = conds.every((c) => matches(c, '2026-11-08T15:00:00Z', '2026-11-08T15:00:01Z'));
    expect([inDay, nextDay]).toEqual([true, false]);
  });

  it('periods: an open-ended period is on or after any later day', () => {
    const conds = parseDateSearch('ge2026-11-07', TZ);
    expect(matches(conds, '2026-11-01T00:00:00Z', '9999-12-31T00:00:00Z')).toBe(true);
    // Ends inside the day but started before it: neither above nor contained (R4 ge).
    expect(matches(conds, '2026-11-06T20:00:00Z', '2026-11-07T10:00:00Z')).toBe(false);
  });

  it('rejects unsupported prefixes and bad values', () => {
    expect(fhirError(() => parseDateSearch('ne2026-11-07', TZ)).status).toBe(400);
    expect(fhirError(() => parseDateSearch('sa2026-11-07', TZ)).code).toBe('not-supported');
    expect(fhirError(() => parseDateSearch('ge2026-99-01', TZ)).status).toBe(400);
  });
});
