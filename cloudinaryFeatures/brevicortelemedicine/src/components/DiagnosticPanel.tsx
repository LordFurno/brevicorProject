import { useState } from 'react';
import { AdvancedImage, placeholder } from '@cloudinary/react';
import { getEnhancedImage } from '../cloudinary/enhancements';
import { BeforeAfterSlider } from './BeforeAfterSlider';
import { LongitudinalTimeline } from './LongitudinalTimeline';
import { WoundMarginView } from './WoundMarginView';
import type { CapturedSnapshot, DiagnosticFilter, PreVisitPhoto, AnnotationConfig, PrivacyConfig } from '../types';

interface DiagnosticPanelProps {
  snapshots: CapturedSnapshot[];
  activeSnapshot: CapturedSnapshot | null;
  onSelectSnapshot: (snapshot: CapturedSnapshot) => void;
  onUpdateNotes: (id: string, notes: string) => void;
  onFilterChange: (filter: DiagnosticFilter) => void;
  onZoomChange: (zoom: number) => void;
  onPanChange: (panX: number, panY: number) => void;
  onToggleAutoGravity: (auto: boolean) => void;
  onResetZoom: () => void;
  onUpdateAnnotation: (annotation: AnnotationConfig) => void;
  onUpdatePrivacy: (privacy: PrivacyConfig) => void;
  preVisitPhotos: PreVisitPhoto[];
  onSelectPreVisitPhoto: (photo: PreVisitPhoto) => void;
  isUploading: boolean;
  uploadError: string | null;
  cloudName: string;
  uploadPreset: string;
  onUpdateConfig: (cloudName: string, uploadPreset: string) => void;
  lowDataMode: boolean;
  onOpenEquityModal: () => void;
}

