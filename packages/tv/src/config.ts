// Sibling-URL derivation:
//   pose-tv.example.com  → broker: wss://pose-broker.example.com, controller: https://pose-ctl.example.com
//   localhost            → broker: ws://localhost:8787, controller: http(s)://localhost:5173
// Override with VITE_BROKER_URL / VITE_CONTROLLER_URL at build time if needed.

const env = (import.meta.env as Record<string, string>);

function derive(prefix: 'pose-broker' | 'pose-ctl', wsProto: boolean): string {
  const host = location.hostname;
  if (host === 'localhost' || host === '127.0.0.1' || /^\d+\.\d+\.\d+\.\d+$/.test(host)) {
    // Local dev: separate ports per service
    const proto = wsProto ? 'ws' : location.protocol.replace(':', '');
    if (prefix === 'pose-broker') return `ws://${host}:8787`;
    if (prefix === 'pose-ctl')    return `${proto}://${host}:5173`;
  }
  // Deployed: replace the leading "pose-{tv|ctl|broker}." with the target service
  const replaced = host.replace(/^pose-[a-z]+/, prefix);
  const proto = wsProto ? 'wss' : 'https';
  return `${proto}://${replaced}`;
}

export const BROKER_URL = env.VITE_BROKER_URL || derive('pose-broker', true);
export const CONTROLLER_URL = env.VITE_CONTROLLER_URL || derive('pose-ctl', false);
export const DEFAULT_MAP_ID = 'phnom-penh-streets';
