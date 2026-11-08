export type DiagnosticFilter = 
  | 'raw'
  | 'auto_enhance'    // q_auto, f_auto, e_improve, e_auto_brightness
  | 'hd_sharpen'
  | 'color_restore'
  | 'wound_zoom'
  | 'margin_outline';

export interface CropRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface NormalizedRect {
  x: number;      // 0 to 1
  y: number;      // 0 to 1
  width: number;  // 0 to 1
  height: number; // 0 to 1
}

export interface AnnotationConfig {
  enabled: boolean;
  text: string;
  position: 'north_west' | 'north_east' | 'south_west' | 'center';
  color: string;
}

export interface PrivacyConfig {
  blurFaces: boolean;
  stripMetadata: boolean;
  signedUrl: boolean;
  shelterSafetyMode: boolean; // Protects vulnerable patients in shelters/domestic violence
}

export interface CapturedSnapshot {
  id: string;
  public_id: string;
  secure_url: string;
  width: number;
  height: number;
  created_at: string;
  activeFilter: DiagnosticFilter;
  dataUrl?: string;
  physicianNotes?: string;
  zoomLevel: number;       // 1.0x to 4.0x
  panX: number;            // horizontal pixel offset
  panY: number;            // vertical pixel offset
  useAutoGravity: boolean; // true = AI auto-crop (g_auto), false = manual pan
  annotation?: AnnotationConfig;
  privacy?: PrivacyConfig;
  sourceType: 'webcam_capture' | 'patient_in_call' | 'pre_visit_upload';
  lowDataMode?: boolean;   // q_auto:eco for rural / prepaid mobile plans
}

export interface PreVisitPhoto {
  id: string;
  public_id: string;
  secure_url: string;
  uploaded_at: string;
  title: string;
  category: string;
  notes?: string;
}

