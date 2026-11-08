// Live verification of the consultation photo features against REAL Cloudinary,
// only through the app's own routes. Writes one rendered image per view to
// verification-output/photos/ (gitignored) and records everything it creates in
// verification-output/photos/created.json so `--cleanup` can remove it.
// Sends no notifications. Never prints secrets, links, cookies or demographics.
//
//   node --conditions=react-server --import tsx scripts/verify-photos-live.ts [--expiry] [--cleanup]
import { createClient } from '@supabase/supabase-js';
import type { DocumentReference, Patient } from 'fhir/r4';
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import sharp from 'sharp';
import { v2 as cloudinary } from 'cloudinary';
import { transformationFor, type TransformControls } from '../src/components/cloudinary/enhancements';
import { rotateInvitation } from '../src/lib/visits/service';
import { fromRow, SupabaseVisitStore } from '../src/lib/visits/store';
import { hashToken, newInviteToken } from '../src/lib/visits/tokens';
import type { Visit } from '../src/lib/visits/types';

try {
  process.loadEnvFile('.env.local');
  process.loadEnvFile('../../.env.local');
} catch {
  /* Shell env is also supported. */
}
const base = process.env.APP_BASE_URL!;
const OUT = 'verification-output/photos';
const LEDGER = join(OUT, 'created.json');
mkdirSync(OUT, { recursive: true });
const db = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SECRET_KEY!, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const store = new SupabaseVisitStore(db);
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

interface Ledger {
  photoIds: string[];
  publicIds: string[];
  documentRefs: { clinic: string; ref: string; table: 'fhir_resources' | 'fhir_docstore' }[];
  visits: { clinic: string; id: string }[];
  users: string[];
  clinics: string[];
}
const ledger: Ledger = existsSync(LEDGER)
  ? JSON.parse(readFileSync(LEDGER, 'utf8'))
  : { photoIds: [], publicIds: [], documentRefs: [], visits: [], users: [], clinics: [] };
const save = () => writeFileSync(LEDGER, JSON.stringify(ledger, null, 2));