export function DiagnosticPanel({
  snapshots,
  onUpdateNotes,
  activeSnapshot,
  onSelectSnapshot,
  onFilterChange,
  onZoomChange,
  onPanChange,
  onToggleAutoGravity,
  onResetZoom,
  onUpdateAnnotation,
  onUpdatePrivacy,
  preVisitPhotos,
  onSelectPreVisitPhoto,
  isUploading,
  uploadError,
  cloudName,
  uploadPreset,
  onUpdateConfig,
  lowDataMode,
  onOpenEquityModal,
}: DiagnosticPanelProps) {
  const [activeTab, setActiveTab] = useState<'diagnostics' | 'auto_enhance' | 'timeline' | 'pre_visit'>('diagnostics');
  const [showFhirModal, setShowFhirModal] = useState(false);
  const [fhirSaved, setFhirSaved] = useState(false);
  const [showConfig, setShowConfig] = useState(false);
  const [tempCloudName, setTempCloudName] = useState(cloudName);
  const [tempPreset, setTempPreset] = useState(uploadPreset);

  // Annotation states
  const annotation = activeSnapshot?.annotation || {
    enabled: false,
    text: 'Erythema Margin: 3.2cm',
    position: 'north_west',
    color: 'yellow',
  };

  // Privacy states
  const privacy = activeSnapshot?.privacy || {
    blurFaces: false,
    stripMetadata: true,
    signedUrl: true,
    shelterSafetyMode: false,
  };

  const filterOptions: { id: DiagnosticFilter; label: string; desc: string; icon: string }[] = [
    { id: 'raw', label: 'Raw Capture', desc: 'Unprocessed video frame', icon: '📷' },
    { id: 'auto_enhance', label: 'Photo clarity', desc: 'Gentle lighting correction and sharpening', icon: '⚡' },
    { id: 'hd_sharpen', label: 'HD Sharpen & De-noise', desc: 'improve + sharpen + unsharp mask', icon: '✨' },
    { id: 'color_restore', label: 'Erythema & Color Balance', desc: 'auto-contrast + auto-color + vibrance', icon: '🎨' },
    { id: 'wound_zoom', label: 'Lesion Crop / Zoom', desc: 'c_crop + zoom + focus centering', icon: '🔍' },
    { id: 'margin_outline', label: 'Wound Border Outline', desc: 'Traces the erythematous lesion margin', icon: '⭕' },
  ];

  const handleSaveConfig = (e: React.FormEvent) => {
    e.preventDefault();
    onUpdateConfig(tempCloudName.trim(), tempPreset.trim());
    setShowConfig(false);
  };

  // Mock FHIR R4 Media Resource
  const fhirResource = activeSnapshot
    ? {
        resourceType: 'Media',
        id: `media-consultation-${activeSnapshot.id.substring(0, 8)}`,
        status: 'completed',
        type: {
          coding: [{ system: 'http://terminology.hl7.org/CodeSystem/media-type', code: 'image' }],
        },
        modality: {
          coding: [{ system: 'http://snomed.info/sct', code: '408443003', display: 'Clinical tele-photography' }],
        },
        subject: { reference: 'Patient/Sarah-Jenkins-4829' },
        encounter: { reference: 'Encounter/Visit-8421-20261107' },
        operator: { reference: 'Practitioner/Dr-A-Mercer-MD' },
        createdDateTime: activeSnapshot.created_at || new Date().toISOString(),
        note: [
          {
            text: `Dermatology evaluation. Filter: ${activeSnapshot.activeFilter}. Annotation: ${
              annotation.enabled ? annotation.text : 'None'
            }. Privacy: FaceBlur=${privacy.blurFaces}, ShelterMode=${privacy.shelterSafetyMode}, EXIF_Stripped=true. Delivery: ${
              lowDataMode ? 'q_auto:eco' : 'q_auto'
            }.`,
          },
        ],
        content: {
          contentType: 'image/jpeg',
          url: activeSnapshot.secure_url,
          title: `Diagnostic Frame - ${activeSnapshot.activeFilter}`,
          width: activeSnapshot.width,
          height: activeSnapshot.height,
        },
      }
    : null;

  return (
    <aside
      style={{
        width: '460px',
        backgroundColor: '#0f172a',
        borderLeft: '1px solid #1e293b',
        display: 'flex',
        flexDirection: 'column',
        color: '#f8fafc',
        height: '100%',
        overflowY: 'auto',
      }}
    >
      {/* Panel Top Nav Bar */}
      <div
        style={{
          padding: '12px 16px',
          borderBottom: '1px solid #1e293b',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}
      >
        <div>
          <div style={{ fontWeight: 700, fontSize: '0.95rem', color: '#f1f5f9' }}>
            Clinical Diagnostic Window
          </div>
          <div style={{ fontSize: '0.7rem', color: '#38bdf8' }}>
            Cloudinary Real-Time Telemedicine Buffer
          </div>
        </div>

        <div style={{ display: 'flex', gap: '6px' }}>
          <button
            onClick={onOpenEquityModal}
            title="Shelter & Vulnerable Patient Protections"
            style={{
              background: privacy.shelterSafetyMode ? 'rgba(16, 185, 129, 0.2)' : 'transparent',
              border: '1px solid #334155',
              color: privacy.shelterSafetyMode ? '#34d399' : '#38bdf8',
              borderRadius: '6px',
              padding: '4px 8px',
              fontSize: '0.72rem',
              cursor: 'pointer',
              fontWeight: 600,
            }}
          >
            🛡️ Equity
          </button>
          <button
            onClick={() => setShowConfig(!showConfig)}
            style={{
              background: 'transparent',
              border: '1px solid #334155',
              color: '#94a3b8',
              borderRadius: '6px',
              padding: '4px 8px',
              fontSize: '0.72rem',
              cursor: 'pointer',
            }}
          >
            ⚙️ Preset
          </button>
        </div>
      </div>

      {/* Preset Config Drawer */}
      {showConfig && (
        <form
          onSubmit={handleSaveConfig}
          style={{
            padding: '12px 16px',
            backgroundColor: '#1e293b',
            borderBottom: '1px solid #334155',
            fontSize: '0.8rem',
            display: 'flex',
            flexDirection: 'column',
            gap: '8px',
          }}
        >
          <div style={{ fontWeight: 600, color: '#38bdf8' }}>Cloudinary Settings</div>
          <div>
            <label style={{ display: 'block', color: '#94a3b8', marginBottom: '2px' }}>Cloud Name:</label>
            <input
              type="text"
              value={tempCloudName}
              onChange={(e) => setTempCloudName(e.target.value)}
              style={{
                width: '100%',
                padding: '6px 8px',
                background: '#0f172a',
                border: '1px solid #334155',
                borderRadius: '4px',
                color: '#fff',
              }}
            />
          </div>
          <div>
            <label style={{ display: 'block', color: '#94a3b8', marginBottom: '2px' }}>Upload Preset (Unsigned):</label>
            <input
              type="text"
              value={tempPreset}
              onChange={(e) => setTempPreset(e.target.value)}
              placeholder="e.g. ml_default"
              style={{
                width: '100%',
                padding: '6px 8px',
                background: '#0f172a',
                border: '1px solid #334155',
                borderRadius: '4px',
                color: '#fff',
              }}
            />
          </div>
          <button
            type="submit"
            style={{
              padding: '6px 12px',
              backgroundColor: '#0284c7',
              color: '#fff',
              border: 'none',
              borderRadius: '4px',
              cursor: 'pointer',
              fontWeight: 600,
            }}
          >
            Apply Settings
          </button>
        </form>
      )}

      {/* Feature Tabs */}
      <div
        style={{
          display: 'flex',
          backgroundColor: '#020617',
          borderBottom: '1px solid #1e293b',
          padding: '4px 8px',
          gap: '4px',
          overflowX: 'auto',
        }}
      >
        <button
          onClick={() => setActiveTab('diagnostics')}
          style={{
            padding: '6px 10px',
            borderRadius: '4px',
            border: 'none',
            backgroundColor: activeTab === 'diagnostics' ? '#1e293b' : 'transparent',
            color: activeTab === 'diagnostics' ? '#38bdf8' : '#94a3b8',
            fontSize: '0.72rem',
            fontWeight: 600,
            cursor: 'pointer',
            whiteSpace: 'nowrap',
          }}
        >
          🔬 Diagnostics
        </button>
        <button
          onClick={() => setActiveTab('auto_enhance')}
          style={{
            padding: '6px 10px',
            borderRadius: '4px',
            border: 'none',
            backgroundColor: activeTab === 'auto_enhance' ? '#1e293b' : 'transparent',
            color: activeTab === 'auto_enhance' ? '#38bdf8' : '#94a3b8',
            fontSize: '0.72rem',
            fontWeight: 600,
            cursor: 'pointer',
            whiteSpace: 'nowrap',
          }}
        >
          ⚡ Photo clarity
        </button>
        <button
          onClick={() => setActiveTab('timeline')}
          style={{
            padding: '6px 10px',
            borderRadius: '4px',
            border: 'none',
            backgroundColor: activeTab === 'timeline' ? '#1e293b' : 'transparent',
            color: activeTab === 'timeline' ? '#38bdf8' : '#94a3b8',
            fontSize: '0.72rem',
            fontWeight: 600,
            cursor: 'pointer',
            whiteSpace: 'nowrap',
          }}
        >
          📅 Notes &amp; Photos
        </button>
        <button
          onClick={() => setActiveTab('pre_visit')}
          style={{
            padding: '6px 10px',
            borderRadius: '4px',
            border: 'none',
            backgroundColor: activeTab === 'pre_visit' ? '#1e293b' : 'transparent',
            color: activeTab === 'pre_visit' ? '#38bdf8' : '#94a3b8',
            fontSize: '0.72rem',
            fontWeight: 600,
            cursor: 'pointer',
            whiteSpace: 'nowrap',
          }}
        >
          📥 Pre-Visit ({preVisitPhotos.length})
        </button>
      </div>

      {/* Upload Error Banner */}
      {uploadError && (
        <div
          style={{
            margin: '10px 14px',
            padding: '8px 10px',
            backgroundColor: 'rgba(239, 68, 68, 0.15)',
            border: '1px solid rgba(239, 68, 68, 0.4)',
            borderRadius: '6px',
            color: '#fca5a5',
            fontSize: '0.75rem',
          }}
        >
          <strong>Upload Notice:</strong> {uploadError}
        </div>
      )}

      {/* Main Tab Views */}
      <div style={{ padding: '14px', flex: 1, display: 'flex', flexDirection: 'column', gap: '14px' }}>
        {/* Loading state during capture */}
        {isUploading && (
          <div
            style={{
              padding: '18px',
              backgroundColor: '#1e293b',
              borderRadius: '8px',
              textAlign: 'center',
              border: '1px dashed #38bdf8',
            }}
          >
            <div style={{ fontSize: '1.5rem', marginBottom: '6px', animation: 'spin 1s linear infinite' }}>
              ⚡
            </div>
            <div style={{ fontWeight: 600, color: '#38bdf8', fontSize: '0.85rem' }}>
              Streaming Frame to Cloudinary Ephemeral Buffer...
            </div>
          </div>
        )}

        {/* TAB 1: DIAGNOSTICS & ACTIVE SNAPSHOT */}
        {activeTab === 'diagnostics' && activeSnapshot && (
          <div>
            {/* Filter Buttons */}
            <div style={{ marginBottom: '10px' }}>
              <div style={{ fontSize: '0.7rem', fontWeight: 600, color: '#94a3b8', marginBottom: '6px' }}>
                CLINICAL PRESETS:
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '6px' }}>
                {filterOptions.map((opt) => (
                  <button
                    key={opt.id}
                    onClick={() => onFilterChange(opt.id)}
                    title={opt.desc}
                    style={{
                      padding: '7px 8px',
                      borderRadius: '6px',
                      border: activeSnapshot.activeFilter === opt.id ? '1px solid #38bdf8' : '1px solid #334155',
                      backgroundColor: activeSnapshot.activeFilter === opt.id ? 'rgba(56, 189, 248, 0.15)' : '#1e293b',
                      color: activeSnapshot.activeFilter === opt.id ? '#38bdf8' : '#cbd5e1',
                      fontSize: '0.72rem',
                      fontWeight: 600,
                      cursor: 'pointer',
                      textAlign: 'left',
                      transition: 'all 0.15s ease',
                    }}
                  >
                    <span>{opt.icon} {opt.label}</span>
                  </button>
                ))}
              </div>
            </div>

            {/* Transformed Image Preview */}
            <div
              style={{
                position: 'relative',
                backgroundColor: '#000',
                borderRadius: '8px',
                overflow: 'hidden',
                border: '1px solid #334155',
                minHeight: '220px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              {activeSnapshot.activeFilter === 'margin_outline' ? (
                <WoundMarginView
                  src={
                    activeSnapshot.public_id && !activeSnapshot.public_id.startsWith('samples/')
                      ? getEnhancedImage(activeSnapshot.public_id, {
                          filter: 'margin_outline',
                          zoomLevel: activeSnapshot.zoomLevel,
                          panX: activeSnapshot.panX,
                          panY: activeSnapshot.panY,
                          useAutoGravity: activeSnapshot.useAutoGravity,
                          annotation: activeSnapshot.annotation,
                          privacy: activeSnapshot.privacy,
                          lowDataMode,
                        }).toURL()
                      : activeSnapshot.dataUrl || activeSnapshot.secure_url
                  }
                  fallbackSrc={activeSnapshot.dataUrl}
                />
              ) : (
                <AdvancedImage
                  cldImg={getEnhancedImage(activeSnapshot.public_id, {
                    filter: activeSnapshot.activeFilter,
                    zoomLevel: activeSnapshot.zoomLevel,
                    panX: activeSnapshot.panX,
                    panY: activeSnapshot.panY,
                    useAutoGravity: activeSnapshot.useAutoGravity,
                    annotation: activeSnapshot.annotation,
                    privacy: activeSnapshot.privacy,
                    lowDataMode,
                  })}
                  plugins={[placeholder({ mode: 'blur' })]}
                  alt="Diagnostic snapshot"
                  style={{
                    width: '100%',
                    height: 'auto',
                    maxHeight: '260px',
                    objectFit: 'contain',
                    display: 'block',
                  }}
                />
              )}
              
              <div
                style={{
                  position: 'absolute',
                  bottom: '6px',
                  left: '6px',
                  backgroundColor: 'rgba(15, 23, 42, 0.85)',
                  padding: '2px 8px',
                  borderRadius: '4px',
                  fontSize: '0.65rem',
                  color: '#38bdf8',
                  fontFamily: 'monospace',
                }}
              >
                {activeSnapshot.activeFilter.toUpperCase()} • {activeSnapshot.zoomLevel.toFixed(1)}x ZOOM
                {lowDataMode && ' • ECO (q_auto:eco)'}
              </div>
            </div>

            {/* ZOOM & MANUAL PAN CONTROLS */}
            <div
              style={{
                marginTop: '10px',
                padding: '10px',
                backgroundColor: '#1e293b',
                borderRadius: '8px',
                border: '1px solid #334155',
                display: 'flex',
                flexDirection: 'column',
                gap: '8px',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontSize: '0.72rem', fontWeight: 700, color: '#38bdf8' }}>
                  🔍 ZOOM & FOCUS CONTROLS
                </span>
                <button
                  onClick={onResetZoom}
                  style={{
                    background: 'transparent',
                    border: '1px solid #475569',
                    borderRadius: '4px',
                    color: '#94a3b8',
                    fontSize: '0.65rem',
                    padding: '2px 6px',
                    cursor: 'pointer',
                  }}
                >
                  Reset Zoom
                </button>
              </div>

              {/* Zoom Slider */}
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span style={{ fontSize: '0.68rem', color: '#cbd5e1' }}>Zoom:</span>
                <input
                  type="range"
                  min="1.0"
                  max="4.0"
                  step="0.1"
                  value={activeSnapshot.zoomLevel}
                  onChange={(e) => onZoomChange(parseFloat(e.target.value))}
                  style={{ flex: 1, accentColor: '#38bdf8', cursor: 'ew-resize' }}
                />
                <span style={{ fontSize: '0.68rem', fontWeight: 700, color: '#38bdf8', width: '30px' }}>
                  {activeSnapshot.zoomLevel.toFixed(1)}x
                </span>
              </div>

              {/* Mode Toggle */}
              <div style={{ display: 'flex', gap: '6px' }}>
                <button
                  onClick={() => onToggleAutoGravity(true)}
                  style={{
                    flex: 1,
                    padding: '4px 6px',
                    borderRadius: '4px',
                    border: activeSnapshot.useAutoGravity ? '1px solid #38bdf8' : '1px solid #334155',
                    backgroundColor: activeSnapshot.useAutoGravity ? 'rgba(56, 189, 248, 0.2)' : '#0f172a',
                    color: activeSnapshot.useAutoGravity ? '#38bdf8' : '#94a3b8',
                    fontSize: '0.68rem',
                    fontWeight: 600,
                    cursor: 'pointer',
                  }}
                >
                  🤖 AI Auto-Detect (g_auto)
                </button>
                <button
                  onClick={() => onToggleAutoGravity(false)}
                  style={{
                    flex: 1,
                    padding: '4px 6px',
                    borderRadius: '4px',
                    border: !activeSnapshot.useAutoGravity ? '1px solid #38bdf8' : '1px solid #334155',
                    backgroundColor: !activeSnapshot.useAutoGravity ? 'rgba(56, 189, 248, 0.2)' : '#0f172a',
                    color: !activeSnapshot.useAutoGravity ? '#38bdf8' : '#94a3b8',
                    fontSize: '0.68rem',
                    fontWeight: 600,
                    cursor: 'pointer',
                  }}
                >
                  🖐️ Manual Pan / Crop
                </button>
              </div>

              {!activeSnapshot.useAutoGravity && (
                <div style={{ display: 'flex', gap: '8px', fontSize: '0.68rem', color: '#cbd5e1' }}>
                  <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: '4px' }}>
                    <span>X:</span>
                    <input
                      type="range"
                      min="-200"
                      max="200"
                      step="5"
                      value={activeSnapshot.panX}
                      onChange={(e) => onPanChange(parseInt(e.target.value, 10), activeSnapshot.panY)}
                      style={{ flex: 1, accentColor: '#38bdf8' }}
                    />
                  </div>
                  <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: '4px' }}>
                    <span>Y:</span>
                    <input
                      type="range"
                      min="-200"
                      max="200"
                      step="5"
                      value={activeSnapshot.panY}
                      onChange={(e) => onPanChange(activeSnapshot.panX, parseInt(e.target.value, 10))}
                      style={{ flex: 1, accentColor: '#38bdf8' }}
                    />
                  </div>
                </div>
              )}
            </div>

            {/* DOCTOR ANNOTATIONS SECTION */}
            <div
              style={{
                marginTop: '10px',
                padding: '10px',
                backgroundColor: '#1e293b',
                borderRadius: '8px',
                border: '1px solid #334155',
                display: 'flex',
                flexDirection: 'column',
                gap: '8px',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontSize: '0.72rem', fontWeight: 700, color: '#facc15' }}>
                  ✍️ CLINICAL ANNOTATION OVERLAY
                </span>
                <label style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '0.68rem', color: '#cbd5e1', cursor: 'pointer' }}>
                  <input
                    type="checkbox"
                    checked={annotation.enabled}
                    onChange={(e) => onUpdateAnnotation({ ...annotation, enabled: e.target.checked })}
                    style={{ accentColor: '#facc15' }}
                  />
                  <span>Enable Overlay</span>
                </label>
              </div>

              {annotation.enabled && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                  <input
                    type="text"
                    value={annotation.text}
                    onChange={(e) => onUpdateAnnotation({ ...annotation, text: e.target.value })}
                    placeholder="Enter clinical note, e.g. Margin: 3.2cm"
                    style={{
                      width: '100%',
                      padding: '5px 8px',
                      backgroundColor: '#0f172a',
                      border: '1px solid #334155',
                      borderRadius: '4px',
                      color: '#fff',
                      fontSize: '0.72rem',
                    }}
                  />
                  <div style={{ display: 'flex', gap: '6px' }}>
                    {['Erythema: 3.2cm', 'Incision Day 14', 'Wound Granulation', 'Demarcated'].map((presetText) => (
                      <button
                        key={presetText}
                        onClick={() => onUpdateAnnotation({ ...annotation, text: presetText })}
                        style={{
                          background: '#0f172a',
                          border: '1px solid #334155',
                          color: '#94a3b8',
                          borderRadius: 3,
                          padding: '2px 5px',
                          fontSize: '0.62rem',
                          cursor: 'pointer',
                        }}
                      >
                        {presetText}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* PRIVACY & VULNERABLE POPULATIONS SAFEGUARDS */}
            <div
              style={{
                marginTop: '10px',
                padding: '10px',
                backgroundColor: privacy.shelterSafetyMode ? 'rgba(16, 185, 129, 0.15)' : '#1e293b',
                borderRadius: '8px',
                border: privacy.shelterSafetyMode ? '1px solid #10b981' : '1px solid #334155',
                display: 'flex',
                flexDirection: 'column',
                gap: '6px',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div style={{ fontSize: '0.72rem', fontWeight: 700, color: privacy.shelterSafetyMode ? '#34d399' : '#38bdf8' }}>
                  🛡️ VULNERABLE POPULATION & SHELTER PROTECTION
                </div>
                <button
                  onClick={onOpenEquityModal}
                  style={{
                    background: 'none',
                    border: 'none',
                    color: '#38bdf8',
                    fontSize: '0.65rem',
                    cursor: 'pointer',
                    textDecoration: 'underline',
                  }}
                >
                  Why this matters?
                </button>
              </div>

              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.7rem', color: '#cbd5e1', cursor: 'pointer' }}>
                  <input
                    type="checkbox"
                    checked={privacy.shelterSafetyMode}
                    onChange={(e) =>
                      onUpdatePrivacy({
                        ...privacy,
                        shelterSafetyMode: e.target.checked,
                        blurFaces: e.target.checked ? true : privacy.blurFaces,
                      })
                    }
                    style={{ accentColor: '#10b981' }}
                  />
                  <span>
                    <strong>Confidential Shelter Mode</strong> (Enforce Face Blur & GPS Scrub)
                  </span>
                </label>
              </div>

              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '2px' }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.68rem', color: '#cbd5e1', cursor: 'pointer' }}>
                  <input
                    type="checkbox"
                    checked={privacy.blurFaces}
                    onChange={(e) => onUpdatePrivacy({ ...privacy, blurFaces: e.target.checked })}
                    style={{ accentColor: '#34d399' }}
                  />
                  <span>Blur Faces (De-identify patient identity)</span>
                </label>
                <span style={{ fontSize: '0.62rem', color: privacy.blurFaces ? '#34d399' : '#94a3b8', fontFamily: 'monospace' }}>
                  {privacy.blurFaces ? 'e_blur_faces:2000' : 'Off'}
                </span>
              </div>

              <div style={{ display: 'flex', gap: '10px', fontSize: '0.63rem', color: '#94a3b8', marginTop: '2px' }}>
                <span>✓ EXIF / GPS stripped on ingest</span>
                <span>✓ 15-min signed token</span>
              </div>
            </div>

            {/* Commit to FHIR */}
            <div style={{ marginTop: '12px' }}>
              <button
                onClick={() => setShowFhirModal(true)}
                style={{
                  width: '100%',
                  padding: '9px 12px',
                  backgroundColor: fhirSaved ? '#059669' : '#2563eb',
                  color: '#fff',
                  border: 'none',
                  borderRadius: '6px',
                  fontWeight: 600,
                  fontSize: '0.82rem',
                  cursor: 'pointer',
                }}
              >
                {fhirSaved ? '✓ Attached to Encounter (FHIR)' : '📋 Commit Snapshot to Canadian FHIR Record'}
              </button>
            </div>
          </div>
        )}

        {/* TAB 2: AUTO-ENHANCE WITH TRUE-COLOR LOCK & LOW-DATA METRICS */}
        {activeTab === 'auto_enhance' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            {activeSnapshot ? (
              <BeforeAfterSlider snapshot={activeSnapshot} lowDataMode={lowDataMode} />
            ) : (
              <p style={{ color: '#94a3b8', fontSize: '0.8rem' }}>Capture a frame or select a photo to optimize.</p>
            )}
          </div>
        )}

        {/* TAB 3: LONGITUDINAL TIMELINE */}
        {activeTab === 'timeline' && (
          <LongitudinalTimeline snapshots={snapshots} lowDataMode={lowDataMode} onUpdateNotes={onUpdateNotes} />
        )}

        {/* TAB 4: PRE-VISIT INTAKE PHOTOS */}
        {activeTab === 'pre_visit' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            <div style={{ fontSize: '0.8rem', fontWeight: 700, color: '#f1f5f9' }}>
              PATIENT PRE-VISIT INTAKE GALLERY:
            </div>
            {preVisitPhotos.length === 0 ? (
              <p style={{ color: '#94a3b8', fontSize: '0.78rem' }}>
                No pre-visit photos uploaded yet. Switch to "Patient Waiting Room" to upload photos.
              </p>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                {preVisitPhotos.map((photo) => (
                  <div
                    key={photo.id}
                    onClick={() => onSelectPreVisitPhoto(photo)}
                    style={{
                      display: 'flex',
                      gap: '10px',
                      padding: '8px',
                      backgroundColor: '#1e293b',
                      borderRadius: '6px',
                      cursor: 'pointer',
                      border: '1px solid #334155',
                    }}
                  >
                    <img
                      src={photo.secure_url}
                      alt={photo.title}
                      style={{ width: '64px', height: '64px', objectFit: 'cover', borderRadius: '4px' }}
                    />
                    <div style={{ flex: 1 }}>
                      <div style={{ fontWeight: 600, fontSize: '0.78rem', color: '#f1f5f9' }}>
                        {photo.title}
                      </div>
                      <div style={{ fontSize: '0.68rem', color: '#38bdf8', marginTop: '2px' }}>
                        Uploaded at {photo.uploaded_at}
                      </div>
                      {photo.notes && (
                        <div style={{ fontSize: '0.65rem', color: '#94a3b8', marginTop: '2px' }}>
                          "{photo.notes}"
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Reel of session snapshots */}
        {snapshots.length > 0 && activeTab === 'diagnostics' && (
          <div style={{ marginTop: 'auto', paddingTop: '10px', borderTop: '1px solid #1e293b' }}>
            <div style={{ fontSize: '0.7rem', fontWeight: 600, color: '#94a3b8', marginBottom: '6px' }}>
              CONSULTATION REEL ({snapshots.length}):
            </div>
            <div style={{ display: 'flex', gap: '6px', overflowX: 'auto', paddingBottom: '4px' }}>
              {snapshots.map((snap) => (
                <button
                  key={snap.id}
                  onClick={() => onSelectSnapshot(snap)}
                  style={{
                    border: activeSnapshot?.id === snap.id ? '2px solid #38bdf8' : '1px solid #334155',
                    borderRadius: '5px',
                    padding: 0,
                    overflow: 'hidden',
                    background: '#000',
                    cursor: 'pointer',
                    width: '60px',
                    height: '45px',
                    flexShrink: 0,
                  }}
                >
                  <img
                    src={snap.dataUrl || snap.secure_url}
                    alt="Reel thumbnail"
                    style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                  />
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* FHIR Media Preview Modal */}
      {showFhirModal && fhirResource && (
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
              borderRadius: '10px',
              border: '1px solid #334155',
              width: '100%',
              maxWidth: '600px',
              maxHeight: '80vh',
              display: 'flex',
              flexDirection: 'column',
              overflow: 'hidden',
            }}
          >
            <div style={{ padding: '14px 18px', borderBottom: '1px solid #1e293b', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div style={{ fontWeight: 700, fontSize: '0.95rem', color: '#38bdf8' }}>
                HL7 FHIR R4: Media Resource Payload
              </div>
              <button onClick={() => setShowFhirModal(false)} style={{ background: 'none', border: 'none', color: '#94a3b8', fontSize: '1.2rem', cursor: 'pointer' }}>
                ✕
              </button>
            </div>
            <div style={{ padding: '14px 18px', overflowY: 'auto', flex: 1 }}>
              <pre style={{ backgroundColor: '#020617', padding: '10px', borderRadius: '6px', color: '#38bdf8', fontSize: '0.72rem', fontFamily: 'monospace' }}>
                {JSON.stringify(fhirResource, null, 2)}
              </pre>
            </div>
            <div style={{ padding: '10px 18px', borderTop: '1px solid #1e293b', display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
              <button onClick={() => setShowFhirModal(false)} style={{ padding: '7px 12px', backgroundColor: '#1e293b', color: '#e2e8f0', border: '1px solid #334155', borderRadius: '6px', cursor: 'pointer' }}>
                Close
              </button>
              <button
                onClick={() => {
                  setFhirSaved(true);
                  setShowFhirModal(false);
                }}
                style={{ padding: '7px 14px', backgroundColor: '#059669', color: '#fff', border: 'none', borderRadius: '6px', fontWeight: 600, cursor: 'pointer' }}
              >
                Confirm Commit to Canadian EHR
              </button>
            </div>
          </div>
        </div>
      )}
    </aside>
  );
}
