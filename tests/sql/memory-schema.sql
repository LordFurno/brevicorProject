-- Division by zero fails the command if any installed-schema invariant fails.
with checks as (
 select
  not exists (select 1 from information_schema.columns where table_schema='public' and table_name in ('visits','visit_events','visit_photos') and column_name in ('name','patient_name','dob','date_of_birth','birth_date','phone','email','health_card','health_card_number','patient','resource','invite_token')) as no_demographics_or_raw_tokens,
  (select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname in ('visits','visit_events','visit_photos') and c.relrowsecurity)=3 as rls_enabled,
  not exists (select 1 from (values ('anon'),('authenticated')) r(role_name) cross join (values ('visits'),('visit_events'),('visit_photos')) t(table_name) where has_table_privilege(r.role_name,'public.'||t.table_name,'SELECT,INSERT,UPDATE,DELETE')) as no_public_table_grants,
  not has_function_privilege('anon','public.memory_mutate_visit(text,uuid,integer,jsonb,jsonb)','EXECUTE') and not has_function_privilege('authenticated','public.memory_save_photo(text,uuid,jsonb,text,boolean)','EXECUTE') as no_public_function_grants
)
select *,1/(case when no_demographics_or_raw_tokens and rls_enabled and no_public_table_grants and no_public_function_grants then 1 else 0 end) as assertions_passed from checks;
