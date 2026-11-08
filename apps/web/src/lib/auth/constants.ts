// Edge-safe constants (imported by middleware — no Node APIs here).
export const DOCTOR_COOKIE = 'brv_doc';
export const patientCookieName = (visitId: string) => `brv_v_${visitId}`;
