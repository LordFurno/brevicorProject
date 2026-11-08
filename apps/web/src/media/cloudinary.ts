import 'server-only';
import { v2 as cloudinary } from 'cloudinary';

/**
 * Cloudinary, server side only. Patient photos are health information, so:
 * - uploads are signed here with the API secret (never sent to the browser,
 *   no unsigned preset);
 * - assets are stored with delivery type `authenticated`: no public URL works;
 * - public ids are random UUIDs (no clinic, patient, visit or file name);
 * - delivery URLs are signed here and fetched by Brevicor's media route, so
 *   the browser only ever sees short-lived Brevicor URLs (photo-urls.ts).
 */

interface CloudinaryEnv {
  cloudName: string;
  apiKey: string;
  apiSecret: string;
}

function env(): CloudinaryEnv | null {
  const cloudName = process.env.CLOUDINARY_CLOUD_NAME ?? process.env.NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME;
  const apiKey = process.env.CLOUDINARY_API_KEY;
  const apiSecret = process.env.CLOUDINARY_API_SECRET;
  return cloudName && apiKey && apiSecret ? { cloudName, apiKey, apiSecret } : null;
}

export const photosConfigured = () => env() !== null;

function config(): CloudinaryEnv {
  const e = env();
  if (!e) throw new Error('Photo storage is not configured.');
  return e;
}

export interface UploadedAsset {
  publicId: string;
  version?: number;
  width?: number;
  height?: number;
}

/** Signed upload as an authenticated (private) asset under a random id. */
export async function uploadAuthenticated(file: Blob): Promise<UploadedAsset> {
  const { cloudName, apiKey, apiSecret } = config();
  const params = {
    public_id: `brevicor/${crypto.randomUUID()}`,
    type: 'authenticated',
    overwrite: 'false',
    timestamp: String(Math.floor(Date.now() / 1000)),
  };
  const body = new FormData();
  for (const [k, v] of Object.entries(params)) body.append(k, v);
  body.append('api_key', apiKey);
  body.append('signature', cloudinary.utils.api_sign_request(params, apiSecret));
  body.append('file', file, 'photo'); // never the user's file name
  const result = await fetch(`https://api.cloudinary.com/v1_1/${encodeURIComponent(cloudName)}/image/upload`, {
    method: 'POST',
    body,
    signal: AbortSignal.timeout(60000),
  });
  const data = (await result.json()) as { public_id?: string; version?: number; width?: number; height?: number; type?: string };
  if (!result.ok || !data.public_id || data.type !== 'authenticated') throw new Error('Cloudinary could not store this photo.');
  return { publicId: data.public_id, version: data.version, width: data.width, height: data.height };
}

/** Only Cloudinary transformation syntax (letters, digits, _ , : . / - $ % and URL-escaped text overlays). */
export const TRANSFORMATION_RE = /^[A-Za-z0-9_,:./$%!-]{0,2000}$/;

/** A signed delivery URL for an authenticated asset. Server-side only: it never expires. */
export function signedDeliveryUrl(publicId: string, version: number | undefined, transformation: string): string {
  if (!TRANSFORMATION_RE.test(transformation)) throw new Error('Invalid transformation');
  const { cloudName, apiKey, apiSecret } = config();
  return cloudinary.url(publicId, {
    cloud_name: cloudName,
    api_key: apiKey,
    api_secret: apiSecret,
    resource_type: 'image',
    type: 'authenticated',
    sign_url: true,
    secure: true,
    urlAnalytics: false, // no SDK tracking parameter on delivery URLs
    ...(version ? { version } : {}),
    ...(transformation ? { raw_transformation: transformation } : {}),
  });
}
