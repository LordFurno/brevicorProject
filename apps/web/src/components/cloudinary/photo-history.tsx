'use client';
import { useEffect, useState } from 'react';
import { transformationFor } from './enhancements';
import { usePhotoUrls } from './use-photo-urls';
import { Button } from '@/components/ui';

interface HistoryPhoto { id: string; publicId: string; version?: number; createdAt: string; visitId: string; meetingStart: string; diagnosis?: string; notes: string }
export function PhotoHistory({ visitId }: { visitId: string }) {
  const [photos, setPhotos] = useState<HistoryPhoto[]>([]), [weeks, setWeeks] = useState('all'), [meetings, setMeetings] = useState('all');
  const [error, setError] = useState(''), [loading, setLoading] = useState(true), [lowData, setLowData] = useState(true), [revision, setRevision] = useState(0);
  useEffect(() => {
    const abort = new AbortController();
    async function load() {
      try {
        const result = await fetch(`/api/doctor/visits/${encodeURIComponent(visitId)}/photos?history=1`, { cache: 'no-store', signal: abort.signal });
        if (!result.ok) throw new Error('Unable to load photo history.');
        const data = await result.json(); setPhotos(data.photos); setError('');
      } catch (e) { if (!abort.signal.aborted) setError(e instanceof Error ? e.message : 'History unavailable.'); }
      finally { if (!abort.signal.aborted) setLoading(false); }
    }
    void load(); const timer = setInterval(() => void load(), 5000);
    return () => { abort.abort(); clearInterval(timer); };
  }, [visitId, revision]);
  const cutoff = weeks === 'all' ? -Infinity : Date.now() - Number(weeks) * 7 * 86400000;
  const filtered = photos.filter((p) => Date.parse(p.createdAt) >= cutoff);
  const groups = Array.from(new Set(filtered.map((p) => p.visitId))).map((id) => ({ id, photos: filtered.filter((p) => p.visitId === id) })).sort((a, b) => Date.parse(b.photos[0].meetingStart) - Date.parse(a.photos[0].meetingStart));
  const visible = meetings === 'all' ? groups : groups.slice(0, Number(meetings));
  // Short-lived Brevicor URLs signed by the server (no Cloudinary URLs in the browser).
  const viewT = transformationFor({ filter: 'raw', lowDataMode: lowData });
  const urlOf = usePhotoUrls(visitId, visible.flatMap((g) => g.photos.map((p) => ({ photoId: p.id, t: viewT }))));
  const earliest = photos.length ? Math.min(...photos.map((p) => Date.parse(p.createdAt))) : Date.now();
  return <section className="space-y-5 p-5 sm:p-7">
    <div><h2 className="text-lg font-semibold">Progress over time</h2><p className="mt-1 text-sm text-slate-500">Review this patient's photos, diagnoses, and notes across meetings with you.</p></div>
    <div className="flex flex-wrap items-end gap-3">
      <label className="text-sm text-slate-700">Time span<select className="mt-1 block rounded-xl border border-slate-200 p-2" value={weeks} onChange={(e) => setWeeks(e.target.value)}><option value="all">All dates</option>{[2, 4, 8, 12, 26, 52].map((n) => <option key={n} value={n}>Last {n} weeks</option>)}</select></label>
      <label className="text-sm text-slate-700">Meetings<select className="mt-1 block rounded-xl border border-slate-200 p-2" value={meetings} onChange={(e) => setMeetings(e.target.value)}><option value="all">All meetings</option>{[2, 3, 5, 10].map((n) => <option key={n} value={n}>Last {n} meetings</option>)}</select></label>
      <Button variant="secondary" size="sm" onClick={() => setRevision((n) => n + 1)}>Refresh</Button>
    </div>
    <label className="flex items-center gap-2 text-sm text-slate-600"><input type="checkbox" checked={lowData} onChange={(e) => setLowData(e.target.checked)} /> Low-data images</label>
    {error && <p role="alert" className="text-sm text-rose-700">{error}</p>}
    <p className="text-xs text-slate-500">{visible.length} meetings · {visible.reduce((n, g) => n + g.photos.length, 0)} photos shown. History begins with photos recorded in this app. Temporary history resets when the server restarts.</p>
    {!visible.length && <p className="rounded-xl border border-dashed border-slate-200 p-6 text-sm text-slate-500">{loading ? 'Loading history…' : photos.length ? 'No photos in this time span. Try All dates.' : 'No photo history yet. Take or upload a photo in Photos & notes to start the record.'}</p>}
    <div className="space-y-6 border-l-2 border-teal-100 pl-4">{visible.map((group) => <article key={group.id} className="relative space-y-3">
      <span className="absolute top-1 -left-[23px] size-3 rounded-full bg-teal-500 ring-4 ring-white" />
      <h3 className="text-sm font-semibold text-slate-800">Meeting · {new Date(group.photos[0].meetingStart).toLocaleDateString()} {group.id === visitId && <span className="ml-2 text-xs font-normal text-teal-700">Current meeting</span>}</h3>
      {group.photos.map((photo) => <div key={photo.id} className="space-y-3 rounded-2xl border border-slate-200 bg-white p-3">
        <div className="flex justify-between gap-2 text-xs text-slate-500"><time dateTime={photo.createdAt}>{new Date(photo.createdAt).toLocaleString()}</time><span>Week {Math.floor((Date.parse(photo.createdAt) - earliest) / (7 * 86400000))} of photo history</span></div>
        {urlOf({ photoId: photo.id, t: viewT }) ? <a href={urlOf({ photoId: photo.id, t: viewT })} target="_blank" rel="noopener noreferrer"><img src={urlOf({ photoId: photo.id, t: viewT })} alt="Consultation photo from this meeting" loading="lazy" className="max-h-64 w-full rounded-xl bg-slate-50 object-contain" /></a> : <div className="h-40 w-full rounded-xl bg-slate-50" />}
        <div><p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Diagnosis / assessment</p><p className="mt-1 whitespace-pre-wrap text-sm text-slate-800">{photo.diagnosis || 'No diagnosis recorded.'}</p></div>
        <div><p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Physician notes</p><p className="mt-1 whitespace-pre-wrap text-sm text-slate-700">{photo.notes || 'No notes recorded.'}</p></div>
      </div>)}
    </article>)}</div>
  </section>;
}
