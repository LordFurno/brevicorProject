// Explicit live verification: this script can send SMS through the running
// gateway. Unit/integration tests never invoke it. No links, cookies or DOBs
// are written to disk or stdout. Only non-demographic IDs enter the snapshot.
import { createClient } from '@supabase/supabase-js';
import { readFileSync, writeFileSync } from 'node:fs';
import { SupabaseVisitStore } from '../src/lib/visits/store';
import { fromRow } from '../src/lib/visits/store';
import { rotateInvitation } from '../src/lib/visits/service';
import { notifyVisit } from '../src/lib/notify';
import type { Patient } from 'fhir/r4';
try {
  process.loadEnvFile('.env.local');
  process.loadEnvFile('../../.env.local');
} catch {
  /* Shell env is also supported. */
}
const base = process.env.APP_BASE_URL!,
  other = process.env.SECOND_WEB_URL ?? 'http://localhost:3002';
const db = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SECRET_KEY!, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const store = new SupabaseVisitStore(db);
type Jar = Map<string, string>;
const assert = (ok: unknown, label: string) => {
  if (!ok) throw new Error(label);
};
async function request(origin: string, path: string, jar: Jar, method = 'GET', body?: unknown) {
  const response = await fetch(`${origin}${path}`, {
    method,
    headers: {
      Cookie: [...jar].map(([k, v]) => `${k}=${v}`).join('; '),
      ...(body instanceof FormData ? {} : body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body instanceof FormData ? body : body ? JSON.stringify(body) : undefined,
    redirect: 'manual',
  });
  for (const entry of response.headers.getSetCookie()) {
    const first = entry.split(';')[0],
      at = first.indexOf('=');
    if (at > 0) jar.set(first.slice(0, at), first.slice(at + 1));
  }
  return response;
}
async function login(email: string, clinic: string) {
  const jar: Jar = new Map();
  const response = await request(base, '/api/auth/login', jar, 'POST', {
    email,
    password: process.env.DEMO_USER_PASSWORD,
  });
  assert(response.ok, `Physician login failed (${response.status})`);
  assert(
    (await request(base, '/api/doctor/clinic', jar, 'POST', { clinicId: clinic })).ok,
    'Clinic switch failed',
  );
  return jar;
}
async function patient(ref: string, clinic: string): Promise<Patient> {
  const response = await fetch(`${process.env.FHIR_BASE_URL}/${ref}`, {
    headers: {
      Authorization: `Bearer ${process.env.INTERNAL_SERVICE_TOKEN}`,
      'X-Clinic-Id': clinic,
    },
  });
  assert(response.ok, 'FHIR Patient read failed');
  return response.json();
}
async function events(clinic: string, id: string) {
  const { data, error } = await db
    .from('visit_events')
    .select('id,type')
    .eq('clinic_id', clinic)
    .eq('visit_id', id);
  assert(!error, 'Timeline read failed');
  return data!;
}
interface Snapshot {
  clinic: string;
  visitId: string;
  photoId: string;
  eventIds: string[];
  email: string;
}
const snapshotPath = '.next/memory-flow.json';
async function main() {
  if (process.argv.includes('--restart-check')) {
    const snapshots = JSON.parse(readFileSync(snapshotPath, 'utf8')) as Snapshot[];
    for (const s of snapshots) {
      const doctor = await login(s.email, s.clinic),
        response = await request(other, `/api/doctor/visits/${s.visitId}/photos`, doctor),
        photos = (await response.json()).photos;
      assert(
        response.ok &&
          photos.some(
            (p: { id: string; notes: string }) =>
              p.id === s.photoId && p.notes === 'Synthetic restart verification',
          ),
        'Photo/notes did not survive restart',
      );
      const timeline = await events(s.clinic, s.visitId);
      assert(
        s.eventIds.every((id) => timeline.some((e) => e.id === id)),
        'Timeline did not survive restart',
      );
      const schedule = await (await request(other, '/api/doctor/visits', doctor)).json();
      assert(
        schedule.visits.some(
          (v: { id: string; status: string }) => v.id === s.visitId && v.status === 'in_progress',
        ),
        'Visit state did not survive restart',
      );
      assert(
        (await request(base, `/api/doctor/visits/${s.visitId}/end`, doctor, 'POST')).ok,
        'End visit failed',
      );
      console.log(
        JSON.stringify({
          clinic: s.clinic,
          restart: 'passed',
          visit: 'persisted',
          photos: photos.length,
          originalEventsPreserved: s.eventIds.length,
          ended: true,
        }),
      );
    }
    return;
  }
  if (!process.argv.includes('--send-notifications'))
    throw new Error('Live verification requires --send-notifications');
  const users = await db.auth.admin.listUsers({ perPage: 1000 });
  const emails = ['physician.one@demo.brevicor.test', 'physician.two@demo.brevicor.test'];
  const snapshots: Snapshot[] = [];
  for (const clinic of ['demo-mock', 'demo-clinicsoft']) {
    const ids = users.data.users.filter((u) => emails.includes(u.email ?? '')).map((u) => u.id);
    const { data: members } = await db
      .from('clinic_members')
      .select('user_id,practitioner_ref')
      .eq('clinic_id', clinic)
      .eq('role', 'physician')
      .in('user_id', ids);
    const { data: rows } = await db
      .from('visits')
      .select('*')
      .eq('clinic_id', clinic)
      .eq('status', 'scheduled')
      .eq('modality', 'video')
      .in(
        'practitioner_ref',
        members!.map((m) => m.practitioner_ref),
      );
    const eligible = rows!
      .map(fromRow)
      .filter(
        (v) =>
          Date.parse(v.start) >= Date.now() - 29 * 60000 &&
          Date.parse(v.start) <= Date.now() + 15 * 60000,
      );
    assert(
      eligible.length > 0,
      'No demo video appointment inside the check-in window; reset/re-sync first',
    );
    const visit = eligible[0],
      member = members!.find((m) => m.practitioner_ref === visit.practitionerRef)!,
      email = users.data.users.find((u) => u.id === member.user_id)!.email!;
    const doctor = await login(email, clinic);
    await db
      .from('physician_contacts')
      .update({ last_seen_at: null })
      .eq('clinic_id', clinic)
      .eq('user_id', member.user_id);
    // An explicit operator retry after the original trial-provider rejection.
    // The fresh key is intentional: failed notification keys are final.
    let invitationResults: unknown[] = [];
    for (const row of rows!) {
      const candidate = fromRow(row),
        p = await patient(candidate.patientRef, clinic);
      if (!p.telecom?.some((t) => t.system === 'phone' && t.value)) continue;
      const token = await rotateInvitation(store, candidate);
      const result = await notifyVisit(store, candidate, {
        type: 'visit_invitation',
        dedupeKey: `visit_invitation:${candidate.id}:${Date.parse(candidate.start)}:retry${Date.now()}`,
        appointmentRef: candidate.appointmentRef,
        link: `${base}/visit/${token}`,
      });
      invitationResults = result.results.map((r) => ({
        status: r.status,
        provider: r.provider,
        id: r.providerMessageId,
        errorCode: r.errorCode,
      }));
      break;
    }
    console.log(JSON.stringify({ clinic, invitationRetry: invitationResults }));
    const invite = await request(base, `/api/doctor/visits/${visit.id}/invitation`, doctor, 'POST');
    assert(invite.ok, 'New invitation failed');
    const link = (await invite.json()).link as string,
      token = link.split('/').at(-1)!,
      guest: Jar = new Map(),
      p = await patient(visit.patientRef, clinic);
    const page = await request(base, `/visit/${token}`, guest);
    assert(page.ok, 'Patient visit page failed');
    assert(
      (
        await request(base, `/api/visit/${token}/verify`, guest, 'POST', {
          dateOfBirth: p.birthDate,
        })
      ).ok,
      'DOB verification failed',
    );
    const checkin = await request(base, `/api/visit/${token}/status`, guest, 'POST'),
      status = await checkin.json();
    assert(status.phase === 'waiting', 'Patient did not enter waiting');
    const schedule = await (await request(other, '/api/doctor/visits', doctor)).json();
    assert(
      schedule.visits.some(
        (v: { id: string; status: string }) => v.id === visit.id && v.status === 'waiting',
      ),
      'Check-in not visible on second frontend',
    );
    assert(
      (await request(base, `/api/doctor/visits/${visit.id}/admit`, doctor, 'POST')).ok,
      'Admission failed',
    );
    assert(
      (await request(base, `/api/visit/${token}/join`, guest, 'POST')).ok,
      'Patient video credentials failed',
    );
    // New invitations revoke old links while preserving already joined calls.
    assert(
      (await request(base, `/api/doctor/visits/${visit.id}/invitation`, doctor, 'POST')).ok,
      'Active-call rotation failed',
    );
    assert(
      (
        await request(base, `/api/visit/${token}/verify`, new Map(), 'POST', {
          dateOfBirth: p.birthDate,
        })
      ).status === 404,
      'Old invitation still verifies',
    );
    assert(
      (await (await request(base, `/api/visit/${token}/status`, guest, 'POST')).json()).phase ===
        'in_call',
      'Rotation interrupted an established call',
    );
    const form = new FormData();
    form.append(
      'file',
      new Blob(
        [
          Buffer.from(
            'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Zl1kAAAAASUVORK5CYII=',
            'base64',
          ),
        ],
        { type: 'image/png' },
      ),
      'synthetic.png',
    );
    const upload = await request(base, `/api/visit/${token}/photos`, guest, 'POST', form);
    assert(upload.ok, `Cloudinary photo upload failed (${upload.status})`);
    const photoResponse = await request(other, `/api/doctor/visits/${visit.id}/photos`, doctor),
      photos = (await photoResponse.json()).photos,
      photoId = photos[0]?.id;
    assert(photoId, 'Photo not shared between servers');
    assert(
      (
        await request(base, `/api/doctor/visits/${visit.id}/photos`, doctor, 'PATCH', {
          id: photoId,
          notes: 'Synthetic restart verification',
          diagnosis: 'Synthetic test image',
        })
      ).ok,
      'Photo note update failed',
    );
    await request(base, '/api/doctor/presence', doctor, 'POST');
    // Allow after() delivery to finish, then inspect only sanitized provider results.
    let delivery: Record<string, unknown>[] = [];
    for (let attempt = 0; attempt < 15; attempt++) {
      const { data } = await db
        .from('notification_log')
        .select('status,provider,provider_message_id,error_code')
        .eq('clinic_id', clinic)
        .eq('dedupe_key', `patient_waiting:${visit.id}`)
        .eq('channel', 'sms');
      delivery = data ?? [];
      if (delivery.length && delivery[0].status !== 'sending') break;
      await new Promise((r) => setTimeout(r, 500));
    }
    const timeline = await events(clinic, visit.id);
    assert(
      timeline.some((e) => e.type === 'checked_in') &&
        timeline.some((e) => e.type === 'photo_added'),
      'Activity events missing',
    );
    snapshots.push({
      clinic,
      visitId: visit.id,
      photoId,
      eventIds: timeline.map((e) => e.id),
      email,
    });
    console.log(
      JSON.stringify({
        clinic,
        dob: 'verified',
        waiting: status.phase,
        waitingSms: delivery,
        crossServer: 'passed',
        admitted: true,
        photo: 'uploaded and annotated',
        tokenRotation: 'old link rejected; active call retained',
        events: timeline.length,
      }),
    );
  }
  writeFileSync(snapshotPath, JSON.stringify(snapshots, null, 2));
  console.log('Saved non-demographic IDs for restart verification.');
}
main().catch((e) => {
  console.error(e instanceof Error ? e.message : 'Verification failed');
  process.exitCode = 1;
});
