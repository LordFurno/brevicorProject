import type * as fhir4 from 'fhir/r4';
// Synthetic FHIR R4 records for the demo. NOT real patients.
// Placeholder until the team's FHIR gateway / Supabase mock is connected.
import type { ClinicalResource } from './map';

// Ontario HCN system (Infoway ca-on-patient-hcn); these demo numbers are made up.
const OHIP = 'https://fhir.infoway-inforoute.ca/NamingSystem/ca-on-patient-hcn';
const ref = (id: string) => ({ reference: `Patient/${id}` });
const cc = (t: string): fhir4.CodeableConcept => ({ text: t });

function patient(
  id: string, given: string, family: string, birthDate: string, gender: fhir4.Patient['gender'],
  hcn: string, phone: string, email: string, city: string, language = 'English',
): fhir4.Patient {
  return {
    resourceType: 'Patient', id, birthDate, gender,
    name: [{ use: 'official', given: [given], family }],
    identifier: [{ system: OHIP, value: hcn }],
    telecom: [{ system: 'phone', value: phone }, { system: 'email', value: email }],
    address: [{ city, state: 'ON', country: 'CA' }],
    communication: [{ language: cc(language), preferred: true }],
  };
}

const condition = (pid: string, name: string, onset: string, status = 'active'): fhir4.Condition => ({
  resourceType: 'Condition', subject: ref(pid), code: cc(name), onsetDateTime: onset,
  clinicalStatus: { coding: [{ system: 'http://terminology.hl7.org/CodeSystem/condition-clinical', code: status }] },
});

const allergy = (
  pid: string, substance: string, reaction: string,
  severity: 'mild' | 'moderate' | 'severe', criticality: 'low' | 'high',
): fhir4.AllergyIntolerance => ({
  resourceType: 'AllergyIntolerance', patient: ref(pid), code: cc(substance), criticality,
  reaction: [{ manifestation: [cc(reaction)], severity }],
});

const med = (pid: string, name: string, dosage: string): fhir4.MedicationRequest => ({
  resourceType: 'MedicationRequest', status: 'active', intent: 'order', subject: ref(pid),
  medicationCodeableConcept: cc(name), dosageInstruction: [{ text: dosage }],
});

function obs(
  pid: string, category: 'vital-signs' | 'laboratory', label: string,
  value: number | string, unit: string | undefined, date: string, flag?: 'H' | 'L' | 'N',
): fhir4.Observation {
  return {
    resourceType: 'Observation', status: 'final', subject: ref(pid), code: cc(label), effectiveDateTime: date,
    category: [{ coding: [{ system: 'http://terminology.hl7.org/CodeSystem/observation-category', code: category }] }],
    ...(typeof value === 'number' ? { valueQuantity: { value, unit } } : { valueString: unit ? `${value} ${unit}` : value }),
    ...(flag
      ? { interpretation: [{ coding: [{ system: 'http://terminology.hl7.org/CodeSystem/v3-ObservationInterpretation', code: flag }] }] }
      : {}),
  };
}

const vitals = (pid: string, date: string, bp: string, hr: number | string, weight: number, extra: fhir4.Observation[] = []) => [
  obs(pid, 'vital-signs', 'Blood pressure', bp, 'mmHg', date),
  obs(pid, 'vital-signs', 'Heart rate', hr, 'bpm', date),
  obs(pid, 'vital-signs', 'Weight', weight, 'kg', date),
  ...extra,
];

function visit(pid: string, id: string, date: string, virtual: boolean, reason: string, practitioner: string, summary: string) {
  const encounter: ClinicalResource = {
    resourceType: 'Encounter', id, status: 'finished', subject: ref(pid),
    class: { system: 'http://terminology.hl7.org/CodeSystem/v3-ActCode', code: virtual ? 'VR' : 'AMB', display: virtual ? 'Virtual' : 'In person' },
    period: { start: date }, reasonCode: [cc(reason)], participant: [{ individual: { display: practitioner } }],
  };
  const note: ClinicalResource = {
    resourceType: 'DocumentReference', status: 'current', subject: ref(pid), date, description: summary,
    content: [{ attachment: { contentType: 'text/plain', title: 'Visit summary' } }],
    context: { encounter: [{ reference: `Encounter/${id}` }] },
  };
  return [encounter, note];
}

const CHEN = 'Dr. Amelia Chen';
const OSEI = 'Dr. Kwame Osei';

