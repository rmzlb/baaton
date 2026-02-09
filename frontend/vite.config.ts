import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { resolve } from 'path';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': resolve(__dirname, './src'),
    },
  },
  server: {
    port: 3000,
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
    rollupOptions: {
      output: {
        manualChunks(id: string) {
          if (id.includes('node_modules/react-dom') || id.includes('node_modules/react/')) return 'vendor';
          if (id.includes('node_modules/@clerk/')) return 'clerk';
          if (id.includes('node_modules/lexical') || id.includes('node_modules/@lexical') || id.includes('node_modules/novel')) return 'editor';
          if (id.includes('node_modules/@tanstack/')) return 'query';
          if (id.includes('node_modules/@hello-pangea/')) return 'dnd';
          if (id.includes('node_modules/framer-motion')) return 'motion';
        },
      },
    },
  },
});
