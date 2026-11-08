import { createHash, timingSafeEqual } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { normalizeString } from '@/lib/fhir/search';
import { CLINICSOFT_SCHEMA } from './rows';

/**
 * Fake "ClinicSoft v2" REST API: a stand-in for a proprietary, non-FHIR EMR.
 * Deliberately vendor-shaped: wrapped JSON, page/pageSize paging, DD/MM/YYYY
 * dates, local times, single-letter codes, X-API-Key auth, its own error format.
 *
 *   GET /practices/{practice}/{resource}          list (filters below)
 *   GET /practices/{practice}/{resource}/{id}     one record
 */

export interface ClinicSoftDeps {
  db: SupabaseClient;
  /** The key callers must send as X-API-Key. */
  apiKey: string | undefined;
}

type Filter = (q: Query, value: string) => Query;

interface Endpoint {
  table: string;
  key: string;
  one: string;
  many: string;
  columns: string[];
  order: [string, boolean][];
  filters: Record<string, Filter>;
}

// The subset of the PostgREST builder this file uses.
interface Query {
  eq(column: string, value: string): Query;
  in(column: string, values: string[]): Query;
  gte(column: string, value: string): Query;
  lte(column: string, value: string): Query;
  lt(column: string, value: string): Query;
  or(filters: string): Query;
  order(column: string, opts: { ascending: boolean }): Query;
  range(from: number, to: number): Query;
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const DMY = /^(\d{2})\/(\d{2})\/(\d{4})$/;

const eq = (column: string): Filter => (q, v) => q.eq(column, v);
const list = (column: string): Filter => (q, v) => q.in(column, v.split(',').filter(Boolean));
/** Case- and accent-insensitive "starts with"; comma = any of. */
const prefix = (column: string): Filter => (q, v) => {
  const terms = v.split(',').map(normalizeString).filter(Boolean);
  if (terms.length === 0) throw new BadRequest(`empty search term`);
  return q.or(terms.map((t) => `${column}.like."${t}*"`).join(','));
};
const dateFrom = (column: string): Filter => (q, v) => q.gte(column, isoDate(v));
const dateTo = (column: string): Filter => (q, v) => q.lte(column, isoDate(v));
/** For 'YYYY-MM-DD HH:MM:SS' columns: through the end of the given day. */
const dayTo = (column: string): Filter => (q, v) => q.lt(column, nextDay(isoDate(v)));
const dmyFrom = (column: string): Filter => (q, v) => q.gte(column, dmyToIso(v));
const dmyTo = (column: string): Filter => (q, v) => q.lte(column, dmyToIso(v));

const ENDPOINTS: Record<string, Endpoint> = {
  patients: {
    table: 'patients',
    key: 'patientNo',
    one: 'patient',
    many: 'patients',
    columns: ['patientNo', 'chartNo', 'title', 'lastName', 'firstName', 'middleName', 'suffix', 'dob', 'sex', 'cellPhone', 'homePhone', 'email', 'address1', 'city', 'province', 'postalCode', 'deceasedDate'],
    order: [['lastName', true], ['patientNo', true]],
    filters: {
      lastName: prefix('search_last'),
      firstName: prefix('search_first'),
      dob: (q, v) => q.eq('dob_date', dmyToIso(v)),
      dobFrom: dmyFrom('dob_date'),
      dobTo: dmyTo('dob_date'),
      chartNo: eq('chartNo'),
    },
  },
  providers: {
    table: 'providers',
    key: 'providerNo',
    one: 'provider',
    many: 'providers',
    columns: ['providerNo', 'title', 'firstName', 'lastName', 'sex', 'specialty', 'cpsoNo', 'orgId'],
    order: [['lastName', true], ['providerNo', true]],
    filters: { lastName: prefix('search_last'), cpsoNo: eq('cpsoNo') },
  },
  organizations: {
    table: 'organizations',
    key: 'orgId',
    one: 'organization',
    many: 'organizations',
    columns: ['orgId', 'orgName', 'licenceNo', 'phone', 'address1', 'city', 'province', 'postalCode'],
    order: [['orgName', true], ['orgId', true]],
    filters: {},
  },
  schedule: {
    table: 'schedule',
    key: 'apptId',
    one: 'appointment',
    many: 'appointments',
    columns: ['apptId', 'patientNo', 'providerNo', 'apptDate', 'startTime', 'duration', 'status', 'type', 'reason'],
    order: [['apptDate', true], ['startTime', true], ['apptId', true]],
    filters: {
      providerNo: eq('providerNo'),
      patientNo: eq('patientNo'),
      from: dateFrom('apptDate'),
      to: dateTo('apptDate'),
      status: list('status'),
    },
  },
  encounters: {
    table: 'encounters',
    key: 'encounterNo',
    one: 'encounter',
    many: 'encounters',
    columns: ['encounterNo', 'patientNo', 'providerNo', 'orgId', 'apptId', 'startDateTime', 'endDateTime', 'encClass', 'encStatus', 'encTypeCode', 'encTypeDesc'],
    order: [['startDateTime', false], ['encounterNo', true]],
    filters: {
      patientNo: eq('patientNo'),
      providerNo: eq('providerNo'),
      apptId: eq('apptId'),
      from: (q, v) => q.gte('startDateTime', isoDate(v)),
      to: dayTo('startDateTime'),
    },
  },
  documents: {
    table: 'documents',
    key: 'docId',
    one: 'document',
    many: 'documents',
    columns: ['docId', 'patientNo', 'encounterNo', 'docType', 'mimeType', 'createdAt', 'body'],
    order: [['createdAt', false], ['docId', true]],
    filters: { patientNo: eq('patientNo'), encounterNo: eq('encounterNo') },
  },
};

class BadRequest extends Error {}

export async function handleClinicSoftRequest(req: Request, path: string[], deps: ClinicSoftDeps): Promise<Response> {
  try {
    if (req.method !== 'GET') return vendorError(405, 'METHOD_NOT_ALLOWED', 'This API is read-only');
    const key = req.headers.get('x-api-key');
    if (!deps.apiKey || !key || !keysEqual(key, deps.apiKey)) {
      return vendorError(401, 'UNAUTHORIZED', 'Missing or invalid API key');
    }

    const [practices, practiceId, resource, id, ...rest] = path;
    const endpoint = resource ? ENDPOINTS[resource] : undefined;
    if (practices !== 'practices' || !practiceId || !endpoint || rest.length > 0) {
      return vendorError(404, 'NOT_FOUND', 'Unknown endpoint');
    }
    const db = deps.db.schema(CLINICSOFT_SCHEMA);
    const practice = await db.from('practices').select('practice_id').eq('practice_id', practiceId).maybeSingle();
    if (practice.error) return vendorError(500, 'INTERNAL', 'Internal error');
    if (!practice.data) return vendorError(404, 'PRACTICE_NOT_FOUND', 'Unknown practice');

    if (id !== undefined) {
      const { data, error } = await db
        .from(endpoint.table)
        .select(endpoint.columns.join(','))
        .eq('practice_id', practiceId)
        .eq(endpoint.key, decodeURIComponent(id))
        .maybeSingle();
      if (error) return vendorError(500, 'INTERNAL', 'Internal error');
      if (!data) return vendorError(404, 'NOT_FOUND', `${endpoint.one} not found`);
      return json(200, { [endpoint.one]: data });
    }

    const params = new URL(req.url).searchParams;
    const page = intParam(params, 'page', 1, 1, 100_000);
    const pageSize = intParam(params, 'pageSize', 25, 1, 100);
    const build = (head: boolean) => {
      let q = db
        .from(endpoint.table)
        .select(endpoint.columns.join(','), { count: 'exact', head })
        .eq('practice_id', practiceId) as unknown as Query;
      for (const [name, value] of params) {
        if (name === 'page' || name === 'pageSize' || value === '') continue;
        const filter = endpoint.filters[name];
        if (!filter) throw new BadRequest(`unknown parameter '${name}'`);
        q = filter(q, value);
      }
      return q;
    };

    let q = build(false);
    for (const [column, ascending] of endpoint.order) q = q.order(column, { ascending });
    const result = (await q.range((page - 1) * pageSize, page * pageSize - 1)) as unknown as {
      data: unknown[] | null;
      count: number | null;
      error: { code: string } | null;
    };
    let rows = result.data ?? [];
    let total = result.count;
    if (result.error?.code === 'PGRST103') {
      rows = [];
      total = ((await build(true)) as unknown as { count: number | null }).count;
    } else if (result.error) {
      return vendorError(500, 'INTERNAL', 'Internal error');
    }
    return json(200, { [endpoint.many]: rows, page, pageSize, totalCount: total ?? rows.length });
  } catch (err) {
    if (err instanceof BadRequest) return vendorError(400, 'BAD_REQUEST', err.message);
    return vendorError(500, 'INTERNAL', 'Internal error');
  }
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

function vendorError(status: number, code: string, message: string): Response {
  return json(status, { error: { code, message } });
}

function keysEqual(a: string, b: string): boolean {
  const digest = (s: string) => createHash('sha256').update(s).digest();
  return timingSafeEqual(digest(a), digest(b));
}

function intParam(params: URLSearchParams, name: string, fallback: number, min: number, max: number): number {
  const raw = params.get(name);
  if (raw === null || raw === '') return fallback;
  if (!/^\d+$/.test(raw) || Number(raw) < min || Number(raw) > max) {
    throw new BadRequest(`${name} must be an integer between ${min} and ${max}`);
  }
  return Number(raw);
}

function isoDate(value: string): string {
  if (!DATE.test(value)) throw new BadRequest('dates must be YYYY-MM-DD');
  return value;
}

function dmyToIso(value: string): string {
  const m = DMY.exec(value);
  if (!m) throw new BadRequest('dates of birth must be DD/MM/YYYY');
  return `${m[3]}-${m[2]}-${m[1]}`;
}

function nextDay(date: string): string {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + 1)).toISOString().slice(0, 10);
}
