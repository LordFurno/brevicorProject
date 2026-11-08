-- Brevicor activity only. Clinical resources remain in the EHR.
create table public.visits (
  id uuid primary key,
  clinic_id text not null references public.ehr_connections(clinic_id) on delete cascade,
  appointment_ref text not null check (appointment_ref ~ '^Appointment/[A-Za-z0-9.-]{1,64}$'),
  patient_ref text not null check (patient_ref ~ '^Patient/[A-Za-z0-9.-]{1,64}$'),
  practitioner_ref text not null check (practitioner_ref ~ '^Practitioner/[A-Za-z0-9.-]{1,64}$'),
  encounter_ref text check (encounter_ref ~ '^Encounter/[A-Za-z0-9.-]{1,64}$'),
  modality text not null check (modality in ('video','phone')),
  start timestamptz not null,
  "end" timestamptz not null check ("end" > start),
  status text not null check (status in ('scheduled','waiting','in_progress','completed','cancelled')),
  appointment_status text not null,
  invite_token_hash text not null check (invite_token_hash ~ '^[a-f0-9]{64}$'),
  room_name text not null,
  waiting_since timestamptz, last_seen_at timestamptz, admitted_at timestamptz, ended_at timestamptz,
  verify_attempts integer not null default 0 check (verify_attempts between 0 and 5),
  revision integer not null default 0,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique (clinic_id, appointment_ref), unique (clinic_id, id), unique (clinic_id, invite_token_hash)
);
create index visits_schedule on public.visits(clinic_id, practitioner_ref, start);
create table public.visit_events (
  id uuid primary key default gen_random_uuid(),
  clinic_id text not null references public.ehr_connections(clinic_id) on delete cascade,
  visit_id uuid not null,
  type text not null check (type in ('synced','invited','rescheduled','cancelled','verify_failed','verified','checked_in','admitted','ended','photo_added','photo_updated','notification_sent','notification_failed','notification_skipped')),
  actor text not null check (actor in ('patient','physician','system')),
  at timestamptz not null default now(),
  meta jsonb not null default '{}'::jsonb check (jsonb_typeof(meta) = 'object' and meta - array['start','status','notificationType','result','errorCode','photoId','source']::text[] = '{}'::jsonb),
  foreign key (clinic_id,visit_id) references public.visits(clinic_id,id) on delete cascade
);
create index visit_events_timeline on public.visit_events(clinic_id,visit_id,at);
create table public.visit_photos (
  id uuid primary key,
  clinic_id text not null references public.ehr_connections(clinic_id) on delete cascade,
  visit_id uuid not null,
  patient_ref text not null check (patient_ref ~ '^Patient/[A-Za-z0-9.-]{1,64}$'),
  cloudinary_public_id text not null,
  version bigint, width integer check (width > 0), height integer check (height > 0),
  source text not null check (source in ('patient_upload','in_call_capture')),
  notes text not null default '' check (char_length(notes) <= 10000),
  diagnosis text not null default '' check (char_length(diagnosis) <= 1000),
  document_ref text check (document_ref ~ '^DocumentReference/[A-Za-z0-9.-]{1,64}$'),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  foreign key (clinic_id,visit_id) references public.visits(clinic_id,id) on delete cascade
);
create index visit_photos_patient on public.visit_photos(clinic_id,patient_ref,created_at desc);
create index visit_photos_visit on public.visit_photos(clinic_id,visit_id);
alter table public.visits enable row level security;
alter table public.visit_events enable row level security;
alter table public.visit_photos enable row level security;
revoke all on public.visits, public.visit_events, public.visit_photos from public, anon, authenticated;
grant select, insert, update, delete on public.visits, public.visit_events, public.visit_photos to service_role;

-- Compare-and-swap: losing callers read again and recompute the transition.
create function public.memory_mutate_visit(p_clinic text, p_id uuid, p_revision integer, p_row jsonb, p_events jsonb)
returns boolean language plpgsql set search_path = public as $$
declare n public.visits; affected integer;
begin
  n := jsonb_populate_record(null::public.visits, p_row);
  if n.clinic_id is distinct from p_clinic or n.id is distinct from p_id then raise exception 'Invalid visit scope'; end if;
  if p_revision = -1 then
    n.revision := 0; n.created_at := now(); n.updated_at := now();
    insert into public.visits select n.* on conflict do nothing;
  else
    update public.visits set appointment_ref=n.appointment_ref, patient_ref=n.patient_ref,
      practitioner_ref=n.practitioner_ref, encounter_ref=n.encounter_ref, modality=n.modality,
      start=n.start, "end"=n."end", status=n.status, appointment_status=n.appointment_status,
      invite_token_hash=n.invite_token_hash, room_name=n.room_name, waiting_since=n.waiting_since,
      last_seen_at=n.last_seen_at, admitted_at=n.admitted_at, ended_at=n.ended_at,
      verify_attempts=n.verify_attempts, revision=revision+1, updated_at=now()
      where clinic_id=p_clinic and id=p_id and revision=p_revision;
  end if;
  get diagnostics affected = row_count;
  if affected = 0 then return false; end if;
  insert into public.visit_events(clinic_id,visit_id,type,actor,meta)
    select p_clinic,p_id,e->>'type',e->>'actor',coalesce(e->'meta','{}'::jsonb) from jsonb_array_elements(p_events) e;
  return true;
end $$;

-- Lock the visit to enforce the upload limit across instances.
create function public.memory_save_photo(p_clinic text, p_visit uuid, p_photo jsonb, p_actor text, p_update boolean default false)
returns jsonb language plpgsql set search_path = public as $$
declare v public.visits; photo public.visit_photos;
begin
  select * into v from public.visits where clinic_id=p_clinic and id=p_visit for update;
  if not found then raise exception 'Visit not found'; end if;
  if p_update then
    update public.visit_photos set notes=p_photo->>'notes', diagnosis=p_photo->>'diagnosis',updated_at=now()
      where clinic_id=p_clinic and visit_id=p_visit and patient_ref=v.patient_ref and id=(p_photo->>'id')::uuid returning * into photo;
    if not found then return null; end if;
  else
    if v.status in ('completed','cancelled') then raise exception 'Visit has ended'; end if;
    if (select count(*) from public.visit_photos where clinic_id=p_clinic and visit_id=p_visit) >= 30 then raise exception 'Photo limit reached'; end if;
    photo := jsonb_populate_record(null::public.visit_photos, p_photo);
    photo.clinic_id:=p_clinic; photo.visit_id:=p_visit; photo.patient_ref:=v.patient_ref;
    photo.created_at:=now(); photo.updated_at:=now();
    insert into public.visit_photos select photo.*;
  end if;
  insert into public.visit_events(clinic_id,visit_id,type,actor,meta) values
    (p_clinic,p_visit,case when p_update then 'photo_updated' else 'photo_added' end,p_actor,jsonb_build_object('photoId',photo.id,'source',photo.source));
  return to_jsonb(photo);
end $$;
revoke all on function public.memory_mutate_visit(text,uuid,integer,jsonb,jsonb), public.memory_save_photo(text,uuid,jsonb,text,boolean) from public, anon, authenticated;
grant execute on function public.memory_mutate_visit(text,uuid,integer,jsonb,jsonb), public.memory_save_photo(text,uuid,jsonb,text,boolean) to service_role;
