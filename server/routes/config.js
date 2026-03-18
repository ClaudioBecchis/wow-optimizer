'use strict';

const express = require('express');
const router = express.Router();
const db = require('../modules/db');
const simcRunner = require('../modules/simc-runner');

// Keys that should be masked in GET responses
const SECRET_KEYS = ['api_key', 'secret', 'token', 'password'];

function maskValue(key, value) {
  try {
    const lower = key.toLowerCase();
    for (const secret of SECRET_KEYS) {
      if (lower.includes(secret)) {
        if (typeof value === 'string' && value.length > 4) {
          return value.substring(0, 4) + '****';
        }
        return '****';
      }
    }
    return value;
  } catch (err) {
    console.error('[config] Error masking value:', err);
    return value;
  }
}

// Allowed config keys (whitelist)
const ALLOWED_KEYS = [
  'simc_path',
  'simc_threads',
  'simc_iterations',
  'default_fight_style',
  'default_fight_duration',
  'default_target_count',
  'blizzard_client_id',
  'blizzard_client_secret',
  'blizzard_region'
];

// GET /api/config
// Return all config (with secrets masked)
router.get('/', (req, res) => {
  try {
    let config;
    try {
      config = db.getAllConfig();
    } catch (dbErr) {
      return res.status(500).json({ error: 'Failed to load config: ' + dbErr.message });
    }

    // Mask sensitive values
    const masked = {};
    try {
      for (const [key, value] of Object.entries(config)) {
        try {
          masked[key] = maskValue(key, value);
        } catch (_) {
          masked[key] = value;
        }
      }
    } catch (maskErr) {
      console.error('[config] Error masking config:', maskErr);
      return res.json(config); // return unmasked if masking fails
    }

    return res.json(masked);
  } catch (err) {
    console.error('[config] Error getting config:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// PATCH /api/config
// Update config from body key/values
router.patch('/', (req, res) => {
  try {
    const updates = req.body;

    if (!updates || typeof updates !== 'object' || Array.isArray(updates)) {
      return res.status(400).json({ error: 'Request body must be a JSON object of key/value pairs' });
    }

    const applied = {};
    const errors = [];

    for (const [key, value] of Object.entries(updates)) {
      try {
        // Validate key
        if (!ALLOWED_KEYS.includes(key)) {
          errors.push(`Unknown config key: ${key}`);
          continue;
        }

        // Validate value types
        if (value === null || value === undefined) {
          errors.push(`Value for ${key} cannot be null or undefined`);
          continue;
        }

        // Type-specific validation
        try {
          if (key === 'simc_threads') {
            const num = parseInt(String(value), 10);
            if (isNaN(num) || num < 1 || num > 64) {
              errors.push(`simc_threads must be between 1 and 64`);
              continue;
            }
          }
          if (key === 'simc_iterations') {
            const num = parseInt(String(value), 10);
            if (isNaN(num) || num < 100 || num > 1000000) {
              errors.push(`simc_iterations must be between 100 and 1000000`);
              continue;
            }
          }
        } catch (valErr) {
          errors.push(`Validation error for ${key}: ${valErr.message}`);
          continue;
        }

        const success = db.setConfig(key, String(value));
        if (success) {
          applied[key] = String(value);
        } else {
          errors.push(`Failed to save ${key}`);
        }
      } catch (keyErr) {
        console.error(`[config] Error setting config key ${key}:`, keyErr);
        errors.push(`Error setting ${key}: ${keyErr.message}`);
      }
    }

    const response = { applied };
    if (errors.length > 0) {
      response.errors = errors;
    }

    // Return current config
    try {
      response.config = db.getAllConfig();
    } catch (_) { /* ignore */ }

    return res.json(response);
  } catch (err) {
    console.error('[config] Error updating config:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/config/test-simc
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
    console.error('[config] Error testing SimC:', err);
    return res.status(500).json({ ok: false, message: 'Internal server error' });
  }
});

// POST /api/config/test-blizzard
router.post('/test-blizzard', async (req, res) => {
  try {
    const blizzard = require('../modules/blizzard-api');
    const result = await blizzard.testConnection();
    return res.json(result);
  } catch (err) {
    return res.status(500).json({ ok: false, message: err.message });
  }
});

module.exports = router;
