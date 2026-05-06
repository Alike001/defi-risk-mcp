// scripts/capture-audit.ts — anti-slop audit capture
//
// Captures two screenshots at 1440x900:
//   - <out>/anchor-bun-1440x900.png      from $ANCHOR_URL  (default https://bun.sh)
//   - <out>/build-current-1440x900.png   from $CURRENT_URL (default http://localhost:3000)
//
// Usage:
//   pnpm exec tsx scripts/capture-audit.ts
//   ANCHOR_URL=https://bun.sh CURRENT_URL=http://localhost:3000 \
//     pnpm exec tsx scripts/capture-audit.ts
//
// Output is committed under landing/.audit/. Each PNG must stay <= 500KB
// per the story acceptance criteria; we re-encode with sharp at palette
// depth 8 to keep size predictable while preserving structural detail.

import { chromium } from '@playwright/test';
import sharp from 'sharp';
import fs from 'node:fs';
import path from 'node:path';

const VIEWPORT = { width: 1440, height: 900 } as const;
const SIZE_BUDGET = 500 * 1024; // 500 KB

const TARGETS: Array<{ url: string; out: string }> = [
  {
    url: process.env.ANCHOR_URL ?? 'https://bun.sh',
    out: 'anchor-bun-1440x900.png',
  },
  {
    url: process.env.CURRENT_URL ?? 'http://localhost:3000',
    out: 'build-current-1440x900.png',
  },
];

async function compressUnderBudget(srcBuf: Buffer, dst: string): Promise<number> {
  // Try increasingly aggressive palette depths until size fits the cap.
  // Falls back to writing the raw PNG if the smallest palette still misses.
  const colourSteps = [256, 128, 64, 48, 32];
  let bestBuf: Buffer | null = null;
  for (const colours of colourSteps) {
    const out = await sharp(srcBuf)
      .png({ palette: true, colours, compressionLevel: 9, effort: 10 })
      .toBuffer();
    bestBuf = out;
    if (out.byteLength <= SIZE_BUDGET) {
      fs.writeFileSync(dst, out);
      return out.byteLength;
    }
  }
  // Final fallback — write smallest attempt, caller will report overflow.
  fs.writeFileSync(dst, bestBuf!);
  return bestBuf!.byteLength;
}

async function main() {
  const outDir = path.resolve(__dirname, '..', '.audit');
  fs.mkdirSync(outDir, { recursive: true });

  const browser = await chromium.launch();
  try {
    const context = await browser.newContext({
      viewport: VIEWPORT,
      // Force 1x DPR — both targets ship retina assets that double PNG weight.
      deviceScaleFactor: 1,
    });
    const page = await context.newPage();

    for (const { url, out } of TARGETS) {
      const file = path.join(outDir, out);
      console.log(`▶ ${url}`);
      // `domcontentloaded` + explicit settle: Next 15 dev keeps an HMR
      // websocket open so `networkidle` never resolves.
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30_000 });
      await page.waitForTimeout(2500);
      const raw = await page.screenshot({ fullPage: false, type: 'png' });
      const finalBytes = await compressUnderBudget(raw, file);
      const kb = Math.round(finalBytes / 1024);
      const flag = finalBytes > SIZE_BUDGET ? ' ⚠ over 500KB cap' : '';
      console.log(`  -> ${file} (${kb} KB)${flag}`);
    }
    await context.close();
  } finally {
    await browser.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
