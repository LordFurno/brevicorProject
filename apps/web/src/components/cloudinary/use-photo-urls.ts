'use client';

import { useEffect, useMemo, useState } from 'react';

export interface PhotoView {
  photoId: string;
  /** Cloudinary transformation (transformationFor), signed by the server. */
  t: string;
}

const REFRESH_AFTER_MS = 4 * 60_000; // URLs live 5 minutes
const key = (v: PhotoView) => `${v.photoId}|${v.t}`;

/**
 * Short-lived Brevicor URLs for this visit's photos. Asks the server to sign
 * the views on screen and refreshes them before they expire. Returns a lookup
 * that is '' until a URL is available.
 */
export function usePhotoUrls(visitId: string, views: PhotoView[]) {
  const [urls, setUrls] = useState<Record<string, { url: string; at: number }>>({});
  const [tick, setTick] = useState(0);

  useEffect(() => {
    const timer = setInterval(() => setTick((n) => n + 1), 30_000);
    return () => clearInterval(timer);
  }, []);

  const wanted = useMemo(() => {
    const now = Date.now();
    const unique = new Map(views.filter((v) => v.photoId).map((v) => [key(v), v]));
    return [...unique.values()].filter((v) => !urls[key(v)] || now - urls[key(v)].at > REFRESH_AFTER_MS);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [views.map(key).join('\n'), urls, tick]);
  const signature = wanted.map(key).sort().join('\n');

  useEffect(() => {
    if (!wanted.length) return;
    const abort = new AbortController();
    void (async () => {
      try {
        for (let i = 0; i < wanted.length; i += 60) {
          const response = await fetch(`/api/doctor/visits/${encodeURIComponent(visitId)}/photos/urls`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ items: wanted.slice(i, i + 60) }),
            signal: abort.signal,
          });
          if (!response.ok) return;
          const data = (await response.json()) as { urls: Record<string, string> };
          const at = Date.now();
          setUrls((prev) => ({ ...prev, ...Object.fromEntries(Object.entries(data.urls).map(([k, url]) => [k, { url, at }])) }));
        }
      } catch {
        /* Keep showing the previous URLs while reconnecting. */
      }
    })();
    return () => abort.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visitId, signature]);

  return (view: PhotoView) => urls[key(view)]?.url ?? '';
}
