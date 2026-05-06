/**
 * Composability-tree loader.
 *
 * For the top-N protocols we ship hand-curated maps in `data/composability/`
 * (per the story file: "manual composability maps for top 10 protocols, JSON
 * files"). Each map encodes the protocol's direct upstream dependencies
 * (oracles, lower-level primitives) and downstream consumers (LRTs, yield
 * aggregators, leveraged-LP wrappers).
 *
 * For protocols *not* in the curated set we fall back to a coarse map
 * inferred from DefiLlama metadata category — this is intentionally
 * conservative so the LLM does not invent integrations that don't exist.
 *
 * Per architecture.md ADR-005, no external API call is made here — the JSONs
 * are bundled with the npm package (see `package.json#files` includes `data`).
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';

const HERE = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(HERE, '..', '..', 'data', 'composability');

/**
 * On-disk composability JSON shape. Mirrors `composabilityTreeSchema` in
 * `src/schemas/domain.ts` but we keep this Zod schema local so the lib does
 * not import schemas (lib boundary is one-way).
 */
const composabilityFileSchema = z.object({
  protocol: z.string().min(1),
  depth: z.number().int().nonnegative(),
  depends_on: z.array(z.string()),
  downstream_users: z.array(z.string()),
  notes: z.string().nullable().optional(),
});

export interface ComposabilityRecord {
  protocol: string;
  depth: number;
  dependsOn: string[];
  downstreamUsers: string[];
  notes: string | null;
}

/**
 * The curated set of slugs we ship JSON maps for. Mirrors the top-6 list in
 * the story notes (aave-v3, morpho, pendle, ethena, lido, eigenlayer).
 */
export const CURATED_COMPOSABILITY_SLUGS = Object.freeze([
  'aave-v3',
  'morpho',
  'pendle',
  'ethena',
  'lido',
  'eigenlayer',
] as const);

export type CuratedComposabilitySlug = (typeof CURATED_COMPOSABILITY_SLUGS)[number];

/**
 * Load a curated composability map for `protocolSlug`. Returns `null` when
 * the slug is not in the curated set OR the file is missing (the latter is
 * a packaging bug — we surface it on stderr).
 */
export function loadCuratedComposability(protocolSlug: string): ComposabilityRecord | null {
  if (!(CURATED_COMPOSABILITY_SLUGS as readonly string[]).includes(protocolSlug)) {
    return null;
  }

  const path = join(DATA_DIR, `${protocolSlug}.json`);
  let raw: string;
  try {
    raw = readFileSync(path, 'utf8');
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    process.stderr.write(`[composability] missing map for ${protocolSlug}: ${message}\n`);
    return null;
  }

  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(raw);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    process.stderr.write(`[composability] invalid JSON for ${protocolSlug}: ${message}\n`);
    return null;
  }

  const parsed = composabilityFileSchema.safeParse(parsedJson);
  if (!parsed.success) {
    process.stderr.write(
      `[composability] schema mismatch for ${protocolSlug}: ${parsed.error.issues.map((i) => i.message).join('; ')}\n`,
    );
    return null;
  }

  return {
    protocol: parsed.data.protocol,
    depth: parsed.data.depth,
    dependsOn: parsed.data.depends_on,
    downstreamUsers: parsed.data.downstream_users,
    notes: parsed.data.notes ?? null,
  };
}

/**
 * Build a fallback composability tree for protocols outside the curated set.
 * We pull a coarse signal from the DefiLlama category — DEX/AMM, lending,
 * yield aggregator, etc. — and emit a deliberately conservative map so the
 * BDD criterion "response includes composability_tree" always holds.
 *
 * `category` is whatever DefiLlama returned (case-preserved by the caller).
 */
export function inferComposabilityFromCategory(
  protocolSlug: string,
  category: string | null,
): ComposabilityRecord {
  const cat = category?.toLowerCase() ?? '';
  if (cat.includes('lending') || cat.includes('cdp')) {
    return {
      protocol: protocolSlug,
      depth: 1,
      dependsOn: ['chainlink-price-feeds'],
      downstreamUsers: [],
      notes:
        'Inferred from DefiLlama category — verify oracle config and downstream wrappers manually.',
    };
  }
  if (cat.includes('dex')) {
    return {
      protocol: protocolSlug,
      depth: 1,
      dependsOn: [],
      downstreamUsers: ['router-aggregators', 'yield-aggregators'],
      notes: 'Inferred from DefiLlama category — DEX surface composes into routers + LP wrappers.',
    };
  }
  if (cat.includes('liquid staking') || cat.includes('liquid restaking')) {
    return {
      protocol: protocolSlug,
      depth: 1,
      dependsOn: ['ethereum-validator-set'],
      downstreamUsers: ['lending-markets', 'lrt-wrappers'],
      notes:
        'Inferred from DefiLlama category — liquid (re)staking tokens are heavily wrapped downstream.',
    };
  }
  if (cat.includes('yield')) {
    return {
      protocol: protocolSlug,
      depth: 1,
      dependsOn: ['underlying-protocols'],
      downstreamUsers: [],
      notes:
        'Inferred from DefiLlama category — yield aggregators inherit risk from underlying allocations.',
    };
  }
  return {
    protocol: protocolSlug,
    depth: 0,
    dependsOn: [],
    downstreamUsers: [],
    notes:
      'No curated composability map and category not recognized — verify integrations manually.',
  };
}
