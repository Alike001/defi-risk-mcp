import { describe, expect, it } from 'vitest';

describe('repo bootstrap smoke test', () => {
  it('is a real test runner, not a placeholder', () => {
    expect(1 + 1).toBe(2);
  });

  it('has a working ESM module system', async () => {
    const result = await Promise.resolve({ ok: true });
    expect(result.ok).toBe(true);
  });
});
