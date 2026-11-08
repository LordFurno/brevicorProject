export const bookingEnabled = () =>
  process.env.NODE_ENV !== 'production' &&
  process.env.BOOKING_ENABLED === 'true' &&
  process.env.VISIT_STORE === 'memory';
