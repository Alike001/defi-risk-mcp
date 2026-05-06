import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createServer } from '../index.js';
import {
  type SimulationResult,
  TenderlyApiError,
  TenderlyMissingCredentialsError,
  cacheKeyFor,
  clearSimulationCache,
  simulateTransaction,
} from '../lib/tenderly.js';
import { InvalidTxHexError, decodeRawTx } from '../lib/txDecoder.js';
import { MEV_RISK_BANDS, txRiskReportSchema } from '../schemas/domain.js';
import {
  SIMULATE_TX_RISK_TOOL_NAME,
  buildReport,
  scoreMevRisk,
  simulateTxRisk,
} from '../tools/simulateTxRisk.js';

/**
 * Story: story-tool-simulate-tx-risk (#3).
 *
 * BDD acceptance:
 *   1. Happy path (Uniswap V3 swap) — valid TxRiskReport, 6 required fields present
 *   2. Happy path (Aave V3 supply) — low MEV verdict, oracle deps present
 *   3. Invalid tx hex — structured error, no crash
 *   4. Malformed chain — structured error
 *   5. Tenderly API failure (mocked) — structured error, no crash
 *   6. MEV-flagged tx (mocked) — high band returned with reasoning
 *   7. (Bonus) Missing credentials → structured error with setup instructions
 *   8. (Bonus) Tool registered + discoverable via MCP listTools
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURES = join(HERE, '..', '..', 'data', 'fixtures', 'txs');

const UNISWAP_HEX = readFileSync(join(FIXTURES, 'uniswap-v3-swap.hex'), 'utf8').trim();
const AAVE_HEX = readFileSync(join(FIXTURES, 'aave-v3-supply.hex'), 'utf8').trim();
const INVALID_HEX = readFileSync(join(FIXTURES, 'invalid.hex'), 'utf8').trim();

/** A "successful" Tenderly response shape used as a stub. */
function fakeOkSimulation(): SimulationResult {
  return {
    success: true,
    gasUsed: 142_000,
    errorMessage: null,
    assetChanges: [],
    balanceChanges: [],
    logs: [],
    simulationId: 'fake-sim-id',
    cached: false,
  };
}

