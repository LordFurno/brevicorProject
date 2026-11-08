-- "ClinicSoft": a fake proprietary (non-FHIR) EMR used to demo the adapter
-- provider. Vendor-style column names on purpose. One database hosts several
-- practices, each served at its own base URL. Only the server (secret key)
-- touches this schema. Expose `clinicsoft` in Data API settings so the
-- secret-key client can reach it.
--
-- Columns prefixed `search_`/`dob_date` are the vendor's internal search
-- helpers, filled by the loaders, never returned by the vendor API.

create schema if not exists clinicsoft;
revoke all on schema clinicsoft from public, anon, authenticated;
grant usage on schema clinicsoft to service_role;

create table clinicsoft.practices (
  practice_id text primary key check (practice_id ~ '^[a-z0-9][a-z0-9-]{0,62}$'),
  name        text not null
);

create table clinicsoft.organizations (
  practice_id  text not null references clinicsoft.practices on delete cascade,
  "orgId"      text not null,
  "orgName"    text not null,
  "licenceNo"  text,
  phone        text,
  address1     text,
  city         text,
  province     text,
  "postalCode" text,
  primary key (practice_id, "orgId")
);

create table clinicsoft.providers (
  practice_id   text not null references clinicsoft.practices on delete cascade,
  "providerNo"  text not null,
  title         text,
  "firstName"   text,
  "lastName"    text not null,
  sex           text check (sex in ('M', 'F', 'U')),
  specialty     text,
  "cpsoNo"      text,
  "orgId"       text,
  search_last   text not null default '',
  primary key (practice_id, "providerNo")
);

create table clinicsoft.patients (
  practice_id    text not null references clinicsoft.practices on delete cascade,
  "patientNo"    text not null,
  "chartNo"      text,
  "lastName"     text not null,
  "firstName"    text,
  "middleName"   text,
  dob            text check (dob ~ '^\d{2}/\d{2}/\d{4}$'),        -- DD/MM/YYYY
  sex            text check (sex in ('M', 'F', 'U')),
  "cellPhone"    text,
  "homePhone"    text,
  address1       text,
  city           text,
  province       text,
  "postalCode"   text,
  "deceasedDate" text check ("deceasedDate" ~ '^\d{2}/\d{2}/\d{4}$'),
  search_last    text not null default '',
  search_first   text not null default '',
  dob_date       date,
  primary key (practice_id, "patientNo")
);
create index on clinicsoft.patients (practice_id, search_last);
create index on clinicsoft.patients (practice_id, "chartNo");

create table clinicsoft.schedule (
  practice_id  text not null references clinicsoft.practices on delete cascade,
  "apptId"     text not null,
  "patientNo"  text not null,
  "providerNo" text not null,
  "apptDate"   text not null check ("apptDate" ~ '^\d{4}-\d{2}-\d{2}$'),   -- local date
  "startTime"  text not null check ("startTime" ~ '^\d{2}:\d{2}$'),        -- local HH:MM (America/Toronto)
  duration     integer not null check (duration > 0),                     -- minutes
  status       text not null check (status in ('B', 'C', 'N', 'A')),      -- booked, cancelled, no-show, arrived
  type         text not null check (type in ('VIRT_VIDEO', 'VIRT_PHONE')),
  reason       text,
  primary key (practice_id, "apptId"),
  foreign key (practice_id, "patientNo") references clinicsoft.patients (practice_id, "patientNo") on delete cascade,
  foreign key (practice_id, "providerNo") references clinicsoft.providers (practice_id, "providerNo") on delete cascade
);
create index on clinicsoft.schedule (practice_id, "providerNo", "apptDate");
create index on clinicsoft.schedule (practice_id, "patientNo", "apptDate");

create table clinicsoft.encounters (
  practice_id     text not null references clinicsoft.practices on delete cascade,
  "encounterNo"   text not null,
  "patientNo"     text not null,
  "providerNo"    text,
  "orgId"         text,
  "apptId"        text,
  "startDateTime" text not null,   -- local 'YYYY-MM-DD HH:MM:SS'
  "endDateTime"   text,
  "encClass"      text not null,
  "encStatus"     text not null check ("encStatus" in ('OPEN', 'CLOSED', 'VOID')),
  "encTypeCode"   text,
  "encTypeDesc"   text,
  primary key (practice_id, "encounterNo"),
  foreign key (practice_id, "patientNo") references clinicsoft.patients (practice_id, "patientNo") on delete cascade
);
create index on clinicsoft.encounters (practice_id, "patientNo", "startDateTime");
create index on clinicsoft.encounters (practice_id, "apptId");

create table clinicsoft.documents (
  practice_id   text not null references clinicsoft.practices on delete cascade,
  "docId"       text not null,
  "patientNo"   text not null,
  "encounterNo" text,
  "docType"     text,
  "mimeType"    text not null,
  "createdAt"   text,             -- local 'YYYY-MM-DD HH:MM:SS'
  body          text not null,    -- base64
  primary key (practice_id, "docId"),
  foreign key (practice_id, "patientNo") references clinicsoft.patients (practice_id, "patientNo") on delete cascade
);
create index on clinicsoft.documents (practice_id, "patientNo");
create index on clinicsoft.documents (practice_id, "encounterNo");

do $$
declare t text;
begin
  foreach t in array array['practices', 'organizations', 'providers', 'patients', 'schedule', 'encounters', 'documents'] loop
    execute format('alter table clinicsoft.%I enable row level security', t);
    execute format('revoke all on table clinicsoft.%I from public, anon, authenticated', t);
    execute format('grant select, insert, update, delete on table clinicsoft.%I to service_role', t);
  end loop;
end $$;

insert into clinicsoft.practices (practice_id, name) values ('demo', 'Demo practice')
on conflict do nothing;

-- The clinic the app sees. Credentials and base URL come from env vars.
insert into public.ehr_connections (clinic_id, name, mode, auth, adapter_config) values (
  'demo-clinicsoft',
  'Demo Clinic (ClinicSoft EMR)',
  'adapter',
  '{"type": "apiKey", "keyEnv": "CLINICSOFT_API_KEY"}',
  '{
     "vendor": "clinicsoft",
     "baseUrlEnv": "CLINICSOFT_BASE_URL",
     "config": {
       "chartNoSystem": "http://hospital.smarthealthit.org",
       "providerLicenceSystem": "http://hl7.org/fhir/sid/us-npi",
       "orgLicenceSystem": "https://github.com/synthetichealth/synthea"
     }
   }'
)
on conflict (clinic_id) do nothing;
