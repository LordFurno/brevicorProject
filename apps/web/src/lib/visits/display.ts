import 'server-only';
import type { Patient, Appointment } from 'fhir/r4';
import { gatewayRead, type GatewayContext } from '@/lib/clinical/gateway';
import { patientName } from '@/lib/clinical/map';
import type { Visit } from './types';
import { toDoctorView } from './service';
import { hasEarlyArrival } from '@/scheduling/doctor-view';
export async function visitViews(visits: Visit[], ctx: GatewayContext, now = Date.now()) {
  const patients = new Map<string, Promise<Patient>>();
  return Promise.all(
    visits.map(async (v) => {
      if (!patients.has(v.patientRef))
        patients.set(v.patientRef, gatewayRead<Patient>(v.patientRef, ctx));
      const [p, a] = await Promise.all([
        patients.get(v.patientRef)!.catch(() => null),
        gatewayRead<Appointment>(v.appointmentRef, ctx).catch(() => null),
      ]);
      const view = toDoctorView(v, now, {
        name: p ? patientName(p) : 'Patient unavailable',
        dob: p?.birthDate ?? '',
        reason: a?.reasonCode?.[0]?.text ?? '',
      });
      return hasEarlyArrival(v, now) ? { ...view, arrivedEarly: true, present: true } : view;
    }),
  );
}
