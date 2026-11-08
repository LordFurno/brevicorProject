import type { ChartSummary } from './types';

// FHIR R4 → ChartSummary. Used by BOTH the mock and the real FHIR gateway
// source, so the UI behaves identically whichever one is configured.

/** The FHIR resource types the chart reads. */
export type ClinicalResource =
  | fhir4.Patient
  | fhir4.Condition
  | fhir4.AllergyIntolerance
  | fhir4.MedicationStatement
  | fhir4.Observation
  | fhir4.Encounter
  | fhir4.DocumentReference;

export interface FhirChartBundle {
  patient: fhir4.Patient;
  conditions: fhir4.Condition[];
  allergies: fhir4.AllergyIntolerance[];
  medications: fhir4.MedicationStatement[];
  observations: fhir4.Observation[];
  encounters: fhir4.Encounter[];
  documents: fhir4.DocumentReference[];
}

const text = (cc?: fhir4.CodeableConcept) => cc?.text ?? cc?.coding?.[0]?.display ?? cc?.coding?.[0]?.code;
const firstCode = (cc?: fhir4.CodeableConcept) => cc?.coding?.[0]?.code;

export function patientName(p: fhir4.Patient) {
  const n = p.name?.find((x) => x.use === 'official') ?? p.name?.[0];
  if (!n) return 'Unknown patient';
  return n.text ?? [...(n.given ?? []), n.family].filter(Boolean).join(' ');
}

const obsDate = (o: fhir4.Observation) => o.effectiveDateTime ?? o.effectivePeriod?.start ?? o.issued;
const hasCategory = (o: fhir4.Observation, code: string) =>
  !!o.category?.some((c) => c.coding?.some((x) => x.code === code));

function obsValue(o: fhir4.Observation): { value: string; unit?: string } {
  if (o.valueQuantity?.value !== undefined) return { value: String(o.valueQuantity.value), unit: o.valueQuantity.unit };
  if (o.valueString) return { value: o.valueString };
  if (o.valueCodeableConcept) return { value: text(o.valueCodeableConcept) ?? '—' };
  return { value: '—' };
}

/** Most recent observation per test name. */
function latestPerCode(list: fhir4.Observation[]) {
  const seen = new Map<string, fhir4.Observation>();
  for (const o of [...list].sort((a, b) => (obsDate(b) ?? '').localeCompare(obsDate(a) ?? ''))) {
    const key = text(o.code) ?? 'Observation';
    if (!seen.has(key)) seen.set(key, o);
  }
  return [...seen.values()];
}

const SEX: Record<string, string> = { male: 'Male', female: 'Female', other: 'Other', unknown: 'Unknown' };

export function mapChart(b: FhirChartBundle, opts: { matched: boolean; source: ChartSummary['source'] }): ChartSummary {
  const p = b.patient;
  const healthCard =
    p.identifier?.find((i) => i.system?.toLowerCase().includes('ohip') || i.system?.toLowerCase().includes('health'))
      ?.value ?? p.identifier?.[0]?.value;
  const addr = p.address?.[0];

  const docsByEncounter = new Map<string, string>();
  for (const d of b.documents) {
    const ref = d.context?.encounter?.[0]?.reference;
    if (ref && d.description) docsByEncounter.set(ref.replace(/^Encounter\//, ''), d.description);
  }

  return {
    matched: opts.matched,
    source: opts.source,
    patient: {
      id: p.id,
      name: patientName(p),
      birthDate: p.birthDate,
      sex: p.gender ? SEX[p.gender] : undefined,
      healthCard,
      phone: p.telecom?.find((t) => t.system === 'phone')?.value,
      email: p.telecom?.find((t) => t.system === 'email')?.value,
      address: addr ? addr.text ?? [addr.city, addr.state].filter(Boolean).join(', ') : undefined,
      language: text(p.communication?.find((c) => c.preferred)?.language ?? p.communication?.[0]?.language),
    },
    allergies: b.allergies.map((a) => ({
      substance: text(a.code) ?? 'Unknown substance',
      reaction: a.reaction?.[0]?.manifestation?.map((m) => text(m)).filter(Boolean).join(', ') || undefined,
      severity: a.reaction?.[0]?.severity,
      critical: a.criticality === 'high',
    })),
    conditions: b.conditions
      .filter((c) => !['resolved', 'inactive', 'remission'].includes(firstCode(c.clinicalStatus) ?? 'active'))
      .map((c) => ({ name: text(c.code) ?? 'Condition', onset: c.onsetDateTime, status: firstCode(c.clinicalStatus) })),
    medications: b.medications
      .filter((m) => m.status === 'active' || m.status === 'intended')
      .map((m) => ({
        name: text(m.medicationCodeableConcept) ?? m.medicationReference?.display ?? 'Medication',
        dosage: m.dosage?.[0]?.text,
        status: m.status,
      })),
    vitals: latestPerCode(b.observations.filter((o) => hasCategory(o, 'vital-signs'))).map((o) => ({
      label: text(o.code) ?? 'Vital',
      ...obsValue(o),
      date: obsDate(o),
    })),
    labs: latestPerCode(b.observations.filter((o) => hasCategory(o, 'laboratory'))).map((o) => ({
      label: text(o.code) ?? 'Lab',
      ...obsValue(o),
      flag: firstCode(o.interpretation?.[0]),
      date: obsDate(o),
    })),
    visits: [...b.encounters]
      .sort((x, y) => (y.period?.start ?? '').localeCompare(x.period?.start ?? ''))
      .map((e) => ({
        id: e.id,
        date: e.period?.start,
        type: e.class?.display ?? e.class?.code,
        practitioner: e.participant?.[0]?.individual?.display,
        reason: text(e.reasonCode?.[0]),
        summary: e.id ? docsByEncounter.get(e.id) : undefined,
      })),
  };
}
