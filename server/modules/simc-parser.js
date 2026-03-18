'use strict';

// --------------- Constants ---------------

const CLASS_MAP = {
  warrior: 'Warrior',
  paladin: 'Paladin',
  hunter: 'Hunter',
  rogue: 'Rogue',
  priest: 'Priest',
  deathknight: 'Death Knight',
  death_knight: 'Death Knight',
  shaman: 'Shaman',
  mage: 'Mage',
  warlock: 'Warlock',
  monk: 'Monk',
  druid: 'Druid',
  demonhunter: 'Demon Hunter',
  demon_hunter: 'Demon Hunter',
  evoker: 'Evoker'
};

const SLOT_NAMES = [
  'head', 'neck', 'shoulder', 'back', 'chest', 'wrist',
  'hands', 'waist', 'legs', 'feet',
  'finger1', 'finger2', 'trinket1', 'trinket2',
  'main_hand', 'off_hand'
];

// --------------- Helpers ---------------

function detectClassFromLine(line) {
  try {
    // Lines like:  warrior="Name"  or  death_knight="Name"
    const lower = line.toLowerCase().trim();
    for (const key of Object.keys(CLASS_MAP)) {
      if (lower.startsWith(key + '=')) {
        return key;
      }
    }
    return null;
  } catch (err) {
    console.error('[simc-parser] Error detecting class:', err);
    return null;
  }
}

function parseEquipmentLine(line) {
  try {
    // Format:  slot=,id=12345,bonus_id=1/2/3,enchant_id=999,gem_id=111/222,ilevel=400
    const parts = line.split(',');
    const item = {
      id: null,
      bonusIds: [],
      enchantId: null,
      gemIds: [],
      ilvl: null,
      name: ''
    };

    for (const part of parts) {
      try {
        const trimmed = part.trim();
        if (trimmed.startsWith('id=')) {
          item.id = parseInt(trimmed.substring(3), 10) || null;
        } else if (trimmed.startsWith('bonus_id=')) {
          const val = trimmed.substring(9);
          item.bonusIds = val.split('/').map((v) => parseInt(v, 10)).filter((v) => !isNaN(v));
        } else if (trimmed.startsWith('enchant_id=')) {
          item.enchantId = parseInt(trimmed.substring(11), 10) || null;
        } else if (trimmed.startsWith('gem_id=')) {
          const val = trimmed.substring(7);
          item.gemIds = val.split('/').map((v) => parseInt(v, 10)).filter((v) => !isNaN(v));
        } else if (trimmed.startsWith('ilevel=')) {
          item.ilvl = parseInt(trimmed.substring(7), 10) || null;
        } else if (trimmed.startsWith('name=')) {
          item.name = trimmed.substring(5);
        }
      } catch (partErr) {
        console.error('[simc-parser] Error parsing equipment part:', partErr);
      }
    }

    return item;
  } catch (err) {
    console.error('[simc-parser] Error parsing equipment line:', err);
    return { id: null, bonusIds: [], enchantId: null, gemIds: [], ilvl: null, name: '' };
  }
}

