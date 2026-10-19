import { describe, expect, it } from 'vitest';
import { decodeContractRows, decodeContractRelease, decodeContractBacktestRows, isContractSourceColumn } from './contract-source-schema.js';

describe('contract source schemas', () => {
  it.each([null, [], {}, { column_name: '' }, { column_name: 1 }])('preserves rejection of invalid source columns %j', value => {
    expect(isContractSourceColumn(value)).toBe(false);
  });
  it('preserves whitespace and excess source-column fields', () => {
    expect(isContractSourceColumn({ column_name: ' ', column_type: 'VARCHAR' })).toBe(true);
  });
  it('rejects malformed contract query rows atomically', () => {
    expect(() => decodeContractRows([{ sleeper_player_id: '1', gsis_id: 'gsis', contract_end_year: 2026 }, { sleeper_player_id: '2', contract_end_year: 2026 }])).toThrow();
    expect(decodeContractRows([{ sleeper_player_id: 1n, gsis_id: 'gsis', contract_end_year: 2026n }])).toHaveLength(1);
  });
  it('rejects incomplete contract backtest query rows', () => {
    expect(() => decodeContractBacktestRows([{ season: 2026, gsis_id: 'gsis' }])).toThrow();
  });
  it('rejects malformed release timestamps before using contract freshness', () => {
    expect(() => decodeContractRelease({ assets: [{ name: 'historical_contracts.parquet', updated_at: 123 }] })).toThrow();
  });
});
