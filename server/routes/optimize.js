'use strict';

const express = require('express');
const router = express.Router();
const db = require('../modules/db');
const optimizer = require('../modules/optimizer');

// GET /api/optimize/:charId/stat-weights
// Return the latest stat weights for a character
router.get('/:charId/stat-weights', (req, res) => {
  try {
    const { charId } = req.params;

    if (!charId || isNaN(Number(charId))) {
      return res.status(400).json({ error: 'Invalid character ID' });
    }

    let character;
    try {
      character = db.getCharacter(charId);
    } catch (dbErr) {
      return res.status(500).json({ error: 'Failed to load character: ' + dbErr.message });
    }

    if (!character) {
      return res.status(404).json({ error: 'Character not found' });
    }

    // Get latest stat weights from DB
    let rawWeights;
    try {
      rawWeights = db.getLatestStatWeights(charId);
    } catch (dbErr) {
      return res.status(500).json({ error: 'Failed to load stat weights: ' + dbErr.message });
    }

    if (!rawWeights) {
      return res.json({
        stat_weights_json: null,
        formatted: [],
        message: 'No stat weights available. Run a Stat Weights simulation first.'
      });
    }

    // Format for display
    const formatted = optimizer.formatStatWeights(rawWeights);

    return res.json({
      stat_weights_json: rawWeights,
      formatted: formatted
    });
  } catch (err) {
    console.error('[optimize] Error getting stat weights:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/optimize/:charId/bis
// Return BiS recommendations based on stat weights
router.get('/:charId/bis', (req, res) => {
  try {
    const { charId } = req.params;

    if (!charId || isNaN(Number(charId))) {
      return res.status(400).json({ error: 'Invalid character ID' });
    }

    let rawWeights;
    try {
      rawWeights = db.getLatestStatWeights(charId);
    } catch (dbErr) {
      return res.status(500).json({ error: 'Failed to load stat weights: ' + dbErr.message });
    }

    if (!rawWeights) {
      return res.status(400).json({
        error: 'No stat weights available. Run a Stat Weights simulation first.'
      });
    }

    // BiS recommendations require external data (not implemented yet)
    return res.json({
      bis: {},
      message: 'BiS recommendations are not yet implemented. Stat weights are available for manual comparison.'
    });
  } catch (err) {
    console.error('[optimize] Error getting BiS:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/optimize/:charId/enchants
// Return enchant recommendations based on stat weights
router.get('/:charId/enchants', (req, res) => {
  try {
    const { charId } = req.params;

    if (!charId || isNaN(Number(charId))) {
      return res.status(400).json({ error: 'Invalid character ID' });
    }

    let rawWeights;
    try {
      rawWeights = db.getLatestStatWeights(charId);
    } catch (dbErr) {
      return res.status(500).json({ error: 'Failed to load stat weights: ' + dbErr.message });
    }

    if (!rawWeights) {
      return res.status(400).json({
        error: 'No stat weights available. Run a Stat Weights simulation first.'
      });
    }

    // Determine best stat from weights
    const formatted = optimizer.formatStatWeights(rawWeights);
    const bestStat = formatted.length > 0 ? formatted[0].stat : 'Unknown';

    // Basic enchant recommendations based on highest stat
    const enchants = [];
    if (bestStat) {
      enchants.push({ slot: 'chest', name: bestStat + ' enchant (best available)', dps_gain: null });
      enchants.push({ slot: 'back', name: bestStat + ' enchant (best available)', dps_gain: null });
      enchants.push({ slot: 'wrist', name: bestStat + ' enchant (best available)', dps_gain: null });
      enchants.push({ slot: 'legs', name: bestStat + ' enchant (best available)', dps_gain: null });
      enchants.push({ slot: 'feet', name: bestStat + ' enchant (best available)', dps_gain: null });
      enchants.push({ slot: 'finger1', name: bestStat + ' enchant (best available)', dps_gain: null });
      enchants.push({ slot: 'finger2', name: bestStat + ' enchant (best available)', dps_gain: null });
    }

    return res.json({ enchants: enchants });
  } catch (err) {
    console.error('[optimize] Error getting enchants:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/optimize/:charId/gems
// Return gem recommendations based on stat weights
router.get('/:charId/gems', (req, res) => {
  try {
    const { charId } = req.params;

    if (!charId || isNaN(Number(charId))) {
      return res.status(400).json({ error: 'Invalid character ID' });
    }

    let rawWeights;
    try {
      rawWeights = db.getLatestStatWeights(charId);
    } catch (dbErr) {
      return res.status(500).json({ error: 'Failed to load stat weights: ' + dbErr.message });
    }

    if (!rawWeights) {
      return res.status(400).json({
        error: 'No stat weights available. Run a Stat Weights simulation first.'
      });
    }

    const formatted = optimizer.formatStatWeights(rawWeights);
    const bestStat = formatted.length > 0 ? formatted[0].stat : 'Unknown';

    const gems = [];
    if (bestStat) {
      gems.push({ slot: 'gem', name: bestStat + ' gem (best available)', dps_gain: null });
    }

    return res.json({ gems: gems });
  } catch (err) {
    console.error('[optimize] Error getting gems:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/optimize/:charId/upgrades
// Return upgrade recommendations based on stat weights
router.get('/:charId/upgrades', (req, res) => {
  try {
    const { charId } = req.params;

    if (!charId || isNaN(Number(charId))) {
      return res.status(400).json({ error: 'Invalid character ID' });
    }

    let rawWeights;
    try {
      rawWeights = db.getLatestStatWeights(charId);
    } catch (dbErr) {
      return res.status(500).json({ error: 'Failed to load stat weights: ' + dbErr.message });
    }

    if (!rawWeights) {
      return res.status(400).json({
        error: 'No stat weights available. Run a Stat Weights simulation first.'
      });
    }

    // Upgrade recommendations require item database (not implemented yet)
    return res.json({
      upgrades: [],
      message: 'Upgrade recommendations are not yet implemented. Use stat weights for manual comparison.'
    });
  } catch (err) {
    console.error('[optimize] Error getting upgrades:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
