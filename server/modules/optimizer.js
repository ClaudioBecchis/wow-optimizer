'use strict';

const db = require('./db');

// --------------- SimC Stat Key Mapping ---------------

var SIMC_STAT_MAP = {
  'Agi': { name: 'Agility', color: '#ffd100' },
  'Str': { name: 'Strength', color: '#ffd100' },
  'Int': { name: 'Intellect', color: '#ffd100' },
  'Crit': { name: 'Critical Strike', color: '#bf616a' },
  'Haste': { name: 'Haste', color: '#ebcb8b' },
  'Mastery': { name: 'Mastery', color: '#a335ee' },
  'Vers': { name: 'Versatility', color: '#1eff00' },
  'AP': { name: 'Attack Power', color: '#c4a35a' },
};

// Old-format key mapping (snake_case / lowercase variants)
var OLD_STAT_MAP = {
  'strength': { name: 'Strength', color: '#ffd100' },
  'agility': { name: 'Agility', color: '#ffd100' },
  'intellect': { name: 'Intellect', color: '#ffd100' },
  'crit_rating': { name: 'Critical Strike', color: '#bf616a' },
  'critrating': { name: 'Critical Strike', color: '#bf616a' },
  'crit': { name: 'Critical Strike', color: '#bf616a' },
  'haste_rating': { name: 'Haste', color: '#ebcb8b' },
  'hasterating': { name: 'Haste', color: '#ebcb8b' },
  'haste': { name: 'Haste', color: '#ebcb8b' },
  'mastery_rating': { name: 'Mastery', color: '#a335ee' },
  'masteryrating': { name: 'Mastery', color: '#a335ee' },
  'mastery': { name: 'Mastery', color: '#a335ee' },
  'versatility_rating': { name: 'Versatility', color: '#1eff00' },
  'versatilityrating': { name: 'Versatility', color: '#1eff00' },
  'versatility': { name: 'Versatility', color: '#1eff00' },
  'vers': { name: 'Versatility', color: '#1eff00' },
  'attack_power': { name: 'Attack Power', color: '#c4a35a' },
  'attackpower': { name: 'Attack Power', color: '#c4a35a' },
  'ap': { name: 'Attack Power', color: '#c4a35a' },
};

// --------------- Stat Key Normalization ---------------

/**
 * Resolve a stat key (SimC or old format) to { name, color } or null.
 */
function resolveStatKey(key) {
  if (!key) return null;

  // Check SimC format first (exact match, case-sensitive)
  if (SIMC_STAT_MAP[key]) {
    return SIMC_STAT_MAP[key];
  }

  // Check old format (case-insensitive, with underscore/space normalization)
  var normalized = String(key).toLowerCase().replace(/[\s-]/g, '_');
  if (OLD_STAT_MAP[normalized]) {
    return OLD_STAT_MAP[normalized];
  }

  // Try without underscores
  var stripped = normalized.replace(/_/g, '');
  if (OLD_STAT_MAP[stripped]) {
    return OLD_STAT_MAP[stripped];
  }

  return null;
}

// --------------- Format Stat Weights ---------------

/**
 * Format raw SimC scale_factors object into a sorted, normalized array.
 *
 * Input: { Agi: 14.33, Crit: 2.74, Haste: 111.19, Mastery: -4.35, Vers: 0.46, AP: 0, Wdps: 0, WOHdps: 0 }
 *   OR old-style: { crit_rating: 2.74, haste_rating: 111.19, ... }
 *
 * Output: [
 *   { stat: 'Haste', weight: 111.19, normalized: 100, color: '#ebcb8b' },
 *   { stat: 'Agility', weight: 14.33, normalized: 12.88, color: '#ffd100' },
 *   ...
 * ]
 *
 * Filters out zero and negative values.  Sorts by weight descending.
 */
function formatStatWeights(scaleFactors) {
  try {
    if (!scaleFactors || typeof scaleFactors !== 'object') {
      return [];
    }

    var entries = [];

    Object.keys(scaleFactors).forEach(function (key) {
      try {
        var val = parseFloat(scaleFactors[key]);
        if (isNaN(val) || val <= 0) return; // Filter out zero and negative

        var info = resolveStatKey(key);
        if (!info) return; // Skip unknown keys like Wdps, WOHdps

        entries.push({
          stat: info.name,
          weight: parseFloat(val.toFixed(2)),
          color: info.color,
        });
      } catch (_) { /* ignore */ }
    });

    // Sort by weight descending
    entries.sort(function (a, b) { return b.weight - a.weight; });

    // Compute normalized 0-100 relative to max
    var maxWeight = entries.length > 0 ? entries[0].weight : 1;
    if (maxWeight <= 0) maxWeight = 1;

    entries.forEach(function (entry) {
      entry.normalized = parseFloat(((entry.weight / maxWeight) * 100).toFixed(2));
    });

    return entries;
  } catch (err) {
    console.error('[optimizer] formatStatWeights error:', err);
    return [];
  }
}

// --------------- Score Item ---------------

/**
 * Score an item based on its stats and the given stat weights.
 *
 * statWeights can be either:
 *   - SimC format: { Agi: 14.33, Crit: 2.74, Haste: 111.19, ... }
 *   - Old format:  { crit_rating: 2.74, haste_rating: 111.19, ... }
 *   - Formatted array from formatStatWeights()
 *
 * itemStats should be an object like: { crit: 100, haste: 200, mastery: 50, ... }
 */
function scoreItem(itemStats, statWeights) {
  try {
    if (!itemStats || typeof itemStats !== 'object') return 0;
    if (!statWeights) return 0;

    // Build a weight lookup: normalized stat name -> weight value
    var weightLookup = {};

    if (Array.isArray(statWeights)) {
      // Formatted array: [{ stat: 'Haste', weight: 111.19 }, ...]
      statWeights.forEach(function (entry) {
        if (entry.stat && typeof entry.weight === 'number') {
          weightLookup[entry.stat.toLowerCase()] = entry.weight;
        }
      });
    } else if (typeof statWeights === 'object') {
      // Raw object (SimC or old format)
      Object.keys(statWeights).forEach(function (key) {
        var val = parseFloat(statWeights[key]);
        if (isNaN(val)) return;

        var info = resolveStatKey(key);
        if (info) {
          weightLookup[info.name.toLowerCase()] = val;
        }
      });
    }

    // Now score the item
    var score = 0;

    Object.keys(itemStats).forEach(function (statKey) {
      try {
        var statVal = parseFloat(itemStats[statKey]);
        if (isNaN(statVal) || statVal <= 0) return;

        var info = resolveStatKey(statKey);
        if (!info) return;

        var lookupName = info.name.toLowerCase();
        var weight = weightLookup[lookupName];
        if (weight && weight > 0) {
          score += statVal * weight;
        }
      } catch (_) { /* ignore */ }
    });

    return parseFloat(score.toFixed(2));
  } catch (err) {
    console.error('[optimizer] scoreItem error:', err);
    return 0;
  }
}

// --------------- Exports ---------------

module.exports = {
  SIMC_STAT_MAP,
  OLD_STAT_MAP,
  resolveStatKey,
  formatStatWeights,
  scoreItem,
};
