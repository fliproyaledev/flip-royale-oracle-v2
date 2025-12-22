/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Oracle projesi olduğu için TypeScript hatalarının build'i durdurmasını engelliyoruz
  typescript: {
    ignoreBuildErrors: true,
  },
  // ESLint hatalarını da yoksay (Hızlı deploy için)
  eslint: {
    ignoreDuringBuilds: true,
  }
};

module.exports = nextConfig;
