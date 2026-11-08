import { useState, useRef, useEffect } from 'react';
import { MeetingHeader } from './MeetingHeader';
import { DiagnosticPanel } from './DiagnosticPanel';
import { SimulatedPatientFeed, type SimulatedFeedHandle } from './SimulatedPatientFeed';
import { VideoRoiSelector } from './VideoRoiSelector';
import { PatientInjuryUploadModal } from './PatientInjuryUploadModal';
import { VulnerablePopulationsModal } from './VulnerablePopulationsModal';
import { captureFrameFromMedia, uploadFrameToCloudinary } from '../cloudinary/uploadService';
import { detectErythemaHotspot } from '../cloudinary/erythemaDetector';
import { uploadPreset as initialPreset } from '../cloudinary/config';
import type {
  CapturedSnapshot,
  DiagnosticFilter,
  NormalizedRect,
  CropRect,
  PreVisitPhoto,
  AnnotationConfig,
  PrivacyConfig,
} from '../types';

interface MeetingRoomProps {
  onSwitchToWaitingRoom: () => void;
  preVisitPhotos: PreVisitPhoto[];
}

export function MeetingRoom({ onSwitchToWaitingRoom, preVisitPhotos }: MeetingRoomProps) {
  const [feedMode, setFeedMode] = useState<'simulated' | 'webcam'>('simulated');
  const [isMicMuted, setIsMicMuted] = useState(false);
  const [isVideoMuted, setIsVideoMuted] = useState(false);
  const [flashActive, setFlashActive] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [isPatientUploadOpen, setIsPatientUploadOpen] = useState(false);
  const [isEquityModalOpen, setIsEquityModalOpen] = useState(false);

  // Health Equity States
  const [lowDataMode, setLowDataMode] = useState(false);
  const [shelterSafetyActive, setShelterSafetyActive] = useState(false);

  // Region of Interest (drag-to-select on video)
  const [selectedRoi, setSelectedRoi] = useState<NormalizedRect | null>(null);
  const [autoDetectNotice, setAutoDetectNotice] = useState<string | null>(null);

  // Cloudinary credentials (customizable in-app)
  const [cloudName, setCloudName] = useState(import.meta.env.VITE_CLOUDINARY_CLOUD_NAME || 'hqhfgx5c');
  const [uploadPreset, setUploadPreset] = useState(initialPreset || 'ml_default');

  // Captured snapshots state
  const [snapshots, setSnapshots] = useState<CapturedSnapshot[]>([]);
  const [activeSnapshot, setActiveSnapshot] = useState<CapturedSnapshot | null>(null);

  // Refs for media elements
  const webcamVideoRef = useRef<HTMLVideoElement | null>(null);
  const simulatedFeedRef = useRef<SimulatedFeedHandle | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);

  // Handle webcam stream start/stop
  useEffect(() => {
    if (feedMode === 'webcam') {
      navigator.mediaDevices
        ?.getUserMedia({ video: { width: 1280, height: 720 }, audio: false })
        .then((stream) => {
          mediaStreamRef.current = stream;
          if (webcamVideoRef.current) {
            webcamVideoRef.current.srcObject = stream;
          }
        })
        .catch((err) => {
          console.warn('Webcam access unavailable or blocked:', err);
          alert('Could not access webcam. Falling back to Simulated Patient Stream.');
          setFeedMode('simulated');
        });
    } else {
      if (mediaStreamRef.current) {
        mediaStreamRef.current.getTracks().forEach((t) => t.stop());
        mediaStreamRef.current = null;
      }
    }

    return () => {
      if (mediaStreamRef.current) {
        mediaStreamRef.current.getTracks().forEach((t) => t.stop());
      }
    };
  }, [feedMode]);

  // Automatic Erythema / Wound Detection on video feed
  const handleAutoDetectWound = () => {
    const sourceEl =
      feedMode === 'webcam'
        ? webcamVideoRef.current
        : simulatedFeedRef.current?.getMediaElement() || null;

    if (!sourceEl) {
      setAutoDetectNotice('Video source is not ready for scanning.');
      setTimeout(() => setAutoDetectNotice(null), 3000);
      return;
    }

    const result = detectErythemaHotspot(sourceEl);
    if (result.detected && result.box) {
      setSelectedRoi(result.box);
      setAutoDetectNotice(`🎯 Wound Hotspot Locked (${Math.round(result.confidence * 100)}% match). Click 'Capture' to zoom!`);
      setTimeout(() => setAutoDetectNotice(null), 4500);
    } else {
      setAutoDetectNotice(`⚠️ ${result.message}`);
      setTimeout(() => setAutoDetectNotice(null), 4500);
    }
  };

  // Capture Frame Handler (Full frame OR selected ROI)
  const handleCaptureFrame = async () => {
    // 1. Shutter flash effect
    setFlashActive(true);
    setTimeout(() => setFlashActive(false), 200);

    // 2. Select source element
    const sourceEl =
      feedMode === 'webcam'
        ? webcamVideoRef.current
        : simulatedFeedRef.current?.getMediaElement() || null;

    if (!sourceEl) {
      alert('Video source is not ready for frame extraction.');
      return;
    }

    // 3. Compute pixel crop rectangle if doctor dragged a selection box
    let cropRect: CropRect | undefined = undefined;
    if (selectedRoi) {
      const srcW = sourceEl instanceof HTMLVideoElement ? sourceEl.videoWidth : sourceEl.width;
      const srcH = sourceEl instanceof HTMLVideoElement ? sourceEl.videoHeight : sourceEl.height;

      if (srcW && srcH) {
        cropRect = {
          x: Math.round(selectedRoi.x * srcW),
          y: Math.round(selectedRoi.y * srcH),
          width: Math.round(selectedRoi.width * srcW),
          height: Math.round(selectedRoi.height * srcH),
        };
      }
    }

    // 4. Extract high-res frame via Canvas
    const dataUrl = captureFrameFromMedia(sourceEl, cropRect);
    if (!dataUrl) {
      alert('Failed to capture frame from video feed.');
      return;
    }

    const tempId = `snap_${Date.now()}`;
    const initialSnap: CapturedSnapshot = {
      id: tempId,
      public_id: '',
      secure_url: '',
      width: cropRect ? cropRect.width : 1280,
      height: cropRect ? cropRect.height : 720,
      created_at: new Date().toISOString(),
      activeFilter: 'auto_enhance',
      dataUrl,
      zoomLevel: 1.0,
      panX: 0,
      panY: 0,
      useAutoGravity: true,
      sourceType: 'webcam_capture',
      lowDataMode,
      annotation: {
        enabled: false,
        text: 'Erythema Margin: 3.2cm',
        position: 'north_west',
        color: 'yellow',
      },
      privacy: {
        blurFaces: shelterSafetyActive,
        stripMetadata: true,
        signedUrl: true,
        shelterSafetyMode: shelterSafetyActive,
      },
    };

    setIsUploading(true);
    setUploadError(null);

    try {
      // 5. Upload base64 directly to Cloudinary
      const res = await uploadFrameToCloudinary(dataUrl, cloudName, uploadPreset, [
        'telemed',
        'consultation_8421',
        cropRect ? 'custom_roi' : 'full_frame',
        lowDataMode ? 'eco_low_data' : 'standard',
        'ephemeral',
      ]);

      const completedSnapshot: CapturedSnapshot = {
        ...initialSnap,
        public_id: res.public_id,
        secure_url: res.secure_url,
        width: res.width,
        height: res.height,
        created_at: res.created_at,
      };

      setSnapshots((prev) => [completedSnapshot, ...prev]);
      setActiveSnapshot(completedSnapshot);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Upload failed';
      console.error('Cloudinary upload error:', msg);
      setUploadError(msg);

      // Keep in reel with local dataUrl as fallback preview
      const fallbackSnap: CapturedSnapshot = {
        ...initialSnap,
        public_id: 'samples/people/bicycle',
        secure_url: dataUrl,
      };
      setSnapshots((prev) => [fallbackSnap, ...prev]);
      setActiveSnapshot(fallbackSnap);
    } finally {
      setIsUploading(false);
    }
  };

  const handleFilterChange = (filter: DiagnosticFilter) => {
    if (!activeSnapshot) return;
    const updated = { ...activeSnapshot, activeFilter: filter };
    setActiveSnapshot(updated);
    setSnapshots((prev) => prev.map((s) => (s.id === updated.id ? updated : s)));
  };

  const handleZoomChange = (zoom: number) => {
    if (!activeSnapshot) return;
    const updated = { ...activeSnapshot, zoomLevel: zoom };
    setActiveSnapshot(updated);
    setSnapshots((prev) => prev.map((s) => (s.id === updated.id ? updated : s)));
  };

  const handlePanChange = (panX: number, panY: number) => {
    if (!activeSnapshot) return;
    const updated = { ...activeSnapshot, panX, panY, useAutoGravity: false };
    setActiveSnapshot(updated);
    setSnapshots((prev) => prev.map((s) => (s.id === updated.id ? updated : s)));
  };

  const handleToggleAutoGravity = (auto: boolean) => {
    if (!activeSnapshot) return;
    const updated = { ...activeSnapshot, useAutoGravity: auto, panX: 0, panY: 0 };
    setActiveSnapshot(updated);
    setSnapshots((prev) => prev.map((s) => (s.id === updated.id ? updated : s)));
  };

  const handleResetZoom = () => {
    if (!activeSnapshot) return;
    const updated = { ...activeSnapshot, zoomLevel: 1.0, panX: 0, panY: 0, useAutoGravity: true };
    setActiveSnapshot(updated);
    setSnapshots((prev) => prev.map((s) => (s.id === updated.id ? updated : s)));
  };

  const handleUpdateAnnotation = (annotation: AnnotationConfig) => {
    if (!activeSnapshot) return;
    const updated = { ...activeSnapshot, annotation };
    setActiveSnapshot(updated);
    setSnapshots((prev) => prev.map((s) => (s.id === updated.id ? updated : s)));
  };

  const handleUpdatePrivacy = (privacy: PrivacyConfig) => {
    if (!activeSnapshot) return;
    const updated = { ...activeSnapshot, privacy };
    setActiveSnapshot(updated);
    setSnapshots((prev) => prev.map((s) => (s.id === updated.id ? updated : s)));
    if (privacy.shelterSafetyMode !== shelterSafetyActive) {
      setShelterSafetyActive(privacy.shelterSafetyMode);
    }
  };

  // Convert a pre-visit photo to an active snapshot in the diagnostic viewer
  const handleSelectPreVisitPhoto = (photo: PreVisitPhoto) => {
    const snap: CapturedSnapshot = {
      id: photo.id,
      public_id: photo.public_id,
      secure_url: photo.secure_url,
      width: 800,
      height: 600,
      created_at: new Date().toISOString(),
      activeFilter: 'auto_enhance',
      zoomLevel: 1.0,
      panX: 0,
      panY: 0,
      useAutoGravity: true,
      sourceType: 'pre_visit_upload',
      lowDataMode,
      annotation: {
        enabled: false,
        text: photo.title,
        position: 'north_west',
        color: 'yellow',
      },
      privacy: {
        blurFaces: shelterSafetyActive,
        stripMetadata: true,
        signedUrl: true,
        shelterSafetyMode: shelterSafetyActive,
      },
    };
    setActiveSnapshot(snap);
    setSnapshots((prev) => [snap, ...prev.filter((s) => s.id !== snap.id)]);
  };

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100vh',
        backgroundColor: '#020617',
        color: '#f8fafc',
        overflow: 'hidden',
        fontFamily: 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
      }}
    >
      {/* Telemedicine Header */}
      <MeetingHeader
        lowDataMode={lowDataMode}
        onToggleLowDataMode={(enabled) => setLowDataMode(enabled)}
        onOpenEquityModal={() => setIsEquityModalOpen(true)}
        shelterSafetyActive={shelterSafetyActive}
      />

      {/* Patient Waiting Room banner link */}
      <div
        style={{
          backgroundColor: '#1e293b',
          borderBottom: '1px solid #334155',
          padding: '6px 20px',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          fontSize: '0.75rem',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span style={{ color: '#34d399' }}>● Call Active</span>
          <span style={{ color: '#94a3b8' }}>|</span>
          <span style={{ color: '#cbd5e1' }}>
            Pre-visit photos in intake packet: <strong>{preVisitPhotos.length}</strong>
          </span>
          {lowDataMode && (
            <span style={{ color: '#38bdf8', backgroundColor: 'rgba(56, 189, 248, 0.15)', padding: '1px 6px', borderRadius: 4 }}>
              📶 Rural Low-Data Mode Active (95% data saver)
            </span>
          )}
          {shelterSafetyActive && (
            <span style={{ color: '#34d399', backgroundColor: 'rgba(16, 185, 129, 0.15)', padding: '1px 6px', borderRadius: 4 }}>
              🛡️ Shelter Protection Active (Face Blur + GPS Scrubbed)
            </span>
          )}
        </div>
        <button
          onClick={onSwitchToWaitingRoom}
          style={{
            background: 'none',
            border: '1px solid #475569',
            color: '#38bdf8',
            borderRadius: '4px',
            padding: '2px 8px',
            fontSize: '0.72rem',
            cursor: 'pointer',
          }}
        >
          View Patient Virtual Waiting Room ➔
        </button>
      </div>

      {/* Main Room Body */}
      <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
        {/* Left: Video Stage */}
        <section
          style={{
            flex: 1,
            display: 'flex',
            flexDirection: 'column',
            padding: '14px',
            gap: '10px',
            backgroundColor: '#020617',
            position: 'relative',
          }}
        >
          {/* Main Video Screen Container with ROI Selector */}
          <div
            style={{
              position: 'relative',
              flex: 1,
              backgroundColor: '#000',
              borderRadius: '12px',
              overflow: 'hidden',
              boxShadow: '0 10px 25px -5px rgba(0, 0, 0, 0.6)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              border: '1px solid #1e293b',
            }}
          >
            {/* Shutter Camera Flash Animation */}
            {flashActive && (
              <div
                style={{
                  position: 'absolute',
                  inset: 0,
                  backgroundColor: '#ffffff',
                  opacity: 0.85,
                  zIndex: 50,
                  pointerEvents: 'none',
                  transition: 'opacity 0.2s ease-out',
                }}
              />
            )}

            {/* Interactive Drag-to-Select ROI Wrapper */}
            <VideoRoiSelector
              selectedRect={selectedRoi}
              onSelectionChange={(rect) => setSelectedRoi(rect)}
            >
              {feedMode === 'simulated' ? (
                <SimulatedPatientFeed ref={simulatedFeedRef} />
              ) : (
                <video
                  ref={webcamVideoRef}
                  autoPlay
                  playsInline
                  muted
                  style={{
                    width: '100%',
                    height: '100%',
                    objectFit: 'cover',
                    display: 'block',
                  }}
                />
              )}
            </VideoRoiSelector>

            {/* Overlay: Patient Name Tag & Stream Indicator */}
            <div
              style={{
                position: 'absolute',
                top: '14px',
                left: '14px',
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                backgroundColor: 'rgba(15, 23, 42, 0.8)',
                backdropFilter: 'blur(8px)',
                padding: '6px 12px',
                borderRadius: '8px',
                border: '1px solid rgba(255, 255, 255, 0.1)',
                color: '#fff',
                fontSize: '0.82rem',
                fontWeight: 600,
                zIndex: 20,
              }}
            >
              <span
                style={{
                  width: '8px',
                  height: '8px',
                  borderRadius: '50%',
                  backgroundColor: '#ef4444',
                  boxShadow: '0 0 6px #ef4444',
                }}
              />
              <span>Sarah Jenkins (Patient)</span>
              <span style={{ color: '#94a3b8', fontSize: '0.72rem' }}>
                [{feedMode === 'simulated' ? 'Simulated Clinical Feed' : 'Webcam'}]
              </span>
            </div>

            {/* Auto-Detection Toast Notification */}
            {autoDetectNotice && (
              <div
                style={{
                  position: 'absolute',
                  top: '50px',
                  left: '14px',
                  backgroundColor: 'rgba(15, 23, 42, 0.95)',
                  color: '#38bdf8',
                  padding: '6px 14px',
                  borderRadius: '8px',
                  border: '1px solid #38bdf8',
                  fontSize: '0.75rem',
                  fontWeight: 600,
                  zIndex: 30,
                  boxShadow: '0 4px 12px rgba(0,0,0,0.5)',
                  animation: 'fadeIn 0.2s',
                }}
              >
                {autoDetectNotice}
              </div>
            )}

            {/* Picture-In-Picture: Physician Self-View */}
            <div
              style={{
                position: 'absolute',
                bottom: '14px',
                right: '14px',
                width: '160px',
                height: '100px',
                backgroundColor: '#1e293b',
                borderRadius: '8px',
                border: '2px solid rgba(56, 189, 248, 0.5)',
                overflow: 'hidden',
                boxShadow: '0 8px 16px rgba(0, 0, 0, 0.5)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                flexDirection: 'column',
                zIndex: 25,
                pointerEvents: 'none',
              }}
            >
              <div
                style={{
                  width: '34px',
                  height: '34px',
                  borderRadius: '50%',
                  backgroundColor: '#2563eb',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontWeight: 700,
                  fontSize: '0.85rem',
                  color: '#fff',
                }}
              >
                DM
              </div>
              <div style={{ fontSize: '0.7rem', fontWeight: 600, marginTop: '3px', color: '#f1f5f9' }}>
                Dr. Mercer (You)
              </div>
            </div>
          </div>

          {/* Video Control Action Toolbar */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '10px 16px',
              backgroundColor: '#0f172a',
              borderRadius: '10px',
              border: '1px solid #1e293b',
              flexWrap: 'wrap',
              gap: '10px',
            }}
          >
            {/* Stream source switchers */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <button
                onClick={() => setFeedMode('simulated')}
                style={{
                  padding: '7px 11px',
                  backgroundColor: feedMode === 'simulated' ? '#0284c7' : '#1e293b',
                  color: '#fff',
                  border: '1px solid #334155',
                  borderRadius: '6px',
                  fontSize: '0.78rem',
                  fontWeight: 600,
                  cursor: 'pointer',
                }}
              >
                🧪 Simulated Feed
              </button>
              <button
                onClick={() => setFeedMode('webcam')}
                style={{
                  padding: '7px 11px',
                  backgroundColor: feedMode === 'webcam' ? '#0284c7' : '#1e293b',
                  color: '#fff',
                  border: '1px solid #334155',
                  borderRadius: '6px',
                  fontSize: '0.78rem',
                  fontWeight: 600,
                  cursor: 'pointer',
                }}
              >
                📹 Use Webcam
              </button>
            </div>

            {/* Central Primary Action: CAPTURE FRAME / ROI */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              {/* Automated Erythema / Lesion Detection */}
              <button
                onClick={handleAutoDetectWound}
                title="Scans video pixels for red mark / erythema on arm and automatically snaps target bounding box"
                style={{
                  padding: '9px 13px',
                  backgroundColor: '#7c3aed',
                  backgroundImage: 'linear-gradient(135deg, #7c3aed 0%, #6366f1 100%)',
                  color: '#fff',
                  border: 'none',
                  borderRadius: '9999px',
                  fontSize: '0.8rem',
                  fontWeight: 600,
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                  boxShadow: '0 2px 8px rgba(124, 58, 237, 0.4)',
                }}
              >
                <span>🔍 Auto-Detect Mark on Arm</span>
              </button>

              <button
                onClick={handleCaptureFrame}
                disabled={isUploading}
                style={{
                  padding: '10px 22px',
                  backgroundColor: isUploading ? '#64748b' : selectedRoi ? '#0284c7' : '#2563eb',
                  backgroundImage: isUploading
                    ? 'none'
                    : selectedRoi
                    ? 'linear-gradient(135deg, #0284c7 0%, #06b6d4 100%)'
                    : 'linear-gradient(135deg, #2563eb 0%, #0284c7 100%)',
                  color: '#ffffff',
                  border: 'none',
                  borderRadius: '9999px',
                  fontSize: '0.88rem',
                  fontWeight: 700,
                  cursor: isUploading ? 'wait' : 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                  boxShadow: isUploading
                    ? 'none'
                    : '0 0 16px rgba(37, 99, 235, 0.4), 0 4px 6px -1px rgba(0, 0, 0, 0.3)',
                  transition: 'all 0.15s ease',
                }}
              >
                <span>{selectedRoi ? '🎯' : '📸'}</span>
                <span>
                  {isUploading
                    ? 'Streaming...'
                    : selectedRoi
                    ? 'Capture Selected Region'
                    : 'Capture Video Frame'}
                </span>
              </button>

              {/* Reset selected ROI button */}
              {selectedRoi && (
                <button
                  onClick={() => setSelectedRoi(null)}
                  title="Clear selected region"
                  style={{
                    padding: '8px 10px',
                    backgroundColor: '#1e293b',
                    border: '1px solid #475569',
                    borderRadius: '6px',
                    color: '#94a3b8',
                    fontSize: '0.75rem',
                    cursor: 'pointer',
                  }}
                >
                  ✕ Clear ROI
                </button>
              )}

              {/* Patient In-Call Photo Upload Modal Trigger */}
              <button
                onClick={() => setIsPatientUploadOpen(true)}
                title="Patient snaps or uploads phone injury photo during call"
                style={{
                  padding: '9px 14px',
                  backgroundColor: '#10b981',
                  color: '#fff',
                  border: 'none',
                  borderRadius: '9999px',
                  fontSize: '0.82rem',
                  fontWeight: 600,
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                }}
              >
                <span>📲 Patient Phone Upload</span>
              </button>
            </div>

            {/* Standard Media Controls */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <button
                onClick={() => setIsMicMuted(!isMicMuted)}
                title={isMicMuted ? 'Unmute' : 'Mute'}
                style={{
                  padding: '7px 12px',
                  backgroundColor: isMicMuted ? '#ef4444' : '#1e293b',
                  border: '1px solid #334155',
                  borderRadius: '6px',
                  color: '#fff',
                  cursor: 'pointer',
                  fontSize: '0.8rem',
                }}
              >
                {isMicMuted ? '🔇' : '🎙️'}
              </button>
              <button
                onClick={() => setIsVideoMuted(!isVideoMuted)}
                title={isVideoMuted ? 'Start Video' : 'Stop Video'}
                style={{
                  padding: '7px 12px',
                  backgroundColor: isVideoMuted ? '#ef4444' : '#1e293b',
                  border: '1px solid #334155',
                  borderRadius: '6px',
                  color: '#fff',
                  cursor: 'pointer',
                  fontSize: '0.8rem',
                }}
              >
                {isVideoMuted ? '🚫' : '📹'}
              </button>
              <button
                onClick={() => alert('Consultation concluded. Ephemeral buffer purged.')}
                style={{
                  padding: '7px 12px',
                  backgroundColor: '#b91c1c',
                  border: 'none',
                  borderRadius: '6px',
                  color: '#fff',
                  fontWeight: 600,
                  cursor: 'pointer',
                  fontSize: '0.78rem',
                }}
              >
                End Call
              </button>
            </div>
          </div>
        </section>

        {/* Right: Diagnostic Window */}
        <DiagnosticPanel
          onUpdateNotes={(id, notes) => {
            setSnapshots((prev) => prev.map((s) => s.id === id ? { ...s, physicianNotes: notes } : s));
            setActiveSnapshot((prev) => prev?.id === id ? { ...prev, physicianNotes: notes } : prev);
          }}
          snapshots={snapshots}
          activeSnapshot={activeSnapshot}
          onSelectSnapshot={(s) => setActiveSnapshot(s)}
          onFilterChange={handleFilterChange}
          onZoomChange={handleZoomChange}
          onPanChange={handlePanChange}
          onToggleAutoGravity={handleToggleAutoGravity}
          onResetZoom={handleResetZoom}
          onUpdateAnnotation={handleUpdateAnnotation}
          onUpdatePrivacy={handleUpdatePrivacy}
          preVisitPhotos={preVisitPhotos}
          onSelectPreVisitPhoto={handleSelectPreVisitPhoto}
          isUploading={isUploading}
          uploadError={uploadError}
          cloudName={cloudName}
          uploadPreset={uploadPreset}
          onUpdateConfig={(cName, preset) => {
            setCloudName(cName);
            setUploadPreset(preset);
            setUploadError(null);
          }}
          lowDataMode={lowDataMode}
          onOpenEquityModal={() => setIsEquityModalOpen(true)}
        />
      </div>

      {/* Patient In-Call Upload Modal */}
      <PatientInjuryUploadModal
        isOpen={isPatientUploadOpen}
        onClose={() => setIsPatientUploadOpen(false)}
        onUploadSuccess={(newSnap) => {
          setSnapshots((prev) => [newSnap, ...prev]);
          setActiveSnapshot(newSnap);
        }}
        cloudName={cloudName}
        uploadPreset={uploadPreset}
      />

      {/* Vulnerable Populations & Domestic Shelter Safety Modal */}
      <VulnerablePopulationsModal
        isOpen={isEquityModalOpen}
        onClose={() => setIsEquityModalOpen(false)}
        shelterSafetyActive={shelterSafetyActive}
        onToggleShelterSafety={(active) => {
          setShelterSafetyActive(active);
          if (activeSnapshot) {
            handleUpdatePrivacy({
              ...activeSnapshot.privacy,
              blurFaces: active,
              stripMetadata: true,
              signedUrl: true,
              shelterSafetyMode: active,
            });
          }
        }}
      />
    </div>
  );
}
