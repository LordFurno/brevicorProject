'use client';

import { useEffect, useRef, useState, type RefObject } from 'react';
import { Camera, Upload, ImagePlus, Download, FileCheck2 } from 'lucide-react';
import { Button } from '@/components/ui';
import { cloudName, uploadPreset } from './config';
import { getEnhancedImage } from './enhancements';
import { WoundMarginView } from './wound-margin-view';
import { RegionSelector } from './region-selector';
import { pixelCrop } from './region-geometry';
import { captureVideoFrame, photoFilename } from './capture-frame';
import type { DiagnosticFilter, NormalizedRect, CropRect } from './types';

interface Photo { width?: number; height?: number; version?: number; id: string; publicId: string; createdAt: string; notes: string; diagnosis?: string; documentRef?: string }
const filters: { value: DiagnosticFilter; label: string }[] = [
  { value: 'raw', label: 'Original colors' },
  { value: 'auto_enhance', label: 'Photo clarity' },
  { value: 'hd_sharpen', label: 'Sharpen detail' },
  { value: 'color_restore', label: 'Color balance' },
  { value: 'wound_zoom', label: 'Lesion zoom' },
  { value: 'margin_outline', label: 'Wound outline' },
];
const field = 'w-full rounded-xl border border-slate-200 bg-white p-2 text-sm text-slate-800';

