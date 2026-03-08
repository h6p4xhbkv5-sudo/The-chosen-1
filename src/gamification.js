/**
 * Pure gamification functions — no DOM, no localStorage, no globals.
 *
 * These are extracted from index.html so they can be unit-tested and
 * imported by both the frontend script and the test suite.
 *
 * The frontend uses them like:
 *   import { applyXP, computeLevel, addActivityEntry } from './src/gamification.js';
 */

export const XP_PER_LEVEL = 200;

/**
 * Compute the level for a given total XP.
 * Level 1 starts at 0 XP; each subsequent level requires XP_PER_LEVEL more.
 */
export function computeLevel(xp) {
  return Math.floor(xp / XP_PER_LEVEL) + 1;
}

/**
 * XP within the current level, used for the progress bar (e.g. "50 / 200 XP").
 */
export function xpInLevel(xp) {
  return xp % XP_PER_LEVEL;
}

/**
 * Progress through the current level as a 0–1 fraction (for bar width %).
 */
export function levelProgress(xp) {
  return xpInLevel(xp) / XP_PER_LEVEL;
}

/**
 * Apply an XP award to a state object and return the new state.
 * Negative amounts are clamped to 0 — XP can never be stolen.
 * Does NOT mutate the original state object.
 *
 * @param {{ xp: number, level: number }} state
 * @param {number} amount
 * @returns {{ xp: number, level: number, leveledUp: boolean }}
 */
export function applyXP(state, amount) {
  const delta = Math.max(0, amount);
  const xp = state.xp + delta;
  const level = computeLevel(xp);
  return { xp, level, leveledUp: level > state.level };
}

/**
 * Add XP to a daily activity log (plain object keyed by ISO date string).
 * Does NOT mutate the original log.
 *
 * @param {Record<string,number>} log   Existing log, e.g. { '2024-01-01': 50 }
 * @param {number} xp                  XP earned to record for today
 * @param {string} [today]             ISO date override — supply in tests
 * @returns {Record<string,number>}    New log with today's entry updated
 */
export function addActivityEntry(log, xp, today) {
  const key = today ?? new Date().toISOString().split('T')[0];
  return { ...log, [key]: (log[key] || 0) + xp };
}
