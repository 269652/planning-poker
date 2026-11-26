/** Base path this deployment is served from, e.g. "/planning-poker" on GitHub Pages ("" locally). */
export const BASE_PATH = (process.env.NEXT_PUBLIC_BASE_PATH ?? "").replace(/\/+$/, "");

/** Origin + base path, e.g. https://me.github.io/planning-poker */
export function siteUrl(): string {
  return window.location.origin + BASE_PATH;
}

/** Demo rooms with fake Jira data exist only in `npm run dev`; the published site always needs the helper. */
export const DEMO_ENABLED = process.env.NODE_ENV === "development";