export function PhotoTools({ remoteStream, visitId, videoRef, captureRegion, captureRequest, onBusyChange }: { remoteStream: MediaStream | null; visitId: string; videoRef: RefObject<HTMLVideoElement | null>; captureRegion: NormalizedRect | null; captureRequest: number; onBusyChange: (busy: boolean) => void }) {
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [selected, setSelected] = useState('');
  const [filter, setFilter] = useState<DiagnosticFilter>('raw');
  const [lowData, setLowData] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [panX, setPanX] = useState(0);
  const [panY, setPanY] = useState(0);
  const [autoGravity, setAutoGravity] = useState(true);
  const [blurFaces, setBlurFaces] = useState(false);
  const [annotation, setAnnotation] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [failedUrl, setFailedUrl] = useState('');
  const input = useRef<HTMLInputElement>(null);
  const locked = useRef(false);
  const captureLatest = useRef<() => void>(() => undefined);
  const [selectingPhoto, setSelectingPhoto] = useState(false);
  const [draftRegion, setDraftRegion] = useState<NormalizedRect | null>(null);
  const [photoRegion, setPhotoRegion] = useState<CropRect | undefined>();
  const [photoSize, setPhotoSize] = useState({ width: 1, height: 1 });
  const controller = useRef<AbortController | null>(null);
  const mounted = useRef(true);
  const configured = Boolean(cloudName && uploadPreset);
  const photo = photos.find((p) => p.id === selected);

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; controller.current?.abort(); };
  }, []);
  useEffect(() => { onBusyChange(busy); }, [busy, onBusyChange]);
  useEffect(() => { if (captureRequest > 0) captureLatest.current(); }, [captureRequest]);

  useEffect(() => {
    const abort = new AbortController();
    async function poll() {
      try {
        const result = await fetch(`/api/doctor/visits/${encodeURIComponent(visitId)}/photos`, { cache: 'no-store', signal: abort.signal });
        if (!result.ok) return;
        const data = await result.json() as { photos: Photo[] };
        if (!Array.isArray(data.photos)) return;
        setPhotos((prev) => {
          const fresh = data.photos.filter((p) => !prev.some((existing) => existing.id === p.id));
          // Keep local edits; pick up chart links saved elsewhere.
          const merged = prev.map((p) => {
            const server = data.photos.find((x) => x.id === p.id);
            return server?.documentRef && !p.documentRef ? { ...p, documentRef: server.documentRef } : p;
          });
          return fresh.length ? [...fresh, ...merged] : merged;
        });
        if (data.photos.length) setSelected((prev) => prev || data.photos[0].id);
      } catch { /* Preserve local photos while reconnecting. */ }
    }
    void poll();
    const timer = setInterval(() => { void poll(); }, 5000);
    return () => { abort.abort(); clearInterval(timer); };
  }, [visitId]);

  async function upload(file: Blob, fromCapture = false) {
    if (!configured || (!fromCapture && locked.current)) return;
    locked.current = true; setBusy(true); setError('');
    const abort = new AbortController(); controller.current = abort;
    const timeout = setTimeout(() => abort.abort(), 60000);
    try {
      const body = new FormData();
      body.append('file', file, photoFilename(file.type));
      body.append('source', fromCapture ? 'in_call_capture' : 'patient_upload');
      const response = await fetch(`/api/doctor/visits/${encodeURIComponent(visitId)}/photos`, { method: 'POST', body, signal: abort.signal });
      const data = await response.json();
      if (!response.ok || !data.photo) throw new Error(data.error || 'Photo upload failed.');
      if (!mounted.current) return;
      const item = data.photo as Photo;
      setPhotos((prev) => [item, ...prev]); setSelected(item.id); setFailedUrl(''); setPhotoRegion(undefined); setDraftRegion(null); setSelectingPhoto(false);
      setFilter('raw'); setZoom(1); setPanX(0); setPanY(0); setAnnotation('');
    } catch (e) {
      if (mounted.current) setError(e instanceof Error && e.name !== 'AbortError' ? e.message : 'Upload timed out. Check your connection and try again.');
    } finally {
      clearTimeout(timeout); locked.current = false; controller.current = null;
      if (mounted.current) setBusy(false);
    }
  }

  async function saveNotes(item: Photo) {
    setError('');
    try {
      const result = await fetch(`/api/doctor/visits/${encodeURIComponent(visitId)}/photos`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: item.id, notes: item.notes, diagnosis: item.diagnosis || '' }) });
      if (!result.ok) throw new Error('Could not save these notes. Please try again.');
      setSavedNote(item.id);
      return true;
    } catch (e) { setError(e instanceof Error ? e.message : 'Save failed.'); return false; }
  }
  const [savedNote, setSavedNote] = useState('');
  const [charting, setCharting] = useState('');
  const [chartStatus, setChartStatus] = useState<Record<string, 'ehr' | 'local-only'>>({});

  /** Saves the current notes, then files the photo to the patient's chart (FHIR DocumentReference). */
  async function saveToChart(item: Photo) {
    if (charting || item.documentRef) return;
    setCharting(item.id);
    try {
      if (!(await saveNotes(item))) return;
      const result = await fetch(`/api/doctor/visits/${encodeURIComponent(visitId)}/photos/${encodeURIComponent(item.id)}/chart`, { method: 'POST' });
      const data = await result.json();
      if (!result.ok || !data.photo) throw new Error(data.error || 'Could not save to the chart. Please retry.');
      setPhotos((prev) => prev.map((p) => (p.id === item.id ? { ...p, documentRef: data.photo.documentRef } : p)));
      if (data.syncStatus) setChartStatus((prev) => ({ ...prev, [item.id]: data.syncStatus }));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save to the chart.');
    } finally {
      setCharting('');
    }
  }

  async function capture() {
    if (locked.current || !configured) return;
    const el = videoRef.current;
    if (!el || el.readyState < 2 || !el.videoWidth || !el.videoHeight || !remoteStream?.getVideoTracks().some((t) => t.readyState === 'live' && t.enabled && !t.muted)) {
      setError('Wait for the patient video to connect before capturing a frame.'); return;
    }
    locked.current = true; setBusy(true); setError('');
    try {
      const blob = await captureVideoFrame(el, captureRegion);
      if (!mounted.current) { locked.current = false; return; }
      await upload(blob, true);
    } catch (e) {
      locked.current = false;
      if (mounted.current) { setBusy(false); setError(e instanceof Error ? e.message : 'Capture failed. Try again.'); }
    }
  }
  captureLatest.current = () => { void capture(); };

  const privacy = { blurFaces, shelterSafetyMode: false, stripMetadata: false, signedUrl: false };
  const url = photo ? getEnhancedImage(photo.publicId, {
    filter, version: photo.version, region: photoRegion, lowDataMode: lowData, zoomLevel: zoom, panX, panY, useAutoGravity: autoGravity,
    privacy, annotation: { enabled: Boolean(annotation.trim()), text: annotation, color: 'yellow', position: 'north_west' },
  }).toURL() : '';

  return (
    <section className="space-y-5 p-5 sm:p-7" aria-label="Consultation photo tools">
      <div><h2 className="flex items-center gap-2 text-lg font-semibold text-slate-900"><ImagePlus className="size-5 text-brand-600" /> Photos & physician notes</h2>
        <p className="mt-1 text-sm text-slate-500">Upload a photo or capture the patient video, then examine details with Cloudinary.</p></div>
      {!configured && <p role="alert" className="rounded-xl bg-amber-50 p-3 text-sm text-amber-900">Set the Cloudinary cloud name and unsigned upload preset in apps/web/.env.local, then restart the app.</p>}
      <div className="flex flex-wrap gap-2">
        <Button variant="secondary" disabled={busy || !configured} onClick={() => input.current?.click()} loading={busy}><Upload /> {busy ? 'Uploading…' : 'Upload photo'}</Button>
        <Button variant="secondary" disabled={busy || !configured || !remoteStream} onClick={capture}><Camera /> {captureRegion ? 'Capture selected area' : 'Capture patient frame'}</Button>
        <input ref={input} type="file" accept="image/jpeg,image/png,image/webp,image/avif" className="hidden" aria-label="Select consultation photo" onChange={(e) => {
          const file = e.target.files?.[0]; e.target.value = '';
          if (!file) return;
          if (!['image/jpeg', 'image/png', 'image/webp', 'image/avif'].includes(file.type)) { setError('Choose a JPEG, PNG, WebP, or AVIF photo.'); return; }
          if (file.size > 20 * 1024 * 1024) { setError('Choose a photo smaller than 20 MB.'); return; }
          void upload(file);
        }} />
      </div>
      {error && <p role="alert" className="rounded-xl bg-rose-50 p-3 text-sm text-rose-700">{error}</p>}
      <label className="flex items-center justify-between gap-4 rounded-xl bg-brand-50 p-3 text-sm text-slate-700">
        <span><strong>Low-data photos</strong><span className="mt-0.5 block text-xs text-slate-500">Smaller downloads with extra compression. Original uploads stay intact.</span></span>
        <input type="checkbox" checked={lowData} onChange={(e) => setLowData(e.target.checked)} className="size-5 accent-teal-600" />
      </label>
      {!photo ? <div className="rounded-2xl border border-dashed border-slate-200 p-8 text-center text-sm text-slate-500">No consultation photos yet. Upload a photo to get started.</div> : <>
        <label className="block text-sm font-medium text-slate-700">Photo view<select className={`${field} mt-1`} value={filter} onChange={(e) => setFilter(e.target.value as DiagnosticFilter)}>{filters.map((f) => <option key={f.value} value={f.value}>{f.label}</option>)}</select></label>
        <p className="text-xs text-slate-500">Enhancements can change colors and detail. Use Original colors when reviewing skin tone. Wound outline is a visual aid.</p>
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" size="sm" aria-pressed={selectingPhoto} onClick={() => { setPhotoRegion(undefined); setDraftRegion(null); setZoom(1); setPanX(0); setPanY(0); setFilter('raw'); setSelectingPhoto(true); }}>Select photo region</Button>
          {selectingPhoto && <Button size="sm" disabled={!draftRegion} onClick={() => { if (draftRegion) setPhotoRegion(pixelCrop(draftRegion, photo.width || photoSize.width, photo.height || photoSize.height)); setSelectingPhoto(false); setDraftRegion(null); }}>Apply region</Button>}
          {(selectingPhoto || photoRegion) && <Button variant="ghost" size="sm" onClick={() => { setSelectingPhoto(false); setPhotoRegion(undefined); setDraftRegion(null); }}>Show full photo</Button>}
        </div>
        <div className="relative overflow-hidden rounded-2xl bg-slate-950">
          {filter === 'margin_outline' ? <WoundMarginView src={url} /> : failedUrl === url ? <p role="alert" className="p-6 text-sm text-white">Unable to load this view. Try Original colors or check your connection.</p> : <img key={url} src={url} alt="Selected consultation photo" onError={() => setFailedUrl(url)} onLoad={(e) => setPhotoSize({ width: e.currentTarget.naturalWidth, height: e.currentTarget.naturalHeight })} draggable={false} className="max-h-96 w-full object-contain" />}
          {selectingPhoto && <RegionSelector width={photoSize.width} height={photoSize.height} active value={draftRegion} onChange={setDraftRegion} />}
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="text-sm text-slate-700">Zoom: {zoom.toFixed(1)}×<input className="mt-2 w-full" type="range" min="1" max="4" step="0.1" value={zoom} onChange={(e) => setZoom(Number(e.target.value))} /></label>
          <label className="flex items-center gap-2 text-sm text-slate-700"><input type="checkbox" checked={autoGravity} onChange={(e) => { setAutoGravity(e.target.checked); setPanX(0); setPanY(0); }} /> Automatic focus</label>
          {!autoGravity && <><label className="text-sm text-slate-700">Horizontal position<input className="w-full" type="range" min="-300" max="300" value={panX} onChange={(e) => setPanX(Number(e.target.value))} /></label><label className="text-sm text-slate-700">Vertical position<input className="w-full" type="range" min="-300" max="300" value={panY} onChange={(e) => setPanY(Number(e.target.value))} /></label></>}
          <label className="flex items-center gap-2 text-sm text-slate-700"><input type="checkbox" checked={blurFaces} onChange={(e) => setBlurFaces(e.target.checked)} /> Blur faces in delivered photos</label>
          <Button variant="ghost" size="sm" onClick={() => { setZoom(1); setPanX(0); setPanY(0); setAutoGravity(true); setFilter('raw'); setAnnotation(''); setPhotoRegion(undefined); setSelectingPhoto(false); setDraftRegion(null); }}>Reset view</Button>
        </div>
        <label className="block text-sm font-medium text-slate-700">Photo annotation<input className={`${field} mt-1`} maxLength={160} value={annotation} onChange={(e) => setAnnotation(e.target.value)} placeholder="Optional marker shown on this photo" /></label>
        <a href={url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-2 text-sm font-medium text-brand-700"><Download className="size-4" /> Open processed photo</a>
      </>}
      {photos.length > 0 && <div className="space-y-3 border-t border-slate-100 pt-5"><h3 className="text-sm font-semibold text-slate-900">Physician notes & photos</h3>
        {photos.map((item) => <article key={item.id} className={`rounded-xl border p-3 ${selected === item.id ? 'border-brand-300 bg-brand-50/40' : 'border-slate-200'}`}>
          <button type="button" className="flex w-full items-center gap-3 text-left" onClick={() => { setSelected(item.id); setPhotoRegion(undefined); setSelectingPhoto(false); setDraftRegion(null); setFailedUrl(''); setZoom(1); setPanX(0); setPanY(0); setAnnotation(''); }} aria-pressed={selected === item.id}>
            <img src={getEnhancedImage(item.publicId, { filter: 'raw', version: item.version, lowDataMode: lowData, privacy }).toURL()} alt="Recorded consultation photo" loading="lazy" className="h-16 w-20 rounded-lg bg-slate-100 object-contain" />
            <span className="text-sm text-slate-700"><time dateTime={item.createdAt}>{new Date(item.createdAt).toLocaleString()}</time><span className="block text-xs text-slate-500">View photo</span></span>
          </button>
          <label className="mt-3 block text-xs font-medium text-slate-600">Diagnosis / assessment<input maxLength={1000} value={item.diagnosis || ''} onChange={(e) => { setSavedNote(''); setPhotos((prev) => prev.map((p) => p.id === item.id ? { ...p, diagnosis: e.target.value } : p)); }} placeholder="Physician assessment" className={`${field} mt-1`} /></label>
          <label className="mt-3 block text-xs font-medium text-slate-600">Physician notes<textarea rows={3} value={item.notes} maxLength={10000} onChange={(e) => { setSavedNote(''); setPhotos((prev) => prev.map((p) => p.id === item.id ? { ...p, notes: e.target.value } : p)); }} placeholder="Add your observations for this photo…" className={`${field} mt-1 resize-y`} /></label>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <Button variant="secondary" size="sm" onClick={() => void saveNotes(item)}>{savedNote === item.id ? 'Notes saved' : 'Save diagnosis & notes'}</Button>
            {item.documentRef ? (
              <span className="inline-flex items-center gap-1.5 text-xs font-medium text-emerald-700"><FileCheck2 className="size-4" /> Saved to chart{chartStatus[item.id] === 'local-only' && <span className="font-normal text-slate-500">(held by Brevicor: this clinic&apos;s EHR can&apos;t store documents yet)</span>}</span>
            ) : (
              <Button size="sm" loading={charting === item.id} disabled={!!charting} onClick={() => void saveToChart(item)}><FileCheck2 /> Save to chart</Button>
            )}
          </div>
        </article>)}
      </div>}
      <p className="text-xs text-slate-500">Save diagnosis & notes keeps your assessment in Progress history. Save to chart files the photo, diagnosis and notes to the patient&apos;s chart as a document on this visit (later edits aren&apos;t sent again). Low-data mode affects photo downloads only.</p>
    </section>
  );
}
