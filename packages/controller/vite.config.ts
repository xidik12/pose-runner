import { defineConfig } from 'vite';
import basicSsl from '@vitejs/plugin-basic-ssl';
import { VitePWA } from 'vite-plugin-pwa';
import fs from 'node:fs';
import path from 'node:path';

const certPath = path.resolve(__dirname, '../../certs');
const keyFile = path.join(certPath, 'lan-key.pem');
const certFile = path.join(certPath, 'lan-cert.pem');
const useMkcert = fs.existsSync(keyFile) && fs.existsSync(certFile);

export default defineConfig({
  server: {
    https: useMkcert ? {
      key: fs.readFileSync(keyFile),
      cert: fs.readFileSync(certFile),
    } : true,
    host: true,
  },
  plugins: [
    !useMkcert && basicSsl(),
    VitePWA({ registerType: 'autoUpdate', injectRegister: 'auto' }),
  ].filter(Boolean) as any,
});
