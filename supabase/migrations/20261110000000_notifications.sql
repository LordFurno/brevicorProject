-- Notification service (lib/notify): physician SMS/email contacts, a PHI-free
-- delivery log, and the clinic name patients see in messages.
-- Server-side only: RLS on, nothing granted to anon or authenticated.

-- The name shown to patients ("Demo Clinic: your video visit is on ..."). Null = "Brevicor".
alter table public.ehr_connections
  add column display_name text check (char_length(display_name) between 1 and 40);

update public.ehr_connections set display_name = 'Demo Clinic' where clinic_id in ('demo-mock', 'demo-clinicsoft');

-- How to reach a physician when they are offline, per clinic membership.
create table public.physician_contacts (
  user_id      uuid not null references auth.users (id) on delete cascade,
  clinic_id    text not null,
  phone        text check (phone ~ '^\+[1-9][0-9]{6,14}$'),           -- E.164
  email        text check (email ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'), -- not used yet
  channels     text[] not null default '{sms}' check (channels <@ array['sms', 'email']::text[]),
  -- POST /api/notify/v1/presence. Seen within NOTIFY_ONLINE_WINDOW_SECONDS = online (no SMS for patient_waiting).
  last_seen_at timestamptz,
  updated_at   timestamptz not null default now(),
  primary key (user_id, clinic_id),
  -- Only clinic members have contacts; removing the membership removes the contact.
  foreign key (user_id, clinic_id) references public.clinic_members (user_id, clinic_id) on delete cascade
);

-- One row per recipient per channel per event. Never a message body or a full
-- recipient: recipient_masked is for people, recipient_key (an HMAC of the
-- address) is for dedupe and rate limiting.
create table public.notification_log (
  id                  uuid primary key default gen_random_uuid(),
  clinic_id           text not null references public.ehr_connections (clinic_id) on delete cascade,
  type                text not null check (type in ('patient_waiting', 'visit_invitation', 'visit_cancelled', 'visit_rescheduled')),
  channel             text not null check (channel in ('sms', 'email')),
  provider            text,
  recipient_masked    text,
  recipient_key       text not null,  -- 'none' when there was nobody to send to
  -- 'sending' is held while a message is in flight; it is what stops concurrent requests sending twice.
  status              text not null check (status in ('sending', 'sent', 'failed', 'skipped')),
  provider_message_id text,
  error_code          text,
  dedupe_key          text not null check (dedupe_key ~ '^[A-Za-z0-9._:-]{1,128}$'),
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  constraint notification_log_once unique (clinic_id, dedupe_key, channel, recipient_key)
);

-- Rate limit: messages per recipient in the last hour.
create index notification_log_recipient_recent on public.notification_log (clinic_id, recipient_key, created_at);

alter table public.physician_contacts enable row level security;
alter table public.notification_log enable row level security;

revoke all on table public.physician_contacts from anon, authenticated;
revoke all on table public.notification_log from anon, authenticated;
grant select, insert, update, delete on table public.physician_contacts to service_role;
grant select, insert, update, delete on table public.notification_log to service_role;
