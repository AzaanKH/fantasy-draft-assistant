import { describe, expect, it } from 'vitest';
import { decodeFantasyProsSnapshot, decodePlayerIdentityFile, decodeSleeperDataFile, decodeKeeperFile, decodePrimaryLeagueSettingsFile } from '@fantasy-draft/shared/catalog';
import identity from '../../demo-data/player-identity.json' with { type: 'json' };
import sleeper from '../../demo-data/sleeper-adp.json' with { type: 'json' };
import snapshot from '../../demo-data/fantasypros-snapshot.json' with { type: 'json' };
import keepers from '../../demo-data/league-history/current-keepers.json' with { type: 'json' };
import settings from '../../demo-data/primary-league-settings.json' with { type: 'json' };
import baseline from './p7-guard-acceptance.js';

const corpus: { label: string; shape: string; value: unknown; decode: (value: unknown) => unknown }[] = [];
const addIdentity = (label: string, value: unknown) => corpus.push({ label, shape: 'identity', value, decode: decodePlayerIdentityFile });
const addSleeper = (label: string, value: unknown) => corpus.push({ label, shape: 'sleeper', value, decode: decodeSleeperDataFile });
const addSnapshot = (label: string, value: unknown) => corpus.push({ label, shape: 'snapshot', value, decode: decodeFantasyProsSnapshot });
  addIdentity('real demo file', identity);
  addSleeper('real demo file', sleeper);
  addSnapshot('real demo file', snapshot);
  for (const value of [null, {}, [], 42, 'invalid']) {
    addIdentity(`invalid root ${JSON.stringify(value)}`, value);
    addSleeper(`invalid root ${JSON.stringify(value)}`, value);
    addSnapshot(`invalid root ${JSON.stringify(value)}`, value);
  }
  const row = identity.players[0];
  if (!row) throw new Error('Demo identity fixture is empty');
  const identityRows = [null, {}, { ...row, canonicalId: '' }, { ...row, name: null }, { ...row, aliases: [null] }, { ...row, aliases: 'Fixture Player' }, { ...row, position: 'INVALID' }, { ...row, team: 'INVALID' }, { ...row, sleeperId: 123 }, { ...row, fantasyProsId: '' }, { ...row, name: '   ' }, { ...row, sleeperId: undefined, fantasyProsId: undefined }];
  identityRows.forEach((r, i) => addIdentity(`validator row case ${i}`, { ...identity, players: [row, r] }));
  addIdentity('nonfinite season', { ...identity, season: Infinity });
  addIdentity('extra fields preserved', { ...identity, extra: 123 });
  for (const [field, value] of Object.entries({ fetchedAt: null, source: 1, playerCount: Infinity, players: {} })) addSleeper(`invalid ${field}`, { ...sleeper, [field]: value });
  addSleeper('count mismatch', { ...sleeper, playerCount: sleeper.playerCount + 1 });
  for (const [field, value] of Object.entries({ playerId: 123, name: null, position: 'INVALID', team: 'INVALID', sleeperAdp: NaN, age: '25', yearsExp: false, status: null })) addSleeper(`invalid row ${field}`, { ...sleeper, playerCount: 1, players: [{ ...sleeper.players[0], [field]: value }] });
  addSleeper('nullable and omitted metadata', { ...sleeper, playerCount: 1, players: [{ ...sleeper.players[0], age: null, yearsExp: null, status: undefined }] });
  addSnapshot('metadata missing required fields', { ...snapshot, metadata: {} });
  addSnapshot('metadata invalid sourceType', { ...snapshot, metadata: { ...snapshot.metadata, sourceType: 'untrusted' } });
  addSnapshot('ranking malformed optional provider id', { ...snapshot, rankings: [{ ...snapshot.rankings[0], fantasyProsId: 123 }] });
  addSnapshot('ranking malformed optional tier', { ...snapshot, rankings: [{ ...snapshot.rankings[0], fantasyProsTier: 'one' }] });
  addSnapshot('news missing headline', { ...snapshot, news: [{ name: 'Fixture', position: 'WR', team: 'DAL', status: 'healthy' }] });
  addSnapshot('nonfinite custom scoring adjustment', { ...snapshot, projections: [{ ...snapshot.projections[0], customScoringAdjustment: Infinity }] });
  addSnapshot('unknown projected stat invalid', { ...snapshot, projections: [{ ...snapshot.projections[0], projectedUnrecognized: 'invalid' }] });

const tightenings = new Set([
  'metadata missing required fields', 'metadata invalid sourceType',
  'ranking malformed optional provider id', 'ranking malformed optional tier',
  'news missing headline', 'nonfinite custom scoring adjustment',
]);

describe('P7 acceptance corpus', () => {
  it('retains all 53 original mutation cases', () => {
    expect(corpus.map(({ shape, label }) => ({ shape, label }))).toEqual(baseline.map(({ shape, label }) => ({ shape, label })));
  });
  for (const [index, entry] of corpus.entries()) {
    it(`${entry.shape}: ${entry.label}`, () => {
      const old = baseline[index];
      if (!old) throw new Error('Missing P7 baseline row');
      if (entry.shape === 'sleeper' && entry.label.startsWith('invalid row ')) {
        const warnings: string[] = [];
        expect(decodeSleeperDataFile(entry.value, { onWarning: message => warnings.push(message) })).toMatchObject({ players: [], playerCount: 0 });
        expect(warnings).toEqual(['Dropped 1 invalid Sleeper rows.']);
        return;
      }
      const accepted = tightenings.has(entry.label) ? false : old.accepted;
      if (accepted) expect(entry.decode(entry.value)).toEqual(entry.value);
      else expect(() => entry.decode(entry.value)).toThrow();
    });
  }
  it('decodes keeper and league settings demo files without losing fields', () => {
    expect(decodeKeeperFile(keepers)).toEqual(keepers);
    expect(decodePrimaryLeagueSettingsFile(settings)).toEqual(settings);
  });
});
