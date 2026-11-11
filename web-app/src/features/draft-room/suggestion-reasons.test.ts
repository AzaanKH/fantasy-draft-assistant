import { describe, expect, it } from 'vitest';
import { getDistinguishingFacts, getPlainSuggestionSummary, getRecommendationVerdict, getSuggestionReasonChips, getSuggestionSummaryCandidates, getTakeOrWaitVerdict, MATERIAL_WAIT_COST, separateSuggestionSummaries, VERDICT_RULE } from './suggestion-reasons';
import { asProbability } from '@fantasy-draft/shared/units';

const player = { id: 'p1', position: 'RB' as const, byeWeek: 8, valueScore: 12, consensusAdp: 14, marketAdp: 15 };

describe('getSuggestionReasonChips', () => {
  it('derives tier, need, value and bye chips from existing data, at most two, warnings first', () => {
    const chips = getSuggestionReasonChips({
      recommendation: { position: 'RB', diagnostics: { isLastInTier: true, tier: 2, tierDropoffPoints: 29.5 } as never },
      player,
      needs: [{ position: 'RB', startersFilled: 0, startersNeeded: 2 }],
      rosteredPlayers: [{ id: 'p9', name: 'Other Back', position: 'RB', byeWeek: 8 }],
    });
    // The bye conflict is found last but is a warning, so the positive chips yield to it and to Tier ends.
    expect(chips.map((chip) => chip.label)).toEqual(['Bye conflict', 'Tier ends']);
    expect(chips[1]?.detail).toContain('about 30 fewer points');
  });

  it('shows a bye conflict and a reach only when the data supports them', () => {
    const chips = getSuggestionReasonChips({
      recommendation: { position: 'RB', diagnostics: { isLastInTier: false, tierRemaining: 3, tier: 2 } as never },
      player: { ...player, valueScore: -7 },
      needs: [{ position: 'RB', startersFilled: 2, startersNeeded: 2 }],
      rosteredPlayers: [{ id: 'p9', name: 'Other Back', position: 'RB', byeWeek: 8 }],
    });
    expect(chips.map((chip) => chip.label)).toEqual(['Bye conflict', 'Reach -7']);
  });

  it('adds nothing without ADP, diagnostics or roster data', () => {
    expect(getSuggestionReasonChips({
      recommendation: { position: 'WR', diagnostics: undefined },
      player: { ...player, position: 'WR', consensusAdp: Number.NaN, marketAdp: Number.NaN },
      needs: [],
      rosteredPlayers: [],
    })).toEqual([]);
  });
});

describe('getTakeOrWaitVerdict', () => {
  const cheap = { costOfWaiting: 1.2 };
  it('says Take now when the player is unlikely to last, and Can wait when they likely will, never with the %', () => {
    expect(getTakeOrWaitVerdict({ survival: 0.19, nextPickLabel: '2.08', tierEnds: false, ...cheap }))
      .toEqual({ kind: 'take-now', label: 'Take now', reason: 'likely gone by 2.08' });
    expect(getTakeOrWaitVerdict({ survival: 0.42, nextPickLabel: '2.08', tierEnds: false, ...cheap })?.reason).toBe('may be gone by 2.08');
    expect(getTakeOrWaitVerdict({ survival: 0.7, nextPickLabel: '2.08', tierEnds: false, ...cheap }))
      .toEqual({ kind: 'can-wait', label: 'Can wait', reason: 'likely still there at 2.08, and waiting costs little' });
  });

  it('treats the last player in a tier as Take now below the higher threshold only', () => {
    expect(getTakeOrWaitVerdict({ survival: 0.6, nextPickLabel: '2.08', tierEnds: true, ...cheap })?.kind).toBe('take-now');
    expect(getTakeOrWaitVerdict({ survival: 0.6, nextPickLabel: '2.08', tierEnds: false, ...cheap })?.kind).toBe('can-wait');
    expect(getTakeOrWaitVerdict({ survival: 0.8, nextPickLabel: '2.08', tierEnds: true, ...cheap })?.kind).toBe('can-wait');
  });

  it('hedges instead of Can wait when waiting costs real points, however likely the player is to last', () => {
    // 55% to last but 45 points lost when he does not: likely there, not safe to wait.
    const costly = getTakeOrWaitVerdict({ survival: 0.55, nextPickLabel: '2.08', tierEnds: false, costOfWaiting: 45 });
    expect(costly).toEqual({ kind: 'likely-available', label: 'Likely available', reason: 'likely still there at 2.08, but waiting has a real cost' });
    // The analysis states the 45 pts once in Cost of waiting; the reason never repeats a figure.
    expect(costly?.reason).not.toMatch(/\d+(\.\d+)? ?(pts?|%)/);
    expect(getTakeOrWaitVerdict({ survival: 0.95, nextPickLabel: '2.08', tierEnds: false, costOfWaiting: MATERIAL_WAIT_COST })?.kind).toBe('likely-available');
    expect(getTakeOrWaitVerdict({ survival: 0.95, nextPickLabel: '2.08', tierEnds: false, costOfWaiting: MATERIAL_WAIT_COST - 0.1 })?.kind).toBe('can-wait');
  });

  it('reads a cost of exactly 0 with high availability as Can wait, never as a missing estimate', () => {
    expect(getTakeOrWaitVerdict({ survival: 0.92, nextPickLabel: '2.08', tierEnds: false, costOfWaiting: 0 }))
      .toEqual({ kind: 'can-wait', label: 'Can wait', reason: 'likely still there at 2.08, and waiting costs little' });
  });

  it('hedges when the cost of waiting is not estimated, and keeps Take now', () => {
    expect(getTakeOrWaitVerdict({ survival: 0.8, nextPickLabel: '2.08', tierEnds: false, costOfWaiting: null })?.label).toBe('Likely available');
    expect(getTakeOrWaitVerdict({ survival: 0.2, nextPickLabel: '2.08', tierEnds: false, costOfWaiting: null })?.label).toBe('Take now');
  });

  it('gives no verdict without an availability estimate', () => {
    expect(getTakeOrWaitVerdict({ survival: undefined, nextPickLabel: '2.08', tierEnds: true, ...cheap })).toBeNull();
  });

  it('states the cost threshold in the rule every surface shows', () => {
    expect(VERDICT_RULE).toContain(`under ${String(MATERIAL_WAIT_COST)} projected points`);
    expect(VERDICT_RULE).toContain('Likely available');
  });
});

