'use strict';

const fs = require('fs');
const path = require('path');

const DB_PATH = path.join(__dirname, '..', 'data', 'db.json');

const DEFAULT_DATA = {
  characters: [],
  simulations: [],
  config: {
    simc_path: '/usr/local/bin/simc',
    simc_threads: '4',
    simc_iterations: '10000'
  },
  nextCharId: 1,
  nextSimId: 1
};

// --------------- Core I/O ---------------

function load() {
  try {
    if (!fs.existsSync(DB_PATH)) {
      save(DEFAULT_DATA);
      return JSON.parse(JSON.stringify(DEFAULT_DATA));
    }
    const raw = fs.readFileSync(DB_PATH, 'utf-8');
    const data = JSON.parse(raw);
    return data;
  } catch (err) {
    console.error('[db] Error loading database:', err);
    return JSON.parse(JSON.stringify(DEFAULT_DATA));
  }
}

function save(data) {
  try {
    const dir = path.dirname(DB_PATH);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(DB_PATH, JSON.stringify(data, null, 2), 'utf-8');
    return true;
  } catch (err) {
    console.error('[db] Error saving database:', err);
    return false;
  }
}

// --------------- Config ---------------

function getConfig(key) {
  try {
    const data = load();
    if (key === undefined || key === null) {
      return data.config || {};
    }
    return data.config ? data.config[key] : undefined;
  } catch (err) {
    console.error('[db] Error getting config:', err);
    return undefined;
  }
}

function setConfig(key, val) {
  try {
    const data = load();
    if (!data.config) {
      data.config = {};
    }
    data.config[key] = val;
    save(data);
    return true;
  } catch (err) {
    console.error('[db] Error setting config:', err);
    return false;
  }
}

function getAllConfig() {
  try {
    const data = load();
    return data.config || {};
  } catch (err) {
    console.error('[db] Error getting all config:', err);
    return {};
  }
}

// --------------- Characters ---------------

function insertCharacter(char) {
  try {
    const data = load();
    const id = data.nextCharId++;
    const now = new Date().toISOString();
    const record = {
      id,
      ...char,
      created_at: now,
      updated_at: now
    };
    data.characters.push(record);
    save(data);
    return id;
  } catch (err) {
    console.error('[db] Error inserting character:', err);
    return null;
  }
}

function getCharacter(id) {
  try {
    const data = load();
    const numId = Number(id);
    const char = data.characters.find((c) => c.id === numId);
    return char || null;
  } catch (err) {
    console.error('[db] Error getting character:', err);
    return null;
  }
}

function getAllCharacters() {
  try {
    const data = load();
    return data.characters || [];
  } catch (err) {
    console.error('[db] Error getting all characters:', err);
    return [];
  }
}

function deleteCharacter(id) {
  try {
    const data = load();
    const numId = Number(id);
    const idx = data.characters.findIndex((c) => c.id === numId);
    if (idx === -1) {
      return false;
    }
    data.characters.splice(idx, 1);
    // Also remove associated simulations
    data.simulations = data.simulations.filter((s) => s.character_id !== numId);
    save(data);
    return true;
  } catch (err) {
    console.error('[db] Error deleting character:', err);
    return false;
  }
}

function updateCharacter(id, updates) {
  try {
    const data = load();
    const numId = Number(id);
    const idx = data.characters.findIndex((c) => c.id === numId);
    if (idx === -1) {
      return null;
    }
    const now = new Date().toISOString();
    data.characters[idx] = {
      ...data.characters[idx],
      ...updates,
      id: numId,          // prevent id overwrite
      updated_at: now
    };
    save(data);
    return data.characters[idx];
  } catch (err) {
    console.error('[db] Error updating character:', err);
    return null;
  }
}

// --------------- Simulations ---------------

function insertSimulation(sim) {
  try {
    const data = load();
    const id = data.nextSimId++;
    const now = new Date().toISOString();
    const record = {
      id,
      ...sim,
      status: sim.status || 'queued',
      progress: sim.progress || 0,
      created_at: now,
      updated_at: now
    };
    data.simulations.push(record);
    save(data);
    return id;
  } catch (err) {
    console.error('[db] Error inserting simulation:', err);
    return null;
  }
}

function getSimulation(id) {
  try {
    const data = load();
    const numId = Number(id);
    const sim = data.simulations.find((s) => s.id === numId);
    return sim || null;
  } catch (err) {
    console.error('[db] Error getting simulation:', err);
    return null;
  }
}

function updateSimulation(id, updates) {
  try {
    const data = load();
    const numId = Number(id);
    const idx = data.simulations.findIndex((s) => s.id === numId);
    if (idx === -1) {
      return null;
    }
    const now = new Date().toISOString();
    data.simulations[idx] = {
      ...data.simulations[idx],
      ...updates,
      id: numId,           // prevent id overwrite
      updated_at: now
    };
    save(data);
    return data.simulations[idx];
  } catch (err) {
    console.error('[db] Error updating simulation:', err);
    return null;
  }
}

function getSimsByCharacter(charId) {
  try {
    const data = load();
    const numId = Number(charId);
    return data.simulations.filter((s) => s.character_id === numId);
  } catch (err) {
    console.error('[db] Error getting simulations by character:', err);
    return [];
  }
}

function getLatestStatWeights(charId) {
  try {
    const data = load();
    const numId = Number(charId);
    const sims = data.simulations
      .filter((s) => s.character_id === numId && s.type === 'stat_weights' && s.status === 'completed')
      .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    if (sims.length === 0) {
      return null;
    }
    return sims[0].results ? sims[0].results.stat_weights || null : null;
  } catch (err) {
    console.error('[db] Error getting latest stat weights:', err);
    return null;
  }
}

// --------------- Exports ---------------

module.exports = {
  load,
  save,
  getConfig,
  setConfig,
  getAllConfig,
  insertCharacter,
  getCharacter,
  getAllCharacters,
  deleteCharacter,
  updateCharacter,
  insertSimulation,
  getSimulation,
  updateSimulation,
  getSimsByCharacter,
  getLatestStatWeights
};
