import { describe, it, expect } from 'vitest';
import {
  calculateTeamNeeds,
  getCriticalPositions,
  isPositionNeed,
} from './team-needs';
import type { Roster } from '@fantasy-draft/shared';
import { DEFAULT_ROSTER_REQUIREMENTS } from '@fantasy-draft/shared';

// Helper to create a roster
function createRoster(positions: Partial<Record<keyof Roster, string[]>>): Roster {
  return {
    QB: positions.QB ?? [],
    RB: positions.RB ?? [],
    WR: positions.WR ?? [],
    TE: positions.TE ?? [],
    K: positions.K ?? [],
    DEF: positions.DEF ?? [],
  };
}

// Helper to create scarcity scores
function createScarcityScores(
  scores: Partial<Record<keyof Roster, number>>
): Map<keyof Roster, number> {
  const map = new Map<keyof Roster, number>();
  map.set('QB', scores.QB ?? 5);
  map.set('RB', scores.RB ?? 5);
  map.set('WR', scores.WR ?? 5);
  map.set('TE', scores.TE ?? 5);
  map.set('K', scores.K ?? 5);
  map.set('DEF', scores.DEF ?? 5);
  return map;
}

describe('calculateTeamNeeds', () => {
  describe('critical priority', () => {
    it('prioritizes empty multi-starter positions at pick one', () => {
      const roster = createRoster({});
      const scarcity = createScarcityScores({});

      const needs = calculateTeamNeeds(roster, DEFAULT_ROSTER_REQUIREMENTS, scarcity, {
        currentPick: 1,
        totalPicks: 150,
        totalRounds: 15,
      });

      const criticalNeeds = needs.filter((n) => n.priority === 'critical');
      expect(criticalNeeds.map((n) => n.position)).toEqual(['RB', 'WR']);
      expect(needs.find((n) => n.position === 'QB')?.priority).toBe('medium');
      expect(needs.find((n) => n.position === 'TE')?.priority).toBe('medium');
      expect(needs.find((n) => n.position === 'K')?.priority).toBe('defer');
      expect(needs.find((n) => n.position === 'DEF')?.priority).toBe('defer');
    });

    it('marks QB as critical when empty after the draft midpoint', () => {
      const roster = createRoster({ RB: ['rb1', 'rb2'], WR: ['wr1', 'wr2'] });
      const scarcity = createScarcityScores({});

      const needs = calculateTeamNeeds(roster, DEFAULT_ROSTER_REQUIREMENTS, scarcity, {
        currentPick: 91,
        totalPicks: 150,
        totalRounds: 15,
      });

      const qbNeed = needs.find((n) => n.position === 'QB');
      expect(qbNeed?.priority).toBe('critical');
    });

    it('marks kicker and defense as critical when still empty in the late rounds', () => {
      const roster = createRoster({});
      const scarcity = createScarcityScores({});

      const needs = calculateTeamNeeds(roster, DEFAULT_ROSTER_REQUIREMENTS, scarcity, {
        currentPick: 125,
        totalPicks: 150,
        totalRounds: 15,
      });

      expect(needs.find((n) => n.position === 'K')?.priority).toBe('critical');
      expect(needs.find((n) => n.position === 'DEF')?.priority).toBe('critical');
    });
  });

  describe('high priority', () => {
    it('returns high when below starter count with high scarcity (>= 7)', () => {
      const roster = createRoster({ RB: ['rb1'] }); // Need 2 RBs, have 1
      const scarcity = createScarcityScores({ RB: 8 }); // High scarcity

      const needs = calculateTeamNeeds(roster, DEFAULT_ROSTER_REQUIREMENTS, scarcity);

      const rbNeed = needs.find((n) => n.position === 'RB');
      expect(rbNeed?.priority).toBe('high');
    });
  });

  describe('medium priority', () => {
    it('returns medium when below starter count with low scarcity (< 7)', () => {
      const roster = createRoster({ RB: ['rb1'] }); // Need 2 RBs, have 1
      const scarcity = createScarcityScores({ RB: 4 }); // Low scarcity

      const needs = calculateTeamNeeds(roster, DEFAULT_ROSTER_REQUIREMENTS, scarcity);

      const rbNeed = needs.find((n) => n.position === 'RB');
      expect(rbNeed?.priority).toBe('medium');
    });
  });

  describe('low priority', () => {
    it('returns low when have starters but below max roster', () => {
      const roster = createRoster({ QB: ['qb1'] }); // Need 1 QB starter, max 4
      const scarcity = createScarcityScores({});

      const needs = calculateTeamNeeds(roster, DEFAULT_ROSTER_REQUIREMENTS, scarcity);

      const qbNeed = needs.find((n) => n.position === 'QB');
      expect(qbNeed?.priority).toBe('low');
    });
  });

  describe('filled priority', () => {
    it('returns filled when at max roster for position', () => {
      const roster = createRoster({ QB: ['qb1', 'qb2', 'qb3', 'qb4'] }); // Max 4 QBs
      const scarcity = createScarcityScores({});

      const needs = calculateTeamNeeds(roster, DEFAULT_ROSTER_REQUIREMENTS, scarcity);

      const qbNeed = needs.find((n) => n.position === 'QB');
      expect(qbNeed?.priority).toBe('filled');
    });
  });

  describe('sorting', () => {
    it('sorts by priority with critical first', () => {
      const roster = createRoster({
        QB: ['qb1'], // low (have starter)
        RB: ['rb1'], // medium/high (need 1 more starter)
        WR: [], // critical (need starters)
        TE: ['te1'], // low
        K: ['k1', 'k2', 'k3'], // filled
        DEF: ['def1'], // low
      });
      const scarcity = createScarcityScores({ RB: 4 });

      const needs = calculateTeamNeeds(roster, DEFAULT_ROSTER_REQUIREMENTS, scarcity);

      // WR should be first (critical)
      expect(needs[0]?.position).toBe('WR');
      expect(needs[0]?.priority).toBe('critical');
    });
  });

  describe('startersFilled calculation', () => {
    it('correctly calculates startersFilled', () => {
      const roster = createRoster({
        RB: ['rb1', 'rb2', 'rb3'], // 3 RBs, need 2 starters
      });
      const scarcity = createScarcityScores({});

      const needs = calculateTeamNeeds(roster, DEFAULT_ROSTER_REQUIREMENTS, scarcity);

      const rbNeed = needs.find((n) => n.position === 'RB');
      expect(rbNeed?.startersFilled).toBe(2); // min(3, 2)
      expect(rbNeed?.startersNeeded).toBe(2);
    });
  });
});

