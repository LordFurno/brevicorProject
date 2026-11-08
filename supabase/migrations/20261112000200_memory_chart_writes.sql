-- Writing clinical artifacts back to the EHR (through the FHIR gateway):
-- admitting a patient opens the visit's Encounter (visits.encounter_ref, set
-- through memory_mutate_visit), and "Save to chart" files a photo as a
-- DocumentReference (visit_photos.document_ref, set here). The outcome of each
-- write is an audit event. Metadata stays free of PHI: only result codes,
-- the sync status ('ehr' or 'local-only', i.e. held by the Brevicor docstore)
-- and photo ids.

alter table public.visit_events drop constraint visit_events_type_check;
alter table public.visit_events add constraint visit_events_type_check check (type in (
  'synced','invited','rescheduled','cancelled','verify_failed','verified','checked_in','admitted','ended',
  'photo_added','photo_updated','notification_sent','notification_failed','notification_skipped',
  'encounter_linked','encounter_failed','photo_charted','photo_chart_failed'
));

alter table public.visit_events drop constraint visit_events_meta_check;
alter table public.visit_events add constraint visit_events_meta_check check (
  jsonb_typeof(meta) = 'object'
  and meta - array['start','status','notificationType','result','errorCode','photoId','source','syncStatus']::text[] = '{}'::jsonb
);

-- Records the DocumentReference a photo was filed as. Locks the visit and
-- rechecks the physician like memory_save_photo. Idempotent: a photo already
-- filed keeps its first reference and no second event is written.
create function public.memory_link_photo_document(
  p_clinic text, p_visit uuid, p_photo uuid, p_document_ref text, p_practitioner_ref text, p_sync text
) returns jsonb language plpgsql set search_path = public as $$
declare v public.visits; photo public.visit_photos;
begin
  select * into v from public.visits where clinic_id=p_clinic and id=p_visit for update;
  if not found then raise exception 'Visit not found'; end if;
  if p_practitioner_ref is distinct from v.practitioner_ref then
    raise exception 'Visit authorization changed; retry with current credentials';
  end if;
  if p_document_ref !~ '^DocumentReference/[A-Za-z0-9.-]{1,64}$' then raise exception 'Invalid document reference'; end if;
  if p_sync not in ('ehr','local-only') then raise exception 'Invalid sync status'; end if;
  update public.visit_photos set document_ref=p_document_ref, updated_at=now()
    where clinic_id=p_clinic and visit_id=p_visit and patient_ref=v.patient_ref and id=p_photo and document_ref is null
    returning * into photo;
  if not found then
    select * into photo from public.visit_photos
      where clinic_id=p_clinic and visit_id=p_visit and patient_ref=v.patient_ref and id=p_photo;
    return case when found then to_jsonb(photo) else null end;
  end if;
  insert into public.visit_events(clinic_id,visit_id,type,actor,meta) values
    (p_clinic,p_visit,'photo_charted','physician',jsonb_build_object('photoId',photo.id,'syncStatus',p_sync));
  return to_jsonb(photo);
end $$;
revoke all on function public.memory_link_photo_document(text,uuid,uuid,text,text,text) from public, anon, authenticated;
grant execute on function public.memory_link_photo_document(text,uuid,uuid,text,text,text) to service_role;
