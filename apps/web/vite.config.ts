import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
  server: {
    // In dev, the browser talks only to Vite; anything under /api is
    // forwarded to the Fastify server. In prod, Nginx plays this role.
    proxy: {
      '/api': 'http://localhost:3000',
    },
  },
});
