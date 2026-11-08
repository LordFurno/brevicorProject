import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: { alias: {
    '@': fileURLToPath(new URL('./src/', import.meta.url)),
    'server-only': fileURLToPath(new URL('../../tests/stubs/server-only.ts', import.meta.url)),
  } },
  root: fileURLToPath(new URL('./', import.meta.url)),
  test: { include: ['tests/cloudinary/*.test.ts'], setupFiles: ['./tests/setup.ts'], environment: 'node' },
});
