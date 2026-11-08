import { Cloudinary } from '@cloudinary/url-gen';

// Used only to compose transformation strings in the browser (transformationFor).
// Uploads and delivery URLs are signed on the server (src/media/cloudinary.ts);
// no Cloudinary name, preset or URL reaches the browser.
export const cld = new Cloudinary({ cloud: { cloudName: 'transformations-only' }, url: { secure: true } });
