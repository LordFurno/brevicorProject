import { readFileSync } from 'node:fs';
import path from 'node:path';
import jsonata from 'jsonata';
import { parse } from 'yaml';
import { IN_SCOPE_TYPES, isInScopeType, type InScopeType } from '../../provider';
import { SUPPORTED_DATE_PREFIXES, type DatePrefix } from '../../search';
import type { CodeTables } from './helpers';

/**
 * A vendor definition (vendors/<name>.yaml), validated and compiled: every
 * JSONata expression and {template} is compiled at load time, so a typo fails
 * loudly once instead of on some later request. See docs/adapter-guide.md.
 */

export class AdapterConfigError extends Error {}

type Expression = ReturnType<typeof jsonata>;

export interface Template {
  source: string;
  /** Literal text and compiled {expressions}, in order. */
  parts: (string | Expression)[];
}

export type VendorAuth =
  | { type: 'apiKey'; header: string }
  | { type: 'oauth2_client_credentials'; tokenUrl: string; scope?: string };

export interface PagingDefinition {
  pageParam: string;
  sizeParam: string;
  maxPageSize: number;
  firstPage: number;
}

export type ParamDefinition =
  | { type: 'id' }
  | { type: 'string'; multiple: boolean }
  | { type: 'token'; multiple: boolean; system?: Template; codes?: string }
  | { type: 'reference'; target: string[]; as: Record<string, string> }
  | { type: 'date'; prefixes: DatePrefix[]; precision: 'day' | 'second' };

export interface SearchDefinition {
  path: Template;
  results: Expression;
  total?: Expression;
  params: Record<string, ParamDefinition>;
  query: Record<string, Template>;
}

export interface ResourceDefinition {
  read?: { path: Template; result: Expression };
  search?: SearchDefinition;
  map: Expression;
}

export interface VendorDefinition {
  vendor: string;
  name: string;
  timezone: string;
  baseUrl?: string;
  auth: VendorAuth;
  paging: PagingDefinition;
  config: Record<string, string>;
  codes: CodeTables;
  hooks?: string;
  resources: Partial<Record<InScopeType, ResourceDefinition>>;
}

const cache = new Map<string, VendorDefinition>();

/** Loads vendors/<vendor>.yaml (cached). */
export function loadVendorDefinition(vendor: string, dir = path.join(process.cwd(), 'vendors')): VendorDefinition {
  if (!/^[a-z0-9-]+$/.test(vendor)) throw new AdapterConfigError(`invalid vendor name '${vendor}'`);
  const file = path.join(dir, `${vendor}.yaml`);
  const hit = cache.get(file);
  if (hit) return hit;
  let text: string;
  try {
    text = readFileSync(file, 'utf8');
  } catch {
    throw new AdapterConfigError(`no vendor definition at vendors/${vendor}.yaml`);
  }
  const def = parseVendorDefinition(text, `vendors/${vendor}.yaml`);
  cache.set(file, def);
  return def;
}

export function parseVendorDefinition(text: string, source = 'vendor definition'): VendorDefinition {
  let raw: unknown;
  try {
    raw = parse(text);
  } catch (err) {
    throw new AdapterConfigError(`${source}: invalid YAML (${(err as Error).message})`);
  }
  const v = new Validator(source);
  const root = v.object(raw, '');
  const codes = v.optionalObject(root.codes, 'codes');
  const def: VendorDefinition = {
    vendor: v.string(root.vendor, 'vendor'),
    name: v.string(root.name, 'name'),
    timezone: v.timezone(root.timezone, 'timezone'),
    baseUrl: root.baseUrl === undefined ? undefined : v.string(root.baseUrl, 'baseUrl'),
    auth: v.auth(root.auth),
    paging: v.paging(root.paging),
    config: v.stringMap(root.config ?? {}, 'config'),
    codes: Object.fromEntries(Object.entries(codes).map(([k, t]) => [k, v.stringMap(t, `codes.${k}`)])),
    hooks: root.hooks === undefined ? undefined : v.string(root.hooks, 'hooks'),
    resources: {},
  };
  const resources = v.object(root.resources, 'resources');
  for (const [type, value] of Object.entries(resources)) {
    if (!isInScopeType(type)) {
      throw new AdapterConfigError(`${source}: resources.${type} is not one of ${IN_SCOPE_TYPES.join(', ')}`);
    }
    def.resources[type] = v.resource(value, `resources.${type}`, def.codes);
  }
  return def;
}

