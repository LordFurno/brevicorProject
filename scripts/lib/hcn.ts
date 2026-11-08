import { createHash } from 'node:crypto';
import type { Identifier } from 'fhir/r4';
import { IDENTIFIER_VERSION_EXT, ONTARIO_HCN_SYSTEM } from '@/lib/fhir/identifiers';

/**
 * Synthetic Ontario health card numbers for demo patients.
 *
 * An Ontario HCN is 10 digits (the 10th a Luhn mod-10 check digit over the
 * first 9) plus a 2-letter version code. Every number generated here
 * deliberately carries the WRONG check digit, so it can never be a real
 * person's card. Deterministic per patient id, so demo-mock and ClinicSoft
 * hold the same number for the same patient.
 */

export interface SyntheticHcn {
  number: string; // 10 digits
  version: string; // 2 letters
}

/** Luhn check digit for the first 9 digits of an Ontario HCN. */
export function hcnCheckDigit(nine: string): number {
  if (!/^\d{9}$/.test(nine)) throw new Error('hcnCheckDigit expects 9 digits');
  let sum = 0;
  for (let i = 0; i < 9; i++) {
    let d = Number(nine[i]);
    if (i % 2 === 0) {
      d *= 2; // 1st, 3rd, 5th, 7th, 9th digits are doubled
      if (d > 9) d -= 9;
    }
    sum += d;
  }
  return (10 - (sum % 10)) % 10;
}

/** True when a 10-digit number passes the HCN check digit (i.e. could be real). */
export function passesHcnCheckDigit(number: string): boolean {
  return /^\d{10}$/.test(number) && hcnCheckDigit(number.slice(0, 9)) === Number(number[9]);
}

export function syntheticHcn(patientId: string): SyntheticHcn {
  const h = createHash('sha256').update(`brevicor-synthetic-hcn:${patientId}`).digest();
  const nine = [1 + (h[0] % 9), ...Array.from({ length: 8 }, (_, i) => h[i + 1] % 10)].join('');
  const wrong = (hcnCheckDigit(nine) + 1 + (h[9] % 9)) % 10; // offset 1..9: never the real check digit
  const letter = (b: number) => String.fromCharCode(65 + (b % 26));
  return { number: `${nine}${wrong}`, version: `${letter(h[10])}${letter(h[11])}` };
}

/** The FHIR Identifier for an Ontario HCN. */
export function hcnIdentifier(hcn: SyntheticHcn): Identifier {
  return {
    extension: [{ url: IDENTIFIER_VERSION_EXT, valueString: hcn.version }],
    use: 'official',
    type: {
      coding: [{ system: 'http://terminology.hl7.org/CodeSystem/v2-0203', code: 'JHN', display: 'Jurisdictional health number (Canada)' }],
      text: 'Ontario health card number',
    },
    system: ONTARIO_HCN_SYSTEM,
    value: hcn.number,
  };
}
