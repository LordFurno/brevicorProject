-- Who may use which clinic's FHIR API. Physicians/staff sign in with Supabase
-- Auth; this links each login to its clinic(s), role, and FHIR Practitioner.
-- Patients never have accounts.

create table public.clinic_members (
  user_id          uuid not null references auth.users (id) on delete cascade,
  clinic_id        text not null references public.ehr_connections (clinic_id) on delete cascade,
  -- Links the login to its FHIR Practitioner, e.g. 'Practitioner/abc' ("my appointments").
  practitioner_ref text check (practitioner_ref ~ '^Practitioner/[A-Za-z0-9.-]{1,64}$'),
  role             text not null check (role in ('physician', 'staff', 'admin')),
  created_at       timestamptz not null default now(),
  primary key (user_id, clinic_id),
  constraint clinic_members_physician_needs_practitioner check (role <> 'physician' or practitioner_ref is not null)
);

alter table public.clinic_members enable row level security;

-- Signed-in users may read only their own memberships; nobody but the server writes.
revoke all on table public.clinic_members from anon, authenticated;
grant select on table public.clinic_members to authenticated;
grant select, insert, update, delete on table public.clinic_members to service_role;

create policy "members read own rows" on public.clinic_members
  for select to authenticated
  using ((select auth.uid()) = user_id);
