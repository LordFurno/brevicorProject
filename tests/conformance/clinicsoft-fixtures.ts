import type { Appointment, DocumentReference, Encounter, FhirResource, Organization, Patient, Practitioner } from 'fhir/r4';
import { formatLocal } from '@/lib/fhir/providers/adapter/helpers';
import {
  isoToDdmmyyyy,
  patientRow,
  providerRow,
  withPractice,
  type ClinicSoftAppointment,
  type ClinicSoftDocument,
  type ClinicSoftEncounter,
  type ClinicSoftOrganization,
} from '@/lib/vendors/clinicsoft/rows';

/**
 * The canonical contract FIXTURES written the way ClinicSoft stores them, so
 * the same contract suite runs against the adapter. (Test-only reverse mapping;
 * production data comes from Synthea CSV.)
 */

const TZ = 'America/Toronto';
const local = (instant: string, fmt: string) => formatLocal(instant, TZ, fmt)!;
const idOf = (reference: string | undefined) => (reference ? reference.split('/')[1] : null);
const sex = (g: string | undefined) => (g === 'male' ? 'M' : g === 'female' ? 'F' : g ? 'U' : null);
const ENC_CLASS: Record<string, string> = { AMB: 'ambulatory', VR: 'virtual', EMER: 'emergency', IMP: 'inpatient', HH: 'home' };
const ENC_STATUS: Record<string, 'OPEN' | 'CLOSED' | 'VOID'> = { 'in-progress': 'OPEN', finished: 'CLOSED', cancelled: 'VOID' };

export function clinicSoftFixtureRows(practiceId: string, fixtures: FhirResource[]) {
  const of = <T extends FhirResource>(type: T['resourceType']) => fixtures.filter((r): r is T => r.resourceType === type);

  const organizations = of<Organization>('Organization').map((o) =>
    withPractice<ClinicSoftOrganization>(practiceId, {
      orgId: o.id!,
      orgName: o.name!,
      licenceNo: o.identifier?.[0]?.value ?? null,
      phone: null,
      address1: null,
      city: null,
      province: null,
      postalCode: null,
    }),
  );

  const providers = of<Practitioner>('Practitioner').map((p) =>
    providerRow(practiceId, {
      providerNo: p.id!,
      title: p.name?.[0]?.prefix?.[0] ?? null,
      firstName: p.name?.[0]?.given?.[0] ?? null,
      lastName: p.name![0].family!,
      sex: sex(p.gender),
      specialty: null,
      cpsoNo: p.identifier?.[0]?.value ?? null,
      orgId: null,
    }),
  );

  const patients = of<Patient>('Patient').map((p) =>
    patientRow(practiceId, {
      patientNo: p.id!,
      chartNo: p.identifier?.[0]?.value ?? null,
      title: null,
      lastName: p.name![0].family!,
      firstName: p.name?.[0]?.given?.[0] ?? null,
      middleName: p.name?.[0]?.given?.[1] ?? null,
      suffix: null,
      dob: p.birthDate ? isoToDdmmyyyy(p.birthDate) : null,
      sex: sex(p.gender),
      cellPhone: null,
      homePhone: null,
      email: null,
      address1: null,
      city: null,
      province: null,
      postalCode: null,
      deceasedDate: null,
    }),
  );

  const schedule = of<Appointment>('Appointment').map((a) => {
    const actor = (type: string) => idOf(a.participant.find((p) => p.actor?.reference?.startsWith(`${type}/`))?.actor?.reference)!;
    return withPractice<ClinicSoftAppointment>(practiceId, {
      apptId: a.id!,
      patientNo: actor('Patient'),
      providerNo: actor('Practitioner'),
      apptDate: local(a.start!, 'YYYY-MM-DD'),
      startTime: local(a.start!, 'HH:mm'),
      duration: (Date.parse(a.end!) - Date.parse(a.start!)) / 60_000,
      status: a.status === 'cancelled' ? 'C' : 'B',
      type: 'VIRT_VIDEO',
      reason: null,
    });
  });

  const encounters = of<Encounter>('Encounter').map((e) =>
    withPractice<ClinicSoftEncounter>(practiceId, {
      encounterNo: e.id!,
      patientNo: idOf(e.subject?.reference)!,
      providerNo: idOf(e.participant?.[0]?.individual?.reference),
      orgId: idOf(e.serviceProvider?.reference),
      apptId: idOf(e.appointment?.[0]?.reference),
      startDateTime: local(e.period!.start!, 'YYYY-MM-DD HH:mm:ss'),
      endDateTime: e.period?.end ? local(e.period.end, 'YYYY-MM-DD HH:mm:ss') : null,
      encClass: ENC_CLASS[e.class.code!],
      encStatus: ENC_STATUS[e.status],
      encTypeCode: null,
      encTypeDesc: null,
    }),
  );

  const documents = of<DocumentReference>('DocumentReference').map((d) =>
    withPractice<ClinicSoftDocument>(practiceId, {
      docId: d.id!,
      patientNo: idOf(d.subject?.reference)!,
      encounterNo: idOf(d.context?.encounter?.[0]?.reference),
      docType: null,
      mimeType: d.content[0].attachment.contentType!,
      createdAt: null,
      body: d.content[0].attachment.data!,
    }),
  );

  // Insert order respects foreign keys.
  return { organizations, providers, patients, schedule, encounters, documents };
}
