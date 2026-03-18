'use strict';

const express = require('express');
const router = express.Router();
const db = require('../modules/db');
const simcRunner = require('../modules/simc-runner');
const { generateSimcProfile } = require('../modules/simc-parser');

// POST /api/simulate/:charId
// Start a DPS simulation for a character
router.post('/:charId', (req, res) => {
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

    // Generate SimC input
    let simcInput;
    try {
      if (character.simc_string) {
        simcInput = character.simc_string;
      } else {
        simcInput = generateSimcProfile(character);
      }
    } catch (genErr) {
      return res.status(500).json({ error: 'Failed to generate SimC profile: ' + genErr.message });
    }

    // Create simulation record
    let simId;
    try {
      simId = db.insertSimulation({
        character_id: Number(charId),
        type: 'dps',
        status: 'queued',
        progress: 0,
        character_name: character.name,
        character_spec: character.spec,
        character_class: character.class
      });
    } catch (dbErr) {
      return res.status(500).json({ error: 'Failed to create simulation record: ' + dbErr.message });
    }

    if (!simId) {
      return res.status(500).json({ error: 'Failed to create simulation record' });
    }

    // Queue the simulation
    try {
      const options = {};
      if (req.body && req.body.iterations) {
        options.iterations = req.body.iterations;
      }
      if (req.body && req.body.threads) {
        options.threads = req.body.threads;
      }
      simcRunner.queueSimulation(simId, simcInput, 'dps', options);
    } catch (queueErr) {
      return res.status(500).json({ error: 'Failed to queue simulation: ' + queueErr.message });
    }

    return res.status(201).json({
      jobId: simId,
      status: 'queued',
      queue: simcRunner.getQueueStatus()
    });
  } catch (err) {
    console.error('[simulate] Error starting DPS simulation:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/simulate/:charId/stat-weights
// Start a stat weights simulation for a character
router.post('/:charId/stat-weights', (req, res) => {
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

    // Generate SimC input
    let simcInput;
    try {
      if (character.simc_string) {
        simcInput = character.simc_string;
      } else {
        simcInput = generateSimcProfile(character);
      }
    } catch (genErr) {
      return res.status(500).json({ error: 'Failed to generate SimC profile: ' + genErr.message });
    }

    // Create simulation record
    let simId;
    try {
      simId = db.insertSimulation({
        character_id: Number(charId),
        type: 'stat_weights',
        status: 'queued',
        progress: 0,
        character_name: character.name,
        character_spec: character.spec,
        character_class: character.class
      });
    } catch (dbErr) {
      return res.status(500).json({ error: 'Failed to create simulation record: ' + dbErr.message });
    }

    if (!simId) {
      return res.status(500).json({ error: 'Failed to create simulation record' });
    }

    // Queue the simulation
    try {
      const options = {};
      if (req.body && req.body.iterations) {
        options.iterations = req.body.iterations;
      }
      if (req.body && req.body.threads) {
        options.threads = req.body.threads;
      }
      simcRunner.queueSimulation(simId, simcInput, 'stat_weights', options);
    } catch (queueErr) {
      return res.status(500).json({ error: 'Failed to queue simulation: ' + queueErr.message });
    }

    return res.status(201).json({
      jobId: simId,
      status: 'queued',
      queue: simcRunner.getQueueStatus()
    });
  } catch (err) {
    console.error('[simulate] Error starting stat weights simulation:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/simulate/status/:jobId
// Get simulation status
router.get('/status/:jobId', (req, res) => {
  try {
    const { jobId } = req.params;

    if (!jobId || isNaN(Number(jobId))) {
      return res.status(400).json({ error: 'Invalid job ID' });
    }

    let sim;
    try {
      sim = db.getSimulation(jobId);
    } catch (dbErr) {
      return res.status(500).json({ error: 'Failed to load simulation: ' + dbErr.message });
    }

    if (!sim) {
      return res.status(404).json({ error: 'Simulation not found' });
    }

    const response = {
      id: sim.id,
      status: sim.status,
      progress: sim.progress || 0,
      error_message: sim.error_message || null
    };

    // Include result data when simulation is done
    if (sim.status === 'done' || sim.status === 'completed') {
      response.dps = sim.dps || null;
      response.stat_weights_json = sim.stat_weights_json || null;
      response.duration_seconds = sim.duration_seconds || null;
      response.type = sim.type || null;

      // Build a result object that renderSimResult can consume
      response.result = {
        dps: sim.dps || null,
        stat_weights_json: sim.stat_weights_json || null,
        type: sim.type || null,
        duration: sim.duration_seconds || null,
        html_report: sim.html_report || null
      };
    }

    return res.json(response);
  } catch (err) {
    console.error('[simulate] Error getting simulation status:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/simulate/result/:jobId
// Get full simulation result
router.get('/result/:jobId', (req, res) => {
  try {
    const { jobId } = req.params;

    if (!jobId || isNaN(Number(jobId))) {
      return res.status(400).json({ error: 'Invalid job ID' });
    }

    let sim;
    try {
      sim = db.getSimulation(jobId);
    } catch (dbErr) {
      return res.status(500).json({ error: 'Failed to load simulation: ' + dbErr.message });
    }

    if (!sim) {
      return res.status(404).json({ error: 'Simulation not found' });
    }

    // Build response
    const response = {
      id: sim.id,
      character_id: sim.character_id,
      type: sim.type,
      status: sim.status,
      progress: sim.progress || 0,
      error_message: sim.error_message || null,
      results: sim.results || null,
      created_at: sim.created_at,
      updated_at: sim.updated_at
    };

    // Include HTML report path if available
    if (sim.html_report) {
      response.html_report = sim.html_report;
    }

    // Include DPS from the sim object directly (simc-runner saves it here)
    if (sim.dps) {
      response.dps = sim.dps;
    }

    // Include stat weights if available
    if (sim.stat_weights_json) {
      response.stat_weights_json = sim.stat_weights_json;
    }

    // Add formatted stat weights if available
    try {
      const weights = sim.stat_weights_json
        || (sim.results && sim.results.stat_weights ? sim.results.stat_weights : null);
      if (weights && sim.type === 'stat_weights') {
        const display = [];
        for (const [stat, value] of Object.entries(weights)) {
          try {
            display.push({
              stat: stat.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()),
              weight: typeof value === 'number' ? value : parseFloat(value) || 0
            });
          } catch (_) { /* ignore individual stat format error */ }
        }
        display.sort((a, b) => b.weight - a.weight);
        response.stat_weights_display = display;
      }
    } catch (swErr) {
      console.error('[simulate] Error formatting stat weights:', swErr);
    }

    return res.json(response);
  } catch (err) {
    console.error('[simulate] Error getting simulation result:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/simulate/history/:charId
// Get simulation history for a character
router.get('/history/:charId', (req, res) => {
  try {
    const { charId } = req.params;

    if (!charId || isNaN(Number(charId))) {
      return res.status(400).json({ error: 'Invalid character ID' });
    }

    let sims;
    try {
      sims = db.getSimsByCharacter(charId);
    } catch (dbErr) {
      return res.status(500).json({ error: 'Failed to load simulations: ' + dbErr.message });
    }

    const summary = sims.map((s) => {
      try {
        const entry = {
          id: s.id,
          type: s.type,
          status: s.status,
          progress: s.progress || 0,
          dps: s.dps || (s.results && s.results.dps ? s.results.dps : null),
          error_message: s.error_message || null,
          created_at: s.created_at,
          updated_at: s.updated_at
        };
        if (s.html_report) {
          entry.html_report = s.html_report;
        }
        return entry;
      } catch (mapErr) {
        console.error('[simulate] Error mapping simulation:', mapErr);
        return { id: s.id, status: s.status || 'unknown' };
      }
    });

    // Sort newest first
    try {
      summary.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    } catch (_) { /* ignore sort error */ }

    return res.json(summary);
  } catch (err) {
    console.error('[simulate] Error getting simulation history:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/simulate/test-simc
// Test the SimC binary
router.post('/test-simc', async (req, res) => {
  try {
    let result;
    try {
      result = await simcRunner.testSimc();
    } catch (testErr) {
      return res.status(500).json({ ok: false, message: 'Test failed: ' + testErr.message });
    }

    return res.json(result);
  } catch (err) {
    console.error('[simulate] Error testing SimC:', err);
    return res.status(500).json({ ok: false, message: 'Internal server error' });
  }
});

// DELETE /api/simulate/cancel/:jobId
// Cancel a single simulation (queued or running)
router.delete('/cancel/:jobId', (req, res) => {
  try {
    const { jobId } = req.params;

    if (!jobId || isNaN(Number(jobId))) {
      return res.status(400).json({ error: 'Invalid job ID' });
    }

    let result;
    try {
      result = simcRunner.cancelSimulation(jobId);
    } catch (cancelErr) {
      return res.status(500).json({ error: 'Failed to cancel simulation: ' + cancelErr.message });
    }

    if (result.ok) {
      return res.json(result);
    } else {
      return res.status(404).json(result);
    }
  } catch (err) {
    console.error('[simulate] Error cancelling simulation:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// DELETE /api/simulate/cancel-all
// Cancel all queued and running simulations
router.delete('/cancel-all', (req, res) => {
  try {
    let result;
    try {
      result = simcRunner.cancelAll();
    } catch (cancelErr) {
      return res.status(500).json({ error: 'Failed to cancel simulations: ' + cancelErr.message });
    }

    return res.json(result);
  } catch (err) {
    console.error('[simulate] Error cancelling all simulations:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
