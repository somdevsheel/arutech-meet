/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  transpilePackages: ["@arutech/types", "@arutech/validation"],
  eslint: {
    ignoreDuringBuilds: true,
  },
};

module.exports = nextConfig;
