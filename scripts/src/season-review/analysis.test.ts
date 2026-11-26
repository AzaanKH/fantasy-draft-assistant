import { describe, expect, it } from 'vitest';
import { pseudonymizeUserId } from '../import-league-draft-history.js';
import { getRecommendations } from '@fantasy-draft/shared/draft';
import { buildBestPickBoard, buildPredraft, buildSeasonReview, nextPickSurvival, replayTiming, resolveManagerRosterId, type PredraftPlayer } from './analysis.js';
import { conditionalSurvival } from './core.js';
import type { SeasonReviewInputs } from './inputs.js';
import { escape, renderSeasonReviewMarkdown } from './markdown.js';

// Two teams, seven rounds: QB RB WR TE FLEX K BN. The manager (slot 1, roster 1) keeps a TE charged at pick 13.
interface Fixture { readonly id: string; readonly position: string; readonly points: number | null; readonly ecr: number; readonly adp?: readonly [number, number] }
const PLAYERS: readonly Fixture[] = [
  { id: 'WRa', position: 'WR', points: 150, ecr: 1, adp: [1, 1.4] },
  { id: 'WRb', position: 'WR', points: 140, ecr: 2 },
  { id: 'WRe', position: 'WR', points: 130, ecr: 3 },
  { id: 'WRf', position: 'WR', points: 50, ecr: 4 },
  { id: 'WRg', position: 'WR', points: 40, ecr: 5 },
  { id: 'TEx', position: 'TE', points: 30, ecr: 6 },
  { id: 'QBb', position: 'QB', points: 200, ecr: 7 },
  { id: 'RBa', position: 'RB', points: 120, ecr: 8 },
  { id: 'QBa', position: 'QB', points: 210, ecr: 9, adp: [6, 9.5] },
  { id: 'RBb', position: 'RB', points: 100, ecr: 10 },
  { id: 'TEb', position: 'TE', points: 60, ecr: 11 },
  { id: 'WRc', position: 'WR', points: 90, ecr: 12 },
  { id: 'RBc', position: 'RB', points: null, ecr: 13 },
  { id: 'WRd', position: 'WR', points: 80, ecr: 14 },
  { id: 'TEk', position: 'TE', points: 75, ecr: 15 },
  { id: 'RBd', position: 'RB', points: 70, ecr: 16 },
  { id: 'QBx', position: 'QB', points: 100, ecr: 20 },
  { id: 'RBx', position: 'RB', points: 20, ecr: 21 },
  { id: 'Ka', position: 'K', points: 92, ecr: 30 },
  { id: 'Kb', position: 'K', points: 80, ecr: 31 },
];
// pick_no → [player, roster, keeper]
const DRAFT: readonly (readonly [string, number, boolean])[] = [
  ['WRa', 1, false], ['WRb', 2, false], ['QBb', 2, false], ['RBa', 1, false], ['QBa', 1, false], ['RBb', 2, false], ['TEb', 2, false],
  ['WRc', 1, false], ['RBc', 1, false], ['WRd', 2, false], ['RBd', 2, false], ['Ka', 1, false], ['TEk', 1, true], ['Kb', 2, false],
];
const team = 'KC';
const rankingRow = (player: Fixture) => ({
  fantasyProsId: `fp-${player.id}`, rank: player.ecr, name: player.id, position: player.position, team,
  positionalRank: player.ecr, bestRank: player.ecr, worstRank: player.ecr + 2, avgRank: player.ecr + 1,
});

