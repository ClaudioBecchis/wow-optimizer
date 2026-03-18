'use strict';

const express = require('express');
const router = express.Router();
const db = require('../modules/db');
const { parseSimcString } = require('../modules/simc-parser');

// POST /api/characters/import-simc
// Import character from SimulationCraft addon string
router.post('/import-simc', (req, res) => {
  try {
    const { simcString } = req.body;

    if (!simcString || typeof simcString !== 'string' || simcString.trim().length === 0) {
      return res.status(400).json({ error: 'simcString is required and must be a non-empty string' });
    }

    let parsed;
    try {
      parsed = parseSimcString(simcString);
    } catch (parseErr) {
      return res.status(400).json({ error: 'Failed to parse SimC string: ' + parseErr.message });
    }

    if (!parsed.name || parsed.name === 'Unknown') {
      return res.status(400).json({ error: 'Could not detect character name from SimC string' });
    }

    const charData = {
      name: parsed.name,
      realm: parsed.realm,
      region: parsed.region,
      class: parsed.class,
      spec: parsed.spec,
      race: parsed.race,
      level: parsed.level,
      talents: parsed.talents,
      equipment: parsed.equipment,
      ilvl: parsed.ilvl,
      simc_string: simcString.trim()
    };

    let id;
    try {
      id = db.insertCharacter(charData);
    } catch (dbErr) {
      return res.status(500).json({ error: 'Failed to save character: ' + dbErr.message });
    }

    if (!id) {
      return res.status(500).json({ error: 'Failed to save character to database' });
    }

    let character;
    try {
      character = db.getCharacter(id);
    } catch (getErr) {
      // Character was saved but we couldn't retrieve it; return what we can
      return res.status(201).json({ id, ...charData });
    }

    return res.status(201).json(character);
  } catch (err) {
    console.error('[character] Error importing SimC string:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/characters
// List all characters (summary view)
router.get('/', (req, res) => {
  try {
    let characters;
    try {
      characters = db.getAllCharacters();
    } catch (dbErr) {
      return res.status(500).json({ error: 'Failed to load characters: ' + dbErr.message });
    }

    const summary = characters.map((c) => {
      try {
        return {
          id: c.id,
          name: c.name,
          realm: c.realm,
          class: c.class,
          spec: c.spec,
          ilvl: c.ilvl,
          updated_at: c.updated_at
        };
      } catch (mapErr) {
        console.error('[character] Error mapping character:', mapErr);
        return { id: c.id, name: c.name || 'Unknown' };
      }
    });

    return res.json(summary);
  } catch (err) {
    console.error('[character] Error listing characters:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/characters/:id
// Get full character data
router.get('/:id', (req, res) => {
  try {
    const { id } = req.params;

    if (!id || isNaN(Number(id))) {
      return res.status(400).json({ error: 'Invalid character ID' });
    }

    let character;
    try {
      character = db.getCharacter(id);
    } catch (dbErr) {
      return res.status(500).json({ error: 'Failed to load character: ' + dbErr.message });
    }

    if (!character) {
      return res.status(404).json({ error: 'Character not found' });
    }

    return res.json(character);
  } catch (err) {
    console.error('[character] Error getting character:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// DELETE /api/characters/:id
// Delete a character and its associated simulations
router.delete('/:id', (req, res) => {
  try {
    const { id } = req.params;

    if (!id || isNaN(Number(id))) {
      return res.status(400).json({ error: 'Invalid character ID' });
    }

    let existed;
    try {
      existed = db.getCharacter(id);
    } catch (_) { /* ignore */ }

    if (!existed) {
      return res.status(404).json({ error: 'Character not found' });
    }

    let deleted;
    try {
      deleted = db.deleteCharacter(id);
    } catch (dbErr) {
      return res.status(500).json({ error: 'Failed to delete character: ' + dbErr.message });
    }

    if (!deleted) {
      return res.status(500).json({ error: 'Failed to delete character' });
    }

    return res.json({ success: true, message: 'Character deleted' });
  } catch (err) {
    console.error('[character] Error deleting character:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// PUT /api/characters/:id/simc
// Update character from new SimC string
router.put('/:id/simc', (req, res) => {
  try {
    const { id } = req.params;
    const { simcString } = req.body;

    if (!id || isNaN(Number(id))) {
      return res.status(400).json({ error: 'Invalid character ID' });
    }

    if (!simcString || typeof simcString !== 'string' || simcString.trim().length === 0) {
      return res.status(400).json({ error: 'simcString is required and must be a non-empty string' });
    }

    // Check character exists
    let existing;
    try {
      existing = db.getCharacter(id);
    } catch (_) { /* ignore */ }

    if (!existing) {
      return res.status(404).json({ error: 'Character not found' });
    }

    let parsed;
    try {
      parsed = parseSimcString(simcString);
    } catch (parseErr) {
      return res.status(400).json({ error: 'Failed to parse SimC string: ' + parseErr.message });
    }

    const updates = {
      name: parsed.name,
      realm: parsed.realm,
      region: parsed.region,
      class: parsed.class,
      spec: parsed.spec,
      race: parsed.race,
      level: parsed.level,
      talents: parsed.talents,
      equipment: parsed.equipment,
      ilvl: parsed.ilvl,
      simc_string: simcString.trim()
    };

    let updated;
    try {
      updated = db.updateCharacter(id, updates);
    } catch (dbErr) {
      return res.status(500).json({ error: 'Failed to update character: ' + dbErr.message });
    }

    if (!updated) {
      return res.status(500).json({ error: 'Failed to update character' });
    }

    return res.json(updated);
  } catch (err) {
    console.error('[character] Error updating character SimC:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
