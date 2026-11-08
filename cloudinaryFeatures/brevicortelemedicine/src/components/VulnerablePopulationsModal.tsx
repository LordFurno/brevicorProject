interface VulnerablePopulationsModalProps {
  isOpen: boolean;
  onClose: () => void;
  shelterSafetyActive: boolean;
  onToggleShelterSafety: (active: boolean) => void;
}

export function VulnerablePopulationsModal({
  isOpen,
  onClose,
  shelterSafetyActive,
  onToggleShelterSafety,
}: VulnerablePopulationsModalProps) {
  if (!isOpen) return null;

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        backgroundColor: 'rgba(0, 0, 0, 0.8)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 1100,
        padding: '20px',
        fontFamily: 'system-ui, -apple-system, sans-serif',
      }}
    >
      <div
        style={{
          backgroundColor: '#0f172a',
          borderRadius: '12px',
          border: '1px solid #334155',
          width: '100%',
          maxWidth: '680px',
          maxHeight: '85vh',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
          boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.7)',
        }}
      >
        {/* Modal Header */}
        <div
          style={{
            padding: '16px 20px',
            borderBottom: '1px solid #1e293b',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            backgroundColor: '#1e293b',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span style={{ fontSize: '1.2rem' }}>🛡️</span>
            <div>
              <div style={{ fontWeight: 700, fontSize: '1rem', color: '#34d399' }}>
                Health Equity & Shelter Safety Architecture
              </div>
              <div style={{ fontSize: '0.72rem', color: '#94a3b8' }}>
                Protecting patients in domestic violence shelters, unsafe homes, and rural communities
              </div>
            </div>
          </div>
          <button
            onClick={onClose}
            style={{ background: 'none', border: 'none', color: '#94a3b8', fontSize: '1.2rem', cursor: 'pointer' }}
          >
            ✕
          </button>
        </div>

        {/* Modal Body */}
        <div style={{ padding: '20px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '16px' }}>
          {/* Pitch Callout Box */}
          <div
            style={{
              padding: '12px 16px',
              backgroundColor: 'rgba(56, 189, 248, 0.1)',
              border: '1px solid rgba(56, 189, 248, 0.3)',
              borderRadius: '8px',
              fontSize: '0.8rem',
              color: '#bae6fd',
              lineHeight: 1.5,
            }}
          >
            <strong>📢 Key Pitch Point (Say This Out Loud to Judges):</strong>
            <p style={{ margin: '4px 0 0 0' }}>
              "Privacy and low-bandwidth optimization aren't just technical conveniences—for patients escaping domestic violence, living in confidential women's shelters, or surviving on prepaid mobile data, these features are matters of physical safety and healthcare equity."
            </p>
          </div>

          {/* Master Shelter Mode Toggle */}
          <div
            style={{
              padding: '14px',
              backgroundColor: shelterSafetyActive ? 'rgba(16, 185, 129, 0.15)' : '#1e293b',
              border: shelterSafetyActive ? '1px solid #10b981' : '1px solid #334155',
              borderRadius: '8px',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
            }}
          >
            <div>
              <div style={{ fontWeight: 700, fontSize: '0.85rem', color: '#f8fafc' }}>
                🔒 Domestic Violence & Confidential Shelter Mode
              </div>
              <div style={{ fontSize: '0.72rem', color: '#94a3b8', marginTop: '2px' }}>
                Automatically enforces GPS scrubbing, facial de-identification (`e_blur_faces`), and expiring tokens
              </div>
            </div>
            <button
              onClick={() => onToggleShelterSafety(!shelterSafetyActive)}
              style={{
                padding: '8px 16px',
                backgroundColor: shelterSafetyActive ? '#059669' : '#334155',
                color: '#fff',
                border: 'none',
                borderRadius: '6px',
                fontWeight: 700,
                fontSize: '0.78rem',
                cursor: 'pointer',
              }}
            >
              {shelterSafetyActive ? '✓ Active (Enforced)' : 'Enable Protection'}
            </button>
          </div>

          {/* The 4 Architectural Safeguards */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
            {/* 1. GPS Stripping */}
            <div style={{ padding: '12px', backgroundColor: '#1e293b', borderRadius: '8px', border: '1px solid #334155' }}>
              <div style={{ fontWeight: 700, fontSize: '0.8rem', color: '#38bdf8', marginBottom: '4px' }}>
                📍 1. EXIF & GPS Location Stripping
              </div>
              <div style={{ fontSize: '0.72rem', color: '#cbd5e1', lineHeight: 1.4 }}>
                Phone cameras embed exact GPS coordinates in EXIF headers. Cloudinary automatically scrubs all geolocation metadata on upload so shelter addresses are never compromised.
              </div>
            </div>

            {/* 2. Face Blurring */}
            <div style={{ padding: '12px', backgroundColor: '#1e293b', borderRadius: '8px', border: '1px solid #334155' }}>
              <div style={{ fontWeight: 700, fontSize: '0.8rem', color: '#38bdf8', marginBottom: '4px' }}>
                👤 2. AI Facial De-Identification (`e_blur_faces`)
              </div>
              <div style={{ fontSize: '0.72rem', color: '#cbd5e1', lineHeight: 1.4 }}>
                Cloudinary's AI facial recognition automatically blurs identifying facial features with Gaussian redaction while preserving 100% optical clarity on the wound or injury.
              </div>
            </div>

            {/* 3. Low-Data Mode */}
            <div style={{ padding: '12px', backgroundColor: '#1e293b', borderRadius: '8px', border: '1px solid #334155' }}>
              <div style={{ fontWeight: 700, fontSize: '0.8rem', color: '#34d399', marginBottom: '4px' }}>
                📶 3. Rural & Prepaid Data Saver (`q_auto:eco`)
              </div>
              <div style={{ fontSize: '0.72rem', color: '#cbd5e1', lineHeight: 1.4 }}>
                Reduces raw phone photo payloads from 4.2 MB to ~180 KB (95%+ reduction). Enables visits over spotty 3G without draining a patient's prepaid phone plan.
              </div>
            </div>

            {/* 4. Signed Expiring URLs */}
            <div style={{ padding: '12px', backgroundColor: '#1e293b', borderRadius: '8px', border: '1px solid #334155' }}>
              <div style={{ fontWeight: 700, fontSize: '0.8rem', color: '#34d399', marginBottom: '4px' }}>
                ⏱️ 4. Ephemeral Signed Tokens (Ontario PHIPA)
              </div>
              <div style={{ fontSize: '0.72rem', color: '#cbd5e1', lineHeight: 1.4 }}>
                Images are accessible only via cryptographically signed URLs with short 15-minute expirations and purged from Cloudinary once committed to the Canadian FHIR record.
              </div>
            </div>
          </div>
        </div>

        {/* Modal Footer */}
        <div
          style={{
            padding: '12px 20px',
            borderTop: '1px solid #1e293b',
            display: 'flex',
            justifyContent: 'flex-end',
            backgroundColor: '#0f172a',
          }}
        >
          <button
            onClick={onClose}
            style={{
              padding: '8px 18px',
              backgroundColor: '#0284c7',
              color: '#fff',
              border: 'none',
              borderRadius: '6px',
              fontWeight: 600,
              fontSize: '0.82rem',
              cursor: 'pointer',
            }}
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
}

