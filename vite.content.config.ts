import { defineConfig } from 'vite';

// Agente injetado nas páginas via chrome.scripting.executeScript({ files }).
// Precisa ser um script clássico autocontido (IIFE), sem imports — por isso tem um build separado.
export default defineConfig({
  publicDir: false,
  build: {
    outDir: 'dist',
    emptyOutDir: false,
    target: 'es2022',
    lib: {
      entry: 'src/content/agent.ts',
      name: 'ApplyPilotAgentBundle',
      formats: ['iife'],
      fileName: () => 'content/agent.js',
    },
  },
});
