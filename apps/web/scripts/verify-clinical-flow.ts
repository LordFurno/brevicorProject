// Live verification of the EHR integration, against running servers:
// chart sections from FHIR, Encounter on admit, "Save to chart" DocumentReference,
// and that ending the call leaves the Encounter in progress. Sends no
// notifications. Prints only ids, counts and statuses (no demographics).
//
//   node --conditions=react-server --import tsx scripts/verify-clinical-flow.ts
import { createClient } from '@supabase/supabase-js';
import type { DocumentReference, Encounter } from 'fhir/r4';
import { loadChart } from '../src/lib/clinical';
import { fromRow, SupabaseVisitStore } from '../src/lib/visits/store';
import { addPhoto } from '../src/media/visit-photos';

try {
  process.loadEnvFile('.env.local');
  process.loadEnvFile('../../.env.local');
} catch {
  /* Shell env is also supported. */
}
const base = process.env.APP_BASE_URL!;
const db = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SECRET_KEY!, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const store = new SupabaseVisitStore(db);
type Jar = Map<string, string>;
const assert = (ok: unknown, label: string) => {
  if (!ok) throw new Error(label);
};

async function request(path: string, jar: Jar, method = 'GET', body?: unknown) {
  const response = await fetch(`${base}${path}`, {
    method,
    headers: {
      Cookie: [...jar].map(([k, v]) => `${k}=${v}`).join('; '),
      Origin: base,
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
    redirect: 'manual',
  });
  for (const entry of response.headers.getSetCookie()) {
    const first = entry.split(';')[0],
      at = first.indexOf('=');
    if (at > 0) jar.set(first.slice(0, at), first.slice(at + 1));
  }
  return response;
}

async function fhir<T>(path: string, clinic: string): Promise<T> {
  const response = await fetch(`${process.env.FHIR_BASE_URL}/${path}`, {
    headers: { Authorization: `Bearer ${process.env.INTERNAL_SERVICE_TOKEN}`, 'X-Clinic-Id': clinic },
  });
  assert(response.ok, `FHIR read failed (${response.status})`);
  return response.json();
}

const localOnly = (r: { meta?: { tag?: { system?: string; code?: string }[] } }) =>
  !!r.meta?.tag?.some((t) => t.system === 'https://brevicor.ca/fhir/sync-status' && t.code === 'local-only');

async function verify(clinic: string) {
  const users = await db.auth.admin.listUsers({ perPage: 1000 });
  const emails = ['physician.one@demo.brevicor.test', 'physician.two@demo.brevicor.test'];
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
    .is('encounter_ref', null)
    .in('practitioner_ref', members!.map((m) => m.practitioner_ref))
    .order('start');
  const visit = (rows ?? []).map(fromRow).find((v) => !['cancelled', 'noshow', 'entered-in-error', 'fulfilled'].includes(v.appointmentStatus));
  assert(visit, 'No scheduled demo visit without an Encounter; reset/re-sync first');
  const member = members!.find((m) => m.practitioner_ref === visit!.practitionerRef)!;
  const email = users.data.users.find((u) => u.id === member.user_id)!.email!;

  const jar: Jar = new Map();
  assert((await request('/api/auth/login', jar, 'POST', { email, password: process.env.DEMO_USER_PASSWORD })).ok, 'Physician login failed');
  assert((await request('/api/doctor/clinic', jar, 'POST', { clinicId: clinic })).ok, 'Clinic switch failed');

  // 1. Chart: every section loads from FHIR, and the page renders it.
  const chart = await loadChart({ patientRef: visit!.patientRef, clinicId: clinic, name: '', dateOfBirth: '' });
  assert(!chart.error, 'Chart failed to load');
  const page = await request(`/doctor/consult/${visit!.id}`, jar);
  const html = await page.text();
  assert(page.ok, `Consult page failed (${page.status})`);
  assert(!html.includes("Not available from this clinic") && !html.includes("Couldn&#x27;t load"), 'A chart section is unavailable or failed');
  for (const name of [chart.conditions[0]?.name, chart.medications[0]?.name].filter(Boolean)) {
    assert(html.includes(name!.replace(/&/g, '&amp;').slice(0, 20)), 'Chart page is missing FHIR data');
  }

  // 2. Admit: opens the FHIR Encounter.
  assert((await request(`/api/doctor/visits/${visit!.id}/admit`, jar, 'POST')).ok, 'Admit failed');
  const admitted = (await store.get(clinic, visit!.id))!;
  assert(admitted.status === 'in_progress' && admitted.encounterRef, 'Encounter not linked on admit');
  const encounter = await fhir<Encounter>(admitted.encounterRef!, clinic);
  assert(encounter.status === 'in-progress' && encounter.class.code === 'VR', 'Encounter shape');
  assert(encounter.appointment?.[0]?.reference === visit!.appointmentRef, 'Encounter.appointment');

  // 3. Save to chart (synthetic photo record; no upload needed for the FHIR write).
  const photoId = crypto.randomUUID();
  await addPhoto(admitted, { id: photoId, publicId: 'brevicor/synthetic-verification', createdAt: new Date().toISOString(), notes: 'Synthetic verification note', diagnosis: 'Synthetic assessment', source: 'in_call_capture' }, 'physician');
  const saved = await request(`/api/doctor/visits/${visit!.id}/photos/${photoId}/chart`, jar, 'POST');
  const savedBody = await saved.json();
  assert(saved.ok && savedBody.photo?.documentRef, `Save to chart failed (${saved.status})`);
  const document = await fhir<DocumentReference>(savedBody.photo.documentRef, clinic);
  assert(document.docStatus === 'final' && document.context?.encounter?.[0]?.reference === admitted.encounterRef, 'DocumentReference shape');
  assert(document.author?.[0]?.reference === visit!.practitionerRef, 'DocumentReference.author');
  const byEncounter = await fhir<{ entry?: { resource: { id: string } }[] }>(`DocumentReference?encounter=${admitted.encounterRef}`, clinic);
  assert(byEncounter.entry?.some((e) => `DocumentReference/${e.resource.id}` === savedBody.photo.documentRef), 'DocumentReference not found by encounter');

  // 4. End call: the Encounter stays in progress.
  assert((await request(`/api/doctor/visits/${visit!.id}/end`, jar, 'POST')).ok, 'End failed');
  const afterEnd = await fhir<Encounter>(admitted.encounterRef!, clinic);

  const { data: events } = await db.from('visit_events').select('type,meta').eq('clinic_id', clinic).eq('visit_id', visit!.id).in('type', ['encounter_linked', 'photo_charted']);
  return {
    clinic,
    visit: visit!.id,
    chart: {
      sections: [...new Set(Object.values(chart.sections))],
      conditions: chart.conditions.length,
      allergies: chart.allergies.length,
      medications: chart.medications.length,
      vitals: chart.vitals.length,
      labs: chart.labs.length,
      pastVisits: chart.visits.length,
      healthCardSystem: chart.patient.healthCard ? 'ontario-hcn' : 'none',
    },
    encounter: { ref: admitted.encounterRef, status: encounter.status, class: encounter.class.code, localOnly: localOnly(encounter) },
    document: { ref: savedBody.photo.documentRef, docStatus: document.docStatus, linkedToEncounter: true, localOnly: localOnly(document), syncStatus: savedBody.syncStatus },
    afterEnd: { visit: (await store.get(clinic, visit!.id))!.status, encounterStatus: afterEnd.status },
    events: events!.map((e) => ({ type: e.type, ...e.meta })),
  };
}

try {
  for (const clinic of ['demo-mock', 'demo-clinicsoft']) console.log(JSON.stringify(await verify(clinic)));
} catch (e) {
  console.error(e instanceof Error ? e.message : 'Verification failed');
  process.exitCode = 1;
}
