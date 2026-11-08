import { FhirError } from '../../outcome';
import type { InScopeType } from '../../provider';
import { dateRange, parseReference, parseToken, splitDatePrefix, splitOrValues, splitParamName } from '../../search';
import { renderTemplate, type ParamDefinition } from './definition';
import { formatInstant, formatLocal } from './helpers';

/**
 * FHIR search params -> one structured object that request templates read:
 *
 *   reference  practitioner=Practitioner/9   -> { practitioner: { type: 'Practitioner', id: '9' } }
 *   date       date=ge2026-11-07&date=lt…    -> { date: { start: '…Z', end: '…Z' } }   (end exclusive)
 *   string     family=tre,ngu                -> { family: { value: 'tre', values: ['tre', 'ngu'] } }
 *   token      status=cancelled              -> { status: { value: 'C', values: ['C'] } }  (via code table)
 *   id         _id=123                       -> { _id: { value: '123' } }
 *
 * Anything the vendor can't express is a 400, never silently dropped. A search
 * that can only ever match nothing (an identifier system the EHR doesn't use,
 * a status it never has) returns `empty` so the caller skips the vendor call.
 */

export interface NormalizedSearch {
  values: Record<string, unknown>;
  empty: boolean;
}

interface Context {
  type: InScopeType;
  timeZone: string;
  codes: Record<string, Record<string, string>>;
  bindings: Record<string, unknown>;
}

export async function normalizeSearch(
  params: [string, string][],
  defs: Record<string, ParamDefinition>,
  ctx: Context,
): Promise<NormalizedSearch> {
  const values: Record<string, unknown> = {};
  const dates: Record<string, { start?: number; end?: number }> = {};
  let empty = false;

  const cannot = (message: string) => new FhirError(400, 'not-supported', `This clinic's EHR can't ${message}`);
  const set = (slot: string, value: unknown, label: string) => {
    if (slot in values && JSON.stringify(values[slot]) !== JSON.stringify(value)) {
      throw cannot(`combine these ${ctx.type} search conditions (${label})`);
    }
    values[slot] = value;
  };

  if (params.some(([n]) => n === '_id') && params.some(([n]) => n !== '_id')) {
    throw cannot(`combine _id with other ${ctx.type} search parameters`);
  }

  for (const [rawName, rawValue] of params) {
    const { base, modifier } = splitParamName(rawName);
    const def = defs[base];
    if (!def) throw new FhirError(400, 'not-supported', `Search parameter '${base}' is not supported for ${ctx.type}`);
    if (modifier !== undefined && def.type !== 'reference') {
      throw new FhirError(400, 'not-supported', `Modifier ':${modifier}' is not supported on '${base}'`);
    }
    const list = splitOrValues(rawValue);
    const multiple = (def.type === 'string' || def.type === 'token') && def.multiple;
    if (list.length > 1 && !multiple) throw cannot(`search ${ctx.type} by several '${base}' values at once`);

    switch (def.type) {
      case 'id':
        set('_id', { value: list[0] }, base);
        break;

      case 'string':
        set(base, { value: list[0], values: list }, base);
        break;

      case 'token': {
        const system = def.system ? await renderTemplate(def.system, {}, ctx.bindings) : undefined;
        const codes: string[] = [];
        for (const raw of list) {
          const token = parseToken(raw);
          if (token.system !== undefined && token.system !== system) continue; // a system this EHR doesn't use
          if (def.codes) {
            const table = ctx.codes[def.codes];
            codes.push(...Object.keys(table).filter((vendorCode) => table[vendorCode] === token.code));
          } else {
            codes.push(token.code);
          }
        }
        if (codes.length === 0) empty = true;
        else set(base, { value: codes[0], values: codes, system }, base);
        break;
      }

      case 'reference': {
        const ref = parseReference(list[0], modifier);
        const type = ref.type ?? (def.target.length === 1 ? def.target[0] : undefined);
        if (!type) throw cannot(`search '${base}' without a type: use e.g. ${base}=${def.target[0]}/123`);
        if (!def.target.includes(type)) {
          empty = true;
          break;
        }
        set(def.as[type] ?? base, { type, id: ref.id }, base);
        break;
      }

      case 'date': {
        const { prefix, value } = splitDatePrefix(list[0]);
        if (!def.prefixes.includes(prefix)) throw cannot(`search ${ctx.type} dates with '${prefix}'`);
        const range = dateRange(value, ctx.timeZone);
        if (!range) throw new FhirError(400, 'value', 'Invalid date search value');
        const [lo, hi] = [range.lo.getTime(), range.hi.getTime()];
        const interval =
          prefix === 'eq' ? { start: lo, end: hi }
          : prefix === 'ge' ? { start: lo }
          : prefix === 'gt' ? { start: hi }
          : prefix === 'le' ? { end: hi }
          : { end: lo }; // lt
        const slot = (dates[base] ??= {});
        if (interval.start !== undefined) slot.start = Math.max(slot.start ?? -Infinity, interval.start);
        if (interval.end !== undefined) slot.end = Math.min(slot.end ?? Infinity, interval.end);
        if (def.precision === 'day') {
          for (const t of [interval.start, interval.end]) {
            if (t !== undefined && formatLocal(new Date(t).toISOString(), ctx.timeZone, 'HH:mm:ss') !== '00:00:00') {
              throw cannot(`filter ${ctx.type} '${base}' more precisely than whole days`);
            }
          }
        }
        break;
      }
    }
  }

  for (const [name, { start, end }] of Object.entries(dates)) {
    if (start !== undefined && end !== undefined && start >= end) empty = true;
    values[name] = {
      start: start === undefined ? undefined : formatInstant(new Date(start)),
      end: end === undefined ? undefined : formatInstant(new Date(end)),
    };
  }
  return { values, empty };
}
