/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Emit a self-contained server (.next/standalone) for the Docker image.
  output: "standalone",
};

export default nextConfig;
