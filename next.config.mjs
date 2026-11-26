// Static export: the whole app is plain files (GitHub Pages). Rooms run in the host's browser and
// talk over WebRTC, so there is no server.
// NEXT_PUBLIC_BASE_PATH is the sub-path the site is served from, e.g. "/planning-poker" on
// https://<user>.github.io/planning-poker/ (set by the Pages workflow; empty for local dev).
const basePath = (process.env.NEXT_PUBLIC_BASE_PATH ?? "").replace(/\/+$/, "");

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  output: "export",
  trailingSlash: true,
  basePath,
  images: { unoptimized: true },
  // Don't let `next dev` write an AGENTS.md into the repository.
  agentRules: false,
};
export default nextConfig;
