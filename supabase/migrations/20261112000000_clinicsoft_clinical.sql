-- ClinicSoft clinical history: problem list, allergies, prescriptions and
-- results, in ClinicSoft's own (non-FHIR) shapes. Plus the Ontario health card
-- number on the patient. Same access rules as the rest of the schema: only the
-- server (secret key) touches it.

alter table clinicsoft.patients
  add column "healthCardNo"      text check ("healthCardNo" ~ '^\d{10}$'),
  add column "healthCardVersion" text check ("healthCardVersion" ~ '^[A-Z]{2}$');

create table clinicsoft.problems (
  practice_id    text not null references clinicsoft.practices on delete cascade,
  "problemId"    text not null,
  "patientNo"    text not null,
  "encounterNo"  text,
  "onsetDate"    text not null check ("onsetDate" ~ '^\d{4}-\d{2}-\d{2}$'),
  "resolvedDate" text check ("resolvedDate" ~ '^\d{4}-\d{2}-\d{2}$'),
  status         text not null check (status in ('A', 'R')),            -- active, resolved
  "snomedCode"   text not null,
  description    text not null,
  primary key (practice_id, "problemId"),
  foreign key (practice_id, "patientNo") references clinicsoft.patients (practice_id, "patientNo") on delete cascade
);
create index on clinicsoft.problems (practice_id, "patientNo");

create table clinicsoft.allergies (
  practice_id     text not null references clinicsoft.practices on delete cascade,
  "allergyId"     text not null,
  "patientNo"     text not null,
  "encounterNo"   text,
  "onsetDate"     text not null check ("onsetDate" ~ '^\d{4}-\d{2}-\d{2}$'),
  "endDate"       text check ("endDate" ~ '^\d{4}-\d{2}-\d{2}$'),
  status          text not null check (status in ('A', 'I')),           -- active, inactive
  "allergenCode"  text not null,                                         -- SNOMED CT
  allergen        text not null,
  "allergyType"   text check ("allergyType" in ('ALLERGY', 'INTOLERANCE')),
  category        text check (category in ('FOOD', 'DRUG', 'ENV', 'BIO')),
  "reaction1Code" text, reaction1 text, severity1 text check (severity1 in ('MILD', 'MOD', 'SEV')),
  "reaction2Code" text, reaction2 text, severity2 text check (severity2 in ('MILD', 'MOD', 'SEV')),
  primary key (practice_id, "allergyId"),
  foreign key (practice_id, "patientNo") references clinicsoft.patients (practice_id, "patientNo") on delete cascade
);
create index on clinicsoft.allergies (practice_id, "patientNo");

create table clinicsoft.prescriptions (
  practice_id     text not null references clinicsoft.practices on delete cascade,
  "rxId"          text not null,
  "patientNo"     text not null,
  "encounterNo"   text,
  "startDateTime" text not null,     -- local 'YYYY-MM-DD HH:MM:SS'
  "stopDateTime"  text,
  status          text not null check (status in ('A', 'C')),           -- active, completed
  "rxnormCode"    text not null,
  "drugName"      text not null,
  sig             text,
  "reasonCode"    text,              -- SNOMED CT
  "reasonDesc"    text,
  primary key (practice_id, "rxId"),
  foreign key (practice_id, "patientNo") references clinicsoft.patients (practice_id, "patientNo") on delete cascade
);
create index on clinicsoft.prescriptions (practice_id, "patientNo");

create table clinicsoft.results (
  practice_id      text not null references clinicsoft.practices on delete cascade,
  "resultId"       text not null,
  "patientNo"      text not null,
  "encounterNo"    text,
  "resultDateTime" text not null,    -- local 'YYYY-MM-DD HH:MM:SS'
  category         text not null check (category in ('VS', 'LAB')),     -- vital sign, laboratory
  "testCode"       text not null,    -- LOINC
  "testName"       text not null,
  value            text,             -- '129.0', 'Negative', or '117/74' for blood pressure
  units            text,
  "valueType"      text not null check ("valueType" in ('N', 'T', 'BP')),
  primary key (practice_id, "resultId"),
  foreign key (practice_id, "patientNo") references clinicsoft.patients (practice_id, "patientNo") on delete cascade
);
create index on clinicsoft.results (practice_id, "patientNo", "resultDateTime");

do $$
declare t text;
begin
  foreach t in array array['problems', 'allergies', 'prescriptions', 'results'] loop
    execute format('alter table clinicsoft.%I enable row level security', t);
    execute format('revoke all on table clinicsoft.%I from public, anon, authenticated', t);
    execute format('grant select, insert, update, delete on table clinicsoft.%I to service_role', t);
  end loop;
end $$;
