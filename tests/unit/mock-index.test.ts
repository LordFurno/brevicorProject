import type { FhirResource } from 'fhir/r4';
import { describe, expect, it } from 'vitest';
import { FhirError } from '@/lib/fhir/outcome';
import { compileSearch, extractSearchColumns, toRow, type Clause, type SearchColumns } from '@/lib/fhir/providers/mock-index';
import type { InScopeType } from '@/lib/fhir/provider';

const TZ = 'America/Toronto';

const patient: FhirResource = {
  resourceType: 'Patient',
  id: 'p1',
  name: [{ family: 'Côté', given: ['Éloïse', 'Marie'] }, { family: 'Smith' }],
  identifier: [
    { system: 'https://health.gov.on.ca/ohip', value: '1234567890' },
    { value: 'MRN-7' },
  ],
  birthDate: '1980-05-15',
};

const appointment: FhirResource = {
  resourceType: 'Appointment',
  id: 'a1',
  status: 'booked',
  start: '2026-11-07T15:00:00Z',
  end: '2026-11-07T15:15:00Z',
  participant: [
    { actor: { reference: 'Patient/p1' }, status: 'accepted' },
    { actor: { reference: 'Practitioner/d1' }, status: 'accepted' },
    { actor: { reference: 'urn:uuid:ignored' }, status: 'accepted' },
  ],
};

const encounter: FhirResource = {
  resourceType: 'Encounter',
  id: 'e1',
  status: 'in-progress',
  class: { code: 'VR' },
  subject: { reference: 'Patient/p1' },
  appointment: [{ reference: 'Appointment/a1' }],
  period: { start: '2026-11-07T15:00:00Z' },
};

const docRef: FhirResource = {
  resourceType: 'DocumentReference',
  id: 'd1',
  status: 'current',
  subject: { reference: 'Patient/p1' },
  context: { encounter: [{ reference: 'Encounter/e1' }] },
  content: [{ attachment: { contentType: 'text/plain' } }],
};

describe('extractSearchColumns', () => {
  it('Patient: names, identifiers, birthdate range', () => {
    const c = extractSearchColumns(patient, TZ);
    expect(c.strings).toBe('|family:cote|given:eloise|given:marie|family:smith|');
    expect(c.tokens).toEqual([
      'identifier:1234567890',
      'identifier:https://health.gov.on.ca/ohip|1234567890',
      'identifier:MRN-7',
      'identifier:|MRN-7',
    ]);
    expect([c.date_lo, c.date_hi]).toEqual(['1980-05-15T04:00:00.000Z', '1980-05-16T04:00:00.000Z']);
    expect(c.refs).toEqual([]);
  });

  it('Appointment: actor refs split by type, status, start', () => {
    const c = extractSearchColumns(appointment, TZ);
    expect(c.refs.sort()).toEqual(
      ['actor:Patient/p1', 'patient:Patient/p1', 'actor:Practitioner/d1', 'practitioner:Practitioner/d1'].sort(),
    );
    expect(c.tokens).toEqual(['status:booked']);
    expect([c.date_lo, c.date_hi]).toEqual(['2026-11-07T15:00:00.000Z', '2026-11-07T15:00:01.000Z']);
  });

  it('Encounter: subject/patient, appointment, open period', () => {
    const c = extractSearchColumns(encounter, TZ);
    expect(c.refs.sort()).toEqual(['appointment:Appointment/a1', 'patient:Patient/p1', 'subject:Patient/p1']);
    expect([c.date_lo, c.date_hi]).toEqual(['2026-11-07T15:00:00.000Z', 'infinity']);
  });

  it('DocumentReference: subject/patient and context.encounter', () => {
    expect(extractSearchColumns(docRef, TZ).refs.sort()).toEqual([
      'encounter:Encounter/e1',
      'patient:Patient/p1',
      'subject:Patient/p1',
    ]);
  });
});

describe('toRow', () => {
  it('stamps meta and derives columns', () => {
    const row = toRow('clinic-a', patient, 3, new Date('2026-11-07T12:00:00Z'), TZ);
    expect(row).toMatchObject({ clinic_id: 'clinic-a', resource_type: 'Patient', id: 'p1', version_id: 3 });
    expect(row.resource.meta).toEqual({ versionId: '3', lastUpdated: '2026-11-07T12:00:00.000Z' });
    expect(row.strings).toContain('family:cote');
  });
});

