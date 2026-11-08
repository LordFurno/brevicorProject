-- FHIR gateway: per-clinic EHR connections + the mock provider's resource store.
-- Only the server (secret key) reads or writes these tables: RLS is on with no
-- policies, and the public Data API roles get no grants.

create extension if not exists pg_trgm with schema extensions;

create table public.ehr_connections (
  clinic_id      text primary key check (clinic_id ~ '^[a-z0-9][a-z0-9-]{0,62}$'),
  name           text not null,
  mode           text not null check (mode in ('fhir', 'mock', 'adapter')),
  base_url       text,
  -- {"type":"none"} | {"type":"bearer","tokenEnv":"ENV_VAR_NAME"}; secrets stay in env, not here.
  auth           jsonb not null default '{"type": "none"}'::jsonb,
  adapter_config jsonb,
  -- Gateway never forwards create/update when true (e.g. public test servers).
  read_only      boolean not null default false,
  created_at     timestamptz not null default now(),
  constraint ehr_connections_fhir_needs_base_url check (mode <> 'fhir' or base_url is not null)
);

create table public.fhir_resources (
  clinic_id     text not null references public.ehr_connections (clinic_id) on delete cascade,
  resource_type text not null,
  id            text not null check (id ~ '^[A-Za-z0-9.-]{1,64}$'),
  resource      jsonb not null,
  version_id    integer not null default 1,
  last_updated  timestamptz not null default now(),
  -- Search columns, derived from `resource` on every write by toRow() in
  -- lib/fhir/providers/mock-index.ts. Never written by hand.
  refs          text[] not null default '{}',  -- 'param:Type/id', e.g. 'patient:Patient/123'
  tokens        text[] not null default '{}',  -- 'identifier:sys|val', 'identifier:val', 'status:booked'
  strings       text not null default '',      -- '|family:smith|given:john|' (lowercased, accents stripped)
  date_lo       timestamptz,                   -- implicit range of the type's date param
  date_hi       timestamptz,
  primary key (clinic_id, resource_type, id)
);

create index fhir_resources_refs_idx on public.fhir_resources using gin (refs);
create index fhir_resources_tokens_idx on public.fhir_resources using gin (tokens);
create index fhir_resources_strings_idx on public.fhir_resources using gin (strings extensions.gin_trgm_ops);
create index fhir_resources_date_lo_idx on public.fhir_resources (clinic_id, resource_type, date_lo);
create index fhir_resources_date_hi_idx on public.fhir_resources (clinic_id, resource_type, date_hi);

alter table public.ehr_connections enable row level security;
alter table public.fhir_resources enable row level security;

revoke all on table public.ehr_connections, public.fhir_resources from anon, authenticated;
grant select, insert, update, delete on table public.ehr_connections, public.fhir_resources to service_role;

insert into public.ehr_connections (clinic_id, name, mode, base_url, read_only) values
  ('demo-mock', 'Demo Clinic (mock FHIR)', 'mock', null, false),
  ('hapi-public', 'HAPI FHIR public test server', 'fhir', 'https://hapi.fhir.org/baseR4', true)
on conflict (clinic_id) do nothing;
