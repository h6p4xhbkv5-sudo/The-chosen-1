import { describe, it, expect } from 'vitest';
import {
  computeLevel,
  xpInLevel,
  levelProgress,
  applyXP,
  addActivityEntry,
  XP_PER_LEVEL,
} from '../../src/gamification.js';

// ─── computeLevel ─────────────────────────────────────────────────────────────

describe('computeLevel', () => {
  it('starts at level 1 with 0 XP', () => {
    expect(computeLevel(0)).toBe(1);
  });

  it('stays at level 1 up to (XP_PER_LEVEL - 1) XP', () => {
    expect(computeLevel(XP_PER_LEVEL - 1)).toBe(1);
  });

  it('reaches level 2 at exactly XP_PER_LEVEL XP', () => {
    expect(computeLevel(XP_PER_LEVEL)).toBe(2);
  });

  it('scales linearly with full levels', () => {
    expect(computeLevel(XP_PER_LEVEL * 2)).toBe(3);
    expect(computeLevel(XP_PER_LEVEL * 9)).toBe(10);
  });

  it('correctly places fractional levels', () => {
    expect(computeLevel(XP_PER_LEVEL + 1)).toBe(2);
    expect(computeLevel(XP_PER_LEVEL * 2 - 1)).toBe(2);
  });
});

// ─── xpInLevel ────────────────────────────────────────────────────────────────

describe('xpInLevel', () => {
  it('returns the full XP amount when below the first level threshold', () => {
    expect(xpInLevel(150)).toBe(150);
  });

  it('resets to 0 at each level boundary', () => {
    expect(xpInLevel(XP_PER_LEVEL)).toBe(0);
    expect(xpInLevel(XP_PER_LEVEL * 2)).toBe(0);
  });

  it('returns the remainder within a level', () => {
    expect(xpInLevel(XP_PER_LEVEL + 50)).toBe(50);
  });
});

// ─── levelProgress ────────────────────────────────────────────────────────────

describe('levelProgress', () => {
  it('returns 0 at the start of a level', () => {
    expect(levelProgress(0)).toBe(0);
    expect(levelProgress(XP_PER_LEVEL)).toBe(0);
  });

  it('returns 0.5 halfway through a level', () => {
    expect(levelProgress(XP_PER_LEVEL / 2)).toBe(0.5);
    expect(levelProgress(XP_PER_LEVEL + XP_PER_LEVEL / 2)).toBe(0.5);
  });

  it('returns just under 1 one XP before a level boundary', () => {
    expect(levelProgress(XP_PER_LEVEL - 1)).toBeCloseTo((XP_PER_LEVEL - 1) / XP_PER_LEVEL);
  });
});

// ─── applyXP ──────────────────────────────────────────────────────────────────

describe('applyXP', () => {
  it('adds XP to the current total', () => {
    const result = applyXP({ xp: 100, level: 1 }, 50);
    expect(result.xp).toBe(150);
  });

  it('does not signal leveledUp when XP stays within the same level', () => {
    const result = applyXP({ xp: 50, level: 1 }, 50);
    expect(result.leveledUp).toBe(false);
    expect(result.level).toBe(1);
  });

  it('signals leveledUp when XP crosses a level boundary', () => {
    const result = applyXP({ xp: XP_PER_LEVEL - 10, level: 1 }, 20);
    expect(result.leveledUp).toBe(true);
    expect(result.level).toBe(2);
  });

  it('can level up multiple levels in a single award', () => {
    const result = applyXP({ xp: 0, level: 1 }, XP_PER_LEVEL * 3);
    expect(result.level).toBe(4);
    expect(result.leveledUp).toBe(true);
  });

  it('clamps negative amounts to 0 — XP cannot be stolen', () => {
    const result = applyXP({ xp: 100, level: 1 }, -50);
    expect(result.xp).toBe(100);
    expect(result.leveledUp).toBe(false);
  });

  it('does not mutate the original state object', () => {
    const original = { xp: 100, level: 1 };
    applyXP(original, 50);
    expect(original.xp).toBe(100);
  });

  it('handles adding 0 XP gracefully', () => {
    const result = applyXP({ xp: 100, level: 1 }, 0);
    expect(result.xp).toBe(100);
    expect(result.leveledUp).toBe(false);
  });
});

// ─── addActivityEntry ─────────────────────────────────────────────────────────

describe('addActivityEntry', () => {
  it('creates a new entry for a date with no prior activity', () => {
    const result = addActivityEntry({}, 50, '2024-06-01');
    expect(result['2024-06-01']).toBe(50);
  });

  it('accumulates XP for the same day', () => {
    const existing = { '2024-06-01': 30 };
    const result = addActivityEntry(existing, 20, '2024-06-01');
    expect(result['2024-06-01']).toBe(50);
  });

  it('does not affect other dates in the log', () => {
    const existing = { '2024-05-31': 100 };
    const result = addActivityEntry(existing, 40, '2024-06-01');
    expect(result['2024-05-31']).toBe(100);
    expect(result['2024-06-01']).toBe(40);
  });

  it('does not mutate the original log object', () => {
    const original = { '2024-06-01': 10 };
    addActivityEntry(original, 20, '2024-06-01');
    expect(original['2024-06-01']).toBe(10);
  });

  it("uses today's date when no override is provided", () => {
    const today = new Date().toISOString().split('T')[0];
    const result = addActivityEntry({}, 15);
    expect(result[today]).toBe(15);
  });
});