describe('compileSearch', () => {
  const err = (fn: () => unknown) => {
    try {
      fn();
    } catch (e) {
      if (e instanceof FhirError) return e.status;
    }
    return 'no error';
  };

  it('compiles each kind of param', () => {
    expect(compileSearch('Patient', [['family', 'CÔT']], TZ)).toEqual([{ column: 'strings', anyOf: ['|family:cot'] }]);
    expect(compileSearch('Patient', [['identifier', 'sys|1']], TZ)).toEqual([{ column: 'tokens', anyOf: ['identifier:sys|1'] }]);
    expect(compileSearch('Patient', [['_id', 'p1,p2']], TZ)).toEqual([{ column: 'id', anyOf: ['p1', 'p2'] }]);
    expect(compileSearch('Appointment', [['status', 'http://hl7.org/fhir/appointmentstatus|booked']], TZ)).toEqual([
      { column: 'tokens', anyOf: ['status:booked'] },
    ]);
    expect(compileSearch('Appointment', [['practitioner', 'Practitioner/d1']], TZ)).toEqual([
      { column: 'refs', anyOf: ['practitioner:Practitioner/d1'] },
    ]);
  });

  it('expands an untyped reference to every allowed target type', () => {
    expect(compileSearch('Encounter', [['subject', 'p1']], TZ)).toEqual([
      { column: 'refs', anyOf: ['subject:Patient/p1', 'subject:Group/p1'] },
    ]);
    expect(compileSearch('Encounter', [['subject:Patient', 'p1']], TZ)).toEqual([
      { column: 'refs', anyOf: ['subject:Patient/p1'] },
    ]);
    // A type that isn't a valid target can never match.
    expect(compileSearch('Encounter', [['patient', 'Group/g1']], TZ)).toEqual([{ column: 'refs', anyOf: [] }]);
  });

  it('rejects unknown params and modifiers', () => {
    expect(err(() => compileSearch('Patient', [['foo', '1']], TZ))).toBe(400);
    expect(err(() => compileSearch('Patient', [['family:exact', 'x']], TZ))).toBe(400);
    expect(err(() => compileSearch('Encounter', [['subject:Observation', 'x']], TZ))).toBe(400);
    expect(err(() => compileSearch('Patient', [['family', '%%%']], TZ))).toBe(400);
  });
});

/** In-memory evaluation of clauses, mirroring the SQL in providers/mock.ts. */
function evaluate(clauses: Clause[], id: string, c: SearchColumns): boolean {
  const ms = (v: string | null) => (v === 'infinity' ? Infinity : v === '-infinity' ? -Infinity : v ? Date.parse(v) : NaN);
  return clauses.every((clause) => {
    switch (clause.column) {
      case 'id':
        return clause.anyOf.includes(id);
      case 'refs':
      case 'tokens':
        return clause.anyOf.some((v) => c[clause.column].includes(v));
      case 'strings':
        return clause.anyOf.some((s) => c.strings.includes(s));
      case 'date':
        return clause.anyOf.some((conj) =>
          conj.every((d) => {
            const v = ms(d.bound === 'lo' ? c.date_lo : c.date_hi);
            const at = d.at.getTime();
            return d.op === 'gt' ? v > at : d.op === 'gte' ? v >= at : d.op === 'lt' ? v < at : v <= at;
          }),
        );
    }
  });
}

describe('search semantics end to end (extract + compile)', () => {
  const resources = [patient, appointment, encounter, docRef];
  const search = (type: InScopeType, params: [string, string][]) =>
    resources
      .filter((r) => r.resourceType === type)
      .filter((r) => evaluate(compileSearch(type, params, TZ), r.id!, extractSearchColumns(r, TZ)))
      .map((r) => r.id);

  it.each<[InScopeType, [string, string][], string[]]>([
    ['Patient', [['family', 'cote']], ['p1']],
    ['Patient', [['family', 'smi']], ['p1']],
    ['Patient', [['family', 'mith']], []], // prefix, not substring
    ['Patient', [['given', 'eloise'], ['family', 'smith']], ['p1']],
    ['Patient', [['given', 'zed,mar']], ['p1']],
    ['Patient', [['birthdate', '1980-05-15']], ['p1']],
    ['Patient', [['birthdate', 'lt1980-05-15']], []],
    ['Patient', [['identifier', '|MRN-7']], ['p1']],
    ['Patient', [['identifier', 'https://health.gov.on.ca/ohip|MRN-7']], []],
    ['Appointment', [['date', 'ge2026-11-07'], ['date', 'lt2026-11-08']], ['a1']],
    ['Appointment', [['date', 'gt2026-11-07']], []],
    ['Appointment', [['actor', 'Practitioner/d1']], ['a1']],
    ['Appointment', [['patient', 'p1'], ['status', 'booked,arrived']], ['a1']],
    ['Appointment', [['status', 'cancelled']], []],
    ['Encounter', [['appointment', 'a1']], ['e1']],
    ['Encounter', [['date', 'ge2026-11-08']], ['e1']], // still open
    ['Encounter', [['date', 'lt2026-11-07']], []],
    ['DocumentReference', [['encounter', 'Encounter/e1'], ['patient', 'p1']], ['d1']],
  ])('%s %j -> %j', (type, params, expected) => {
    expect(search(type, params)).toEqual(expected);
  });
});