class Validator {
  constructor(private readonly source: string) {}

  fail(where: string, message: string): never {
    throw new AdapterConfigError(`${this.source}: ${where ? `${where} ` : ''}${message}`);
  }

  object(value: unknown, where: string): Record<string, unknown> {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) this.fail(where, 'must be a mapping');
    return value as Record<string, unknown>;
  }

  optionalObject(value: unknown, where: string): Record<string, unknown> {
    return value === undefined ? {} : this.object(value, where);
  }

  string(value: unknown, where: string): string {
    if (typeof value !== 'string' || value === '') this.fail(where, 'must be a non-empty string');
    return value;
  }

  stringMap(value: unknown, where: string): Record<string, string> {
    const obj = this.object(value, where);
    return Object.fromEntries(Object.entries(obj).map(([k, x]) => [k, this.string(String(x ?? ''), `${where}.${k}`)]));
  }

  timezone(value: unknown, where: string): string {
    const tz = this.string(value, where);
    try {
      new Intl.DateTimeFormat('en-US', { timeZone: tz });
    } catch {
      this.fail(where, `'${tz}' is not an IANA timezone`);
    }
    return tz;
  }

  auth(value: unknown): VendorAuth {
    const a = this.object(value, 'auth');
    if (a.type === 'apiKey') return { type: 'apiKey', header: this.string(a.header, 'auth.header') };
    if (a.type === 'oauth2_client_credentials') {
      return {
        type: 'oauth2_client_credentials',
        tokenUrl: this.string(a.tokenUrl, 'auth.tokenUrl'),
        scope: a.scope === undefined ? undefined : this.string(a.scope, 'auth.scope'),
      };
    }
    return this.fail('auth.type', 'must be apiKey or oauth2_client_credentials');
  }

  paging(value: unknown): PagingDefinition {
    const p = this.object(value, 'paging');
    const max = Number(p.maxPageSize);
    if (!Number.isInteger(max) || max < 1) this.fail('paging.maxPageSize', 'must be a positive integer');
    return {
      pageParam: this.string(p.pageParam, 'paging.pageParam'),
      sizeParam: this.string(p.sizeParam, 'paging.sizeParam'),
      maxPageSize: max,
      firstPage: p.firstPage === undefined ? 1 : Number(p.firstPage),
    };
  }

  expression(value: unknown, where: string): Expression {
    const text = this.string(value, where);
    try {
      return jsonata(text);
    } catch (err) {
      return this.fail(where, `has invalid JSONata (${(err as Error).message})`);
    }
  }

  template(value: unknown, where: string): Template {
    const source = this.string(String(value ?? ''), where);
    const parts: (string | Expression)[] = [];
    let i = 0;
    while (i < source.length) {
      const open = source.indexOf('{', i);
      if (open === -1) {
        parts.push(source.slice(i));
        break;
      }
      if (open > i) parts.push(source.slice(i, open));
      const close = matchingBrace(source, open);
      if (close === -1) this.fail(where, 'has an unclosed {');
      parts.push(this.expression(source.slice(open + 1, close), `${where} {…}`));
      i = close + 1;
    }
    return { source, parts };
  }

  resource(value: unknown, where: string, codes: CodeTables): ResourceDefinition {
    const r = this.object(value, where);
    const out: ResourceDefinition = { map: this.expression(r.map, `${where}.map`) };
    if (r.read !== undefined) {
      const read = this.object(r.read, `${where}.read`);
      out.read = {
        path: this.template(read.path, `${where}.read.path`),
        result: this.expression(read.result, `${where}.read.result`),
      };
    }
    if (r.search !== undefined) {
      const s = this.object(r.search, `${where}.search`);
      const params = this.object(s.params, `${where}.search.params`);
      out.search = {
        path: this.template(s.path, `${where}.search.path`),
        results: this.expression(s.results, `${where}.search.results`),
        total: s.total === undefined ? undefined : this.expression(s.total, `${where}.search.total`),
        params: Object.fromEntries(
          Object.entries(params).map(([name, p]) => [name, this.param(p, `${where}.search.params.${name}`, codes)]),
        ),
        query: Object.fromEntries(
          Object.entries(this.optionalObject(s.query, `${where}.search.query`)).map(([k, t]) => [
            k,
            this.template(t, `${where}.search.query.${k}`),
          ]),
        ),
      };
      if (out.search.params._id && out.search.params._id.type !== 'id') this.fail(`${where}.search.params._id`, 'must have type id');
      if (out.search.params._id && !out.read) this.fail(`${where}.search.params._id`, 'needs a read definition');
    }
    if (!out.read && !out.search) this.fail(where, 'needs read and/or search');
    return out;
  }

  param(value: unknown, where: string, codes: CodeTables): ParamDefinition {
    const p = this.object(value, where);
    const multiple = p.multiple === true;
    switch (p.type) {
      case 'id':
        return { type: 'id' };
      case 'string':
        return { type: 'string', multiple };
      case 'token': {
        const table = p.codes === undefined ? undefined : this.string(p.codes, `${where}.codes`);
        if (table !== undefined && !codes[table]) this.fail(`${where}.codes`, `refers to unknown code table '${table}'`);
        return {
          type: 'token',
          multiple,
          codes: table,
          system: p.system === undefined ? undefined : this.template(p.system, `${where}.system`),
        };
      }
      case 'reference': {
        const target = Array.isArray(p.target) ? p.target.map((t) => this.string(t, `${where}.target`)) : [this.string(p.target, `${where}.target`)];
        return { type: 'reference', target, as: p.as === undefined ? {} : this.stringMap(p.as, `${where}.as`) };
      }
      case 'date': {
        const prefixes: DatePrefix[] = Array.isArray(p.prefixes) ? (p.prefixes as DatePrefix[]) : ['eq'];
        for (const prefix of prefixes) {
          if (!SUPPORTED_DATE_PREFIXES.includes(prefix)) this.fail(`${where}.prefixes`, `has unsupported prefix '${prefix}'`);
        }
        const precision = p.precision === undefined ? 'second' : p.precision;
        if (precision !== 'day' && precision !== 'second') this.fail(`${where}.precision`, 'must be day or second');
        return { type: 'date', prefixes, precision };
      }
      default:
        return this.fail(`${where}.type`, 'must be id, string, token, reference or date');
    }
  }
}