function fixture(): SeasonReviewInputs {
  const stats: Record<string, Record<string, number>> = {};
  for (const player of PLAYERS) {
    if (player.points === null) continue;
    stats[player.id] = player.position === 'K' ? { gp: 1, fgm: player.points } : { gp: 1, rec_yd: player.points * 10 };
  }
  return {
    season: 2026,
    throughWeek: 1,
    standingsThroughWeek: 1,
    managerSlot: 1,
    managerSlotEvidence: ['test'],
    league: {
      league_id: 'L', season: '2026', total_rosters: 2,
      roster_positions: ['QB', 'RB', 'WR', 'TE', 'FLEX', 'K', 'BN'],
      scoring_settings: { rec: 1, rec_yd: 0.1, fgm: 1 },
      settings: {},
    },
    users: [{ user_id: 'u1', display_name: 'Me' }, { user_id: 'u2', display_name: 'Opp' }],
    rosters: [{ roster_id: 1, owner_id: 'u1', settings: { wins: 1 } }, { roster_id: 2, owner_id: 'u2', settings: { losses: 1 } }],
    draft: { draft_id: 'D', status: 'complete', type: 'snake', settings: { rounds: 7 }, slot_to_roster_id: { '1': 1, '2': 2 } },
    picks: DRAFT.map(([playerId, rosterId, keeper], index) => ({
      pick_no: index + 1, round: Math.ceil((index + 1) / 2), draft_slot: rosterId, roster_id: rosterId,
      picked_by: `u${String(rosterId)}`, player_id: playerId, is_keeper: keeper,
    })),
    weeklyStats: [{ week: 1, stats }],
    matchups: [],
    transactions: [],
    players: Object.fromEntries(PLAYERS.map((player) => [player.id, { full_name: player.id, position: player.position, team }])),
    priorSeasonSleeperGames: new Map(),
    priorSeasonRows: [],
    predraftFantasyPros: {
      metadata: { season: 2026, refreshedAt: '2026-08-30T00:00:00.000Z' },
      rankings: PLAYERS.map(rankingRow),
      adp: PLAYERS.map((player) => ({
        fantasyProsId: `fp-${player.id}`, rank: player.adp?.[0] ?? player.ecr, name: player.id, position: player.position, team,
        averageRank: player.adp?.[1] ?? player.ecr,
      })),
      projections: PLAYERS.map((player) => ({
        fantasyProsId: `fp-${player.id}`, name: player.id, position: player.position, team, projectedPoints: player.points ?? 50,
      })),
    },
    currentFantasyPros: null,
    identity: null,
    predraftSleeper: null,
    contracts: null,
    sportsbook: null,
    omittedInputs: [],
    predraftPredictions: null,
    history: [],
    historyEcr: new Map(),
  };
}

