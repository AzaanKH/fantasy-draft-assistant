import { describe, expect, it } from 'vitest';
import { decodeFantasyProsSnapshot, decodePlayerIdentityFile, decodeSleeperDataFile, decodeKeeperFile, decodePrimaryLeagueSettingsFile } from '@fantasy-draft/shared/catalog';
import identity from '../../demo-data/player-identity.json' with { type: 'json' };
import sleeper from '../../demo-data/sleeper-adp.json' with { type: 'json' };
import snapshot from '../../demo-data/fantasypros-snapshot.json' with { type: 'json' };
import keepers from '../../demo-data/league-history/current-keepers.json' with { type: 'json' };
import settings from '../../demo-data/primary-league-settings.json' with { type: 'json' };

const decoders = {
  identity: decodePlayerIdentityFile, sleeper: decodeSleeperDataFile, snapshot: decodeFantasyProsSnapshot,
  keepers: decodeKeeperFile, settings: decodePrimaryLeagueSettingsFile,
} as const;
const row = identity.players[0];
if (!row) throw new Error('Demo identity fixture is empty');

describe('catalog file decoders on the demo data', () => {
  it.each([
    ['identity', identity], ['sleeper', sleeper], ['snapshot', snapshot], ['keepers', keepers], ['settings', settings],
    ['identity', { ...identity, extra: 123 }],
    ['identity', { ...identity, players: [row, { ...row, sleeperId: undefined, fantasyProsId: undefined }] }],
    ['sleeper', { ...sleeper, playerCount: 1, players: [{ ...sleeper.players[0], age: null, yearsExp: null, status: undefined }] }],
  ] as const)('decodes a %s file without losing fields', (shape, value) => {
    expect(decoders[shape](value)).toEqual(value);
  });

  it.each([
    ['identity', null], ['sleeper', []], ['snapshot', 'invalid'],
    ['identity', { ...identity, season: Infinity }],
    ...[{}, { ...row, canonicalId: '' }, { ...row, aliases: [null] }, { ...row, position: 'INVALID' }, { ...row, sleeperId: 123 }, { ...row, name: '   ' }]
      .map(invalid => ['identity', { ...identity, players: [row, invalid] }] as const),
    ['sleeper', { ...sleeper, players: {} }],
    ['sleeper', { ...sleeper, playerCount: sleeper.playerCount + 1 }],
    ['snapshot', { ...snapshot, metadata: {} }],
    ['snapshot', { ...snapshot, metadata: { ...snapshot.metadata, sourceType: 'untrusted' } }],
    ['snapshot', { ...snapshot, rankings: [{ ...snapshot.rankings[0], fantasyProsTier: 'one' }] }],
    ['snapshot', { ...snapshot, news: [{ name: 'Fixture', position: 'WR', team: 'DAL', status: 'healthy' }] }],
    ['snapshot', { ...snapshot, projections: [{ ...snapshot.projections[0], projectedUnrecognized: 'invalid' }] }],
  ] as const)('rejects an invalid %s file', (shape, value) => {
    expect(() => decoders[shape](value)).toThrow();
  });

  it.each(Object.entries({ playerId: 123, name: null, position: 'INVALID', sleeperAdp: NaN, age: '25' }))(
    'drops a Sleeper row with an invalid %s and warns', (field, value) => {
      const warnings: string[] = [];
      expect(decodeSleeperDataFile({ ...sleeper, playerCount: 1, players: [{ ...sleeper.players[0], [field]: value }] },
        { onWarning: message => warnings.push(message) })).toMatchObject({ players: [], playerCount: 0 });
      expect(warnings).toEqual(['Dropped 1 invalid Sleeper rows.']);
    });
});
