import { notFound } from 'next/navigation';
import { bookingEnabled } from '@/lib/booking';
import { getVisitStore } from '@/lib/visits/booking-store';
import { getClinic, getPractitioner, drName } from '@/lib/directory';
import { BookingPreview } from '@/components/booking/booking-preview';
export const dynamic = 'force-dynamic';
export default async function DemoVisit({ params }: { params: Promise<{ token: string }> }) {
  if (!bookingEnabled()) notFound();
  const { token } = await params,
    visit = await getVisitStore().getByToken(token);
  if (!visit) notFound();
  return (
    <BookingPreview
      token={token}
      clinic={getClinic(visit.clinicId)?.name ?? 'Demo clinic'}
      physician={drName(getPractitioner(visit.practitionerId)!)}
      start={visit.start}
    />
  );
}
