import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { resolve } from 'path';

const buildId = process.env.BAATON_BUILD_ID || new Date().toISOString();

export default defineConfig({
  define: {
    __BUILD_ID__: JSON.stringify(buildId),
  },
  plugins: [
    react(),
    tailwindcss(),
    {
      name: 'emit-version-json',
      generateBundle() {
        this.emitFile({
          type: 'asset',
          fileName: 'version.json',
          source: JSON.stringify({ version: buildId }),
        });
      },
    },
  ],
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
          if (id.includes('node_modules/ai/') || id.includes('node_modules/@ai-sdk/')) return 'ai-sdk';
          if (id.includes('node_modules/zod')) return 'ai-sdk';
        },
      },
    },
  },
});
