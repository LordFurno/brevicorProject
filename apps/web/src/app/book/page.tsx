import { notFound } from 'next/navigation';
import { bookingEnabled } from '@/lib/booking';
import type { Metadata } from 'next';
import { BookingWizard } from '@/components/booking/booking-wizard';
import { publicDirectory } from '@/lib/directory';
import { ymdInTz } from '@/lib/time';

export const metadata: Metadata = { title: 'Book a visit' };
export const dynamic = 'force-dynamic';

export default function BookPage() { if (!bookingEnabled()) notFound();
  return <BookingWizard directory={publicDirectory()} today={ymdInTz(Date.now())} />;
}
