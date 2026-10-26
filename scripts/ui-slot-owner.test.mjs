import { test, expect } from 'vitest';
import { scoreSlotOwnership } from './persistence/ui-slot-owner.mjs';

test('unit 12 smoke scores exactly eight observations and two real user commands', () => {
  const proof = { commands: [6, 8].map(requested => ({ requested, committed: requested, revision: 1, outcome: 'ack' })), checks: ['user-choice', 'reload', 'reconnect', 'stale-cross-draft-url', 'return-to-draft', 'second-tab', 'two-tab-slot-change', 'two-tab-reload'].map((kind, index) => ({ kind, expected: index >= 6 ? 8 : kind === 'stale-cross-draft-url' ? 1 : 6, actual: index >= 6 ? 8 : kind === 'stale-cross-draft-url' ? 1 : 6 })) };
  expect(scoreSlotOwnership(proof)).toBe(true);
  for (const mutate of [row => row.commands.pop(), row => row.checks.pop(), row => row.checks[2].actual = 2, row => row.checks.reverse(), row => { row.checks[0].actual = 0; row.checks[0].expected = 0; }, row => row.commands[0].committed = 3]) {
    const invalid = structuredClone(proof); mutate(invalid); expect(scoreSlotOwnership(invalid)).toBe(false);
  }
});