describe('getRecommendationVerdict', () => {
  const base = { playerId: 'p1', playerName: 'Back', position: 'RB' as const };
  it('never says Can wait when the cost of waiting is unavailable', () => {
    const recommendation = { ...base, diagnostics: { nextPickSurvivalProbability: asProbability(0.9), nextPickLabel: '2.08', nextPickNumber: 20, tier: 1 } } as never;
    expect(getRecommendationVerdict(recommendation)?.kind).toBe('likely-available');
  });

  it('reads the cost from the recommendation, so cards, analysis and side panel agree', () => {
    const timing = (costOfWaiting: number) => ({
      ...base,
      diagnostics: { tier: 1, nextPickSurvivalProbability: asProbability(0.8), nextPickLabel: '2.08', nextPickNumber: 20 },
      decisionFactors: { draftTiming: { returnProbability: asProbability(0.8), nextPickLabel: '2.08', costOfWaiting } },
    }) as never;
    expect(getRecommendationVerdict(timing(1))?.kind).toBe('can-wait');
    expect(getRecommendationVerdict(timing(12))?.kind).toBe('likely-available');
  });
});

describe('getPlainSuggestionSummary', () => {
  const recommendation = { position: 'RB' as const, diagnostics: { valueOverReplacement: 114, tier: 2 } as never, decisionFactors: undefined };
  it('compares the card with the others in plain words, never availability or model terms', () => {
    const summary = getPlainSuggestionSummary({ recommendation, gap: { vorDelta: 52, versus: 2 }, run: null });
    expect(summary).toBe('+52 pts over #2');
    expect(summary).not.toMatch(/%|gone by|still there|Take now|policy|VOR|replacement/);
    expect(getPlainSuggestionSummary({ recommendation, gap: { vorDelta: -12, versus: 1 }, run: null })).toBe('12 pts behind #1');
  });

  it('leads with the end of a tier and a position run, which set a card apart more than the value gap', () => {
    const lastInTier = { ...recommendation, diagnostics: { valueOverReplacement: 90, tier: 2, isLastInTier: true, tierDropoffPoints: 19.6 } as never };
    expect(getPlainSuggestionSummary({ recommendation: lastInTier, gap: { vorDelta: -24, versus: 1 }, run: null })).toBe('Last RB in Tier 2 · 24 pts behind #1');
    expect(getPlainSuggestionSummary({ recommendation, gap: { vorDelta: -3, versus: 1 }, run: { count: 4, window: 5 } })).toBe('RB run: 4 of last 5 picks · 3 pts behind #1');
    expect(getPlainSuggestionSummary({ recommendation: lastInTier, gap: { vorDelta: -3, versus: 1 }, run: { count: 4, window: 5 } }))
      .toBe('Last RB in Tier 2 · RB run: 4 of last 5 picks');
  });

  it('mentions a coming tier drop after the comparison', () => {
    const withDrop = { ...recommendation, decisionFactors: { tierSupply: { dropoffPoints: 12.4 } } as never };
    expect(getPlainSuggestionSummary({ recommendation: withDrop, gap: { vorDelta: -5, versus: 1 }, run: null })).toBe('5 pts behind #1 · Next RB tier −12 pts');
  });

  it('says nothing rather than a filler line when there is nothing to compare', () => {
    expect(getPlainSuggestionSummary({ recommendation: { position: 'RB', diagnostics: undefined, decisionFactors: undefined }, gap: null, run: null })).toBeNull();
  });
});

