import { Cloudinary } from '@cloudinary/url-gen';

export const cloudName = process.env.NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME || '';
export const uploadPreset = process.env.NEXT_PUBLIC_CLOUDINARY_UPLOAD_PRESET || '';
export const cld = new Cloudinary({ cloud: { cloudName: cloudName || 'unconfigured' }, url: { secure: true } });
