/**
 * PHI-free structured logs. Only ever pass identifiers and codes: never
 * resource contents, search values, or upstream error text.
 */

export interface RequestLog {
  clinic: string | null;
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

export function logWarning(evt: string, fields: Record<string, string | number | string[] | null | undefined>): void {
  write('warn', { evt, ...fields });
}

function write(level: 'info' | 'warn', record: Record<string, unknown>): void {
  if (process.env.FHIR_LOG === 'silent') return;
  const line = JSON.stringify({ level, at: new Date().toISOString(), ...record });
  if (level === 'warn') console.warn(line);
  else console.log(line);
}
