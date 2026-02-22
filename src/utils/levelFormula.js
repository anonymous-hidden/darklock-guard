/**
 * Unified Level Formula Module
 * 
 * SECURITY FIX (MEDIUM 19): Consolidates the level formula into a single
 * source of truth. Previously 3 different formulas existed across the codebase:
 *   A) level = floor(0.1 * sqrt(xp))  [RankSystem, xpDatabase, leaderboard]
 *   B) 5L² + 50L + 100               [messageCreate dead code]
 *   C) level² × 100                   [RankCardGenerator, systems/rankSystem]
 * 
 * Canonical formula: level = floor(0.1 * sqrt(xp))
 * Inverse:          xpForLevel = (level / 0.1)²
 */

'use strict';

/**
 * Calculate level from total XP
 * @param {number} xp - Total accumulated XP
 * @returns {number} Current level (integer)
 */
function calculateLevel(xp) {
    if (!xp || xp < 0) return 0;
    return Math.floor(0.1 * Math.sqrt(xp));
}

/**
 * Calculate XP required for a given level
 * @param {number} level - Target level
 * @returns {number} Total XP needed to reach this level
 */
function xpForLevel(level) {
    if (!level || level < 0) return 0;
    return Math.pow(level / 0.1, 2);
}

/**
 * Calculate progress percentage toward the next level
 * @param {number} xp - Current total XP
 * @returns {number} Progress 0-100
 */
function progressPercent(xp) {
    const currentLevel = calculateLevel(xp);
    const currentLevelXP = xpForLevel(currentLevel);
    const nextLevelXP = xpForLevel(currentLevel + 1);
    const range = nextLevelXP - currentLevelXP;
    if (range <= 0) return 0;
    return Math.min(100, Math.floor(((xp - currentLevelXP) / range) * 100));
}

module.exports = { calculateLevel, xpForLevel, progressPercent };
