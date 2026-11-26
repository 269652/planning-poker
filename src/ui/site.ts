/** Base path this deployment is served from, e.g. "/planning-poker" on GitHub Pages ("" locally). */
export const BASE_PATH = (process.env.NEXT_PUBLIC_BASE_PATH ?? "").replace(/\/+$/, "");

/** Origin + base path, e.g. https://me.github.io/planning-poker */
export function siteUrl(): string {
  return window.location.origin + BASE_PATH;
}

/**
 * WebSocket relay (relay/, deployed to Vercel), e.g. wss://planning-poker-relay.vercel.app/api/relay.
 * Set NEXT_PUBLIC_RELAY_URL at build time; `npm run dev` falls back to the local relay (`npm run relay`).
 */
export const RELAY_URL = process.env.NEXT_PUBLIC_RELAY_URL
  || (process.env.NODE_ENV === "development" ? "ws://localhost:8788/api/relay" : "");

/** Demo rooms with fake Jira data exist only in `npm run dev`; the published site always needs the helper. */
export const DEMO_ENABLED = process.env.NODE_ENV === "development";
