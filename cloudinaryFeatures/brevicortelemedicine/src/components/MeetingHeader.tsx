import { useState, useEffect } from 'react';

interface MeetingHeaderProps {
  onToggleSettings?: () => void;
  lowDataMode: boolean;
  onToggleLowDataMode: (enabled: boolean) => void;
  onOpenEquityModal: () => void;
  shelterSafetyActive: boolean;
}

export function MeetingHeader({
  onToggleSettings,
  lowDataMode,
  onToggleLowDataMode,
  onOpenEquityModal,
  shelterSafetyActive,
}: MeetingHeaderProps) {
  const [seconds, setSeconds] = useState(254); // starts at 4m 14s

  useEffect(() => {
    const timer = setInterval(() => {
      setSeconds((prev) => prev + 1);
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  const formatTime = (totalSeconds: number) => {
    const mins = Math.floor(totalSeconds / 60);
    const secs = totalSeconds % 60;
    return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  };

  return (
    <header
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '10px 20px',
        backgroundColor: '#0f172a',
        borderBottom: '1px solid #1e293b',
        color: '#f8fafc',
        flexWrap: 'wrap',
        gap: '10px',
      }}
    >
      {/* Brand & Call Status */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <div
            style={{
              width: '10px',
              height: '10px',
              borderRadius: '50%',
              backgroundColor: '#10b981',
              boxShadow: '0 0 8px #10b981',
            }}
          />
          <span style={{ fontWeight: 700, fontSize: '1.05rem', letterSpacing: '-0.02em', color: '#38bdf8' }}>
            Brevicor CareConnect
          </span>
        </div>

        {/* Security & Health Equity Badges */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <div
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '5px',
              backgroundColor: 'rgba(16, 185, 129, 0.12)',
              color: '#34d399',
              padding: '3px 8px',
              borderRadius: '9999px',
              fontSize: '0.72rem',
              fontWeight: 600,
              border: '1px solid rgba(16, 185, 129, 0.3)',
            }}
          >
            <span>🔒 PHIPA Verified</span>
            <span>•</span>
            <span>CA-Central-1</span>
          </div>

          {/* Shelter Safety Pill */}
          <button
            onClick={onOpenEquityModal}
            title="Click to view Vulnerable Populations & Shelter Safety Protections"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '4px',
              backgroundColor: shelterSafetyActive ? 'rgba(16, 185, 129, 0.2)' : 'rgba(56, 189, 248, 0.15)',
              color: shelterSafetyActive ? '#34d399' : '#38bdf8',
              padding: '3px 8px',
              borderRadius: '9999px',
              fontSize: '0.72rem',
              fontWeight: 600,
              border: shelterSafetyActive ? '1px solid #10b981' : '1px solid rgba(56, 189, 248, 0.4)',
              cursor: 'pointer',
            }}
          >
            <span>🛡️ {shelterSafetyActive ? 'Shelter Protection Active' : 'Shelter & Equity Shield'}</span>
          </button>
        </div>

        {/* Timer */}
        <div
          style={{
            fontFamily: 'monospace',
            backgroundColor: '#1e293b',
            color: '#e2e8f0',
            padding: '3px 8px',
            borderRadius: '5px',
            fontSize: '0.8rem',
            fontWeight: 600,
          }}
        >
          ⏱️ {formatTime(seconds)}
        </div>
      </div>

      {/* Low Data Mode Toggle & Provider Info */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
        {/* Low Data Mode Toggle (Rural & Prepaid Mobile Equity) */}
        <button
          onClick={() => onToggleLowDataMode(!lowDataMode)}
          title="Auto-compresses media (q_auto:eco) to save data on rural 3G or prepaid phone plans"
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
            backgroundColor: lowDataMode ? '#065f46' : '#1e293b',
            color: lowDataMode ? '#34d399' : '#cbd5e1',
            border: lowDataMode ? '1px solid #10b981' : '1px solid #334155',
            borderRadius: '6px',
            padding: '4px 10px',
            fontSize: '0.75rem',
            fontWeight: 600,
            cursor: 'pointer',
            transition: 'all 0.2s',
          }}
        >
          <span>📶 Low-Data Mode:</span>
          <span style={{ fontWeight: 700, color: lowDataMode ? '#34d399' : '#94a3b8' }}>
            {lowDataMode ? 'ON' : 'OFF'}
          </span>
        </button>

        {/* Patient / Provider Info */}
        <div style={{ textAlign: 'right' }}>
          <div style={{ fontSize: '0.82rem', fontWeight: 600, color: '#f1f5f9' }}>
            Sarah Jenkins (34F)
          </div>
          <div style={{ fontSize: '0.7rem', color: '#94a3b8' }}>
            OHIP: 4829-192-384 • Dr. A. Mercer
          </div>
        </div>

        {onToggleSettings && (
          <button
            onClick={onToggleSettings}
            title="Cloudinary API & Preset Settings"
            style={{
              background: '#1e293b',
              border: '1px solid #334155',
              color: '#cbd5e1',
              borderRadius: '6px',
              padding: '4px 8px',
              fontSize: '0.75rem',
              cursor: 'pointer',
            }}
          >
            ⚙️
          </button>
        )}
      </div>
    </header>
  );
}
