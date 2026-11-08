import type { SupabaseClient } from '@supabase/supabase-js';
import type { ChannelId } from './providers/types';
import type { DeliveryStatus, NotificationType } from './types';

/** One row of notification_log. Never a message body or a full recipient. */
export interface LogRow {
  id: string;
  clinicId: string;
  type: NotificationType;
  channel: ChannelId;
  provider: string | null;
  recipientMasked: string | null;
  /** HMAC of the address (config.recipientKey), or 'none' when there was nobody to send to. */
  recipientKey: string;
  status: DeliveryStatus;
  providerMessageId: string | null;
  errorCode: string | null;
  dedupeKey: string;
  createdAt: string;
}

export type NewLogRow = Omit<LogRow, 'id' | 'createdAt'>;

export interface PhysicianContact {
  userId: string;
  phone: string | null;
  email: string | null;
  channels: ChannelId[];
  lastSeenAt: string | null;
}

export interface NotifyStore {
  findByDedupeKey(clinicId: string, dedupeKey: string): Promise<LogRow[]>;
  /** Inserts the row unless (clinic, dedupeKey, channel, recipientKey) already exists. Null = someone else got there first. */
  claim(row: NewLogRow): Promise<LogRow | null>;
  finish(clinicId: string, id: string, update: Pick<LogRow, 'status' | 'providerMessageId' | 'errorCode'>): Promise<void>;
  /** Rows in sending/sent state for this recipient since `since`, excluding `excludeId`. */
  countRecent(clinicId: string, recipientKey: string, since: Date, excludeId: string): Promise<number>;
  /** Contacts of the clinic's physicians linked to this Practitioner. */
  physicianContacts(clinicId: string, practitionerRef: string): Promise<PhysicianContact[]>;
  touchPresence(clinicId: string, userId: string, at: Date): Promise<void>;
  clinicDisplayName(clinicId: string): Promise<string | null>;
}

/** Any database failure. The API turns it into a 503; it never carries row contents. */
export class NotifyStoreError extends Error {
  constructor(operation: string, code?: string) {
    super(`notification store: ${operation} failed${code ? ` (${code})` : ''}`);
    this.name = 'NotifyStoreError';
  }
}

const LOG = 'notification_log';
const CONTACTS = 'physician_contacts';
const LOG_COLUMNS =
  'id, clinic_id, type, channel, provider, recipient_masked, recipient_key, status, provider_message_id, error_code, dedupe_key, created_at';

interface DbLogRow {
  id: string;
  clinic_id: string;
  type: NotificationType;
  channel: ChannelId;
  provider: string | null;
  recipient_masked: string | null;
  recipient_key: string;
  status: DeliveryStatus;
  provider_message_id: string | null;
  error_code: string | null;
  dedupe_key: string;
  created_at: string;
}

export function supabaseNotifyStore(db: SupabaseClient): NotifyStore {
  return {
    async findByDedupeKey(clinicId, dedupeKey) {
      const { data, error } = await db
        .from(LOG)
        .select(LOG_COLUMNS)
        .eq('clinic_id', clinicId)
        .eq('dedupe_key', dedupeKey)
        .order('created_at')
        .order('id')
        .returns<DbLogRow[]>();
      if (error) throw new NotifyStoreError('reading the log', error.code);
      return (data ?? []).map(fromDb);
    },

    async claim(row) {
      const { data, error } = await db
        .from(LOG)
        .upsert(toDb(row), { onConflict: 'clinic_id,dedupe_key,channel,recipient_key', ignoreDuplicates: true })
        .select(LOG_COLUMNS)
        .returns<DbLogRow[]>();
      if (error) throw new NotifyStoreError('claiming a delivery', error.code);
      return data?.[0] ? fromDb(data[0]) : null;
    },

    async finish(clinicId, id, update) {
      const { error } = await db
        .from(LOG)
        .update({
          status: update.status,
          provider_message_id: update.providerMessageId,
          error_code: update.errorCode,
          updated_at: new Date().toISOString(),
        })
        .eq('clinic_id', clinicId)
        .eq('id', id);
      if (error) throw new NotifyStoreError('recording a delivery', error.code);
    },

    async countRecent(clinicId, recipientKey, since, excludeId) {
      const { count, error } = await db
        .from(LOG)
        .select('id', { count: 'exact', head: true })
        .eq('clinic_id', clinicId)
        .eq('recipient_key', recipientKey)
        .in('status', ['sending', 'sent'])
        .gte('created_at', since.toISOString())
        .neq('id', excludeId);
      if (error) throw new NotifyStoreError('counting recent messages', error.code);
      return count ?? 0;
    },

    async physicianContacts(clinicId, practitionerRef) {
      const members = await db
        .from('clinic_members')
        .select('user_id')
        .eq('clinic_id', clinicId)
        .eq('role', 'physician')
        .eq('practitioner_ref', practitionerRef);
      if (members.error) throw new NotifyStoreError('finding physicians', members.error.code);
      const userIds = (members.data ?? []).map((m) => m.user_id as string);
      if (userIds.length === 0) return [];
      const { data, error } = await db
        .from(CONTACTS)
        .select('user_id, phone, email, channels, last_seen_at')
        .eq('clinic_id', clinicId)
        .in('user_id', userIds)
        .order('user_id');
      if (error) throw new NotifyStoreError('reading physician contacts', error.code);
      return (data ?? []).map((row) => ({
        userId: row.user_id as string,
        phone: (row.phone as string | null) ?? null,
        email: (row.email as string | null) ?? null,
        channels: (row.channels as ChannelId[] | null) ?? ['sms'],
        lastSeenAt: (row.last_seen_at as string | null) ?? null,
      }));
    },

    async touchPresence(clinicId, userId, at) {
      // Only these columns are written, so an existing phone/channels survive.
      const { error } = await db
        .from(CONTACTS)
        .upsert({ user_id: userId, clinic_id: clinicId, last_seen_at: at.toISOString() }, { onConflict: 'user_id,clinic_id' });
      if (error) throw new NotifyStoreError('recording presence', error.code);
    },

    async clinicDisplayName(clinicId) {
      const { data, error } = await db.from('ehr_connections').select('display_name').eq('clinic_id', clinicId).maybeSingle();
      if (error) throw new NotifyStoreError('reading the clinic name', error.code);
      return (data?.display_name as string | null) ?? null;
    },
  };
}

function toDb(row: NewLogRow) {
  return {
    clinic_id: row.clinicId,
    type: row.type,
    channel: row.channel,
    provider: row.provider,
    recipient_masked: row.recipientMasked,
    recipient_key: row.recipientKey,
    status: row.status,
    provider_message_id: row.providerMessageId,
    error_code: row.errorCode,
    dedupe_key: row.dedupeKey,
  };
}

function fromDb(row: DbLogRow): LogRow {
  return {
    id: row.id,
    clinicId: row.clinic_id,
    type: row.type,
    channel: row.channel,
    provider: row.provider,
    recipientMasked: row.recipient_masked,
    recipientKey: row.recipient_key,
    status: row.status,
    providerMessageId: row.provider_message_id,
    errorCode: row.error_code,
    dedupeKey: row.dedupe_key,
    createdAt: row.created_at,
  };
}
