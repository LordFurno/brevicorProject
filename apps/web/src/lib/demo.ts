// Demo/testing conveniences: extended doctor hours, "book now" slots, demo logins.
// On automatically in local development; off in production unless ALLOW_DEMO_LOGIN=true.
export const isDemoEnvironment = () => process.env.NODE_ENV !== 'production' || process.env.ALLOW_DEMO_LOGIN === 'true';

/** In demo mode every physician is bookable every day, 6:00–24:00 (Toronto time). */
export const DEMO_HOURS = { start: 6, end: 24 };
export const DEMO_WORK_DAYS = [0, 1, 2, 3, 4, 5, 6];

/** In demo mode you can book a slot that started up to this long ago, so you can join immediately. */
export const DEMO_BOOK_STARTED_SLOT_MIN = 10;
