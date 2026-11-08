import { notFound } from 'next/navigation';
import { bookingEnabled, ehrBookingEnabled } from '@/lib/booking';
import type { Metadata } from 'next';
import { BookingWizard } from '@/components/booking/booking-wizard';
import { publicDirectory } from '@/lib/directory';
import { ehrDirectory } from '@/lib/visits/ehr-booking';
import { ymdInTz } from '@/lib/time';

export const metadata: Metadata = { title: 'Book a visit' };
export const dynamic = 'force-dynamic';

export default async function BookPage() {
  if (ehrBookingEnabled()) return <BookingWizard directory={await ehrDirectory()} today={ymdInTz(Date.now())} />;
  if (!bookingEnabled()) notFound();
  return <BookingWizard directory={publicDirectory()} today={ymdInTz(Date.now())} />;
}
