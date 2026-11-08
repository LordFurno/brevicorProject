import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';
const sql = readFileSync(
  new URL('../../supabase/migrations/20261111000000_memory.sql', import.meta.url),
  'utf8',
);
describe('Brevicor memory schema', () => {
  for (const table of ['visits', 'visit_events', 'visit_photos'])
    it(`${table} has no patient demographic/resource/raw-token column and is server-only`, () => {
      const definition = new RegExp(`create table public\\.${table} \\(([\\s\\S]*?)\\n\\);`).exec(
        sql,
      )![1];
      expect(definition).not.toMatch(
        /^\s*(name|patient_name|dob|date_of_birth|birth_date|phone|email|health_card|patient|resource|invite_token)\s/im,
      );
      expect(sql).toContain(`alter table public.${table} enable row level security`);
      expect(sql).toContain('from public, anon, authenticated');
    });
});
