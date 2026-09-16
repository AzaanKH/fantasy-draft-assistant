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
    it('marks every active offensive starter position critical on an empty roster', () => {
      const roster = createRoster({});
      const scarcity = createScarcityScores({});

      const needs = calculateTeamNeeds(roster, DEFAULT_ROSTER_REQUIREMENTS, scarcity, {
        currentPick: 1,
        totalPicks: 150,
        totalRounds: 15,
      });

      const criticalNeeds = needs.filter((n) => n.priority === 'critical');
      expect(criticalNeeds.map((n) => n.position)).toEqual(['QB', 'RB', 'WR', 'TE']);
      expect(needs.find((n) => n.position === 'K')?.priority).toBe('defer');
      expect(needs.find((n) => n.position === 'DEF')?.priority).toBe('filled');
    });

    it('marks every unfilled offensive starter position critical at pick one with a keeper', () => {
      const roster = createRoster({ RB: ['keeper-rb'] });
      const scarcity = createScarcityScores({});

      const needs = calculateTeamNeeds(roster, DEFAULT_ROSTER_REQUIREMENTS, scarcity, {
        currentPick: 1,
        totalPicks: 150,
        totalRounds: 15,
      });

      const criticalNeeds = needs.filter((n) => n.priority === 'critical');
      expect(criticalNeeds.map((n) => n.position)).toEqual(['QB', 'RB', 'WR', 'TE']);
      expect(needs.find((n) => n.position === 'RB')?.startersFilled).toBe(1);
      expect(needs.find((n) => n.position === 'K')?.priority).toBe('defer');
      expect(needs.find((n) => n.position === 'DEF')?.priority).toBe('filled');
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

    it('marks kicker critical while leaving disabled defense filled in the late rounds', () => {
      const roster = createRoster({});
      const scarcity = createScarcityScores({});

      const needs = calculateTeamNeeds(roster, DEFAULT_ROSTER_REQUIREMENTS, scarcity, {
        currentPick: 125,
        totalPicks: 150,
        totalRounds: 15,
      });

      expect(needs.find((n) => n.position === 'K')?.priority).toBe('critical');
      expect(needs.find((n) => n.position === 'DEF')?.priority).toBe('filled');
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

    it('returns low for FLEX positions after every shared FLEX starter is filled', () => {
      const roster = createRoster({
        QB: ['qb1'],
        RB: ['rb1', 'rb2', 'rb3'],
        WR: ['wr1', 'wr2', 'wr3'],
        TE: ['te1'],
      });
      const scarcity = createScarcityScores({});

      const needs = calculateTeamNeeds(roster, DEFAULT_ROSTER_REQUIREMENTS, scarcity);

      for (const position of ['RB', 'WR', 'TE'] as const) {
        const need = needs.find((item) => item.position === position);
        expect(need?.priority).toBe('low');
        expect(need?.flexSlotsFilled).toBe(2);
        expect(need?.flexSlotsNeeded).toBe(2);
        expect(need?.isFlexEligible).toBe(true);
      }
    });
  });

  describe('FLEX starter priority', () => {
    it('keeps eligible positions open when fixed starters are filled but two FLEX slots are not', () => {
      const roster = createRoster({
        QB: ['qb1'],
        RB: ['rb1', 'rb2'],
        WR: ['wr1', 'wr2'],
        TE: ['te1'],
      });
      const scarcity = createScarcityScores({});

      const needs = calculateTeamNeeds(roster, DEFAULT_ROSTER_REQUIREMENTS, scarcity);

      for (const position of ['RB', 'WR', 'TE'] as const) {
        const need = needs.find((item) => item.position === position);
        expect(need?.priority).toBe('medium');
        expect(need?.flexSlotsFilled).toBe(0);
        expect(need?.flexSlotsNeeded).toBe(2);
        expect(need?.isFlexEligible).toBe(true);
      }
      expect(needs.find((item) => item.position === 'QB')?.priority).toBe('low');
      expect(needs.find((item) => item.position === 'QB')?.isFlexEligible).toBe(false);
    });

    it('keeps one shared FLEX need open after the first surplus eligible player is drafted', () => {
      const roster = createRoster({
        QB: ['qb1'],
        RB: ['rb1', 'rb2', 'rb3'],
        WR: ['wr1', 'wr2'],
        TE: ['te1'],
      });
      const scarcity = createScarcityScores({});

      const needs = calculateTeamNeeds(roster, DEFAULT_ROSTER_REQUIREMENTS, scarcity);

      for (const position of ['RB', 'WR', 'TE'] as const) {
        const need = needs.find((item) => item.position === position);
        expect(need?.priority).toBe('medium');
        expect(need?.flexSlotsFilled).toBe(1);
      }
    });

    it('fills FLEX from positional surplus even while another fixed position is still open', () => {
      const roster = createRoster({
        RB: ['rb1', 'rb2', 'rb3', 'rb4'],
        WR: [],
        TE: ['te1'],
      });
      const scarcity = createScarcityScores({});

      const needs = calculateTeamNeeds(roster, DEFAULT_ROSTER_REQUIREMENTS, scarcity);

      expect(needs.find((item) => item.position === 'RB')?.flexSlotsFilled).toBe(2);
      expect(needs.find((item) => item.position === 'RB')?.priority).toBe('low');
      expect(needs.find((item) => item.position === 'WR')?.priority).toBe('critical');
    });

    it('does not create FLEX demand when the user format has no FLEX starters', () => {
      const requirements = {
        ...DEFAULT_ROSTER_REQUIREMENTS,
        FLEX: { ...DEFAULT_ROSTER_REQUIREMENTS.FLEX, starters: 0 },
      };
      const roster = createRoster({
        QB: ['qb1'],
        RB: ['rb1', 'rb2'],
        WR: ['wr1', 'wr2'],
        TE: ['te1'],
      });

      const needs = calculateTeamNeeds(roster, requirements, createScarcityScores({}));

      expect(needs.find((item) => item.position === 'RB')?.priority).toBe('low');
      expect(needs.find((item) => item.position === 'RB')?.flexSlotsNeeded).toBe(0);
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
      WR: ['wr1', 'wr2'], // medium while FLEX starters remain open
    });
    const scarcity = createScarcityScores({ RB: 4 });

    const needs = calculateTeamNeeds(roster, DEFAULT_ROSTER_REQUIREMENTS, scarcity);

    expect(isPositionNeed(needs, 'QB')).toBe(true);
    expect(isPositionNeed(needs, 'RB')).toBe(true);
    expect(isPositionNeed(needs, 'WR')).toBe(true);
  });

  it('returns false for low or filled positions', () => {
    const roster = createRoster({
      QB: ['qb1', 'qb2', 'qb3', 'qb4'], // filled
      RB: ['rb1', 'rb2', 'rb3'],
      WR: ['wr1', 'wr2', 'wr3'],
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