describe('a pick worth about nothing over a fill-in starter', () => {
  const zero = (extra: Record<string, unknown> = {}) => ({ position: 'DEF' as const, diagnostics: { valueOverReplacement: 0.3, tier: 1, ...extra } as never, decisionFactors: undefined });
  it('leads with the open starter spot instead of a 0-point gap', () => {
    expect(getPlainSuggestionSummary({ recommendation: zero(), gap: { vorDelta: 0.4, versus: 2 }, run: null, reasons: [{ key: 'need' }] }))
      .toMatch(/^Fills your open DEF starter spot/);
  });
  it('names the tier end once when that is the reason', () => {
    expect(getPlainSuggestionSummary({ recommendation: zero({ isLastInTier: true }), gap: null, run: null }))
      .toBe('Last DEF in Tier 1');
  });
  it('says only that he is level with a fill-in starter when there is no other reason, keeping the other facts', () => {
    expect(getPlainSuggestionSummary({ recommendation: zero(), gap: null, run: null })).toBe('About even with a fill-in DEF');
    expect(getPlainSuggestionSummary({ recommendation: zero({ tierDropoffPoints: 20 }), gap: null, run: null }))
      .toBe('About even with a fill-in DEF · Next DEF tier −20 pts');
  });
  it('leaves a normal value alone', () => {
    expect(getPlainSuggestionSummary({ recommendation: zero({ valueOverReplacement: 40 }), gap: null, run: null })).toBeNull();
  });
});


describe('separateSuggestionSummaries: every card states a fact the other three do not', () => {
  const kicker = (playerId: string, projectedPoints: number, expertRank: number, extra: Record<string, unknown> = {}) => ({
    playerId,
    recommendation: { position: 'K' as const, diagnostics: { valueOverReplacement: 0.2, tier: 1, tierDropoffPoints: 11, projectedPoints, expertRank, ...extra } as never, decisionFactors: undefined },
  });
  const lines = (cards: readonly ReturnType<typeof kicker>[], reasons: readonly { key: 'need' }[] = [], run: { count: number; window: number } | null = null) => {
    const summaries = separateSuggestionSummaries(cards.map(({ playerId, recommendation }, index) => ({
      playerId,
      candidates: getSuggestionSummaryCandidates({ recommendation, gap: index === 0 ? { vorDelta: 0, versus: 2 } : { vorDelta: 0, versus: 1 }, run, reasons }),
      extras: getDistinguishingFacts(recommendation, undefined),
    })));
    return cards.map(({ playerId }) => summaries.get(playerId)?.text ?? null);
  };
  const uniqueFacts = (texts: readonly (string | null)[]) => texts.map((text, index) => {
    const others = texts.flatMap((other, otherIndex) => otherIndex === index || !other ? [] : other.split(' · '));
    return (text ?? '').split(' · ').some((part) => part !== '' && !others.includes(part));
  });

  it('four near-zero kickers with the same open slot, run and tier drop each get a line of their own', () => {
    const cards = [kicker('a', 142, 160), kicker('b', 138, 171), kicker('c', 138, 175), kicker('d', 131, 188)];
    const texts = lines(cards, [{ key: 'need' }], { count: 3, window: 5 });
    expect(new Set(texts).size).toBe(4);
    expect(uniqueFacts(texts)).toEqual([true, true, true, true]);
    // Two kickers share 138 projected points, so the expert rank tells them apart.
    expect(texts).toEqual([
      // Only #1 is compared with #2, so that comparison is already its own.
      'Fills your open K starter spot · Even with #2',
      'Fills your open K starter spot · Expert rank #171',
      'Fills your open K starter spot · Expert rank #175',
      'Fills your open K starter spot · Projects 131 pts',
    ]);
  });

  it('late kickers that all read "Even with #1 · Next K tier −11 pts" keep one shared fact and add their own', () => {
    const texts = lines([kicker('a', 150, 150, { valueOverReplacement: 20 }), kicker('b', 141, 161, { valueOverReplacement: 20 }), kicker('c', 139, 166, { valueOverReplacement: 20 }), kicker('d', 137, 170, { valueOverReplacement: 20 })]);
    expect(texts.slice(1)).toEqual(['Even with #1 · Projects 141 pts', 'Even with #1 · Projects 139 pts', 'Even with #1 · Projects 137 pts']);
    expect(uniqueFacts(texts)).toEqual([true, true, true, true]);
  });

  it('leaves lines that already differ alone', () => {
    const summaries = separateSuggestionSummaries([
      { playerId: 'a', candidates: [{ text: '+5 pts over #2', basis: '' }], extras: [{ text: 'Projects 300 pts', basis: '' }] },
      { playerId: 'b', candidates: [{ text: '5 pts behind #1', basis: '' }], extras: [{ text: 'Projects 290 pts', basis: '' }] },
    ]);
    expect([...summaries.values()].map((summary) => summary?.text)).toEqual(['+5 pts over #2', '5 pts behind #1']);
  });

  it('gives an unranked card without facts no invented line', () => {
    const summaries = separateSuggestionSummaries([
      { playerId: 'a', candidates: [], extras: [] },
      { playerId: 'b', candidates: [], extras: [] },
    ]);
    expect([...summaries.values()]).toEqual([null, null]);
  });
});
