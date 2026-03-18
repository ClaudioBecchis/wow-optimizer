'use strict';

const db = require('./db');

// --------------- Constants ---------------

const REGION_HOSTS = {
  eu: 'https://eu.api.blizzard.com',
  us: 'https://us.api.blizzard.com'
};

const OAUTH_TOKEN_URL = 'https://oauth.battle.net/token';

const SLOT_MAP = {
  HEAD: 'head',
  NECK: 'neck',
  SHOULDER: 'shoulder',
  BACK: 'back',
  CHEST: 'chest',
  WRIST: 'wrist',
  HANDS: 'hands',
  WAIST: 'waist',
  LEGS: 'legs',
  FEET: 'feet',
  FINGER_1: 'finger1',
  FINGER_2: 'finger2',
  TRINKET_1: 'trinket1',
  TRINKET_2: 'trinket2',
  MAIN_HAND: 'main_hand',
  OFF_HAND: 'off_hand'
};

// --------------- Token cache ---------------

let cachedToken = null;
let tokenExpiresAt = 0;

// --------------- Helpers ---------------

/**
 * Map of known realm names / partial slugs (without accents) to the correct
 * Blizzard API slug.  Keys MUST be lowercase.
 */
var REALM_SLUG_MAP = {
  "pozzo dell'eternita": "pozzo-delleternità",
  "pozzo dell'eternità": "pozzo-delleternità",
  "pozzo-delleternita": "pozzo-delleternità",
  "pozzo-delleternità": "pozzo-delleternità",
  "pozzo dell eternita": "pozzo-delleternità",
};

/**
 * Convert a display name (realm or character) into a Blizzard-API-compatible slug.
 *
 * Steps:
 *  1. Lowercase
 *  2. Remove apostrophes / quotes entirely (join the surrounding words)
 *  3. Replace spaces with dashes
 *  4. Strip any character that is not a-z, 0-9, dash, or accented letter
 *  5. Collapse consecutive dashes
 *  6. Trim leading / trailing dashes
 *
 * Accented characters (à, è, é, ö, etc.) are PRESERVED because Blizzard
 * realm slugs require them.
 *
 * Examples:
 *   "Pozzo dell'Eternità" → "pozzo-delleternità"
 *   "Aggra (Português)"   → "aggra-português"
 *   "Twisting Nether"     → "twisting-nether"
 */
