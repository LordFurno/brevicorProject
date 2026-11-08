import { describe, it, expect } from 'vitest';
import { visitInvitation, visitRescheduled } from '@/lib/notify/templates';
describe('clinic-scoped memory invitation links', () => {
  it('fits actual demo invitation paths in GSM-7 single-segment templates', () => {
    const link = `https://app.brevicor.ca/visit/demo-clinicsoft.${'x'.repeat(27)}`;
    for (const modality of ['video', 'telephone'] as const) {
      const details = { clinicName: 'Demo Clinic', start: '2026-11-18T17:59:00Z', modality, link };
      for (const message of [visitInvitation(details), visitRescheduled(details)]) {
        expect(message.sms.length).toBeLessThanOrEqual(160);
        expect(message.sms).toMatch(/^[\x20-\x7e]*$/);
      }
    }
  });
});