export const mockResources: ClinicalResource[] = [
  // ── Maya Thompson ─────────────────────────────────────
  patient('pt-maya', 'Maya', 'Thompson', '1988-03-14', 'female', '4821937560', '(416) 555-0193', 'maya.t@example.com', 'Toronto'),
  condition('pt-maya', 'Asthma, mild persistent', '2009-05-01'),
  condition('pt-maya', 'Seasonal allergic rhinitis', '2015-04-12'),
  allergy('pt-maya', 'Penicillin', 'Hives', 'moderate', 'high'),
  med('pt-maya', 'Fluticasone 125 mcg inhaler', '1 puff twice daily'),
  med('pt-maya', 'Salbutamol 100 mcg inhaler', '2 puffs every 4–6 h as needed'),
  med('pt-maya', 'Cetirizine 10 mg', 'Once daily in spring and summer'),
  ...vitals('pt-maya', '2026-09-18', '118/76', 72, 64, [
    obs('pt-maya', 'vital-signs', 'SpO₂', 98, '%', '2026-09-18'),
    obs('pt-maya', 'vital-signs', 'Temperature', 36.8, '°C', '2026-09-18'),
  ]),
  obs('pt-maya', 'laboratory', 'WBC', 7.2, '×10⁹/L', '2026-09-12', 'N'),
  obs('pt-maya', 'laboratory', 'Eosinophils', 0.6, '×10⁹/L', '2026-09-12', 'H'),
  ...visit('pt-maya', 'enc-maya-3', '2026-09-18', true, 'Asthma review', CHEN, 'Symptoms well controlled. Continue fluticasone. Reviewed inhaler technique.'),
  ...visit('pt-maya', 'enc-maya-2', '2026-03-02', false, 'Annual physical', CHEN, 'Healthy. Pap up to date. Influenza vaccine given.'),
  ...visit('pt-maya', 'enc-maya-1', '2025-11-20', true, 'Upper respiratory infection', OSEI, 'Viral URI. Supportive care; return if fever > 3 days.'),

  // ── Daniel Okafor ─────────────────────────────────────
  patient('pt-daniel', 'Daniel', 'Okafor', '1975-09-02', 'male', '4532281946', '(416) 555-0128', 'daniel.o@example.com', 'Toronto'),
  condition('pt-daniel', 'Type 2 diabetes mellitus', '2018-02-20'),
  condition('pt-daniel', 'Essential hypertension', '2016-07-11'),
  condition('pt-daniel', 'Hyperlipidemia', '2019-01-15'),
  allergy('pt-daniel', 'Sulfonamide antibiotics', 'Rash', 'mild', 'low'),
  med('pt-daniel', 'Metformin 1000 mg', 'Twice daily with meals'),
  med('pt-daniel', 'Empagliflozin 10 mg', 'Once daily in the morning'),
  med('pt-daniel', 'Ramipril 10 mg', 'Once daily'),
  med('pt-daniel', 'Atorvastatin 20 mg', 'Once daily at bedtime'),
  ...vitals('pt-daniel', '2026-10-02', '136/84', 78, 92, [obs('pt-daniel', 'vital-signs', 'BMI', 29.1, 'kg/m²', '2026-10-02')]),
  obs('pt-daniel', 'laboratory', 'HbA1c', 7.4, '%', '2026-09-28', 'H'),
  obs('pt-daniel', 'laboratory', 'LDL cholesterol', 2.1, 'mmol/L', '2026-09-28', 'N'),
  obs('pt-daniel', 'laboratory', 'eGFR', 84, 'mL/min/1.73m²', '2026-09-28', 'N'),
  obs('pt-daniel', 'laboratory', 'Urine ACR', 2.4, 'mg/mmol', '2026-09-28', 'H'),
  ...visit('pt-daniel', 'enc-daniel-3', '2026-10-02', false, 'Diabetes follow-up', CHEN, 'A1c improved from 8.1 to 7.4. Added empagliflozin. Foot exam normal.'),
  ...visit('pt-daniel', 'enc-daniel-2', '2026-06-14', true, 'Medication review', CHEN, 'Tolerating metformin. Home BP averaging 138/86; ramipril increased to 10 mg.'),
  ...visit('pt-daniel', 'enc-daniel-1', '2026-01-10', false, 'Annual physical', CHEN, 'Referred to diabetes education centre. Retinal screening booked.'),

  // ── Priya Raman ───────────────────────────────────────
  patient('pt-priya', 'Priya', 'Raman', '1993-06-21', 'female', '5729104483', '(647) 555-0171', 'priya.r@example.com', 'Toronto', 'English'),
  condition('pt-priya', 'Migraine without aura', '2012-09-01'),
  condition('pt-priya', 'Iron deficiency anemia', '2026-08-05'),
  allergy('pt-priya', 'Latex', 'Contact dermatitis', 'mild', 'low'),
  med('pt-priya', 'Ferrous fumarate 300 mg', 'Once daily, on alternate days if GI upset'),
  med('pt-priya', 'Rizatriptan 10 mg', 'At migraine onset; max 2 doses / 24 h'),
  ...vitals('pt-priya', '2026-08-11', '112/70', 68, 58),
  obs('pt-priya', 'laboratory', 'Hemoglobin', 112, 'g/L', '2026-08-05', 'L'),
  obs('pt-priya', 'laboratory', 'Ferritin', 9, 'µg/L', '2026-08-05', 'L'),
  obs('pt-priya', 'laboratory', 'TSH', 1.8, 'mIU/L', '2026-08-05', 'N'),
  ...visit('pt-priya', 'enc-priya-2', '2026-08-11', true, 'Fatigue', CHEN, 'Iron deficiency confirmed. Started oral iron; recheck CBC and ferritin in 3 months.'),
  ...visit('pt-priya', 'enc-priya-1', '2025-12-03', false, 'Migraine follow-up', CHEN, '2–3 migraines / month. Continue rizatriptan; headache diary provided.'),

  // ── Robert Gagnon ─────────────────────────────────────
  patient('pt-robert', 'Robert', 'Gagnon', '1952-11-30', 'male', '3318726605', '(613) 555-0144', 'r.gagnon@example.com', 'Ottawa', 'French'),
  condition('pt-robert', 'Atrial fibrillation', '2019-04-08'),
  condition('pt-robert', 'Chronic kidney disease, stage 3a', '2021-10-19'),
  condition('pt-robert', 'Osteoarthritis, both knees', '2014-06-02'),
  condition('pt-robert', 'Hypertension', '2010-03-22'),
  allergy('pt-robert', 'Codeine', 'Severe nausea, confusion', 'severe', 'high'),
  allergy('pt-robert', 'Shellfish', 'Hives', 'moderate', 'high'),
  med('pt-robert', 'Apixaban 5 mg', 'Twice daily'),
  med('pt-robert', 'Metoprolol 50 mg', 'Twice daily'),
  med('pt-robert', 'Amlodipine 5 mg', 'Once daily'),
  med('pt-robert', 'Acetaminophen 650 mg', 'Up to 3 times daily as needed'),
  ...vitals('pt-robert', '2026-10-20', '132/78', '64 (irregular)', 81, [obs('pt-robert', 'vital-signs', 'SpO₂', 96, '%', '2026-10-20')]),
  obs('pt-robert', 'laboratory', 'eGFR', 52, 'mL/min/1.73m²', '2026-10-15', 'L'),
  obs('pt-robert', 'laboratory', 'Creatinine', 121, 'µmol/L', '2026-10-15', 'H'),
  obs('pt-robert', 'laboratory', 'Potassium', 4.6, 'mmol/L', '2026-10-15', 'N'),
  ...visit('pt-robert', 'enc-robert-2', '2026-10-20', false, 'Atrial fibrillation follow-up', CHEN, 'Rate controlled. Continue apixaban (dose appropriate for renal function).'),
  ...visit('pt-robert', 'enc-robert-1', '2026-05-04', true, 'Knee pain', OSEI, 'Avoid NSAIDs given CKD and anticoagulation. Physio referral placed.'),

  // ── Sofia Martinez ────────────────────────────────────
  patient('pt-sofia', 'Sofia', 'Martinez', '2001-01-08', 'female', '6140392718', '(416) 555-0166', 'sofia.m@example.com', 'Toronto', 'Spanish'),
  condition('pt-sofia', 'Generalized anxiety disorder', '2022-02-14'),
  med('pt-sofia', 'Sertraline 50 mg', 'Once daily in the morning'),
  ...vitals('pt-sofia', '2026-07-22', '110/68', 74, 60),
  obs('pt-sofia', 'laboratory', 'TSH', 2.1, 'mIU/L', '2026-07-10', 'N'),
  ...visit('pt-sofia', 'enc-sofia-1', '2026-07-22', true, 'Anxiety follow-up', CHEN, 'GAD-7 improved from 14 to 8. Continue sertraline 50 mg. CBT referral sent.'),
];

/** Shown when a booking doesn't match any clinic record, so the demo still looks complete. */
export function samplePatientResources(name: string, birthDate: string): ClinicalResource[] {
  const parts = name.trim().split(/\s+/);
  const pid = 'pt-sample';
  return [
    {
      resourceType: 'Patient', id: pid, birthDate,
      name: [{ use: 'official', given: parts.slice(0, -1).length ? parts.slice(0, -1) : parts, family: parts.length > 1 ? parts[parts.length - 1] : undefined }],
    } as fhir4.Patient,
    condition(pid, 'Seasonal allergies', '2020-04-01'),
    med(pid, 'Vitamin D3 1000 IU', 'Once daily'),
    ...vitals(pid, '2026-06-02', '120/78', 70, 70),
    ...visit(pid, 'enc-sample-1', '2026-06-02', false, 'Annual physical', CHEN, 'Routine physical. No concerns.'),
  ];
}