describe('story-tool-simulate-tx-risk', () => {
  beforeEach(() => {
    clearSimulationCache();
  });

  describe('happy path: Uniswap V3 swap on Ethereum (BDD #1)', () => {
    it('decodes the tx, returns a valid TxRiskReport with all required fields', async () => {
      const result = await simulateTxRisk(
        { chain: 'ethereum', unsigned_tx_hex: UNISWAP_HEX },
        { simulate: async () => fakeOkSimulation() },
      );

      expect(result.status).toBe('ok');
      if (result.status !== 'ok') return; // narrow for TS

      // Schema enforces every field; calling parse a second time is a
      // belt-and-braces guard against future drift.
      txRiskReportSchema.parse(result.report);

      // BDD field-level assertions
      expect(MEV_RISK_BANDS).toContain(result.report.mev_risk);
      expect(result.report.mev_reasoning.length).toBeGreaterThanOrEqual(20);
      expect(result.report.slippage_pct).toBeGreaterThanOrEqual(0);
      expect(result.report.counterparty.name).toMatch(/uniswap/i);
      expect(typeof result.report.counterparty.audited).toBe('boolean');
      expect(Array.isArray(result.report.oracle_deps)).toBe(true); // may be empty for AMM
      expect(result.report.portfolio_after).toBeNull();
      expect(result.report.recommendations.length).toBeGreaterThanOrEqual(1);
      expect(result.report.decoded?.function_name).toBe('exactInputSingle');
      expect(result.report.decoded?.selector).toBe('0x414bf389');
    });

    it('flags Uniswap swap as high MEV when notional > $5K and slippage > 0.3%', async () => {
      const result = await simulateTxRisk(
        { chain: 'ethereum', unsigned_tx_hex: UNISWAP_HEX },
        { simulate: async () => fakeOkSimulation() },
      );
      expect(result.status).toBe('ok');
      if (result.status !== 'ok') return;
      // 10K USDC swap with very loose amountOutMinimum → high band expected
      expect(result.report.mev_risk).toBe('high');
      expect(result.report.recommendations.join(' ').toLowerCase()).toMatch(/flashbots|private/);
    });
  });

  describe('happy path: Aave V3 deposit (BDD #2 — non-swap, low MEV)', () => {
    it('returns low MEV with oracle deps for an Aave supply', async () => {
      const result = await simulateTxRisk(
        { chain: 'ethereum', unsigned_tx_hex: AAVE_HEX },
        { simulate: async () => fakeOkSimulation() },
      );
      expect(result.status).toBe('ok');
      if (result.status !== 'ok') return;

      expect(result.report.mev_risk).toBe('low');
      expect(result.report.counterparty.name).toMatch(/aave/i);
      expect(result.report.counterparty.audited).toBe(true);
      expect(result.report.oracle_deps).toContain('chainlink-price-feeds');
      expect(result.report.decoded?.function_name).toBe('supply');
      expect(result.report.slippage_pct).toBe(0);
    });
  });

  describe('rejection paths (BDD #3, #4)', () => {
    it('returns a structured error for invalid tx hex (BDD #3)', async () => {
      const result = await simulateTxRisk(
        { chain: 'ethereum', unsigned_tx_hex: INVALID_HEX },
        { simulate: async () => fakeOkSimulation() },
      );
      expect(result.status).toBe('error');
      if (result.status !== 'error') return;
      expect(result.code).toBe('invalid_input'); // fails Zod regex first
      expect(result.message.length).toBeGreaterThan(0);
    });

    it('returns a structured error when tx hex is well-formed but not a valid tx', async () => {
      // 0x-prefixed hex long enough to survive Zod (>20 chars) but garbage
      // RLP that blows up parseTransaction.
      const result = await simulateTxRisk(
        { chain: 'ethereum', unsigned_tx_hex: '0xdeadbeefcafebabedeadbeefcafebabedeadbeef' },
        { simulate: async () => fakeOkSimulation() },
      );
      expect(result.status).toBe('error');
      if (result.status !== 'error') return;
      expect(result.code).toBe('invalid_tx_hex');
    });

    it('rejects malformed chain (BDD #4)', async () => {
      const result = await simulateTxRisk(
        { chain: 'solana', unsigned_tx_hex: UNISWAP_HEX },
        { simulate: async () => fakeOkSimulation() },
      );
      expect(result.status).toBe('error');
      if (result.status !== 'error') return;
      expect(result.code).toBe('invalid_input');
      expect(result.message.toLowerCase()).toContain('chain');
    });

    it('rejects entirely non-object input', async () => {
      const result = await simulateTxRisk(null);
      expect(result.status).toBe('error');
      if (result.status !== 'error') return;
      expect(result.code).toBe('invalid_input');
    });
  });

  describe('Tenderly API failure (BDD #5)', () => {
    it('returns a structured error (not a crash) when Tenderly returns 5xx', async () => {
      const result = await simulateTxRisk(
        { chain: 'ethereum', unsigned_tx_hex: UNISWAP_HEX },
        {
          simulate: async () => {
            throw new TenderlyApiError('Tenderly simulate 503: upstream timeout', 503);
          },
        },
      );
      expect(result.status).toBe('error');
      if (result.status !== 'error') return;
      expect(result.code).toBe('tenderly_api_error');
      expect(result.message).toMatch(/503/);
    });

    it('returns a structured missing_credentials error with setup instructions (BDD #7)', async () => {
      const result = await simulateTxRisk(
        { chain: 'ethereum', unsigned_tx_hex: UNISWAP_HEX },
        {
          simulate: async () => {
            throw new TenderlyMissingCredentialsError([
              'TENDERLY_USER',
              'TENDERLY_PROJECT',
              'TENDERLY_ACCESS_KEY',
            ]);
          },
        },
      );
      expect(result.status).toBe('error');
      if (result.status !== 'error') return;
      expect(result.code).toBe('missing_credentials');
      expect(result.message).toMatch(/TENDERLY_USER/);
      expect(result.message).toMatch(/setup|instructions|tenderly\.co/i);
    });
  });

  describe('MEV verdict logic (BDD #6)', () => {
    it('returns "high" band on AMM swap with $10K notional and 0.5% slippage', async () => {
      const decoded = await decodeRawTx('ethereum', UNISWAP_HEX);
      const verdict = scoreMevRisk(decoded, 10_000, 0.5);
      expect(verdict.band).toBe('high');
      expect(verdict.reasoning.toLowerCase()).toMatch(/sandwich|flashbots|private/);
    });

    it('returns "medium" band on AMM swap with smaller size', async () => {
      const decoded = await decodeRawTx('ethereum', UNISWAP_HEX);
      const verdict = scoreMevRisk(decoded, 500, 0.1);
      expect(verdict.band).toBe('medium');
    });

    it('returns "low" band for non-swap tx (Aave supply)', async () => {
      const decoded = await decodeRawTx('ethereum', AAVE_HEX);
      const verdict = scoreMevRisk(decoded, 10_000, 0);
      expect(verdict.band).toBe('low');
    });
  });

  describe('decoder + ABI registry', () => {
    it('decodeRawTx resolves Uniswap router from the local registry without network', async () => {
      const decoded = await decodeRawTx('ethereum', UNISWAP_HEX);
      expect(decoded.counterparty?.name).toMatch(/uniswap/i);
      expect(decoded.counterparty?.isPublicAmm).toBe(true);
      expect(decoded.call?.functionName).toBe('exactInputSingle');
      expect(decoded.selector).toBe('0x414bf389');
    });

    it('decodeRawTx throws InvalidTxHexError on garbage hex', async () => {
      await expect(decodeRawTx('ethereum', '0xdeadbeef')).rejects.toBeInstanceOf(InvalidTxHexError);
    });

    it('buildReport handles unknown counterparty without fabricating a name', () => {
      const report = buildReport(
        'ethereum',
        {
          to: '0xffffffffffffffffffffffffffffffffffffffff',
          value: '0',
          data: '0x',
          selector: null,
          from: null,
          counterparty: null,
          call: null,
        },
        null,
      );
      expect(report.counterparty.name).toMatch(/Unknown contract/);
      expect(report.counterparty.audited).toBe(false);
      expect(report.mev_risk).toBe('low');
      expect(report.recommendations.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('Tenderly client cache + credential gate', () => {
    it('throws TenderlyMissingCredentialsError when env vars unset', async () => {
      // resolveCredentials uses process.env defaults; we override with empty strings
      await expect(
        simulateTransaction(
          {
            chain: 'ethereum',
            from: '0x0000000000000000000000000000000000000000',
            to: '0x0000000000000000000000000000000000000001',
            input: '0x',
            value: '0',
          },
          { user: '', project: '', accessKey: '' },
        ),
      ).rejects.toBeInstanceOf(TenderlyMissingCredentialsError);
    });

    it('serves repeat requests from the in-process cache (free-tier amortization)', async () => {
      const fakeFetch = vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              transaction: {
                status: true,
                gas_used: 100_000,
                transaction_info: { asset_changes: [], balance_changes: [], logs: [] },
              },
              simulation: { id: 'abc', status: true },
            }),
            { status: 200, headers: { 'content-type': 'application/json' } },
          ),
      ) as unknown as typeof fetch;

      const req = {
        chain: 'ethereum' as const,
        from: '0x0000000000000000000000000000000000000000' as `0x${string}`,
        to: '0x68b3465833Fb72A70ecdf485e0E4c7BD8665fc45' as `0x${string}`,
        input: '0xdeadbeef' as `0x${string}`,
        value: '0',
      };

      const a = await simulateTransaction(req, {
        fetchImpl: fakeFetch,
        user: 'u',
        project: 'p',
        accessKey: 'k',
      });
      const b = await simulateTransaction(req, {
        fetchImpl: fakeFetch,
        user: 'u',
        project: 'p',
        accessKey: 'k',
      });

      expect(a.cached).toBe(false);
      expect(b.cached).toBe(true);
      expect(fakeFetch).toHaveBeenCalledTimes(1);
    });

    it('cacheKeyFor is stable + chain-sensitive', () => {
      const base = {
        chain: 'ethereum' as const,
        from: '0x0000000000000000000000000000000000000000' as `0x${string}`,
        to: '0x68b3465833fb72a70ecdf485e0e4c7bd8665fc45' as `0x${string}`,
        input: '0x414bf389' as `0x${string}`,
        value: '0',
      };
      const arb = { ...base, chain: 'arbitrum' as const };
      expect(cacheKeyFor(base)).toBe(cacheKeyFor(base));
      expect(cacheKeyFor(base)).not.toBe(cacheKeyFor(arb));
    });
  });

  describe('MCP tool registration (BDD #8)', () => {
    let client: Client;
    let close: () => Promise<void>;

    beforeEach(async () => {
      const server = createServer();
      const [serverTransport, clientTransport] = InMemoryTransport.createLinkedPair();
      client = new Client(
        { name: 'simulate-tx-risk-test-client', version: '0.0.0' },
        { capabilities: {} },
      );
      await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
      close = async () => {
        await client.close();
        await server.close();
      };
    });

    afterEach(async () => {
      await close();
    });

    it('lists simulate_tx_risk among the registered tools', async () => {
      const { tools } = await client.listTools();
      const names = tools.map((t) => t.name);
      expect(names).toContain(SIMULATE_TX_RISK_TOOL_NAME);
      expect(SIMULATE_TX_RISK_TOOL_NAME).toBe('simulate_tx_risk');
    });

    it('describes the tool with chains + MEV heuristic + Tenderly limit', async () => {
      const { tools } = await client.listTools();
      const tool = tools.find((t) => t.name === SIMULATE_TX_RISK_TOOL_NAME);
      expect(tool).toBeDefined();
      expect(tool?.description).toMatch(/ethereum/i);
      expect(tool?.description).toMatch(/mev/i);
      expect(tool?.description).toMatch(/tenderly|simulation/i);
      expect(tool?.description).toMatch(/100/); // free-tier limit documented
    });
  });
});
