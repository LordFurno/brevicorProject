-- Brevicor docstore: writes a clinic's EHR can't take (e.g. Encounter or
-- DocumentReference at a read-only adapter clinic) are stored here instead of
-- being dropped, tagged meta.tag https://brevicor.ca/fhir/sync-status|local-only
-- (Brevicor holds the authoritative copy), and merged into that clinic's reads
-- and searches by lib/fhir/providers/fallback.ts.
--
-- Same columns and search index as fhir_resources (rows built only by toRow()
-- in lib/fhir/providers/mock-index.ts), but a separate table: EHR data and
-- Brevicor-held data stay distinguishable, and `fhir:reset` never touches it.
-- Server-only, like fhir_resources.

create table public.fhir_docstore (like public.fhir_resources including defaults including constraints);
alter table public.fhir_docstore add primary key (clinic_id, resource_type, id);
alter table public.fhir_docstore
  add constraint fhir_docstore_clinic_fk foreign key (clinic_id) references public.ehr_connections (clinic_id) on delete cascade;

create index fhir_docstore_refs_idx on public.fhir_docstore using gin (refs);
create index fhir_docstore_tokens_idx on public.fhir_docstore using gin (tokens);
create index fhir_docstore_strings_idx on public.fhir_docstore using gin (strings extensions.gin_trgm_ops);
create index fhir_docstore_date_lo_idx on public.fhir_docstore (clinic_id, resource_type, date_lo);
create index fhir_docstore_date_hi_idx on public.fhir_docstore (clinic_id, resource_type, date_hi);

alter table public.fhir_docstore enable row level security;
revoke all on table public.fhir_docstore from anon, authenticated;
grant select, insert, update, delete on table public.fhir_docstore to service_role;