describe('getCriticalPositions', () => {
  it('returns positions with critical or high priority', () => {
    const roster = createRoster({
      QB: [], // critical
      RB: ['rb1'], // high (scarcity 8)
      WR: ['wr1', 'wr2'], // low
      TE: ['te1'], // low
    });
    const scarcity = createScarcityScores({ QB: 8, RB: 8 });

    const needs = calculateTeamNeeds(roster, DEFAULT_ROSTER_REQUIREMENTS, scarcity);
    const criticalPositions = getCriticalPositions(needs);

    expect(criticalPositions).toContain('QB');
    expect(criticalPositions).toContain('RB');
    expect(criticalPositions).not.toContain('WR');
    expect(criticalPositions).not.toContain('TE');
  });

  it('returns empty array when no critical/high needs', () => {
    const roster = createRoster({
      QB: ['qb1'],
      RB: ['rb1', 'rb2'],
      WR: ['wr1', 'wr2'],
      TE: ['te1'],
      K: ['k1'],
      DEF: ['def1'],
    });
    const scarcity = createScarcityScores({});

    const needs = calculateTeamNeeds(roster, DEFAULT_ROSTER_REQUIREMENTS, scarcity);
    const criticalPositions = getCriticalPositions(needs);

    expect(criticalPositions).toHaveLength(0);
  });
});

describe('isPositionNeed', () => {
  it('returns true for critical, high, or medium priority positions', () => {
    const roster = createRoster({
      QB: [], // critical
      RB: ['rb1'], // medium (scarcity 4)
      WR: ['wr1', 'wr2'], // low
    });
    const scarcity = createScarcityScores({ RB: 4 });

    const needs = calculateTeamNeeds(roster, DEFAULT_ROSTER_REQUIREMENTS, scarcity);

    expect(isPositionNeed(needs, 'QB')).toBe(true);
    expect(isPositionNeed(needs, 'RB')).toBe(true);
    expect(isPositionNeed(needs, 'WR')).toBe(false);
  });

  it('returns false for low or filled positions', () => {
    const roster = createRoster({
      QB: ['qb1', 'qb2', 'qb3', 'qb4'], // filled
      TE: ['te1'], // low
    });
    const scarcity = createScarcityScores({});

    const needs = calculateTeamNeeds(roster, DEFAULT_ROSTER_REQUIREMENTS, scarcity);

    expect(isPositionNeed(needs, 'QB')).toBe(false);
    expect(isPositionNeed(needs, 'TE')).toBe(false);
  });

  it('returns false for deferred positions', () => {
    const needs = calculateTeamNeeds(
      createRoster({}),
      DEFAULT_ROSTER_REQUIREMENTS,
      createScarcityScores({}),
      {
        currentPick: 1,
        totalPicks: 150,
        totalRounds: 15,
      }
    );

    expect(isPositionNeed(needs, 'K')).toBe(false);
    expect(isPositionNeed(needs, 'DEF')).toBe(false);
  });
});
