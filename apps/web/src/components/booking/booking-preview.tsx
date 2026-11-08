'use client';
import { useState } from 'react';
export function BookingPreview({
  token,
  clinic,
  physician,
  start,
}: {
  token: string;
  clinic: string;
  physician: string;
  start: string;
}) {
  const [dob, setDob] = useState(''),
    [message, setMessage] = useState(''),
    [verified, setVerified] = useState(false);
  return (
    <main className="mx-auto max-w-md px-5 py-20">
      <h1 className="text-2xl font-semibold">Development booking preview</h1>
      <p className="mt-4">
        {clinic} · {physician}
      </p>
      <p>{new Date(start).toLocaleString()}</p>
      {verified ? (
        <p className="mt-6">
          Identity confirmed. This isolated booking stays in memory and is not an EHR appointment.
        </p>
      ) : (
        <form
          className="mt-6 space-y-3"
          onSubmit={async (e) => {
            e.preventDefault();
            const r = await fetch(`/api/book/visit/${encodeURIComponent(token)}`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ dateOfBirth: dob }),
            });
            if (r.ok) setVerified(true);
            else setMessage('Could not verify this booking.');
          }}
        >
          <label>
            Date of birth
            <input
              type="date"
              required
              value={dob}
              onChange={(e) => setDob(e.target.value)}
              className="block border p-2"
            />
          </label>
          <button className="rounded bg-slate-900 px-4 py-2 text-white">Verify booking</button>
          <p>{message}</p>
        </form>
      )}
    </main>
  );
}