const results: { check: string; ok: boolean; detail?: string }[] = [];
function check(name: string, ok: boolean, detail?: string) {
  results.push({ check: name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
}

// --- HTTP with a cookie jar ---------------------------------------------------
type Jar = Map<string, string>;
async function request(path: string, jar: Jar | null, method = 'GET', body?: unknown, headers: Record<string, string> = {}) {
  const response = await fetch(path.startsWith('http') ? path : `${base}${path}`, {
    method,
    headers: {
      ...(jar ? { Cookie: [...jar].map(([k, v]) => `${k}=${v}`).join('; ') } : {}),
      Origin: base,
      ...(body && !(body instanceof FormData) ? { 'Content-Type': 'application/json' } : {}),
      ...headers,
    },
    body: body instanceof FormData ? body : body ? JSON.stringify(body) : undefined,
    redirect: 'manual',
  });
  if (jar)
    for (const entry of response.headers.getSetCookie()) {
      const first = entry.split(';')[0],
        at = first.indexOf('=');
      if (at > 0) jar.set(first.slice(0, at), first.slice(at + 1));
    }
  return response;
}
async function login(email: string, password: string, clinic: string): Promise<Jar> {
  const jar: Jar = new Map();
  const res = await request('/api/auth/login', jar, 'POST', { email, password });
  if (!res.ok) throw new Error(`login failed (${res.status})`);
  const sw = await request('/api/doctor/clinic', jar, 'POST', { clinicId: clinic });
  if (!sw.ok) throw new Error(`clinic switch failed (${sw.status})`);
  return jar;
}
async function fhir<T>(path: string, clinic: string): Promise<T> {
  const r = await fetch(`${process.env.FHIR_BASE_URL}/${path}`, {
    headers: { Authorization: `Bearer ${process.env.INTERNAL_SERVICE_TOKEN}`, 'X-Clinic-Id': clinic },
  });
  if (!r.ok) throw new Error(`FHIR ${r.status}`);
  return r.json();
}

// --- Synthetic test images ----------------------------------------------------
/** Skin-toned field with mild texture and an irregular red blotch (no real person). */
async function skinPhoto(seed: number, format: 'png' | 'jpeg' = 'png'): Promise<Buffer> {
  const w = 900,
    h = 675,
    px = Buffer.alloc(w * h * 3);
  const cx = w * (0.45 + 0.1 * Math.sin(seed)),
    cy = h * 0.5,
    r = 120 + 15 * seed;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 3;
      const n = Math.sin(x * 0.21 + seed) * Math.cos(y * 0.17) * 6 + ((x * 31 + y * 17 + seed * 7) % 9) - 4;
      const a = Math.atan2(y - cy, x - cx);
      const edge = r * (1 + 0.18 * Math.sin(5 * a + seed) + 0.08 * Math.sin(11 * a));
      const d = Math.hypot(x - cx, y - cy);
      const t = Math.max(0, Math.min(1, (edge - d) / 30)); // soft margin
      px[i] = Math.round(224 + n - t * 30);
      px[i + 1] = Math.round(172 + n - t * 110);
      px[i + 2] = Math.round(140 + n - t * 95);
    }
  const img = sharp(px, { raw: { width: w, height: h, channels: 3 } });
  return format === 'png' ? img.png().toBuffer() : img.jpeg({ quality: 88 }).toBuffer();
}

function form(file: Buffer, type: string, name: string, source?: string) {
  const f = new FormData();
  f.append('file', new Blob([new Uint8Array(file)], { type }), name);
  if (source) f.append('source', source);
  return f;
}

async function newestPhoto(clinic: string, visitId: string) {
  const { data } = await db
    .from('visit_photos')
    .select('id,cloudinary_public_id,version,source,width,height')
    .eq('clinic_id', clinic)
    .eq('visit_id', visitId)
    .order('created_at', { ascending: false })
    .limit(1)
    .single();
  return data!;
}

function track(photo: { id: string; cloudinary_public_id: string }) {
  if (!ledger.photoIds.includes(photo.id)) ledger.photoIds.push(photo.id);
  if (!ledger.publicIds.includes(photo.cloudinary_public_id)) ledger.publicIds.push(photo.cloudinary_public_id);
  save();
}

// --- Views ----------------------------------------------------------------------
async function signedUrl(jar: Jar, visitId: string, photoId: string, t: string): Promise<string> {
  const r = await request(`/api/doctor/visits/${visitId}/photos/urls`, jar, 'POST', { items: [{ photoId, t }] });
  if (!r.ok) throw new Error(`sign failed (${r.status})`);
  const url = (await r.json()).urls[`${photoId}|${t}`];
  if (!url) throw new Error('photo not signed');
  return url;
}
const EXT: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/avif': 'avif', 'image/gif': 'gif' };
async function render(jar: Jar, visitId: string, photoId: string, name: string, controls: TransformControls, accept = 'image/avif,image/webp,image/*;q=0.8') {
  const t = transformationFor(controls);
  const res = await request(await signedUrl(jar, visitId, photoId, t), jar, 'GET', undefined, { Accept: accept });
  const type = res.headers.get('content-type') ?? '';
  const bytes = Buffer.from(await res.arrayBuffer());
  let meta: { width?: number; height?: number } | undefined;
  if (res.ok && type.startsWith('image/')) {
    writeFileSync(join(OUT, `${name}.${EXT[type] ?? 'bin'}`), bytes);
    meta = await sharp(bytes).metadata().catch(() => undefined);
  }
  return { status: res.status, type, size: bytes.length, width: meta?.width, height: meta?.height, t };
}

// --- Fixtures -----------------------------------------------------------------
async function physicianVisit(clinic: string, exclude: string[] = []) {
  const users = await db.auth.admin.listUsers({ perPage: 1000 });
  const emails = ['physician.one@demo.brevicor.test', 'physician.two@demo.brevicor.test'];
  const ids = users.data.users.filter((u) => emails.includes(u.email ?? '')).map((u) => u.id);
  const { data: members } = await db.from('clinic_members').select('user_id,practitioner_ref').eq('clinic_id', clinic).eq('role', 'physician').in('user_id', ids);
  const { data: rows } = await db
    .from('visits')
    .select('*')
    .eq('clinic_id', clinic)
    .in('status', ['scheduled', 'waiting'])
    .in('practitioner_ref', members!.map((m) => m.practitioner_ref))
    .order('start');
  const visit = (rows ?? [])
    .map(fromRow)
    .find((v) => !exclude.includes(v.id) && !['cancelled', 'noshow', 'entered-in-error', 'fulfilled'].includes(v.appointmentStatus));
  if (!visit) throw new Error(`no open demo visit in ${clinic}; reset/re-sync first`);
  const member = members!.find((m) => m.practitioner_ref === visit.practitionerRef)!;
  return { visit, email: users.data.users.find((u) => u.id === member.user_id)!.email! };
}

/** A second Brevicor visit for the same patient (synthetic appointment), to exercise progress history. */
async function secondVisit(first: Visit): Promise<Visit> {
  const id = crypto.randomUUID(),
    now = Date.now();
  const v: Visit = {
    ...first,
    id,
    appointmentRef: `Appointment/photo-verify-${id.slice(0, 8)}`,
    encounterRef: undefined,
    start: new Date(now - 7 * 86400000).toISOString(),
    end: new Date(now - 7 * 86400000 + 900000).toISOString(),
    status: 'scheduled',
    appointmentStatus: 'booked',
    inviteTokenHash: hashToken(newInviteToken(first.clinicId)),
    roomName: `photo-verify-${id.slice(0, 8)}`,
    waitingSince: undefined,
    lastSeenAt: undefined,
    admittedAt: undefined,
    endedAt: undefined,
    verifyAttempts: 0,
    revision: 0,
    createdAt: new Date(now).toISOString(),
    updatedAt: new Date(now).toISOString(),
  };
  await store.mutate(v.clinicId, v.id, () => ({ visit: v, events: [{ type: 'synced', actor: 'system' }] }));
  ledger.visits.push({ clinic: v.clinicId, id });
  save();
  return (await store.get(v.clinicId, id))!;
}

/** A physician who belongs only to a throwaway clinic. */
async function outsider() {
  const clinic = `photo-verify-${crypto.randomUUID().slice(0, 8)}`;
  const email = `${clinic}@demo.brevicor.test`;
  const password = `${crypto.randomUUID()}Aa1!`;
  const { error: ce } = await db.from('ehr_connections').insert({ clinic_id: clinic, name: 'Photo verification (outsider)', mode: 'mock' });
  if (ce) throw new Error('outsider clinic');
  ledger.clinics.push(clinic);
  save();
  const { data, error } = await db.auth.admin.createUser({ email, password, email_confirm: true });
  if (error || !data.user) throw new Error('outsider user');
  ledger.users.push(data.user.id);
  save();
  await db.from('clinic_members').insert({ user_id: data.user.id, clinic_id: clinic, role: 'physician', practitioner_ref: 'Practitioner/photo-verify' });
  return login(email, password, clinic);
}

// --- Main -----------------------------------------------------------------------
async function verify() {
  const cloud = process.env.CLOUDINARY_CLOUD_NAME!;
  const demo = await physicianVisit('demo-mock');
  const visit = demo.visit;
  const doctor = await login(demo.email, process.env.DEMO_USER_PASSWORD!, 'demo-mock');

  // 1. Patient pre-visit upload through /api/visit/[token]/photos.
  const token = (await rotateInvitation(store, visit))!;
  const patient = await fhir<Patient>(visit.patientRef, 'demo-mock');
  const pjar: Jar = new Map();
  const verified = await request(`/api/visit/${token}/verify`, pjar, 'POST', { dateOfBirth: patient.birthDate });
  check('patient verifies with DOB', verified.ok, `HTTP ${verified.status}`);
  const pu = await request(`/api/visit/${token}/photos`, pjar, 'POST', form(await skinPhoto(1), 'image/png', 'Jane-Doe-arm.png'));
  check('patient upload accepted', pu.ok, `HTTP ${pu.status}`);
  const pPhoto = await newestPhoto('demo-mock', visit.id);
  track(pPhoto);
  check('patient photo: random public id, patient_upload', /^brevicor\/[0-9a-f-]{36}$/.test(pPhoto.cloudinary_public_id) && pPhoto.source === 'patient_upload');
  const asset = await cloudinary.api.resource(pPhoto.cloudinary_public_id, { type: 'authenticated' }).catch(() => null);
  check('stored in Cloudinary as authenticated (private)', asset?.type === 'authenticated', `type=${asset?.type}, format=${asset?.format}`);
  const unsigned = await fetch(`https://res.cloudinary.com/${cloud}/image/authenticated/v${pPhoto.version}/${pPhoto.cloudinary_public_id}.${asset?.format ?? 'png'}`);
  const asPublic = await fetch(`https://res.cloudinary.com/${cloud}/image/upload/v${pPhoto.version}/${pPhoto.cloudinary_public_id}.${asset?.format ?? 'png'}`);
  check('raw Cloudinary URL without a signature is refused', !unsigned.ok && !asPublic.ok, `authenticated=${unsigned.status}, upload=${asPublic.status}`);

  // 2. Physician upload and live capture (in_call_capture; the browser sends a JPEG frame).
  const du = await request(`/api/doctor/visits/${visit.id}/photos`, doctor, 'POST', form(await skinPhoto(2), 'image/png', 'photo.png', 'patient_upload'));
  const dPhoto = (await du.json()).photo;
  check('physician upload', du.ok && !!dPhoto?.id, `HTTP ${du.status}`);
  track({ id: dPhoto.id, cloudinary_public_id: dPhoto.publicId });
  const cu = await request(`/api/doctor/visits/${visit.id}/photos`, doctor, 'POST', form(await skinPhoto(3, 'jpeg'), 'image/jpeg', 'capture.jpg', 'in_call_capture'));
  const cPhoto = (await cu.json()).photo;
  check('live-capture upload (in_call_capture)', cu.ok && cPhoto?.source === 'in_call_capture', `HTTP ${cu.status}`);
  track({ id: cPhoto.id, cloudinary_public_id: cPhoto.publicId });

  // Face blur needs a face: one of Cloudinary's own sample photos, uploaded through the app.
  let facePhotoId: string | undefined;
  let sample: { secure_url: string; public_id: string } | undefined;
  for (const id of ['samples/man-portrait', 'samples/people/smiling-man', 'samples/upscale-face-1']) {
    sample = await cloudinary.api.resource(id, { type: 'upload' }).catch(() => undefined);
    if (sample) break;
  }
  if (sample) {
    const bytes = Buffer.from(await (await fetch(sample.secure_url)).arrayBuffer());
    const fu = await request(`/api/doctor/visits/${visit.id}/photos`, doctor, 'POST', form(bytes, 'image/jpeg', 'sample.jpg', 'patient_upload'));
    const fp = (await fu.json()).photo;
    if (fu.ok && fp) {
      facePhotoId = fp.id;
      track({ id: fp.id, cloudinary_public_id: fp.publicId });
    }
    check('face sample uploaded through the app', !!facePhotoId, `sample ${sample.public_id}`);
  } else check('face sample available in the Cloudinary account', false, 'no samples/people assets');

  // 3. Every view through the signed-URL route.
  const views: [string, string, TransformControls][] = [
    ['01-original-colors', dPhoto.id, { filter: 'raw' }],
    ['02-photo-clarity', dPhoto.id, { filter: 'auto_enhance' }],
    ['03-sharpen-detail', dPhoto.id, { filter: 'hd_sharpen' }],
    ['04-color-balance', dPhoto.id, { filter: 'color_restore' }],
    ['05-lesion-zoom-auto-focus', dPhoto.id, { filter: 'wound_zoom', useAutoGravity: true }],
    ['06-lesion-zoom-manual-pan', dPhoto.id, { filter: 'wound_zoom', useAutoGravity: false, zoomLevel: 2, panX: 120, panY: -60 }],
    ['07-wound-outline-base', dPhoto.id, { filter: 'margin_outline' }],
    ['08-region-crop', dPhoto.id, { filter: 'raw', region: { x: 250, y: 150, width: 400, height: 380 } }],
    ['09-zoom-1x', dPhoto.id, { filter: 'raw', zoomLevel: 1 }],
    ['10-zoom-2x', dPhoto.id, { filter: 'raw', zoomLevel: 2 }],
    ['11-zoom-3x', dPhoto.id, { filter: 'raw', zoomLevel: 3 }],
    ['12-zoom-4x', dPhoto.id, { filter: 'raw', zoomLevel: 4 }],
    ['13-annotation', dPhoto.id, { filter: 'raw', annotation: { enabled: true, text: 'Margin 2 cm, review in 1 week', color: 'yellow', position: 'north_west' } }],
    ['14-low-data', dPhoto.id, { filter: 'raw', lowDataMode: true }],
    ['15-patient-upload-original', pPhoto.id, { filter: 'raw' }],
    ['16-live-capture-original', cPhoto.id, { filter: 'raw' }],
  ];
  if (facePhotoId) {
    views.push(['17-face-sample-original', facePhotoId, { filter: 'raw' }]);
    views.push(['18-face-blur', facePhotoId, { filter: 'raw', privacy: { blurFaces: true, shelterSafetyMode: false, stripMetadata: false, signedUrl: false } }]);
  }
  const rendered: Record<string, Awaited<ReturnType<typeof render>>> = {};
  for (const [name, id, controls] of views) {
    try {
      const r = await render(doctor, visit.id, id, name, controls);
      rendered[name] = r;
      check(`view ${name}`, r.status === 200 && r.type.startsWith('image/'), `HTTP ${r.status} ${r.type} ${r.width}x${r.height}`);
    } catch (e) {
      check(`view ${name}`, false, e instanceof Error ? e.message : 'error');
    }
  }
  const low = rendered['14-low-data'];
  check('low-data mode: q_auto:eco and at most 640px', !!low && low.t.includes('q_auto:eco') && low.t.includes('w_640') && (low.width ?? 9999) <= 640, `${low?.width}x${low?.height}, ${low?.size} bytes vs ${rendered['01-original-colors']?.size} normal`);
  const crop = rendered['08-region-crop'];
  check('region crop returns the selected area', !!crop && crop.width === 400 && crop.height === 380, `${crop?.width}x${crop?.height}`);
  const sizes = ['09-zoom-1x', '10-zoom-2x', '11-zoom-3x', '12-zoom-4x'].map((n) => rendered[n]);
  check('zoom 2x-4x crop to 600x600', sizes.slice(1).every((r) => r?.width === 600 && r?.height === 600), sizes.map((r) => `${r?.width}x${r?.height}`).join(', '));
  if (facePhotoId) {
    const [a, b] = await Promise.all(['17-face-sample-original', '18-face-blur'].map(async (n) => {
      const file = [...Object.entries(EXT)].map(([, ext]) => join(OUT, `${n}.${ext}`)).find(existsSync);
      return file ? sharp(readFileSync(file)).resize(64, 64).raw().toBuffer() : null;
    }));
    const diff = a && b ? a.reduce((s, v, i) => s + Math.abs(v - b[i]), 0) / a.length : 0;
    check('face blur changes the image', diff > 2, `mean pixel difference ${diff.toFixed(1)}`);
  }

  // 4. Link lifetime and audience.
  const grantUrl = await signedUrl(doctor, visit.id, dPhoto.id, transformationFor({ filter: 'raw' }));
  const anon = await request(grantUrl, null);
  check('signed photo link refused for anonymous requests', anon.status === 401 || anon.status === 403 || anon.status === 404, `HTTP ${anon.status}`);
  const other = await outsider();
  const otherRes = await request(grantUrl, other);
  check('signed photo link refused for a physician of another clinic', !otherRes.ok, `HTTP ${otherRes.status}`);
  const otherSign = await request(`/api/doctor/visits/${visit.id}/photos/urls`, other, 'POST', { items: [{ photoId: dPhoto.id, t: 'f_auto' }] });
  check('another clinic cannot get signed links', otherSign.status === 404, `HTTP ${otherSign.status}`);
  writeFileSync(join(OUT, 'expiry-pending.json'), JSON.stringify({ issuedAt: Date.now(), path: grantUrl }));

  // 5. Notes/diagnosis and progress history across visits.
  const patch = await request(`/api/doctor/visits/${visit.id}/photos`, doctor, 'PATCH', { id: dPhoto.id, notes: 'Synthetic note: erythema 3 cm', diagnosis: 'Synthetic: contact dermatitis' });
  const reread = (await (await request(`/api/doctor/visits/${visit.id}/photos`, doctor)).json()).photos.find((p: { id: string }) => p.id === dPhoto.id);
  check('notes and diagnosis persist', patch.ok && reread?.notes === 'Synthetic note: erythema 3 cm' && reread?.diagnosis === 'Synthetic: contact dermatitis');
  const earlier = await secondVisit(visit);
  const eu = await request(`/api/doctor/visits/${earlier.id}/photos`, doctor, 'POST', form(await skinPhoto(4), 'image/png', 'photo.png', 'patient_upload'));
  const ePhoto = (await eu.json()).photo;
  if (ePhoto) track({ id: ePhoto.id, cloudinary_public_id: ePhoto.publicId });
  const history = (await (await request(`/api/doctor/visits/${visit.id}/photos?history=1`, doctor)).json()).photos as { id: string; visitId: string }[];
  check('progress history spans visits for the same patient', !!ePhoto && history.some((p) => p.id === ePhoto.id && p.visitId === earlier.id) && history.some((p) => p.id === dPhoto.id && p.visitId === visit.id), `${history.length} photos across ${new Set(history.map((p) => p.visitId)).size} visits`);
  const hView = await render(doctor, visit.id, ePhoto.id, '19-history-earlier-visit', { filter: 'raw', lowDataMode: true });
  check('history photo renders', hView.status === 200 && hView.type.startsWith('image/'), `HTTP ${hView.status} ${hView.type}`);

  // 6. Save to chart on both clinics; the attachment link is clinic-gated.
  for (const clinic of ['demo-mock', 'demo-clinicsoft']) {
    const { visit: v, email } = clinic === 'demo-mock' ? demo : await physicianVisit(clinic);
    const jar = clinic === 'demo-mock' ? doctor : await login(email, process.env.DEMO_USER_PASSWORD!, clinic);
    let photoId = dPhoto.id;
    if (clinic !== 'demo-mock') {
      const up = await request(`/api/doctor/visits/${v.id}/photos`, jar, 'POST', form(await skinPhoto(5), 'image/png', 'photo.png', 'patient_upload'));
      const p = (await up.json()).photo;
      track({ id: p.id, cloudinary_public_id: p.publicId });
      photoId = p.id;
      await request(`/api/doctor/visits/${v.id}/photos`, jar, 'PATCH', { id: photoId, notes: 'Synthetic note', diagnosis: 'Synthetic assessment' });
    }
    const saved = await request(`/api/doctor/visits/${v.id}/photos/${photoId}/chart`, jar, 'POST');
    const body = await saved.json();
    const ref = body.photo?.documentRef as string | undefined;
    if (ref) {
      ledger.documentRefs.push({ clinic, ref, table: body.syncStatus === 'local-only' ? 'fhir_docstore' : 'fhir_resources' });
      save();
    }
    const doc = ref ? await fhir<DocumentReference>(ref, clinic) : undefined;
    const tag = doc?.meta?.tag?.some((t) => t.code === 'local-only');
    check(`${clinic}: Save to chart creates a DocumentReference`, saved.ok && !!doc && (clinic === 'demo-clinicsoft' ? !!tag : !tag), `HTTP ${saved.status}, ${tag ? 'local-only' : 'in EHR'}`);
    const link = doc?.content[0].attachment.url ?? '';
    const own = await request(link, jar);
    const ownType = own.headers.get('content-type') ?? '';
    if (own.ok) writeFileSync(join(OUT, `20-chart-link-${clinic}.jpg`), Buffer.from(await own.arrayBuffer()));
    check(`${clinic}: chart link opens for a physician of the clinic`, own.ok && ownType === 'image/jpeg', `HTTP ${own.status} ${ownType}`);
    const anonLink = await request(link, null);
    const otherLink = await request(link, other);
    check(`${clinic}: chart link refused for anonymous and another clinic`, anonLink.status === 401 && otherLink.status === 404, `anonymous=${anonLink.status}, other clinic=${otherLink.status}`);
  }
  writeFileSync(join(OUT, 'playwright-target.json'), JSON.stringify({ visitId: visit.id, email: demo.email }));
}

async function expiry() {
  const pending = JSON.parse(readFileSync(join(OUT, 'expiry-pending.json'), 'utf8')) as { issuedAt: number; path: string };
  const demo = await physicianVisit('demo-mock');
  const doctor = await login(demo.email, process.env.DEMO_USER_PASSWORD!, 'demo-mock');
  const wait = pending.issuedAt + 5 * 60_000 + 5_000 - Date.now();
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  const res = await request(pending.path, doctor);
  check('signed photo link refused after 5 minutes (same physician)', res.status === 403, `HTTP ${res.status} after ${Math.round((Date.now() - pending.issuedAt) / 1000)} s`);
}

async function cleanup() {
  if (ledger.publicIds.length) {
    const r = await cloudinary.api.delete_resources(ledger.publicIds, { type: 'authenticated', resource_type: 'image', invalidate: true });
    const deleted = Object.values(r.deleted as Record<string, string>).filter((s) => s === 'deleted').length;
    console.log(`cloudinary: deleted ${deleted}/${ledger.publicIds.length} test assets`);
  }
  for (const d of ledger.documentRefs) {
    const [type, id] = d.ref.split('/');
    await db.from(d.table).delete().eq('clinic_id', d.clinic).eq('resource_type', type).eq('id', id);
  }
  if (ledger.photoIds.length) await db.from('visit_photos').delete().in('id', ledger.photoIds);
  for (const v of ledger.visits) await db.from('visits').delete().eq('clinic_id', v.clinic).eq('id', v.id);
  for (const u of ledger.users) await db.auth.admin.deleteUser(u);
  for (const c of ledger.clinics) await db.from('ehr_connections').delete().eq('clinic_id', c);
  console.log(`db: removed ${ledger.photoIds.length} photo rows, ${ledger.documentRefs.length} DocumentReferences, ${ledger.visits.length} synthetic visits, ${ledger.users.length} test users, ${ledger.clinics.length} test clinics`);
  writeFileSync(LEDGER, JSON.stringify({ photoIds: [], publicIds: [], documentRefs: [], visits: [], users: [], clinics: [] }, null, 2));
}

try {
  if (process.argv.includes('--cleanup')) await cleanup();
  else if (process.argv.includes('--expiry')) await expiry();
  else await verify();
  writeFileSync(join(OUT, `results-${process.argv.includes('--expiry') ? 'expiry' : 'main'}.json`), JSON.stringify(results, null, 2));
  if (results.some((r) => !r.ok)) process.exitCode = 1;
} catch (e) {
  console.error('ERROR', e instanceof Error ? e.message : 'verification failed');
  save();
  process.exitCode = 1;
}
