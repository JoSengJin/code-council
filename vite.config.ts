import { defineConfig } from 'vitest/config';
export default defineConfig({ root: 'web', server: { port: 5173, proxy: { '/api': 'http://127.0.0.1:3001' } }, build: { outDir: '../dist', emptyOutDir: true }, test: { root: '.' } });
