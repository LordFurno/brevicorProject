// Clinics and physicians that patients can book with.
//
// INTEGRATION SEAM: this is static demo data. Once the FHIR gateway is live,
// replace these with Organization / Practitioner / PractitionerRole lookups.
// Keep the exported function signatures so the rest of the app is unaffected.

export interface Clinic {
  id: string; // also the tenant id
  name: string;
  city: string;
  address: string;
  phone: string;
}

export interface Practitioner {
  id: string;
  clinicId: string;
  name: string;
  specialty: string;
  bio: string;
  email: string;
  color: string;
  languages: string[];
  /** 0 = Sunday … 6 = Saturday */
  workDays: number[];
  /** Local clinic hours, 24h. Lunch (12–13) is always blocked. */
  hours: { start: number; end: number };
  slotMinutes: number;
}

/** Demo-mode password for every practitioner (ignored when Supabase Auth is configured). */
export const DEMO_PASSWORD = 'brevicor-demo';

export const clinics: Clinic[] = [
  { id: 'riverside', name: 'Riverside Family Health', city: 'Toronto', address: '412 Queen St E, Toronto, ON', phone: '(416) 555-0142' },
  { id: 'lakeshore', name: 'Lakeshore Medical Clinic', city: 'Mississauga', address: '88 Lakeshore Rd W, Mississauga, ON', phone: '(905) 555-0187' },
  { id: 'northgate', name: 'Northgate Community Clinic', city: 'Ottawa', address: '1500 Bank St, Ottawa, ON', phone: '(613) 555-0119' },
];

export const practitioners: Practitioner[] = [
  {
    id: 'pr-chen', clinicId: 'riverside', name: 'Amelia Chen', specialty: 'Family Medicine',
    bio: 'Primary care for adults and families, with a focus on chronic disease and preventive care.',
    email: 'amelia.chen@demo.brevicor.ca', color: '#1c7e69', languages: ['English', 'Mandarin'],
    workDays: [1, 2, 3, 4, 5, 6], hours: { start: 9, end: 17 }, slotMinutes: 20,
  },
  {
    id: 'pr-osei', clinicId: 'riverside', name: 'Kwame Osei', specialty: 'Family Medicine',
    bio: 'Family physician with interests in sports medicine and men’s health.',
    email: 'kwame.osei@demo.brevicor.ca', color: '#4f46e5', languages: ['English', 'French'],
    workDays: [1, 2, 3, 4, 5], hours: { start: 10, end: 18 }, slotMinutes: 20,
  },
  {
    id: 'pr-patel', clinicId: 'lakeshore', name: 'Ravi Patel', specialty: 'Internal Medicine',
    bio: 'Internist caring for adults with complex and multiple chronic conditions.',
    email: 'ravi.patel@demo.brevicor.ca', color: '#b45309', languages: ['English', 'Hindi', 'Gujarati'],
    workDays: [1, 2, 3, 4, 5], hours: { start: 9, end: 16 }, slotMinutes: 30,
  },
  {
    id: 'pr-nguyen', clinicId: 'lakeshore', name: 'Thomas Nguyen', specialty: 'Pediatrics',
    bio: 'Pediatrician for newborns through teens. Parents are welcome on every call.',
    email: 'thomas.nguyen@demo.brevicor.ca', color: '#0369a1', languages: ['English', 'Vietnamese'],
    workDays: [1, 3, 5, 6], hours: { start: 9, end: 15 }, slotMinutes: 20,
  },
  {
    id: 'pr-lavoie', clinicId: 'northgate', name: 'Isabelle Lavoie', specialty: 'Family Medicine',
    bio: 'Bilingual family doctor focused on women’s health and mental health.',
    email: 'isabelle.lavoie@demo.brevicor.ca', color: '#be185d', languages: ['French', 'English'],
    workDays: [1, 2, 3, 4, 5], hours: { start: 8, end: 16 }, slotMinutes: 20,
  },
];

export const getClinic = (id: string) => clinics.find((c) => c.id === id);
export const getPractitioner = (id: string) => practitioners.find((p) => p.id === id);
export const findPractitionerByEmail = (email: string) =>
  practitioners.find((p) => p.email.toLowerCase() === email.trim().toLowerCase());

export const drName = (p: Pick<Practitioner, 'name'>) => `Dr. ${p.name}`;
export const drShort = (p: Pick<Practitioner, 'name'>) => `Dr. ${p.name.split(' ').slice(-1)[0]}`;

export interface PublicPractitioner {
  id: string;
  name: string;
  specialty: string;
  bio: string;
  color: string;
  languages: string[];
  slotMinutes: number;
}
export interface PublicClinic extends Clinic {
  practitioners: PublicPractitioner[];
}

/** Directory safe to send to anonymous patients (no emails / internal config). */
export function publicDirectory(): PublicClinic[] {
  return clinics.map((c) => ({
    ...c,
    practitioners: practitioners
      .filter((p) => p.clinicId === c.id)
      .map((p) => ({
        id: p.id,
        name: p.name,
        specialty: p.specialty,
        bio: p.bio,
        color: p.color,
        languages: p.languages,
        slotMinutes: p.slotMinutes,
      })),
  }));
}
