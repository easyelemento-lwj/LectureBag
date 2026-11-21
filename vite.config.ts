import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {defineConfig, loadEnv} from 'vite';
import { androidSecurityPolicy } from './scripts/androidSecurityPolicy';

export default defineConfig(({ mode }) => {
  return {
    plugins: [react(), tailwindcss(), ...(['desktop', 'android'].includes(mode) ? [{
      name: 'desktop-offline-shell',
      // Remote stylesheets block the initial render when offline. Desktop uses
      // the existing CSS font fallbacks; normal web builds are unchanged.
      transformIndexHtml: (html: string) => html.replace(/<link\b[^>]*href="https:\/\/[^\"]*"[^>]*>/g, ''),
    }] : []), ...(mode === 'android' ? [{
      name: 'android-content-security-policy',
      transformIndexHtml: () => [{ tag: 'meta', attrs: {
        'http-equiv': 'Content-Security-Policy',
        content: androidSecurityPolicy(loadEnv(mode, process.cwd(), 'VITE_PROXY_SERVER_URL').VITE_PROXY_SERVER_URL || 'https://lecturebag-production.up.railway.app'),
      }, injectTo: 'head-prepend' as const }],
    }] : [])],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    server: {
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modifyâfile watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
      // Disable file watching when DISABLE_HMR is true to save CPU during agent edits.
      watch: process.env.DISABLE_HMR === 'true' ? null : {},
    },
  };
});
