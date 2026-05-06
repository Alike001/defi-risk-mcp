import path from 'node:path';
import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Pin the workspace root so Next does not climb to the parent monorepo
  // and emit a "multiple lockfiles" warning. The landing has its own
  // pnpm-lock.yaml — that's the truth.
  outputFileTracingRoot: path.join(import.meta.dirname),
};

export default nextConfig;
