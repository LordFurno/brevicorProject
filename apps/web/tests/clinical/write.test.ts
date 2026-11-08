import { afterEach, describe, expect, it, vi } from 'vitest';
import { GatewayError } from '../../src/lib/clinical/gateway';
import { ensureEncounter, photoDocument, visitEncounter } from '../../src/lib/clinical/write';
import { endVisit, linkEncounter } from '../../src/lib/visits/service';
import { MemoryVisitStore, validateEvents } from '../../src/lib/visits/store';
import type { Visit } from '../../src/lib/visits/types';

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

const visit: Visit = {
  id: 'v1',
  clinicId: 'demo-clinicsoft',
  appointmentRef: 'Appointment/a1',
  patientRef: 'Patient/p1',
  practitionerRef: 'Practitioner/d1',
  modality: 'video',
  start: '2026-11-08T15:00:00.000Z',
  end: '2026-11-08T15:15:00.000Z',
  status: 'in_progress',
  appointmentStatus: 'booked',
  inviteTokenHash: 'a'.repeat(64),
  roomName: 'room',
  admittedAt: '2026-11-08T15:01:02.345Z',
  verifyAttempts: 0,
  revision: 0,
  createdAt: '2026-11-08T14:00:00.000Z',
  updatedAt: '2026-11-08T14:00:00.000Z',
};

async function seeded() {
  const store = new MemoryVisitStore();
  await store.mutate(visit.clinicId, visit.id, () => ({ visit, events: [] }));
  return store;
}

describe('Encounter write-back', () => {
  it('builds an in-progress virtual Encounter keyed by the appointment', () => {
    expect(visitEncounter(visit)).toEqual({
      resourceType: 'Encounter',
      identifier: [{ system: 'https://brevicor.ca/fhir/sid/appointment-encounter', value: 'a1' }],
      status: 'in-progress',
      class: { system: 'http://terminology.hl7.org/CodeSystem/v3-ActCode', code: 'VR', display: 'virtual' },
      type: [{ text: 'Video consultation' }],
      subject: { reference: 'Patient/p1' },
      participant: [{ individual: { reference: 'Practitioner/d1' } }],
      appointment: [{ reference: 'Appointment/a1' }],
      period: { start: '2026-11-08T15:01:02Z' },
    });
  });

  it('conditional-creates through the gateway with the physician token', async () => {
    vi.stubEnv('FHIR_BASE_URL', 'http://gateway.test/api/fhir/R4');
    const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      Response.json(
        { ...visitEncounter(visit), id: 'e9', meta: { tag: [{ system: 'https://brevicor.ca/fhir/sync-status', code: 'local-only' }] } },
        { status: 201 },
      ),
    );
    const linked = await ensureEncounter(visit, { clinicId: visit.clinicId, accessToken: 'physician-token' });
    expect(linked).toEqual({ ref: 'Encounter/e9', result: 'created', syncStatus: 'local-only' });
    const [url, init] = fetch.mock.calls[0];
    expect(String(url)).toBe('http://gateway.test/api/fhir/R4/Encounter');
    expect(init).toMatchObject({
      method: 'POST',
      headers: { Authorization: 'Bearer physician-token', 'X-Clinic-Id': 'demo-clinicsoft', 'If-None-Exist': 'appointment=Appointment%2Fa1' },
    });
  });

  it('a 200 from the conditional create means the Encounter already existed', async () => {
    vi.stubEnv('FHIR_BASE_URL', 'http://gateway.test/api/fhir/R4');
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(Response.json({ ...visitEncounter(visit), id: 'e1' }, { status: 200 }));
    expect(await ensureEncounter(visit, { clinicId: visit.clinicId })).toEqual({ ref: 'Encounter/e1', result: 'existing', syncStatus: 'ehr' });
  });

  it('admitting survives a failed Encounter write: the visit stays admitted and the failure is an event', async () => {
    const store = await seeded();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const result = await linkEncounter(visit, { clinicId: visit.clinicId }, store, async () => {
      throw new GatewayError(501);
    });
    expect(result.status).toBe('in_progress');
    expect((await store.get(visit.clinicId, visit.id))!.encounterRef).toBeUndefined();
    expect(store.events.map((e) => [e.type, e.meta])).toEqual([['encounter_failed', { errorCode: 'gateway:501' }]]);
  });

  it('links once; later calls do not write again; ending the call leaves the Encounter alone', async () => {
    const store = await seeded();
    const create = vi.fn(async () => ({ ref: 'Encounter/e1', result: 'created' as const, syncStatus: 'ehr' as const }));
    const linked = await linkEncounter(visit, { clinicId: visit.clinicId }, store, create);
    expect(linked.encounterRef).toBe('Encounter/e1');
    await linkEncounter(linked, { clinicId: visit.clinicId }, store, create);
    expect(create).toHaveBeenCalledTimes(1);
    const fetch = vi.spyOn(globalThis, 'fetch');
    const ended = await endVisit(linked, Date.now(), store);
    expect(ended?.encounterRef).toBe('Encounter/e1');
    expect(fetch).not.toHaveBeenCalled(); // no FHIR call on end
    expect(store.events.map((e) => e.type)).toEqual(['encounter_linked', 'ended']);
  });

  it('audit metadata allows the sync status', () => {
    expect(() => validateEvents([{ type: 'encounter_linked', actor: 'physician', meta: { result: 'created', syncStatus: 'local-only' } }])).not.toThrow();
  });
});

describe('Save to chart', () => {
  it('files the photo as a final DocumentReference on the visit encounter, authored by the physician', () => {
    const doc = photoDocument(
      { ...visit, encounterRef: 'Encounter/e1' },
      { id: 'ph1', createdAt: '2026-11-08T15:05:00.000Z', notes: 'Healing well', diagnosis: 'Contact dermatitis' },
      'https://app.example/api/media/photos/ph1',
      Date.parse('2026-11-08T15:10:00Z'),
    );
    expect(doc).toEqual({
      resourceType: 'DocumentReference',
      status: 'current',
      docStatus: 'final',
      type: { coding: [{ system: 'http://loinc.org', code: '72170-4', display: 'Photographic image' }], text: 'Clinical photograph' },
      subject: { reference: 'Patient/p1' },
      date: '2026-11-08T15:10:00Z',
      author: [{ reference: 'Practitioner/d1' }],
      description: 'Diagnosis/assessment: Contact dermatitis\nNotes: Healing well',
      content: [
        {
          attachment: {
            contentType: 'image/jpeg',
            url: 'https://app.example/api/media/photos/ph1',
            title: 'Clinical photo – Contact dermatitis',
            creation: '2026-11-08T15:05:00.000Z',
          },
        },
      ],
      context: { encounter: [{ reference: 'Encounter/e1' }] },
    });
  });

  it('leaves out an empty description and a missing encounter', () => {
    const doc = photoDocument(visit, { id: 'ph1', createdAt: '2026-11-08T15:05:00.000Z', notes: ' ' }, 'https://app.example/x');
    expect(doc.description).toBeUndefined();
    expect(doc.context).toBeUndefined();
    expect(doc.content[0].attachment.title).toBe('Clinical photo');
  });
});
