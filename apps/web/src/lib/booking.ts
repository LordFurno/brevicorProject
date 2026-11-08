export const bookingEnabled = () =>
  process.env.NODE_ENV !== 'production' &&
  process.env.BOOKING_ENABLED === 'true' &&
  process.env.VISIT_STORE === 'memory';

/**
 * Self-service booking into the clinic's EHR (demo): creates the FHIR Patient
 * and Appointment through the gateway, then the visit. Works with the normal
 * Supabase visit store, in production builds too.
 */
export const ehrBookingEnabled = () => process.env.EHR_BOOKING_ENABLED === 'true';
export const anyBookingEnabled = () => ehrBookingEnabled() || bookingEnabled();