function slugify(text) {
  return text
    .toLowerCase()
    .replace(/[''‛'"`]/g, '')          // remove apostrophes and quotes (WITHOUT inserting dash)
    .replace(/\s+/g, '-')             // spaces → dashes
    .replace(/[^a-z0-9\u00C0-\u024F\u1E00-\u1EFF-]/g, '') // keep a-z, 0-9, dash, accented chars
    .replace(/-{2,}/g, '-')           // collapse multiple dashes
    .replace(/^-+|-+$/g, '');         // trim leading/trailing dashes
}

/**
 * Returns true if the string already looks like a slug:
 * all lowercase, no spaces, may contain dashes and accented chars.
 */
function isAlreadySlug(text) {
  // A slug has no uppercase letters and no spaces
  return text === text.toLowerCase() && !/\s/.test(text);
}

/**
 * Resolve a realm input to the correct Blizzard API slug.
 *
 * 1. Check REALM_SLUG_MAP for a known override (handles accent-stripped slugs
 *    and display names with apostrophes).
 * 2. If the input already looks like a slug, return it as-is.
 * 3. Otherwise, run the generic slugify helper.
 */
function resolveRealmSlug(realm) {
  var key = realm.toLowerCase();
  if (REALM_SLUG_MAP[key]) {
    return REALM_SLUG_MAP[key];
  }
  if (isAlreadySlug(realm)) {
    return realm;
  }
  return slugify(realm);
}

/**
 * Retrieve and cache an OAuth2 access token using client_credentials flow.
 */
async function getAccessToken() {
  try {
    // Return cached token if still valid (with 60s safety margin)
    if (cachedToken && Date.now() < tokenExpiresAt - 60_000) {
      return cachedToken;
    }

    const clientId = db.getConfig('blizzard_client_id');
    const clientSecret = db.getConfig('blizzard_client_secret');
    const region = db.getConfig('blizzard_region') || 'eu';

    if (!clientId || !clientSecret) {
      throw new Error('Blizzard API non configurata. Vai nelle Impostazioni.');
    }

    const credentials = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');

    const response = await fetch(OAUTH_TOKEN_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Basic ${credentials}`,
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: 'grant_type=client_credentials'
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`OAuth token request failed (${response.status}): ${text}`);
    }

    const data = await response.json();

    if (!data.access_token) {
      throw new Error('OAuth response missing access_token');
    }

    cachedToken = data.access_token;
    // expires_in is in seconds
    tokenExpiresAt = Date.now() + (data.expires_in || 3600) * 1000;

    return cachedToken;
  } catch (err) {
    console.error('[blizzard-api] Error getting access token:', err);
    throw err;
  }
}

/**
 * Perform a GET request against the Blizzard API.
 * @param {string} endpoint - API path (e.g. /profile/wow/character/ragnaros/arthas)
 * @param {string} region   - Region key (eu, us)
 * @param {string} namespace - Namespace header value (e.g. profile-eu, static-eu)
 * @returns {Promise<object>} Parsed JSON response
 */
async function apiGet(endpoint, region, namespace) {
  try {
    const token = await getAccessToken();
    const host = REGION_HOSTS[region] || REGION_HOSTS.eu;

    const separator = endpoint.includes('?') ? '&' : '?';
    const url = `${host}${endpoint}${separator}locale=en_US`;

    const headers = {
      'Authorization': `Bearer ${token}`
    };
    if (namespace) {
      headers['Battlenet-Namespace'] = namespace;
    }

    const response = await fetch(url, { method: 'GET', headers });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Blizzard API error ${response.status} for ${endpoint}: ${text}`);
    }

    return await response.json();
  } catch (err) {
    console.error('[blizzard-api] apiGet error:', err);
    throw err;
  }
}

// --------------- Item icon ---------------

/**
 * Fetch the icon URL for a given item ID from the Blizzard media endpoint.
 * @param {number} itemId - The WoW item ID
 * @returns {Promise<string|null>} The icon asset URL, or null on failure
 */
async function getItemIcon(itemId) {
  try {
    const region = (db.getConfig('blizzard_region') || 'eu').toLowerCase();
    const data = await apiGet(
      `/data/wow/media/item/${itemId}`,
      region,
      `static-${region}`
    );
    return (data && data.assets && data.assets[0] && data.assets[0].value) || null;
  } catch (err) {
    console.error('[blizzard-api] getItemIcon error for item ' + itemId + ':', err.message);
    return null;
  }
}

// --------------- Character import ---------------

/**
 * Parse a single equipment item from the Blizzard API equipment response.
 */
function parseEquipmentItem(item) {
  try {
    const result = {
      id: item.item?.id || 0,
      name: item.item?.name || item.name || 'Unknown',
      ilvl: item.level?.value || 0,
      quality: item.quality?.type || 'COMMON',
      bonusIds: [],
      enchantId: null,
      enchantName: null,
      gemIds: [],
      stats: {}
    };

    // Bonus IDs
    try {
      if (Array.isArray(item.bonus_list)) {
        result.bonusIds = item.bonus_list.map(Number);
      }
    } catch (_) { /* ignore */ }

    // Enchantments
    try {
      if (Array.isArray(item.enchantments) && item.enchantments.length > 0) {
        const ench = item.enchantments[0];
        result.enchantId = ench.enchantment_id || null;
        result.enchantName = ench.display_string || null;
      }
    } catch (_) { /* ignore */ }

    // Sockets / gems
    try {
      if (Array.isArray(item.sockets)) {
        result.gemIds = item.sockets
          .filter((s) => s.item && s.item.id)
          .map((s) => s.item.id);
      }
    } catch (_) { /* ignore */ }

    // Stats
    try {
      if (Array.isArray(item.stats)) {
        for (const s of item.stats) {
          try {
            const statType = s.type?.type || s.type?.name || '';
            const value = s.value || 0;
            if (statType && value) {
              result.stats[statType] = value;
            }
          } catch (_) { /* ignore */ }
        }
      }
    } catch (_) { /* ignore */ }

    return result;
  } catch (err) {
    console.error('[blizzard-api] Error parsing equipment item:', err);
    return {
      id: 0,
      name: 'Unknown',
      ilvl: 0,
      quality: 'COMMON',
      bonusIds: [],
      enchantId: null,
      enchantName: null,
      gemIds: [],
      stats: {}
    };
  }
}

/**
 * Full character import: fetches profile, equipment, stats and media in parallel.
 * @param {string} realm  - Realm slug (lowercase, hyphenated)
 * @param {string} name   - Character name (lowercase)
 * @param {string} region - Region key (eu, us). Falls back to config or 'eu'.
 * @returns {Promise<object>} Normalised character data
 */
async function importCharacter(realm, name, region) {
  try {
    const effectiveRegion = (region || db.getConfig('blizzard_region') || 'eu').toLowerCase();
    const realmSlug = resolveRealmSlug(realm);
    const charName = slugify(name);
    const profileNs = `profile-${effectiveRegion}`;
    const basePath = `/profile/wow/character/${encodeURIComponent(realmSlug)}/${encodeURIComponent(charName)}`;

    // Fetch profile, equipment, stats and media in parallel
    const [profile, equipmentData, statsData, mediaData] = await Promise.all([
      apiGet(basePath, effectiveRegion, profileNs),
      apiGet(`${basePath}/equipment`, effectiveRegion, profileNs).catch((err) => {
        console.error('[blizzard-api] Equipment fetch failed:', err.message);
        return null;
      }),
      apiGet(`${basePath}/statistics`, effectiveRegion, profileNs).catch((err) => {
        console.error('[blizzard-api] Stats fetch failed:', err.message);
        return null;
      }),
      apiGet(`${basePath}/character-media`, effectiveRegion, profileNs).catch((err) => {
        console.error('[blizzard-api] Media fetch failed:', err.message);
        return null;
      })
    ]);

    // --- Build equipment map ---
    const equipment = {};
    try {
      if (equipmentData && Array.isArray(equipmentData.equipped_items)) {
        for (const item of equipmentData.equipped_items) {
          try {
            const slotType = item.slot?.type || '';
            const mapped = SLOT_MAP[slotType];
            if (mapped) {
              equipment[mapped] = parseEquipmentItem(item);
            }
          } catch (_) { /* ignore individual slot errors */ }
        }
      }
    } catch (eqErr) {
      console.error('[blizzard-api] Error building equipment map:', eqErr);
    }

    // --- Fetch item icons in parallel ---
    try {
      var iconResults = await Promise.all(
        Object.keys(equipment).map(function (slot) {
          var item = equipment[slot];
          if (item && item.id) {
            return getItemIcon(item.id).then(function (url) {
              return { slot: slot, url: url };
            });
          }
          return Promise.resolve({ slot: slot, url: null });
        })
      );
      iconResults.forEach(function (entry) {
        if (entry.url && equipment[entry.slot]) {
          equipment[entry.slot].iconUrl = entry.url;
        }
      });
    } catch (iconErr) {
      console.error('[blizzard-api] Error fetching item icons:', iconErr);
    }

    // --- Build stats ---
    const stats = {
      strength: 0,
      agility: 0,
      intellect: 0,
      stamina: 0,
      crit: 0,
      haste: 0,
      mastery: 0,
      versatility: 0,
      versatilityDmg: 0
    };
    try {
      if (statsData) {
        stats.strength = statsData.strength?.effective || 0;
        stats.agility = statsData.agility?.effective || 0;
        stats.intellect = statsData.intellect?.effective || 0;
        stats.stamina = statsData.stamina?.effective || 0;
        stats.crit = statsData.melee_crit?.value ?? statsData.ranged_crit?.value ?? statsData.spell_crit?.value ?? 0;
        stats.haste = statsData.melee_haste?.value ?? statsData.ranged_haste?.value ?? statsData.spell_haste?.value ?? 0;
        stats.mastery = statsData.mastery?.value ?? 0;
        stats.versatility = statsData.versatility ?? 0;
        stats.versatilityDmg = statsData.versatility_damage_done_bonus?.value ?? 0;
      }
    } catch (stErr) {
      console.error('[blizzard-api] Error building stats:', stErr);
    }

    // --- Avatar URL ---
    let avatarUrl = null;
    try {
      if (mediaData && Array.isArray(mediaData.assets)) {
        const avatar = mediaData.assets.find((a) => a.key === 'avatar');
        avatarUrl = avatar ? avatar.value : (mediaData.assets[0]?.value || null);
      }
    } catch (mErr) {
      console.error('[blizzard-api] Error extracting avatar:', mErr);
    }

    return {
      name: profile.name || name,
      realm: profile.realm?.slug || realm,
      region: effectiveRegion,
      class: profile.character_class?.name || 'Unknown',
      spec: profile.active_spec?.name || 'Unknown',
      race: profile.race?.name || 'Unknown',
      level: profile.level || 0,
      ilvl: profile.equipped_item_level || profile.average_item_level || 0,
      equipment,
      stats,
      avatarUrl,
      blizzardData: {
        profile,
        equipment: equipmentData,
        statistics: statsData,
        media: mediaData
      }
    };
  } catch (err) {
    console.error('[blizzard-api] Error importing character:', err);
    throw err;
  }
}

// --------------- Connection test ---------------

/**
 * Test the Blizzard API connection by requesting a token.
 * @returns {Promise<{ok: boolean, message: string}>}
 */
async function testConnection() {
  try {
    await getAccessToken();
    return { ok: true, message: 'Connessione riuscita!' };
  } catch (err) {
    console.error('[blizzard-api] testConnection failed:', err);
    return { ok: false, message: err.message || 'Connessione fallita' };
  }
}

// --------------- Exports ---------------

module.exports = {
  getAccessToken,
  apiGet,
  importCharacter,
  testConnection
};
