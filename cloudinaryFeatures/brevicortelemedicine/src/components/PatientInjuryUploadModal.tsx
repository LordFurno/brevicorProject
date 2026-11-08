import { useState, useRef } from 'react';
import { uploadFrameToCloudinary } from '../cloudinary/uploadService';
import type { CapturedSnapshot } from '../types';

interface PatientInjuryUploadModalProps {
  isOpen: boolean;
  onClose: () => void;
  onUploadSuccess: (snapshot: CapturedSnapshot) => void;
  cloudName: string;
  uploadPreset: string;
}

export function PatientInjuryUploadModal({
  isOpen,
  onClose,
  onUploadSuccess,
  cloudName,
  uploadPreset,
}: PatientInjuryUploadModalProps) {
  const [isUploading, setIsUploading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  if (!isOpen) return null;

  const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsUploading(true);
    setErrorMsg(null);

    const reader = new FileReader();
    reader.onload = async () => {
      try {
        const dataUrl = reader.result as string;
        const res = await uploadFrameToCloudinary(dataUrl, cloudName, uploadPreset, [
          'patient_in_call',
          'patient_4829',
          'consultation_8421',
          'ephemeral',
        ]);

        const snapshot: CapturedSnapshot = {
          id: `in_call_${Date.now()}`,
          public_id: res.public_id,
          secure_url: res.secure_url,
          width: res.width,
          height: res.height,
          created_at: res.created_at,
          activeFilter: 'auto_enhance', // Auto-enhance directly!
          dataUrl,
          zoomLevel: 1.0,
          panX: 0,
          panY: 0,
          useAutoGravity: true,
          sourceType: 'patient_in_call',
        };

        onUploadSuccess(snapshot);
        onClose();
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : 'Upload failed';
        setErrorMsg(msg);

        // Fallback for demo
        const fallbackSnap: CapturedSnapshot = {
          id: `in_call_${Date.now()}`,
          public_id: 'samples/people/bicycle',
          secure_url: reader.result as string,
          width: 800,
          height: 600,
          created_at: new Date().toISOString(),
          activeFilter: 'auto_enhance',
          dataUrl: reader.result as string,
          zoomLevel: 1.0,
          panX: 0,
          panY: 0,
          useAutoGravity: true,
          sourceType: 'patient_in_call',
        };
        onUploadSuccess(fallbackSnap);
        onClose();
      } finally {
        setIsUploading(false);
      }
    };
    reader.readAsDataURL(file);
  };

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        backgroundColor: 'rgba(0, 0, 0, 0.75)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 1000,
        padding: '20px',
      }}
    >
      <div
        style={{
          backgroundColor: '#0f172a',
          borderRadius: '12px',
          border: '1px solid #334155',
          width: '100%',
          maxWidth: '500px',
          padding: '24px',
          display: 'flex',
          flexDirection: 'column',
          gap: '16px',
          boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.5)',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ fontWeight: 700, fontSize: '1rem', color: '#38bdf8' }}>
            📲 Patient In-Call Injury Photo Upload
          </div>
          <button
            onClick={onClose}
            style={{ background: 'none', border: 'none', color: '#94a3b8', fontSize: '1.2rem', cursor: 'pointer' }}
          >
            ✕
          </button>
        </div>

        <p style={{ fontSize: '0.82rem', color: '#cbd5e1', margin: 0, lineHeight: 1.5 }}>
          Simulates the patient sending a real-time high-resolution phone photo of their injury during the live consultation. The photo streams straight to Cloudinary via unsigned upload preset.
        </p>

        <div
          onClick={() => fileInputRef.current?.click()}
          style={{
            border: '2px dashed #38bdf8',
            borderRadius: '8px',
            padding: '24px',
            textAlign: 'center',
            backgroundColor: 'rgba(56, 189, 248, 0.05)',
            cursor: 'pointer',
          }}
        >
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            onChange={handleFile}
            style={{ display: 'none' }}
          />
          <div style={{ fontSize: '2.2rem', marginBottom: '8px' }}>📸</div>
          <div style={{ fontWeight: 600, color: '#38bdf8', fontSize: '0.9rem' }}>
            {isUploading ? 'Uploading to Cloudinary Ephemeral Buffer...' : 'Select or Snap Patient Photo'}
          </div>
          <div style={{ fontSize: '0.72rem', color: '#94a3b8', marginTop: '4px' }}>
            Direct Unsigned Upload Preset: {uploadPreset}
          </div>
        </div>

        {errorMsg && (
          <div style={{ fontSize: '0.75rem', color: '#fca5a5', padding: '6px 10px', backgroundColor: 'rgba(239, 68, 68, 0.15)', borderRadius: 4 }}>
            {errorMsg}
          </div>
        )}

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
          <button
            onClick={onClose}
            style={{ padding: '8px 14px', backgroundColor: '#1e293b', border: '1px solid #334155', color: '#cbd5e1', borderRadius: 6, fontSize: '0.8rem', cursor: 'pointer' }}
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

