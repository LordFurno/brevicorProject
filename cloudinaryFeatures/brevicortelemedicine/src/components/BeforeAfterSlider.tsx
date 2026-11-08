import { useState } from 'react';
import { getEnhancedImage } from '../cloudinary/enhancements';
import type { CapturedSnapshot } from '../types';

export function BeforeAfterSlider({ snapshot, lowDataMode = false }: { snapshot: CapturedSnapshot; lowDataMode?: boolean }) {
  const [original, setOriginal] = useState(false);
  const [failedUrl, setFailedUrl] = useState('');
  const uploaded = Boolean(snapshot.public_id && !snapshot.public_id.startsWith('samples/'));
  const url = uploaded ? getEnhancedImage(snapshot.public_id, { filter: original ? 'raw' : 'auto_enhance', lowDataMode, privacy: snapshot.privacy }).toURL() : snapshot.dataUrl || snapshot.secure_url;
  return (
    <section style={{ display: 'grid', gap: 14, color: '#e2e8f0' }}>
      <h3 style={{ margin: 0 }}>Photo clarity</h3>
      <p style={{ margin: 0, fontSize: '0.8rem', color: '#94a3b8' }}>Gentle lighting correction and sharpening. Switch to the original colors to review the photo.</p>
      <div style={{ display: 'flex', gap: 8 }}>
        <button onClick={() => setOriginal(false)} aria-pressed={!original}>Improve clarity</button>
        <button onClick={() => setOriginal(true)} aria-pressed={original}>Original colors</button>
      </div>
      {failedUrl === url ? <p>Unable to load this photo. Try the original colors or check your connection.</p> : <img key={url} src={url} alt={original ? 'Photo with original colors' : 'Photo with improved clarity'} onError={() => setFailedUrl(url)} style={{ width: '100%', maxHeight: 420, objectFit: 'contain', background: '#0f172a', borderRadius: 8 }} />}
      <p style={{ margin: 0, fontSize: '0.8rem', color: '#94a3b8' }}>{!uploaded ? 'Upload this photo successfully to enable Cloudinary optimization.' : lowDataMode ? 'Low-data mode: smaller images with extra compression. Original upload retained.' : 'Automatic format and quality optimization. Original upload retained.'}</p>
    </section>
  );
}
