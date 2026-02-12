/** @type {import('next').NextConfig} */
const nextConfig = {
  // サーバー専用パッケージをバンドルから除外
  serverExternalPackages: ['playwright', 'mupdf', 'pdf-parse', 'sharp'],
};

module.exports = nextConfig;
