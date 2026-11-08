import { getEnhancedImage } from '../cloudinary/enhancements';
import type { CapturedSnapshot } from '../types';

interface Props {
  snapshots: CapturedSnapshot[];
  lowDataMode: boolean;
  onUpdateNotes: (id: string, notes: string) => void;
}

export function LongitudinalTimeline({ snapshots, lowDataMode, onUpdateNotes }: Props) {
  return (
    <section style={{ display: 'grid', gap: 16, color: '#e2e8f0' }}>
      <div>
        <h3 style={{ margin: '0 0 6px' }}>Physician notes & photos</h3>
        <p style={{ margin: 0, color: '#94a3b8', fontSize: '0.8rem' }}>Captured photos with physician notes, newest first. Notes are kept for this session.</p>
      </div>
      {snapshots.length === 0 && <p>No photos recorded yet. Capture or upload a photo to add a note.</p>}
      {[...snapshots].sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at)).map((snapshot) => (
        <article key={snapshot.id} style={{ background: '#1e293b', border: '1px solid #334155', borderRadius: 10, overflow: 'hidden' }}>
          <img
            src={snapshot.public_id && !snapshot.public_id.startsWith('samples/') ? getEnhancedImage(snapshot.public_id, { filter: 'raw', lowDataMode, privacy: snapshot.privacy }).toURL() : snapshot.dataUrl || snapshot.secure_url}
            alt="Recorded consultation photo"
            loading="lazy"
            onError={(event) => { event.currentTarget.hidden = true; }}
            style={{ width: '100%', maxHeight: 260, objectFit: 'contain', background: '#0f172a' }}
          />
          <div style={{ padding: 14 }}>
            <time dateTime={snapshot.created_at} style={{ fontSize: '0.8rem', color: '#94a3b8' }}>{new Date(snapshot.created_at).toLocaleString()}</time>
            <label style={{ display: 'grid', gap: 8, marginTop: 12, fontSize: '0.85rem' }}>
              Physician notes
              <textarea value={snapshot.physicianNotes || ''} onChange={(event) => onUpdateNotes(snapshot.id, event.target.value)} placeholder="Add physician notes for this photo..." rows={3} style={{ boxSizing: 'border-box', width: '100%', resize: 'vertical', padding: 10, borderRadius: 6, border: '1px solid #475569', background: '#0f172a', color: '#f1f5f9', font: 'inherit' }} />
            </label>
          </div>
        </article>
      ))}
    </section>
  );
}
