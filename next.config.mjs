// Two ways to deploy the same app:
// - Vercel (VERCEL is set during Vercel builds): a normal Next.js deployment that also serves the
//   WebSocket relay at /api/relay (src/app/api/relay/route.vercel.ts). The site finds it on its own origin.
// - Anywhere else (e.g. GitHub Pages): a static export; the relay runs elsewhere (relay/ on Vercel) and
//   NEXT_PUBLIC_RELAY_URL points at it. NEXT_PUBLIC_BASE_PATH is the sub-path the site is served from,
//   e.g. "/planning-poker" on https://<user>.github.io/planning-poker/ (empty for local dev).
const onVercel = !!process.env.VERCEL;
const basePath = (process.env.NEXT_PUBLIC_BASE_PATH ?? "").replace(/\/+$/, "");
const extensions = ["tsx", "ts", "jsx", "js"];

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  ...(onVercel ? {} : { output: "export", trailingSlash: true }),
  // Files named *.vercel.ts only exist in Vercel builds (the relay route needs a server).
  pageExtensions: onVercel ? [...extensions, "vercel.ts"] : extensions,
  basePath,
  images: { unoptimized: true },
  env: { NEXT_PUBLIC_SAME_ORIGIN_RELAY: onVercel ? "1" : "" },
  // Don't let `next dev` write an AGENTS.md into the repository.
  agentRules: false,
};
export default nextConfig;
