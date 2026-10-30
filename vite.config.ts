import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
export default defineConfig({
  plugins: [react()],
  build: { rollupOptions: { output: { manualChunks: {
    motion: ['gsap','@gsap/react'],
    accounts: ['@supabase/supabase-js'],
  } } } },
  server: { proxy: {
    '/api': 'http://127.0.0.1:8000',
    '/ws': { target: 'ws://127.0.0.1:8000', ws: true },
  } },
});
