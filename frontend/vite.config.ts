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
        manualChunks: {
          vendor: ['react', 'react-dom'],
          clerk: ['@clerk/clerk-react'],
          editor: [
            'lexical',
            '@lexical/react',
            '@lexical/rich-text',
            '@lexical/list',
            '@lexical/link',
            '@lexical/code',
            '@lexical/markdown',
            'novel',
          ],
          query: ['@tanstack/react-query'],
          dnd: ['@hello-pangea/dnd'],
          motion: ['framer-motion'],
        },
      },
    },
  },
});
