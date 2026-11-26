/** Base path this deployment is served from, e.g. "/planning-poker" on GitHub Pages ("" locally). */
export const BASE_PATH = (process.env.NEXT_PUBLIC_BASE_PATH ?? "").replace(/\/+$/, "");

/** Origin + base path, e.g. https://me.github.io/planning-poker */
export function siteUrl(): string {
  return window.location.origin + BASE_PATH;
}

/**
 * Where the WebSocket relay is:
 * 1. NEXT_PUBLIC_RELAY_URL if set at build time (e.g. the GitHub Pages build pointing at Vercel);
 * 2. on a Vercel deployment, the relay route of the deployment itself (wss://<site>/api/relay);
 * 3. in `npm run dev`, the local relay (`npm run relay`).
 */
export function resolveRelayUrl(opts: {
  configured?: string; sameOrigin: boolean; dev: boolean; location?: { protocol: string; host: string };
}): string {
  if (opts.configured) return opts.configured;
  if (opts.sameOrigin && opts.location) return `${opts.location.protocol === "https:" ? "wss" : "ws"}://${opts.location.host}/api/relay`;
  if (opts.dev) return "ws://localhost:8788/api/relay";
  return "";
}

export function relayUrl(): string {
  return resolveRelayUrl({
    configured: process.env.NEXT_PUBLIC_RELAY_URL,
    sameOrigin: process.env.NEXT_PUBLIC_SAME_ORIGIN_RELAY === "1",
    dev: process.env.NODE_ENV === "development",
    location: typeof window === "undefined" ? undefined : window.location,
  });
}

/** Demo rooms with fake Jira data exist only in `npm run dev`; the published site always needs the helper. */
export const DEMO_ENABLED = process.env.NODE_ENV === "development";