describe('season review assembly', () => {
  it('replays roster-aware ECR with the known keeper rostered from pick 1', () => {
    const review = buildSeasonReview(fixture());
    const ecr = review.myDraft.counterfactual.picks.map((pick) => pick.ecr?.name);
    // With the keeper TE already rostered, the replay must still find a QB and an RB in five selections.
    expect(ecr).toEqual(['WRa', 'WRe', 'WRf', 'RBa', 'QBa', 'Ka', 'TEk']);
    expect(review.myDraft.counterfactual.ecr.totalPoints).toBe(150 + 130 + 50 + 120 + 210 + 92 + 75);
  });

  it('scores the best legal lineup with the required kicker', () => {
    const { actual } = buildSeasonReview(fixture()).myDraft.counterfactual;
    // QB 210, RB 120, WR 150, TE 75, FLEX 90, K 92.
    expect(actual.seasonLineupPoints).toBe(737);
  });

  it('prices draft cost from FantasyPros average pick, not ordinal ADP rank', () => {
    const picks = buildSeasonReview(fixture()).picks;
    expect(picks.find((pick) => pick.playerId === 'WRa')?.adpDelta).toBe(-0.4);
    expect(picks.find((pick) => pick.playerId === 'QBa')?.adpDelta).toBe(-4.5);
  });

  it('feeds the Best Pick replay average pick, not ordinal ADP rank, wherever it needs a pick number', () => {
    const player: PredraftPlayer = {
      playerId: 'WRz', fantasyProsId: 'fp-WRz', name: 'WRz', position: 'WR', team, ecrRank: 120, ecrPositionRank: 40,
      bestRank: null, worstRank: null, avgRank: null, adpRank: 130, adpPick: 136.4, projection: 100, projectionStats: {},
    };
    const boardPlayer = buildBestPickBoard(new Map([[player.playerId, player]]), new Map([['WR', 50]])).get('WRz');
    expect(boardPlayer?.marketAdp).toBe(136.4);
    expect(boardPlayer?.sleeperAdp).toBe(136.4);
    expect(boardPlayer?.marketRank).toBe(130);
    expect(nextPickSurvival(player, 125, 140)).toBe(conditionalSurvival(136.4, 125, 140));
    expect(nextPickSurvival(player, 125, 140)).not.toBe(conditionalSurvival(130, 125, 140));
  });

  it('gives the replayed Best Pick its next pick so draft timing is scored', () => {
    const predraft = (playerId: string, ecrRank: number, adpPick: number, projection: number): PredraftPlayer => ({
      playerId, fantasyProsId: `fp-${playerId}`, name: playerId, position: 'WR', team, ecrRank, ecrPositionRank: ecrRank,
      bestRank: null, worstRank: null, avgRank: null, adpRank: ecrRank, adpPick, projection, projectionStats: {},
    });
    const players = [predraft('WRstar', 10, 11, 300), predraft('WRlate', 40, 60, 60)];
    const board = buildBestPickBoard(new Map(players.map((player) => [player.playerId, player])), new Map([['WR', 50]]));
    const timing = replayTiming(players[0]!, 10, 31, 12);
    expect(timing).toMatchObject({ nextPickNumber: 31, nextPickLabel: '3.07', picksUntilNextPick: 21 });
    const result = getRecommendations(players.map((player) => ({ ...board.get(player.playerId)!, ...replayTiming(player, 10, 31, 12) })), [], 1, {
      currentPick: 10, totalPicks: 120, totalTeams: 12, isMyTurn: true,
    });
    const draftTiming = result.draftNow[0]?.decisionFactors?.draftTiming;
    expect(draftTiming?.nextPickNumber).toBe(31);
    expect(draftTiming?.score).toBeGreaterThan(0);
  });

  it('ranks drafted players without a stat line and counts them in the hit-rate denominator', () => {
    const review = buildSeasonReview(fixture());
    const zero = review.picks.find((pick) => pick.playerId === 'RBc');
    expect(zero?.positionRank).toBe(5);
    expect(zero?.returnVsSlot).not.toBeNull();
    const all = review.risks.summary.find((row) => row.category === 'all-drafted');
    expect(all?.n).toBe(12);
    expect(all?.hitRate).toBe(Math.round(((all?.hits ?? 0) / 12) * 100) / 100);
    expect((all?.paidOff.length ?? 0) + (all?.didNot.length ?? 0)).toBe(12);
  });

  it('joins pseudonymized league history to live managers and lists only seasons that contributed', () => {
    const inputs = fixture();
    const hidden = pseudonymizeUserId('u1');
    const review = buildSeasonReview({
      ...inputs,
      history: [
        { season: 2025, teams: 2, users: [{ user_id: hidden, display_name: null }], picks: [
          { pick_no: 1, round: 1, draft_slot: 1, picked_by: hidden, player_id: 'WRa', metadata: { position: 'WR' } },
        ] },
        { season: 2024, teams: 2, users: [], picks: [
          { pick_no: 1, round: 1, draft_slot: 1, picked_by: 'someone-else', player_id: 'WRa', metadata: { position: 'WR' } },
        ] },
      ],
    });
    expect(review.tendencies.historySeasons).toEqual([2025]);
    expect(review.tendencies.withHistory.find((row) => row.userId === 'u1')?.seasons).toEqual([2025, 2026]);
  });

  it('keeps ordinal ADP rank out of the Best Pick market cost but uses it for descriptive pick cost', () => {
    const inputs = fixture();
    const adp = inputs.predraftFantasyPros.adp.map((row) => row.fantasyProsId === 'fp-WRb' ? { ...row, rank: 5, averageRank: undefined } : row);
    const withoutAverage = { ...inputs, predraftFantasyPros: { ...inputs.predraftFantasyPros, adp } };
    const predraft = buildPredraft(withoutAverage, new Map(PLAYERS.map((player) => [`fp-${player.id}`, player.id])));
    expect(predraft.get('WRb')).toMatchObject({ adpRank: 5, adpPick: null, ecrRank: 2 });
    expect(buildBestPickBoard(predraft, new Map()).get('WRb')?.marketAdp).toBe(2);
    const pick = buildSeasonReview(withoutAverage).picks.find((row) => row.playerId === 'WRb');
    expect(pick).toMatchObject({ adpPick: 5, adpDelta: 2 - 5 });
  });

  it('reports a lineup that cannot fill a required starter as incomplete instead of a total', () => {
    const inputs = fixture();
    // The opponent takes QBa at pick 5, so the manager's actual picks have no QB; QBx stays available to the replay.
    const picks = inputs.picks.map((pick) => pick.player_id === 'QBa' ? { ...pick, roster_id: 2, draft_slot: 2 } : pick);
    const review = buildSeasonReview({ ...inputs, picks });
    expect(review.myDraft.counterfactual.actual.seasonLineupPoints).toBeNull();
    expect(review.myDraft.counterfactual.ecr.seasonLineupPoints).not.toBeNull();
    const markdown = renderSeasonReviewMarkdown(review);
    expect(markdown).toContain('| Your picks | ');
    expect(markdown).toContain('incomplete lineup');
    expect(markdown).not.toContain('NaN');
  });

  it('resolves the manager roster from corroborating picks without slot_to_roster_id, and refuses roster 0', () => {
    const inputs = fixture();
    const draft = { ...inputs.draft, slot_to_roster_id: null };
    expect(resolveManagerRosterId({ ...inputs, draft })).toBe(1);
    expect(buildSeasonReview({ ...inputs, draft }).meta.managerRosterId).toBe(1);
    const mixed = inputs.picks.map((pick, index) => index === 0 ? { ...pick, roster_id: 2 } : pick);
    expect(() => resolveManagerRosterId({ ...inputs, draft, picks: mixed })).toThrow('draft slot 1');
    const unknown = inputs.picks.map((pick) => pick.draft_slot === 1 ? { ...pick, roster_id: 7 } : pick);
    expect(() => buildSeasonReview({ ...inputs, draft, picks: unknown })).toThrow('draft slot 1');
  });

  it('ranks a drafted player by the draft position when the player directory has none', () => {
    const inputs = fixture();
    const players = { ...inputs.players, WRc: { full_name: 'WRc', team } };
    const picks = inputs.picks.map((pick) => pick.player_id === 'WRc' ? { ...pick, metadata: { position: 'WR' } } : pick);
    const pick = buildSeasonReview({ ...inputs, players, picks }).picks.find((row) => row.playerId === 'WRc');
    expect(pick?.position).toBe('WR');
    expect(pick?.positionRank).not.toBeNull();
    expect(pick?.vor).toBeGreaterThanOrEqual(0);
  });

  it('breaks standings ties on record and points for by higher points against', () => {
    const inputs = fixture();
    const rosters = [
      { roster_id: 1, owner_id: 'u1', settings: { wins: 1, losses: 1, fpts: 100, fpts_against: 90 } },
      { roster_id: 2, owner_id: 'u2', settings: { wins: 1, losses: 1, fpts: 100, fpts_against: 95 } },
    ];
    const teams = buildSeasonReview({ ...inputs, rosters }).teams;
    expect(teams.find((row) => row.rosterId === 2)?.standingsRank).toBe(1);
    expect(teams.find((row) => row.rosterId === 1)?.standingsRank).toBe(2);
  });

  it('builds the historical room average from every manager in the included drafts, departed ones too', () => {
    const inputs = fixture();
    const current = buildSeasonReview(inputs).tendencies.withHistory.find((row) => row.userId === 'room-average');
    const hidden = pseudonymizeUserId('u1');
    const review = buildSeasonReview({
      ...inputs,
      history: [{ season: 2025, teams: 2, users: [], picks: [
        { pick_no: 1, round: 1, draft_slot: 1, picked_by: hidden, player_id: 'WRa', metadata: { position: 'WR' } },
        { pick_no: 22, round: 1, draft_slot: 2, picked_by: 'departed', player_id: 'WRb', metadata: { position: 'WR' } },
      ] }],
      historyEcr: new Map([['2025:WRa', 21], ['2025:WRb', 2]]),
    });
    const rows = review.tendencies.withHistory;
    expect(rows.some((row) => row.userId === 'departed')).toBe(false);
    expect(rows.find((row) => row.userId === 'room-average')?.picks).toBe((current?.picks ?? 0) + 2);
  });

  it('lists inputs omitted for another season among the caveats', () => {
    const review = buildSeasonReview({ ...fixture(), omittedInputs: ['contracts.json is for season 2027, not 2026; omitted from the risk analysis.'] });
    expect(review.meta.caveats).toContain('contracts.json is for season 2027, not 2026; omitted from the risk analysis.');
  });
});

