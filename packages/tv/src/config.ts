export const BROKER_URL = (() => {
  const env = (import.meta.env as Record<string, string>).VITE_BROKER_URL;
  if (env) return env;
  const host = location.hostname;
  return `ws://${host}:8787`;
})();

// Where on a phone the controller PWA lives. For local dev, same host, port 5173.
export const CONTROLLER_URL = (() => {
  const env = (import.meta.env as Record<string, string>).VITE_CONTROLLER_URL;
  if (env) return env;
  return `${location.protocol}//${location.hostname}:5173`;
})();

export const DEFAULT_MAP_ID = 'phnom-penh-streets';
