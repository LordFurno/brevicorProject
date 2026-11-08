import type {
  AllergyIntolerance,
  Appointment,
  Condition,
  DocumentReference,
  Encounter,
  FhirResource,
  MedicationRequest,
  Observation,
  Organization,
  Patient,
  Practitioner,
} from 'fhir/r4';
import { formatLocal } from '@/lib/fhir/providers/adapter/helpers';
import {
  isoToDdmmyyyy,
  patientRow,
  providerRow,
  withPractice,
  type AllergySeverity,
  type ClinicSoftAllergy,
  type ClinicSoftAppointment,
  type ClinicSoftDocument,
  type ClinicSoftEncounter,
  type ClinicSoftOrganization,
  type ClinicSoftPrescription,
  type ClinicSoftProblem,
  type ClinicSoftResult,
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
const ALLERGY_CATEGORY: Record<string, ClinicSoftAllergy['category']> = { food: 'FOOD', medication: 'DRUG', environment: 'ENV', biologic: 'BIO' };
const SEVERITY: Record<string, AllergySeverity> = { mild: 'MILD', moderate: 'MOD', severe: 'SEV' };
const coding = (cc: { coding?: { code?: string }[] } | undefined) => cc?.coding?.[0];

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

  const problems = of<Condition>('Condition').map((c) =>
    withPractice<ClinicSoftProblem>(practiceId, {
      problemId: c.id!,
      patientNo: idOf(c.subject.reference)!,
      encounterNo: idOf(c.encounter?.reference),
      onsetDate: c.onsetDateTime!,
      resolvedDate: c.abatementDateTime ?? null,
      status: coding(c.clinicalStatus)?.code === 'resolved' ? 'R' : 'A',
      snomedCode: coding(c.code)!.code!,
      description: c.code!.text!,
    }),
  );

  const allergies = of<AllergyIntolerance>('AllergyIntolerance').map((a) => {
    const reaction = (i: number) => a.reaction?.[i];
    const severity = (i: number) => {
      const s = reaction(i)?.severity;
      return s ? SEVERITY[s] : null;
    };
    return withPractice<ClinicSoftAllergy>(practiceId, {
      allergyId: a.id!,
      patientNo: idOf(a.patient.reference)!,
      encounterNo: idOf(a.encounter?.reference),
      onsetDate: a.recordedDate!,
      endDate: null,
      status: coding(a.clinicalStatus)?.code === 'inactive' ? 'I' : 'A',
      allergenCode: coding(a.code)!.code!,
      allergen: a.code!.text!,
      allergyType: a.type === 'intolerance' ? 'INTOLERANCE' : a.type === 'allergy' ? 'ALLERGY' : null,
      category: a.category?.[0] ? ALLERGY_CATEGORY[a.category[0]] : null,
      reaction1Code: coding(reaction(0)?.manifestation[0])?.code ?? null,
      reaction1: reaction(0)?.manifestation[0].text ?? null,
      severity1: severity(0),
      reaction2Code: coding(reaction(1)?.manifestation[0])?.code ?? null,
      reaction2: reaction(1)?.manifestation[0].text ?? null,
      severity2: severity(1),
    });
  });

  const prescriptions = of<MedicationRequest>('MedicationRequest').map((m) =>
    withPractice<ClinicSoftPrescription>(practiceId, {
      rxId: m.id!,
      patientNo: idOf(m.subject.reference)!,
      encounterNo: idOf(m.encounter?.reference),
      startDateTime: local(m.authoredOn!, 'YYYY-MM-DD HH:mm:ss'),
      stopDateTime: null,
      status: m.status === 'completed' ? 'C' : 'A',
      rxnormCode: coding(m.medicationCodeableConcept)!.code!,
      drugName: m.medicationCodeableConcept!.text!,
      sig: null,
      reasonCode: null,
      reasonDesc: null,
    }),
  );

  const results = of<Observation>('Observation').map((o) => {
    const bp = o.component?.length === 2; // [diastolic, systolic], stored as 'systolic/diastolic'
    return withPractice<ClinicSoftResult>(practiceId, {
      resultId: o.id!,
      patientNo: idOf(o.subject?.reference)!,
      encounterNo: idOf(o.encounter?.reference),
      resultDateTime: local(o.effectiveDateTime!, 'YYYY-MM-DD HH:mm:ss'),
      category: coding(o.category?.[0])?.code === 'laboratory' ? 'LAB' : 'VS',
      testCode: coding(o.code)!.code!,
      testName: o.code.text!,
      value: bp ? `${o.component![1].valueQuantity!.value}/${o.component![0].valueQuantity!.value}` : String(o.valueQuantity!.value),
      units: bp ? o.component![0].valueQuantity!.unit! : o.valueQuantity!.unit!,
      valueType: bp ? 'BP' : 'N',
    });
  });

  // Insert order respects foreign keys.
  return { organizations, providers, patients, schedule, encounters, documents, problems, allergies, prescriptions, results };
}