function extractName(line, classKey) {
  try {
    // warrior="CharName"  ->  CharName
    const afterEq = line.substring(classKey.length + 1).trim();
    return afterEq.replace(/^["']|["']$/g, '');
  } catch (err) {
    console.error('[simc-parser] Error extracting name:', err);
    return 'Unknown';
  }
}

// --------------- Main Parse ---------------

function parseSimcString(text) {
  try {
    if (!text || typeof text !== 'string') {
      throw new Error('Invalid SimC string: input is empty or not a string');
    }

    const lines = text.split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !l.startsWith('#'));

    const result = {
      name: 'Unknown',
      realm: '',
      region: '',
      class: '',
      spec: '',
      race: '',
      level: 80,
      talents: '',
      equipment: {},
      ilvl: 0
    };

    let detectedClassKey = null;

    for (const line of lines) {
      try {
        // Detect class line (e.g. warrior="Name")
        const classKey = detectClassFromLine(line);
        if (classKey) {
          detectedClassKey = classKey;
          result.class = CLASS_MAP[classKey] || classKey;
          result.name = extractName(line, classKey);
          continue;
        }

        // Key=value pairs
        const eqIdx = line.indexOf('=');
        if (eqIdx === -1) continue;

        const key = line.substring(0, eqIdx).trim().toLowerCase();
        const value = line.substring(eqIdx + 1).trim();

        switch (key) {
          case 'level':
            result.level = parseInt(value, 10) || 80;
            break;
          case 'race':
            result.race = value.replace(/_/g, ' ');
            break;
          case 'region':
            result.region = value.toLowerCase();
            break;
          case 'server':
            result.realm = value.replace(/_/g, ' ');
            break;
          case 'role':
            // informational only; not stored separately
            break;
          case 'spec':
            result.spec = value.charAt(0).toUpperCase() + value.slice(1);
            break;
          case 'talents':
            result.talents = value;
            break;
          default:
            // Check if it's an equipment slot
            if (SLOT_NAMES.includes(key)) {
              result.equipment[key] = parseEquipmentLine(value);
            }
            break;
        }
      } catch (lineErr) {
        console.error('[simc-parser] Error parsing line:', line, lineErr);
      }
    }

    // Calculate average ilvl from equipment
    try {
      const items = Object.values(result.equipment);
      const ilvls = items.map((i) => i.ilvl).filter((v) => v && v > 0);
      if (ilvls.length > 0) {
        result.ilvl = Math.round(ilvls.reduce((a, b) => a + b, 0) / ilvls.length);
      }
    } catch (ilvlErr) {
      console.error('[simc-parser] Error calculating ilvl:', ilvlErr);
    }

    return result;
  } catch (err) {
    console.error('[simc-parser] Error parsing SimC string:', err);
    throw err; // re-throw so the caller knows parsing failed
  }
}

// --------------- Generate Profile ---------------

function generateSimcProfile(character) {
  try {
    if (!character) {
      throw new Error('Character object is required');
    }

    const lines = [];

    // Determine class key for the header line
    let classKey = 'warrior'; // fallback
    try {
      const reverseMap = {};
      for (const [k, v] of Object.entries(CLASS_MAP)) {
        if (!reverseMap[v]) {
          reverseMap[v] = k;
        }
      }
      classKey = reverseMap[character.class] || character.class.toLowerCase().replace(/ /g, '_');
    } catch (mapErr) {
      console.error('[simc-parser] Error mapping class key:', mapErr);
    }

    const charName = (character.name || 'Unknown').replace(/"/g, '');
    lines.push(`${classKey}="${charName}"`);

    if (character.level) lines.push(`level=${character.level}`);
    if (character.race) lines.push(`race=${character.race.replace(/ /g, '_').toLowerCase()}`);
    if (character.region) lines.push(`region=${character.region.toLowerCase()}`);
    if (character.realm) lines.push(`server=${character.realm.replace(/ /g, '_').toLowerCase()}`);
    if (character.spec) lines.push(`spec=${character.spec.toLowerCase()}`);
    if (character.talents) lines.push(`talents=${character.talents}`);

    // Equipment
    try {
      if (character.equipment && typeof character.equipment === 'object') {
        for (const slot of SLOT_NAMES) {
          try {
            const item = character.equipment[slot];
            if (!item || !item.id) continue;

            const parts = [`${slot}=`, `id=${item.id}`];

            if (item.bonusIds && item.bonusIds.length > 0) {
              parts.push(`bonus_id=${item.bonusIds.join('/')}`);
            }
            if (item.enchantId) {
              parts.push(`enchant_id=${item.enchantId}`);
            }
            if (item.gemIds && item.gemIds.length > 0) {
              parts.push(`gem_id=${item.gemIds.join('/')}`);
            }
            if (item.ilvl) {
              parts.push(`ilevel=${item.ilvl}`);
            }

            lines.push(parts.join(','));
          } catch (slotErr) {
            console.error(`[simc-parser] Error generating slot ${slot}:`, slotErr);
          }
        }
      }
    } catch (equipErr) {
      console.error('[simc-parser] Error generating equipment:', equipErr);
    }

    // Auto-use trinkets and suppress warning
    lines.push('');
    lines.push('# Auto-generated options');
    lines.push('use_item_verification=0');

    return lines.join('\n');
  } catch (err) {
    console.error('[simc-parser] Error generating SimC profile:', err);
    throw err;
  }
}

// --------------- Exports ---------------

module.exports = {
  parseSimcString,
  generateSimcProfile,
  CLASS_MAP,
  SLOT_NAMES
};
