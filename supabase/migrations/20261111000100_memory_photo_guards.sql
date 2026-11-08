-- Recheck authorization under the lock: sync may reassign a participant or
-- rotate an invitation while Cloudinary is receiving an upload.
create or replace function public.memory_save_photo(p_clinic text, p_visit uuid, p_photo jsonb, p_actor text, p_update boolean default false)
returns jsonb language plpgsql set search_path = public as $$
declare v public.visits; photo public.visit_photos;
begin
  select * into v from public.visits where clinic_id=p_clinic and id=p_visit for update;
  if not found then raise exception 'Visit not found'; end if;
  if p_actor not in ('patient','physician') or p_photo->>'_patient_ref' is distinct from v.patient_ref
    or (p_actor='physician' and p_photo->>'_practitioner_ref' is distinct from v.practitioner_ref)
    or (p_actor='patient' and p_photo->>'_invite_token_hash' is distinct from v.invite_token_hash)
  then raise exception 'Visit authorization changed; retry with current credentials'; end if;
  if p_update then
    if p_actor <> 'physician' then raise exception 'Physician required'; end if;
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
revoke all on function public.memory_save_photo(text,uuid,jsonb,text,boolean) from public,anon,authenticated;
grant execute on function public.memory_save_photo(text,uuid,jsonb,text,boolean) to service_role;
