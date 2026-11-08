/**
 * PHI-free structured logs. Only ever pass identifiers and codes: never
 * resource contents, search values, or upstream error text.
 */

export interface CallerLog {
  kind: 'user' | 'service';
  /** Supabase auth user id (staff, never a patient). */
  userId?: string;
}

export interface RequestLog {
  clinic: string | null;
  /** Who called: a signed-in user (by auth user id) or server-side code. */
  caller?: 'user' | 'service';
  user?: string;
  method: string;
  interaction?: string;
  type?: string;
  id?: string;
  /** Search param NAMES only. */
  params?: string[];
  status: number;
  issue?: string;
  ms: number;
}

export function logRequest(entry: RequestLog): void {
  write('info', { evt: 'fhir.request', ...entry });
}

type LogFields = Record<string, string | number | boolean | string[] | null | undefined>;

export function logInfo(evt: string, fields: LogFields): void {
  write('info', { evt, ...fields });
}

export function logWarning(evt: string, fields: LogFields): void {
  write('warn', { evt, ...fields });
}

function write(level: 'info' | 'warn', record: Record<string, unknown>): void {
  if (process.env.FHIR_LOG === 'silent') return;
  const line = JSON.stringify({ level, at: new Date().toISOString(), ...record });
  if (level === 'warn') console.warn(line);
  else console.log(line);
}
