-- Name prefix/suffix (e.g. 'Mrs.', 'PhD') so a ClinicSoft patient's full name
-- round-trips to FHIR Patient.name like the native record's does.
alter table clinicsoft.patients add column title text, add column suffix text;