describe('season review markdown', () => {
  it('keeps a table row on one line when a cell has a line break', () => {
    expect(escape('Line\nbreak|pipe\r\nend')).toBe('Line break\\|pipe end');
  });

  it('builds the rerun command and labels from the report season, cutoff and snapshot', () => {
    const review = buildSeasonReview(fixture());
    const past = { ...review, meta: { ...review.meta, season: 2025, throughWeek: 9, predraftRankingsAt: '2025-08-28T00:00:00.000Z', predraftRankingsLabel: 'Aug 28' } };
    const markdown = renderSeasonReviewMarkdown(past);
    expect(markdown).toContain('--season 2025 --through-week 18');
    expect(markdown).toContain('one season, 9 weeks');
    expect(markdown).toContain('injuries after week 9');
    expect(markdown).toContain('(Aug 28 → current snapshot');
    expect(markdown).not.toContain('--season 2026');
    expect(markdown).toContain('2022–2025 folds');
    expect(markdown).not.toContain('11 weeks');
    const full = renderSeasonReviewMarkdown({ ...review, meta: { ...review.meta, throughWeek: 18 } });
    expect(full).not.toContain('--through-week 18');
    expect(full).toContain('Follow-ups for the full regular season');
  });

  it('says plainly when there is no current FantasyPros snapshot', () => {
    const markdown = renderSeasonReviewMarkdown(buildSeasonReview(fixture()));
    expect(markdown).toContain('No current FantasyPros snapshot was supplied');
    expect(markdown).not.toContain('treated as rest-of-season rankings');
  });
});