/** Index of the } matching the { at `open`, skipping quoted strings; -1 if none. */
function matchingBrace(text: string, open: number): number {
  let depth = 0;
  let quote: string | null = null;
  for (let i = open; i < text.length; i++) {
    const c = text[i];
    if (quote) {
      if (c === '\\') i++;
      else if (c === quote) quote = null;
    } else if (c === '"' || c === "'") {
      quote = c;
    } else if (c === '{') {
      depth++;
    } else if (c === '}' && --depth === 0) {
      return i;
    }
  }
  return -1;
}

/**
 * Renders a template against `input`. A template that is exactly one {expr}
 * yields the raw value; otherwise the parts are joined as a string (values
 * URL-encoded when `encode`). Undefined/null/'' anywhere -> undefined.
 */
export async function renderTemplate(
  t: Template,
  input: unknown,
  bindings: Record<string, unknown>,
  encode = false,
): Promise<unknown> {
  const blank = (v: unknown) => v === undefined || v === null || v === '';
  if (t.parts.length === 1 && typeof t.parts[0] !== 'string') {
    const value = await t.parts[0].evaluate(input, bindings);
    return blank(value) ? undefined : value;
  }
  let out = '';
  for (const part of t.parts) {
    if (typeof part === 'string') {
      out += part;
      continue;
    }
    const value = await part.evaluate(input, bindings);
    if (blank(value)) return undefined;
    out += encode ? encodeURIComponent(String(value)) : String(value);
  }
  return out;
}
