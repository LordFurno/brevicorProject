import { cld } from './config';
import { limitFit, crop } from '@cloudinary/url-gen/actions/resize';
import { 
  improve, 
  sharpen, 
  autoContrast, 
  autoColor, 
  vibrance,
  unsharpMask,
} from '@cloudinary/url-gen/actions/adjust';
import { autoGravity, compass } from '@cloudinary/url-gen/qualifiers/gravity';
import { format, quality } from '@cloudinary/url-gen/actions/delivery';
import { auto } from '@cloudinary/url-gen/qualifiers/format';
import { auto as autoQuality, autoEco } from '@cloudinary/url-gen/qualifiers/quality';
import { source } from '@cloudinary/url-gen/actions/overlay';
import { text } from '@cloudinary/url-gen/qualifiers/source';
import { Position } from '@cloudinary/url-gen/qualifiers/position';
import { TextStyle } from '@cloudinary/url-gen/qualifiers/textStyle';
import type { CloudinaryImage } from '@cloudinary/url-gen';
import type { DiagnosticFilter, AnnotationConfig, PrivacyConfig, CropRect } from './types';

export interface TransformControls {
  filter: DiagnosticFilter;
  region?: CropRect;
  version?: number;
  zoomLevel?: number;       // 1.0 to 4.0
  panX?: number;            // -300 to 300
  panY?: number;            // -300 to 300
  useAutoGravity?: boolean; // true = g_auto, false = manual center + x/y
  annotation?: AnnotationConfig;
  privacy?: PrivacyConfig;
  lowDataMode?: boolean;    // Rural / Prepaid mobile eco mode (q_auto:eco)
}

export function getEnhancedImage(
  publicId: string, 
  controls: TransformControls | DiagnosticFilter
): CloudinaryImage {
  const options: TransformControls = 
    typeof controls === 'string' ? { filter: controls } : controls;

  const {
    filter,
    region,
    version,
    zoomLevel = 1.0,
    panX = 0,
    panY = 0,
    useAutoGravity = true,
    annotation,
    privacy,
    lowDataMode = false,
  } = options;

  let base = cld.image(publicId);
  if (version) base.setVersion(version);
  if (region) base = base.resize(crop().width(region.width).height(region.height).x(region.x).y(region.y).gravity(compass('north_west')));

  // 1. Privacy de-identification: Blur faces if shelter safety mode or blur faces is active
  if (privacy?.blurFaces || privacy?.shelterSafetyMode) {
    base = base.addTransformation('e_blur_faces:2000');
  }

  // 2. Doctor Annotations overlay: Render text notes / clinical markers
  if (annotation?.enabled && annotation.text.trim()) {
    const textColor = annotation.color || 'yellow';
    const pos = annotation.position || 'north_west';
    base = base.overlay(
      source(text(annotation.text.trim(), new TextStyle('Arial', 32).fontWeight('bold')).textColor(textColor))
        .position(new Position().gravity(compass(pos)).offsetX(24).offsetY(24))
    );
  }

  // Helper to apply crop / zoom with either AI g_auto or manual center pan
  const applyZoomAndCrop = (targetImg: CloudinaryImage, defaultZoom = 1.0) => {
    const effectiveZoom = zoomLevel > 1.0 ? zoomLevel : defaultZoom;

    if (effectiveZoom > 1.0 || panX !== 0 || panY !== 0) {
      if (useAutoGravity && panX === 0 && panY === 0) {
        return targetImg.resize(
          crop()
            .width(600)
            .height(600)
            .gravity(autoGravity())
            .zoom(effectiveZoom)
        );
      } else {
        return targetImg.resize(
          crop()
            .width(600)
            .height(600)
            .gravity(compass('center'))
            .x(panX)
            .y(panY)
            .zoom(effectiveZoom)
        );
      }
    }

    return targetImg.resize(limitFit().width(lowDataMode ? 640 : 1280).height(lowDataMode ? 640 : 1280));
  };

  // Helper for delivery: q_auto:eco for low-data rural plans, q_auto standard otherwise
  const applyDelivery = (img: CloudinaryImage) => {
    return img
      .resize(limitFit().width(lowDataMode ? 640 : 1280).height(lowDataMode ? 640 : 1280))
      .delivery(format(auto()))
      .delivery(quality(lowDataMode ? autoEco() : autoQuality()));
  };

  switch (filter) {
    case 'auto_enhance': {
      // Gentle correction avoids stacking multiple automatic exposure adjustments.
      const adjusted = base
        .adjust(improve().blend(30))
        .adjust(sharpen(20));
      return applyDelivery(applyZoomAndCrop(adjusted));
    }

    case 'hd_sharpen': {
      // Clinical enhancement: improves exposure, suppresses noise, sharpens fine micro-textures
      const adjusted = base
        .adjust(improve())
        .adjust(sharpen(100))
        .adjust(unsharpMask(150));
      return applyDelivery(applyZoomAndCrop(adjusted));
    }

    case 'color_restore': {
      // Color correction: balances skin tone pigments and highlights erythema (redness/inflammation)
      const adjusted = base
        .adjust(autoContrast())
        .adjust(autoColor())
        .adjust(vibrance(35));
      return applyDelivery(applyZoomAndCrop(adjusted));
    }

    case 'wound_zoom': {
      // AI Subject Detection or Physician Manual ROI Zoom
      const defaultZoom = zoomLevel > 1.0 ? zoomLevel : 1.5;
      const adjusted = base.adjust(improve());
      return applyDelivery(applyZoomAndCrop(adjusted, defaultZoom));
    }

    case 'margin_outline': {
      // Contrast boost only. The wound border itself is traced client-side
      // from erythema pixels — Cloudinary e_outline strokes the photo rectangle.
      const adjusted = base
        .adjust(autoContrast())
        .adjust(vibrance(20))
        .adjust(unsharpMask(180));
      return applyDelivery(applyZoomAndCrop(adjusted));
    }

    case 'raw':
    default:
      return applyDelivery(applyZoomAndCrop(base));
  }
}
