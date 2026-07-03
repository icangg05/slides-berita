/** @type {import('next').NextConfig} */
const nextConfig = {
  // Produces a self-contained server bundle (.next/standalone) for the
  // lightweight production Docker runner stage (see Dockerfile).
  output: "standalone",

  // The kiosk pulls featured images straight from the WordPress media library.
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "berita.kendarikota.go.id",
        pathname: "/**",
      },
    ],
    // Signage runs on a single fixed portrait panel; keep the optimizer lean.
    formats: ["image/webp"],
  },

  // Silence the multi-lockfile / workspace-root inference warning in Docker.
  outputFileTracingRoot: process.cwd(),
};

export default nextConfig;
