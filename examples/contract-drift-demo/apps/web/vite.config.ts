import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

const apiOrigin = process.env.STACKGATE_API_ORIGIN ?? 'http://127.0.0.1:8000';

export default defineConfig({
  plugins: [react()],
  define: { 'import.meta.env.STACKGATE_API_ORIGIN': JSON.stringify(apiOrigin) },
  server: { host: '127.0.0.1', port: 0, strictPort: false },
  preview: { host: '127.0.0.1', port: 0 },
  test: {
    environment: 'jsdom',
    include: ['tests/**/*.test.tsx', 'tests/**/*.test.ts'],
  },
});
