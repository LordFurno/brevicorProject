import { useState, useRef } from 'react';
import { uploadFrameToCloudinary } from '../cloudinary/uploadService';
import type { PreVisitPhoto } from '../types';

interface PatientWaitingRoomProps {
  onJoinCall: () => void;
  preVisitPhotos: PreVisitPhoto[];
  onAddPreVisitPhoto: (photo: PreVisitPhoto) => void;
  cloudName: string;
  uploadPreset: string;
}

export function PatientWaitingRoom({
  onJoinCall,
  preVisitPhotos,
  onAddPreVisitPhoto,
  cloudName,
  uploadPreset,
}: PatientWaitingRoomProps) {
  const [isUploading, setIsUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [photoTitle, setPhotoTitle] = useState('Injury Close-up');
  const [patientNotes, setPatientNotes] = useState('Redness and swelling increased over the last 48 hours.');
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Handle file select (supports mobile camera or photo upload)
  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsUploading(true);
    setUploadError(null);

    try {
      const reader = new FileReader();
      reader.onload = async () => {
        try {
          const dataUrl = reader.result as string;
          const res = await uploadFrameToCloudinary(dataUrl, cloudName, uploadPreset, [
            'pre_visit_upload',
            'patient_4829',
            'intake_packet',
            'ephemeral',
          ]);

          const newPhoto: PreVisitPhoto = {
            id: `pre_${Date.now()}`,
            public_id: res.public_id,
            secure_url: res.secure_url,
            uploaded_at: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
            title: photoTitle || 'Pre-visit Injury Photo',
            category: 'Dermatology / Wound Intake',
            notes: patientNotes,
          };

          onAddPreVisitPhoto(newPhoto);
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : 'Upload failed';
          setUploadError(msg);
          // Fallback sample for demo if offline or unconfigured preset
          const fallbackPhoto: PreVisitPhoto = {
            id: `pre_${Date.now()}`,
            public_id: 'samples/people/bicycle',
            secure_url: 'https://images.unsplash.com/photo-1584515979956-d9f6e5d09982?auto=format&fit=crop&w=600&q=80',
            uploaded_at: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
            title: photoTitle || 'Pre-visit Injury Photo',
            category: 'Dermatology / Wound Intake',
            notes: patientNotes,
          };
          onAddPreVisitPhoto(fallbackPhoto);
        } finally {
          setIsUploading(false);
          if (fileInputRef.current) fileInputRef.current.value = '';
        }
      };
      reader.readAsDataURL(file);
    } catch {
      setIsUploading(false);
      setUploadError('Failed to process image file.');
    }
  };

  // Add demo quick sample
  const handleAddDemoPhoto = () => {
    const demoPhoto: PreVisitPhoto = {
      id: `pre_${Date.now()}`,
      public_id: 'samples/landscapes/beach-boat',
      secure_url: 'https://images.unsplash.com/photo-1584515979956-d9f6e5d09982?auto=format&fit=crop&w=600&q=80',
      uploaded_at: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      title: 'Right Forearm Rash (Day 3)',
      category: 'Pre-Visit Intake',
      notes: 'Mild burning sensation, demarcated erythema.',
    };
    onAddPreVisitPhoto(demoPhoto);
  };

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100vh',
        backgroundColor: '#020617',
        color: '#f8fafc',
        fontFamily: 'system-ui, -apple-system, sans-serif',
      }}
    >
      {/* Waiting Room Header */}
      <header
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '16px 28px',
          backgroundColor: '#0f172a',
          borderBottom: '1px solid #1e293b',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <div style={{ width: 10, height: 10, borderRadius: '50%', backgroundColor: '#10b981', boxShadow: '0 0 8px #10b981' }} />
          <span style={{ fontWeight: 700, fontSize: '1.1rem', color: '#38bdf8' }}>
            Brevicor Patient Portal
          </span>
          <span style={{ fontSize: '0.8rem', color: '#94a3b8' }}>• Virtual Waiting Room</span>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
          <div style={{ fontSize: '0.85rem', color: '#cbd5e1' }}>
            Patient: <strong>Sarah Jenkins</strong> (OHIP: 4829-192-384)
          </div>
          <button
            onClick={onJoinCall}
            style={{
              padding: '8px 18px',
              backgroundColor: '#059669',
              color: '#fff',
              border: 'none',
              borderRadius: '6px',
              fontWeight: 600,
              fontSize: '0.85rem',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
            }}
          >
            <span>👨‍⚕️ Switch to Physician View</span>
          </button>
        </div>
      </header>

      {/* Main Content */}
      <div
        style={{
          flex: 1,
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'center',
          padding: '24px',
          overflowY: 'auto',
        }}
      >
        <div
          style={{
            width: '100%',
            maxWidth: '720px',
            backgroundColor: '#0f172a',
            borderRadius: '12px',
            border: '1px solid #1e293b',
            boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.5)',
            padding: '28px',
            display: 'flex',
            flexDirection: 'column',
            gap: '20px',
          }}
        >
          {/* Waiting Status Card */}
          <div
            style={{
              backgroundColor: '#1e293b',
              borderRadius: '8px',
              padding: '16px',
              borderLeft: '4px solid #38bdf8',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
            }}
          >
            <div>
              <div style={{ fontWeight: 700, color: '#f1f5f9', fontSize: '0.95rem' }}>
                You are checked in for your appointment
              </div>
              <div style={{ fontSize: '0.8rem', color: '#94a3b8', marginTop: '2px' }}>
                Physician: Dr. Andrea Mercer, MD • Dermatology Consult
              </div>
            </div>
            <div
              style={{
                backgroundColor: 'rgba(56, 189, 248, 0.15)',
                color: '#38bdf8',
                padding: '4px 10px',
                borderRadius: '9999px',
                fontSize: '0.75rem',
                fontWeight: 600,
              }}
            >
              Estimated wait: &lt; 2 mins
            </div>
          </div>

          {/* Pre-Visit Upload Section */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            <div>
              <div style={{ fontWeight: 700, fontSize: '1.05rem', color: '#f8fafc' }}>
                📸 Pre-Visit Photo Upload
              </div>
              <p style={{ fontSize: '0.82rem', color: '#94a3b8', margin: '4px 0 0 0', lineHeight: 1.5 }}>
                Please take or upload clear photos of your wound, injury, or skin rash. Cloudinary will auto-enhance lighting and contrast so Dr. Mercer can examine it in the pre-visit intake summary.
              </p>
            </div>

            {/* Inputs */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
              <div>
                <label style={{ display: 'block', fontSize: '0.75rem', color: '#cbd5e1', marginBottom: '4px' }}>
                  Photo Description:
                </label>
                <input
                  type="text"
                  value={photoTitle}
                  onChange={(e) => setPhotoTitle(e.target.value)}
                  placeholder="e.g. Forearm burn, rash close-up"
                  style={{
                    width: '100%',
                    padding: '8px 10px',
                    backgroundColor: '#020617',
                    border: '1px solid #334155',
                    borderRadius: '6px',
                    color: '#fff',
                    fontSize: '0.8rem',
                  }}
                />
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '0.75rem', color: '#cbd5e1', marginBottom: '4px' }}>
                  Symptoms / Notes for Doctor:
                </label>
                <input
                  type="text"
                  value={patientNotes}
                  onChange={(e) => setPatientNotes(e.target.value)}
                  placeholder="e.g. Started 2 days ago"
                  style={{
                    width: '100%',
                    padding: '8px 10px',
                    backgroundColor: '#020617',
                    border: '1px solid #334155',
                    borderRadius: '6px',
                    color: '#fff',
                    fontSize: '0.8rem',
                  }}
                />
              </div>
            </div>

            {/* Dropzone Box */}
            <div
              onClick={() => fileInputRef.current?.click()}
              style={{
                border: '2px dashed #38bdf8',
                borderRadius: '8px',
                padding: '24px',
                textAlign: 'center',
                backgroundColor: 'rgba(56, 189, 248, 0.05)',
                cursor: 'pointer',
                transition: 'all 0.2s',
              }}
            >
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                onChange={handleFileChange}
                style={{ display: 'none' }}
              />
              <div style={{ fontSize: '2rem', marginBottom: '6px' }}>📷</div>
              <div style={{ fontWeight: 600, color: '#38bdf8', fontSize: '0.9rem' }}>
                {isUploading ? 'Uploading to Cloudinary...' : 'Click to Upload Injury Photo or Take Camera Snap'}
              </div>
              <div style={{ fontSize: '0.75rem', color: '#94a3b8', marginTop: '4px' }}>
                Direct unsigned upload • JPEG, PNG, HEIC up to 15MB
              </div>
            </div>

            {/* Upload Error Banner */}
            {uploadError && (
              <div style={{ padding: '8px 12px', backgroundColor: 'rgba(239, 68, 68, 0.2)', border: '1px solid #ef4444', borderRadius: '6px', color: '#fca5a5', fontSize: '0.75rem' }}>
                {uploadError} (Fallback sample image loaded for testing)
              </div>
            )}

            {/* Demo quick sample helper */}
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
              <button
                type="button"
                onClick={handleAddDemoPhoto}
                style={{
                  background: 'none',
                  border: '1px solid #334155',
                  color: '#94a3b8',
                  padding: '4px 10px',
                  borderRadius: '4px',
                  fontSize: '0.72rem',
                  cursor: 'pointer',
                }}
              >
                + Add Pre-Visit Sample Demo Photo
              </button>
            </div>

            {/* Uploaded Photos Gallery */}
            {preVisitPhotos.length > 0 && (
              <div style={{ marginTop: '10px' }}>
                <div style={{ fontSize: '0.8rem', fontWeight: 700, color: '#cbd5e1', marginBottom: '8px' }}>
                  ATTACHED INTAKE PHOTOS ({preVisitPhotos.length}):
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: '10px' }}>
                  {preVisitPhotos.map((photo) => (
                    <div
                      key={photo.id}
                      style={{
                        backgroundColor: '#1e293b',
                        borderRadius: '6px',
                        overflow: 'hidden',
                        border: '1px solid #334155',
                      }}
                    >
                      <img
                        src={photo.secure_url}
                        alt={photo.title}
                        style={{ width: '100%', height: '110px', objectFit: 'cover', display: 'block' }}
                      />
                      <div style={{ padding: '8px' }}>
                        <div style={{ fontWeight: 600, fontSize: '0.75rem', color: '#f1f5f9' }}>
                          {photo.title}
                        </div>
                        <div style={{ fontSize: '0.68rem', color: '#38bdf8', marginTop: '2px' }}>
                          Uploaded at {photo.uploaded_at}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Action to enter consultation */}
          <div style={{ display: 'flex', justifyContent: 'center', paddingTop: '10px', borderTop: '1px solid #1e293b' }}>
            <button
              onClick={onJoinCall}
              style={{
                padding: '12px 32px',
                backgroundColor: '#2563eb',
                backgroundImage: 'linear-gradient(135deg, #2563eb 0%, #0284c7 100%)',
                color: '#fff',
                border: 'none',
                borderRadius: '8px',
                fontWeight: 700,
                fontSize: '0.95rem',
                cursor: 'pointer',
                boxShadow: '0 4px 12px rgba(37, 99, 235, 0.4)',
              }}
            >
              Start Physician Consultation ➔
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

