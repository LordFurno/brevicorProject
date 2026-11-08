import { describe, expect, it } from 'vitest';
import { validateResource } from '@/lib/fhir/validate';

const codes = (r: unknown, type?: string) => validateResource(r, type).map((i) => i.code);
const paths = (r: unknown, type?: string) => validateResource(r, type).flatMap((i) => i.expression ?? []);

const appointment = {
  resourceType: 'Appointment',
  id: 'a1',
  status: 'booked',
  start: '2026-11-07T15:00:00Z',
  end: '2026-11-07T15:15:00Z',
  participant: [
    { actor: { reference: 'Patient/p1' }, status: 'accepted' },
    { actor: { reference: 'Practitioner/d1' }, status: 'accepted' },
  ],
};

describe('validateResource', () => {
  it('accepts minimal valid resources', () => {
    expect(validateResource({ resourceType: 'Patient', id: 'p1', birthDate: '1980-05-15', gender: 'female' })).toEqual([]);
    expect(validateResource(appointment)).toEqual([]);
    expect(
      validateResource({ resourceType: 'Encounter', status: 'finished', class: { code: 'AMB' }, period: { start: '2026-01-01T10:00:00-05:00' } }),
    ).toEqual([]);
    expect(
      validateResource({ resourceType: 'DocumentReference', status: 'current', content: [{ attachment: { contentType: 'text/plain' } }] }),
    ).toEqual([]);
    expect(validateResource({ resourceType: 'Organization', name: 'Clinic' })).toEqual([]);
  });

  it('requires a resourceType and checks the expected type', () => {
    expect(codes({ id: 'x' })).toEqual(['required']);
    expect(codes({ resourceType: 'Patient' }, 'Encounter')).toEqual(['invalid']);
    expect(codes('nope')).toEqual(['structure']);
  });

  it('checks id and meta formats', () => {
    expect(codes({ resourceType: 'Patient', id: 'has space' })).toEqual(['value']);
    expect(codes({ resourceType: 'Patient', meta: { lastUpdated: '2026-11-07' } })).toEqual(['value']);
  });

  it('enforces Appointment required elements and invariants', () => {
    expect(paths({ ...appointment, status: undefined })).toContain('Appointment.status');
    expect(codes({ ...appointment, status: 'scheduled' })).toEqual(['code-invalid']);
    expect(codes({ ...appointment, participant: [] })).toEqual(['required']);
    expect(paths({ ...appointment, participant: [{ actor: { reference: 'Patient/p1' } }] })).toContain(
      'Appointment.participant[0].status',
    );
    expect(codes({ ...appointment, end: undefined })).toContain('invariant'); // app-2
    expect(codes({ ...appointment, start: undefined, end: undefined })).toContain('invariant'); // app-3 (booked)
    expect(validateResource({ ...appointment, status: 'cancelled', start: undefined, end: undefined })).toEqual([]);
    expect(codes({ ...appointment, start: '2026-11-07' })).toContain('value'); // instant needs time + zone
  });

  it('enforces Encounter and DocumentReference required elements', () => {
    expect(paths({ resourceType: 'Encounter', status: 'finished' })).toEqual(['Encounter.class']);
    expect(paths({ resourceType: 'DocumentReference', status: 'current', content: [{}] })).toEqual([
      'DocumentReference.content[0].attachment',
    ]);
    expect(codes({ resourceType: 'DocumentReference', status: 'draft', content: [{ attachment: {} }] })).toEqual([
      'code-invalid',
    ]);
  });

  it('enforces org-1', () => {
    expect(codes({ resourceType: 'Organization' })).toEqual(['invariant']);
  });

  it('rejects non-literal references', () => {
    const r = { ...appointment, participant: [{ actor: { reference: 'urn:uuid:abc' }, status: 'accepted' }] };
    expect(paths(r)).toEqual(['Appointment.participant[0].actor.reference']);
    const conditional = { resourceType: 'Encounter', status: 'finished', class: {}, serviceProvider: { reference: 'Organization?identifier=x|y' } };
    expect(codes(conditional)).toEqual(['value']);
    expect(validateResource({ resourceType: 'Encounter', status: 'finished', class: {}, subject: { reference: 'https://ehr/fhir/Patient/1' } })).toEqual([]);
  });

  it('never echoes field values in diagnostics', () => {
    const issues = validateResource({ resourceType: 'Patient', birthDate: 'SECRET-1980', gender: 'SECRET' });
    expect(issues).toHaveLength(2);
    expect(JSON.stringify(issues)).not.toContain('SECRET');
  });
});
