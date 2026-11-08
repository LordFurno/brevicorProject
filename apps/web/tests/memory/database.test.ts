import { beforeAll, afterAll, describe, it, expect, vi } from 'vitest';
import { createClient } from '@supabase/supabase-js';
import type { Appointment } from 'fhir/r4';
import { SupabaseVisitStore } from '../../src/lib/visits/store';
import { syncVisits, defaultSyncRange } from '../../src/lib/visits/sync';
import { appointmentVisitId } from '../../src/lib/visits/tokens';
import { checkInAndGetStatus, rotateInvitation, verifyPatient } from '../../src/lib/visits/service';
import { getPhotos, getHistory, addPhoto, updatePhoto } from '../../src/media/visit-photos';
import type { Visit } from '../../src/lib/visits/types';
const configured = !!(process.env.SUPABASE_URL && process.env.SUPABASE_SECRET_KEY);
describe.skipIf(!configured)(
  'persistent memory (real Supabase, isolated clinic, no notifications)',
  () => {
    const clinic = `memory-test-${crypto.randomUUID().slice(0, 8)}`;
    const db = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SECRET_KEY!, {
        auth: { persistSession: false },
      }),
      store = new SupabaseVisitStore(db);
    let v: Visit;
    beforeAll(async () => {
      vi.stubEnv('VISIT_STORE', 'supabase');
      const { error } = await db
        .from('ehr_connections')
        .insert({ clinic_id: clinic, name: 'Memory integration', mode: 'mock' });
      if (error) throw new Error('Could not create test clinic');
      const a: Appointment = {
        resourceType: 'Appointment',
        id: 'memory-test',
        status: 'booked',
        start: new Date(Date.now() + 60000).toISOString(),
        end: new Date(Date.now() + 960000).toISOString(),
        participant: [
          { actor: { reference: 'Patient/p1' }, status: 'accepted' },
          { actor: { reference: 'Practitioner/d1' }, status: 'accepted' },
        ],
        serviceType: [
          {
            coding: [
              {
                system: 'https://brevicor.ca/fhir/CodeSystem/consultation-modality',
                code: 'video',
              },
            ],
          },
        ],
      };
      await Promise.all(
        Array.from({ length: 4 }, () =>
          syncVisits(clinic, defaultSyncRange(), {
            store,
            search: async () => [a],
            dispatch: () => {},
          }),
        ),
      );
      v = (await store.get(clinic, appointmentVisitId(clinic, 'Appointment/memory-test')))!;
    });
    afterAll(async () => {
      await db.from('ehr_connections').delete().eq('clinic_id', clinic);
    });
    it('creates exactly one visit/invitation during a concurrent sync', async () => {
      expect(v).toBeTruthy();
      const { data, error } = await db
        .from('visit_events')
        .select('type')
        .eq('clinic_id', clinic)
        .eq('visit_id', v.id);
      expect(error).toBeNull();
      expect(data?.filter((e) => e.type === 'invited')).toHaveLength(1);
    });
    it('persists token rotation across fresh store clients', async () => {
      const first = await rotateInvitation(store, v),
        next = await rotateInvitation(store, v),
        other = new SupabaseVisitStore(db);
      expect(await other.getByToken(first!)).toBeNull();
      expect((await other.getByToken(next!))?.id).toBe(v.id);
      expect(await other.get('another-clinic', v.id)).toBeNull();
    });
    it('counts concurrent DOB failures atomically and does not persist the submitted value', async () => {
      const token = await rotateInvitation(store, v);
      v = (await store.get(clinic, v.id))!;
      await Promise.all(
        Array.from({ length: 8 }, () =>
          verifyPatient(store, v, token!, '2000-01-01', async () => ({
            resourceType: 'Patient',
            birthDate: '1990-01-01',
          })),
        ),
      );
      expect((await store.get(clinic, v.id))?.verifyAttempts).toBe(5);
      const { data } = await db
        .from('visit_events')
        .select('meta')
        .eq('clinic_id', clinic)
        .eq('visit_id', v.id);
      expect(JSON.stringify(data)).not.toContain('2000-01-01');
    });
    it('commits one checked_in event across independent store clients', async () => {
      await rotateInvitation(store, v);
      v = (await store.get(clinic, v.id))!;
      await Promise.all(
        Array.from({ length: 6 }, () =>
          checkInAndGetStatus(new SupabaseVisitStore(db), v, Date.now(), () => {}),
        ),
      );
      const { data } = await db
        .from('visit_events')
        .select('id')
        .eq('clinic_id', clinic)
        .eq('visit_id', v.id)
        .eq('type', 'checked_in');
      expect(data).toHaveLength(1);
    });
    it('persists photo notes/history by clinic and patient across physicians', async () => {
      const photo = {
        id: crypto.randomUUID(),
        publicId: 'synthetic/test',
        createdAt: new Date().toISOString(),
        notes: 'Synthetic observation',
        source: 'in_call_capture' as const,
      };
      await addPhoto(v, photo, 'physician');
      await updatePhoto(v, photo.id, 'Updated synthetic note', 'Synthetic assessment');
      const rows = await getPhotos(v);
      expect(rows[0]).toMatchObject({
        id: photo.id,
        notes: 'Updated synthetic note',
        diagnosis: 'Synthetic assessment',
      });
      expect(
        await getHistory({ ...v, id: crypto.randomUUID(), practitionerRef: 'Practitioner/d2' }),
      ).toHaveLength(1);
      expect(await getHistory({ ...v, clinicId: 'unrelated-clinic' })).toHaveLength(0);
      expect(await getHistory({ ...v, patientRef: 'Patient/other' })).toHaveLength(0);
    });
    it('rejects cross-clinic photo references and PHI audit fields in the database', async () => {
      const { error } = await db.from('visit_photos').insert({
        id: crypto.randomUUID(),
        clinic_id: 'demo-mock',
        visit_id: v.id,
        patient_ref: 'Patient/p1',
        cloudinary_public_id: 'test',
        source: 'patient_upload',
      });
      expect(error?.code).toBe('23503');
      const result = await db.from('visit_events').insert({
        clinic_id: clinic,
        visit_id: v.id,
        type: 'synced',
        actor: 'system',
        meta: { dob: 'forbidden' },
      });
      expect(result.error?.code).toBe('23514');
    });
    it('rejects stale authorization before writing a photo', async () => {
      const { error } = await db.rpc('memory_save_photo', {
        p_clinic: clinic,
        p_visit: v.id,
        p_actor: 'physician',
        p_update: false,
        p_photo: {
          id: crypto.randomUUID(),
          cloudinary_public_id: 'test',
          source: 'patient_upload',
          notes: '',
          diagnosis: '',
          _patient_ref: v.patientRef,
          _practitioner_ref: 'Practitioner/wrong',
        },
      });
      expect(error).toBeTruthy();
    });
    it('denies anonymous table reads and mutation execution', async () => {
      const client = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_ANON_KEY!, {
        auth: { persistSession: false },
      });
      for (const table of ['visits', 'visit_events', 'visit_photos']) {
        const { error } = await client.from(table).select('id').eq('clinic_id', clinic);
        expect(error).toBeTruthy();
      }
      const { error } = await client.rpc('memory_mutate_visit', {
        p_clinic: clinic,
        p_id: v.id,
        p_revision: 0,
        p_row: {},
        p_events: [],
      });
      expect(error).toBeTruthy();
    });
  },
);
