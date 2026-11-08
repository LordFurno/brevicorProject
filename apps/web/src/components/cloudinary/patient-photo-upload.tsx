'use client';
import { useEffect, useRef, useState, type RefObject } from 'react';
import { Camera, Upload, Send, RotateCcw } from 'lucide-react';
import { Button } from '@/components/ui';
import { captureVideoFrame } from './capture-frame';

export function PatientPhotoUpload({ token, cameraRef, cameraOn = false }: { token: string; cameraRef?: RefObject<HTMLVideoElement | null>; cameraOn?: boolean }) {
  const input = useRef<HTMLInputElement>(null), locked = useRef(false);
  const [busy, setBusy] = useState(false), [message, setMessage] = useState('');
  const [preview, setPreview] = useState<Blob | null>(null);
  const [previewUrl, setPreviewUrl] = useState('');
  useEffect(() => {
    if (!preview) { setPreviewUrl(''); return; }
    const url = URL.createObjectURL(preview); setPreviewUrl(url); return () => URL.revokeObjectURL(url);
  }, [preview]);
  async function takePhoto() {
    if (!cameraRef?.current || !cameraOn || locked.current) return;
    locked.current = true; setBusy(true); setMessage('');
    try { setPreview(await captureVideoFrame(cameraRef.current, null)); }
    catch (e) { setMessage(e instanceof Error ? e.message : 'Could not take a photo.'); }
    finally { locked.current = false; setBusy(false); }
  }
  async function upload(file: Blob) {
    if (locked.current) return;
    if (file.size > 20 * 1024 * 1024) { setMessage('Choose a photo under 20 MB.'); return; }
    locked.current = true; setBusy(true); setMessage('');
    try {
      const body = new FormData(); body.append('file', file, `patient-photo-${crypto.randomUUID()}`);
      const result = await fetch(`/api/visit/${encodeURIComponent(token)}/photos`, { method: 'POST', body, signal: AbortSignal.timeout(75000) });
      const data = await result.json();
      if (!result.ok) throw new Error(data.error || 'Upload failed.');
      setPreview(null); setMessage('Photo sent. Your physician can review it before the call.');
    } catch (e) { setMessage(e instanceof Error && e.name !== 'TimeoutError' ? e.message : 'Upload timed out. Please try again.'); }
    finally { locked.current = false; setBusy(false); }
  }
  return <div className="rounded-2xl border border-slate-200 bg-white p-4 text-slate-900 shadow-sm">
    <h3 className="text-sm font-semibold">Share an injury photo</h3>
    <p className="mt-1 text-xs text-slate-500">Take a photo from your camera preview, review it, then send it to your physician.</p>
    {previewUrl && <img src={previewUrl} alt="Photo to send to your physician" className="mt-3 max-h-64 w-full rounded-xl object-contain" />}
    <div className="mt-3 flex flex-wrap gap-2">
      {cameraRef && <Button variant="secondary" size="sm" disabled={busy || !cameraOn} onClick={() => void takePhoto()}><Camera /> {preview ? 'Retake photo' : 'Take photo'}</Button>}
      {preview && <><Button size="sm" loading={busy} disabled={busy} onClick={() => void upload(preview)}><Send /> Send to physician</Button><Button variant="ghost" size="sm" disabled={busy} onClick={() => setPreview(null)}><RotateCcw /> Discard</Button></>}
      <Button variant="secondary" size="sm" disabled={busy} onClick={() => input.current?.click()}><Upload /> Upload photo</Button>
    </div>
    <input ref={input} type="file" accept="image/jpeg,image/png,image/webp,image/avif" className="hidden" aria-label="Upload injury photo" onChange={(e) => { const file = e.target.files?.[0]; e.target.value = ''; if (file) { setPreview(file); setMessage(''); } }} />
    {cameraRef && !cameraOn && <p className="mt-2 text-xs text-slate-500">Turn on your camera to take a photo, or upload an existing photo.</p>}
    {message && <p role="status" className="mt-2 text-xs">{message}</p>}
  </div>;
}
