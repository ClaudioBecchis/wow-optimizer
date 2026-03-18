// ============================================================================
// WoW Character Optimizer - Frontend Application
// ============================================================================

// --------------------------------------------------------------------------
// Constants
// --------------------------------------------------------------------------

var CLASS_COLORS = {
  warrior: '#C79C6E',
  paladin: '#F58CBA',
  hunter: '#ABD473',
  rogue: '#FFF569',
  priest: '#FFFFFF',
  deathknight: '#C41F3B',
  shaman: '#0070DE',
  mage: '#69CCF0',
  warlock: '#9482C9',
  monk: '#00FF96',
  druid: '#FF7D0A',
  demonhunter: '#A330C9',
  evoker: '#33937F',
};

var QUALITY_COLORS = {
  poor: '#9d9d9d',
  common: '#ffffff',
  uncommon: '#1eff00',
  rare: '#0070dd',
  epic: '#a335ee',
  legendary: '#ff8000',
  artifact: '#e6cc80',
  heirloom: '#00ccff',
};

var STAT_COLORS = {
  strength: '#ffd100',
  agility: '#ffd100',
  intellect: '#ffd100',
  crit: '#bf616a',
  critrating: '#bf616a',
  criticalstrike: '#bf616a',
  haste: '#ebcb8b',
  hasterating: '#ebcb8b',
  mastery: '#a335ee',
  masteryrating: '#a335ee',
  vers: '#1eff00',
  versatility: '#1eff00',
  versatilityrating: '#1eff00',
};

// SimC scale_factors output uses these capitalized short keys
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

// Map SimC keys to Pawn stat names
var SIMC_PAWN_MAP = {
  'Agi': 'Agility',
  'Str': 'Strength',
  'Int': 'Intellect',
  'Crit': 'CritRating',
  'Haste': 'HasteRating',
  'Mastery': 'MasteryRating',
  'Vers': 'Versatility',
  'AP': 'Ap',
};

var GEAR_SLOTS = [
  'head', 'neck', 'shoulder', 'back', 'chest', 'wrist',
  'hands', 'waist', 'legs', 'feet', 'finger1', 'finger2',
  'trinket1', 'trinket2', 'main_hand', 'off_hand',
];

var PLACEHOLDER_ICON =
  'https://wow.zamimg.com/images/wow/icons/medium/inv_misc_questionmark.jpg';

var REALMS = [
  'Aerie Peak', 'Antonidas', 'Archimonde', 'Area 52', 'Argent Dawn',
  'Blackhand', 'Blackmoore', 'Blackrock', 'Bladefist', 'Bronzebeard',
  'Burning Blade', 'Crushridge', 'Dalaran', 'Draenor', 'Elune',
  'Emerald Dream', 'Eredar', 'Frostmourne', 'Frostwolf', 'Hellfire',
  'Hellscream', 'Hyjal', 'Kazzak', 'Kilrogg', 'Magtheridon', 'Nemesis',
  'Outland', 'Pozzo dell\'Eternita', 'Ragnaros', 'Ravencrest', 'Runetotem',
  'Sargeras', 'Silvermoon', 'Stormscale', 'Tarren Mill', 'Thrall',
  'Turalyon', 'Twisting Nether', 'Wildhammer', 'Ysera', 'Ysondre',
];

// --------------------------------------------------------------------------
// State
// --------------------------------------------------------------------------

var currentChar = null;
var currentPage = 'characters';
var pollTimers = [];
var activeSimJobId = null;

// --------------------------------------------------------------------------
// Server Management
// --------------------------------------------------------------------------

function getServers() {
  try {
    var raw = localStorage.getItem('wow-servers');
    if (raw) {
      var parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.length > 0) return parsed;
    }
  } catch (e) {
    console.error('getServers: failed to parse localStorage', e);
  }
  return [{ name: 'WoW Optimizer', url: window.location.origin }];
}

function saveServers(servers) {
  try {
    localStorage.setItem('wow-servers', JSON.stringify(servers));
  } catch (e) {
    console.error('saveServers: failed', e);
  }
}

function getServerIdx() {
  try {
    var idx = parseInt(localStorage.getItem('wow-server-idx'), 10);
    var servers = getServers();
    if (!isNaN(idx) && idx >= 0 && idx < servers.length) return idx;
  } catch (e) {
    console.error('getServerIdx: failed', e);
  }
  return 0;
}

function setServerIdx(idx) {
  try {
    localStorage.setItem('wow-server-idx', String(idx));
  } catch (e) {
    console.error('setServerIdx: failed', e);
  }
}

function getApiBase() {
  try {
    var servers = getServers();
    var idx = getServerIdx();
    var server = servers[idx] || servers[0];
    var base = (server.url || window.location.origin).replace(/\/+$/, '');
    return base + '/api';
  } catch (e) {
    console.error('getApiBase: failed, using default', e);
    return window.location.origin + '/api';
  }
}

function switchServer(idx) {
  try {
    var servers = getServers();
    if (idx < 0 || idx >= servers.length) {
      console.warn('switchServer: invalid index', idx);
      return;
    }
    setServerIdx(idx);
    currentChar = null;
    renderServerList();
    loadCharacters();
  } catch (e) {
    console.error('switchServer: failed', e);
  }
}

function addServer() {
  try {
    var nameInput = document.getElementById('newServerName');
    var urlInput = document.getElementById('newServerUrl');
    if (!nameInput || !urlInput) return;

    var name = nameInput.value.trim();
    var url = urlInput.value.trim();
    if (!name || !url) {
      showToast('Server name and URL are required.', 'error');
      return;
    }

    var servers = getServers();
    servers.push({ name: name, url: url });
    saveServers(servers);

    nameInput.value = '';
    urlInput.value = '';
    renderServerList();
    showToast('Server added.', 'success');
  } catch (e) {
    console.error('addServer: failed', e);
    showToast('Failed to add server.', 'error');
  }
}

function removeServer(idx) {
  try {
    var servers = getServers();
    if (servers.length <= 1) {
      showToast('Cannot remove the last server.', 'error');
      return;
    }
    if (idx < 0 || idx >= servers.length) return;

    servers.splice(idx, 1);
    saveServers(servers);

    var currentIdx = getServerIdx();
    if (currentIdx >= servers.length) {
      setServerIdx(servers.length - 1);
    } else if (idx < currentIdx) {
      setServerIdx(currentIdx - 1);
    } else if (idx === currentIdx) {
      setServerIdx(0);
    }

    renderServerList();
    loadCharacters();
    showToast('Server removed.', 'success');
  } catch (e) {
    console.error('removeServer: failed', e);
    showToast('Failed to remove server.', 'error');
  }
}

function renderServerList() {
  try {
    var container = document.getElementById('serverList');
    if (!container) return;

    var servers = getServers();
    var activeIdx = getServerIdx();

    var html = '';
    servers.forEach(function (srv, i) {
      var active = i === activeIdx ? ' active' : '';
      html += '<div class="server-item' + active + '">'
        + '<span class="server-info" onclick="switchServer(' + i + ')">'
        + '<strong>' + escapeHtml(srv.name) + '</strong>'
        + ' <small>(' + escapeHtml(srv.url) + ')</small>'
        + '</span>';
      if (servers.length > 1) {
        html += ' <button class="btn btn-sm btn-danger" onclick="removeServer(' + i + ')">X</button>';
      }
      html += '</div>';
    });

    container.innerHTML = html;
  } catch (e) {
    console.error('renderServerList: failed', e);
  }
}

async function testServer() {
  try {
    showToast('Testing server connection...', 'info');
    var result = await apiFetch('/config', 'GET');
    if (result.error) {
      showToast('Server test failed: ' + result.error, 'error');
    } else {
      showToast('Server connection OK!', 'success');
    }
  } catch (e) {
    console.error('testServer: failed', e);
    showToast('Server test failed.', 'error');
  }
}

// --------------------------------------------------------------------------
// API Helper
// --------------------------------------------------------------------------

async function apiFetch(endpoint, method, body) {
  try {
    var url = getApiBase() + endpoint;
    var opts = {
      method: method || 'GET',
      headers: { 'Content-Type': 'application/json' },
    };
    if (body && method !== 'GET') {
      opts.body = JSON.stringify(body);
    }

    var res = await fetch(url, opts);
    var text = await res.text();

    var data;
    try {
      data = JSON.parse(text);
    } catch (_) {
      data = { raw: text };
    }

    if (!res.ok) {
      return {
        error: data.error || data.message || ('HTTP ' + res.status),
        status: res.status,
        data: data,
      };
    }

    return data;
  } catch (e) {
    console.error('apiFetch: network error for ' + endpoint, e);
    return { error: e.message || 'Network error', networkError: true };
  }
}

function fmt(n) {
  try {
    if (n === null || n === undefined) return '-';
    return Number(n).toLocaleString('it-IT', {
      minimumFractionDigits: 0,
      maximumFractionDigits: 2,
    });
  } catch (e) {
    console.error('fmt: failed', e);
    return String(n);
  }
}

// --------------------------------------------------------------------------
// Utility
// --------------------------------------------------------------------------

function escapeHtml(str) {
  try {
    if (!str) return '';
    var div = document.createElement('div');
    div.appendChild(document.createTextNode(str));
    return div.innerHTML;
  } catch (e) {
    console.error('escapeHtml: failed', e);
    return '';
  }
}

function showToast(message, type) {
  try {
    var container = document.getElementById('toast-container');
    if (!container) {
      container = document.createElement('div');
      container.id = 'toast-container';
      container.style.cssText =
        'position:fixed;top:20px;right:20px;z-index:10000;display:flex;flex-direction:column;gap:8px;';
      document.body.appendChild(container);
    }

    var toast = document.createElement('div');
    toast.className = 'toast toast-' + (type || 'info');
    toast.style.cssText =
      'padding:12px 20px;border-radius:6px;color:#fff;font-size:14px;'
      + 'box-shadow:0 4px 12px rgba(0,0,0,0.3);cursor:pointer;max-width:400px;'
      + 'animation:fadeIn 0.3s ease;';

    var bgMap = { success: '#2ecc71', error: '#e74c3c', info: '#3498db', warning: '#f39c12' };
    toast.style.backgroundColor = bgMap[type] || bgMap.info;
    toast.textContent = message;

    toast.onclick = function () {
      try { container.removeChild(toast); } catch (_) { /* ignore */ }
    };

    container.appendChild(toast);
    setTimeout(function () {
      try { container.removeChild(toast); } catch (_) { /* ignore */ }
    }, 4000);
  } catch (e) {
    console.error('showToast: failed', e);
  }
}

function getClassColor(className) {
  try {
    if (!className) return '#ffffff';
    var key = String(className).toLowerCase().replace(/[\s_-]/g, '');
    return CLASS_COLORS[key] || '#ffffff';
  } catch (e) {
    console.error('getClassColor: failed', e);
    return '#ffffff';
  }
}

function getQualityColor(quality) {
  try {
    if (!quality) return QUALITY_COLORS.common;
    return QUALITY_COLORS[String(quality).toLowerCase()] || QUALITY_COLORS.common;
  } catch (e) {
    return '#ffffff';
  }
}

function clearPollTimers() {
  try {
    pollTimers.forEach(function (t) { clearInterval(t); });
    pollTimers = [];
  } catch (e) {
    console.error('clearPollTimers: failed', e);
  }
}

async function cancelSim(jobId) {
  try {
    var id = jobId || activeSimJobId;
    if (!id) {
      showToast('No simulation to cancel.', 'warning');
      return;
    }

    var result = await apiFetch('/simulate/cancel/' + encodeURIComponent(id), 'DELETE');

    if (result.error && !result.ok) {
      showToast('Failed to cancel: ' + (result.error || result.message), 'error');
      return;
    }

    clearPollTimers();
    activeSimJobId = null;

    var statusEl = document.getElementById('sim-status');
    if (statusEl) {
      statusEl.innerHTML =
        '<div style="padding:12px;background:#2c2c1a;border-radius:6px;color:#f39c12;">'
        + 'Simulazione annullata</div>';
    }

    showToast('Simulazione annullata.', 'info');
    loadSimHistory();
  } catch (e) {
    console.error('cancelSim: failed', e);
    showToast('Error cancelling simulation.', 'error');
  }
}

async function cancelAllSims() {
  try {
    var result = await apiFetch('/simulate/cancel-all', 'DELETE');

    if (result.error && !result.ok) {
      showToast('Failed to cancel: ' + (result.error || result.message), 'error');
      return;
    }

    clearPollTimers();
    activeSimJobId = null;

    var statusEl = document.getElementById('sim-status');
    if (statusEl) {
      statusEl.innerHTML =
        '<div style="padding:12px;background:#2c2c1a;border-radius:6px;color:#f39c12;">'
        + 'Simulazione annullata</div>';
    }

    var cancelled = result.cancelled || 0;
    showToast('Annullate ' + cancelled + ' simulazioni.', 'info');
    loadSimHistory();
  } catch (e) {
    console.error('cancelAllSims: failed', e);
    showToast('Error cancelling simulations.', 'error');
  }
}

function slotLabel(slot) {
  try {
    var labels = {
      head: 'Head', neck: 'Neck', shoulder: 'Shoulder', back: 'Back',
      chest: 'Chest', wrist: 'Wrist', hands: 'Hands', waist: 'Waist',
      legs: 'Legs', feet: 'Feet', finger1: 'Ring 1', finger2: 'Ring 2',
      trinket1: 'Trinket 1', trinket2: 'Trinket 2',
      main_hand: 'Main Hand', off_hand: 'Off Hand',
    };
    return labels[slot] || slot;
  } catch (e) {
    return slot || '';
  }
}

// --------------------------------------------------------------------------
// Navigation
// --------------------------------------------------------------------------

function navigateTo(page) {
  try {
    currentPage = page;
    clearPollTimers();

    var pages = document.querySelectorAll('.page');
    for (var i = 0; i < pages.length; i++) {
      try {
        pages[i].style.display = 'none';
        pages[i].classList.remove('active');
      } catch (_) { /* ignore */ }
    }

    var target = document.getElementById('page-' + page);
    if (target) {
      target.style.display = 'block';
      target.classList.add('active');
    }

    var btns = document.querySelectorAll('.nav-btn');
    for (var j = 0; j < btns.length; j++) {
      try {
        btns[j].classList.remove('active');
        if (btns[j].dataset.page === page) {
          btns[j].classList.add('active');
        }
      } catch (_) { /* ignore */ }
    }

    // Load page data
    if (page === 'characters') loadCharacters();
    if (page === 'dashboard' && currentChar) renderDashboard();
    if (page === 'simulate' && currentChar) renderSimPage();
    if (page === 'bis' && currentChar) loadOptimizations();
    if (page === 'enchants' && currentChar) loadOptimizations();
    if (page === 'upgrades' && currentChar) loadOptimizations();
  } catch (e) {
    console.error('navigateTo: failed', e);
  }
}

function initNavigation() {
  try {
    var btns = document.querySelectorAll('.nav-btn');
    for (var i = 0; i < btns.length; i++) {
      (function (btn) {
        btn.addEventListener('click', function () {
          try {
            var page = btn.dataset.page;
            if (page) navigateTo(page);
          } catch (e) {
            console.error('nav-btn click: failed', e);
          }
        });
      })(btns[i]);
    }
  } catch (e) {
    console.error('initNavigation: failed', e);
  }
}

// --------------------------------------------------------------------------
// Settings Modal
// --------------------------------------------------------------------------

function showSettings() {
  try {
    var modal = document.getElementById('settings-modal');
    if (modal) {
      modal.style.display = 'flex';
      loadSettings();
      renderServerList();
    }
  } catch (e) {
    console.error('showSettings: failed', e);
  }
}

function hideSettings() {
  try {
    var modal = document.getElementById('settings-modal');
    if (modal) modal.style.display = 'none';
  } catch (e) {
    console.error('hideSettings: failed', e);
  }
}

async function loadSettings() {
  try {
    var result = await apiFetch('/config', 'GET');
    if (result.error) {
      console.warn('loadSettings: could not load config, skipping', result.error);
      return;
    }

    var simcPathInput = document.getElementById('settSimcPath');
    var threadsInput = document.getElementById('settSimcThreads');
    var iterationsInput = document.getElementById('settSimcIterations');
    var clientIdInput = document.getElementById('settBlizzClientId');
    var clientSecretInput = document.getElementById('settBlizzClientSecret');
    var regionSelect = document.getElementById('settBlizzRegion');

    if (simcPathInput) simcPathInput.value = result.simc_path || '';
    if (threadsInput) threadsInput.value = result.simc_threads || '';
    if (iterationsInput) iterationsInput.value = result.simc_iterations || '';
    if (clientIdInput) clientIdInput.value = result.blizzard_client_id || '';
    if (clientSecretInput) clientSecretInput.value = result.blizzard_client_secret || '';
    if (regionSelect) regionSelect.value = result.blizzard_region || 'eu';
  } catch (e) {
    console.error('loadSettings: failed', e);
  }
}

async function saveSettings() {
  try {
    var simcPath = '';
    var threads = '';
    var iterations = '';
    var clientId = '';
    var clientSecret = '';
    var region = '';

    var simcPathInput = document.getElementById('settSimcPath');
    var threadsInput = document.getElementById('settSimcThreads');
    var iterationsInput = document.getElementById('settSimcIterations');
    var clientIdInput = document.getElementById('settBlizzClientId');
    var clientSecretInput = document.getElementById('settBlizzClientSecret');
    var regionSelect = document.getElementById('settBlizzRegion');

    if (simcPathInput) simcPath = simcPathInput.value.trim();
    if (threadsInput) threads = threadsInput.value.trim();
    if (iterationsInput) iterations = iterationsInput.value.trim();
    if (clientIdInput) clientId = clientIdInput.value.trim();
    if (clientSecretInput) clientSecret = clientSecretInput.value.trim();
    if (regionSelect) region = regionSelect.value;

    var body = {
      simc_path: simcPath,
      simc_threads: threads ? parseInt(threads, 10) : undefined,
      simc_iterations: iterations ? parseInt(iterations, 10) : undefined,
      blizzard_client_id: clientId,
      blizzard_client_secret: clientSecret,
      blizzard_region: region,
    };

    var result = await apiFetch('/config', 'PATCH', body);
    if (result.error) {
      showToast('Failed to save settings: ' + result.error, 'error');
    } else {
      showToast('Settings saved.', 'success');
    }
  } catch (e) {
    console.error('saveSettings: failed', e);
    showToast('Failed to save settings.', 'error');
  }
}

async function testSimc() {
  try {
    showToast('Testing SimC installation...', 'info');
    var result = await apiFetch('/simulate/test-simc', 'POST');
    if (result.error) {
      showToast('SimC test failed: ' + result.error, 'error');
    } else {
      var version = result.version || result.simc_version || 'unknown';
      showToast('SimC is working! Version: ' + version, 'success');
    }
  } catch (e) {
    console.error('testSimc: failed', e);
    showToast('SimC test failed.', 'error');
  }
}

function testBlizzard() {
  try {
    showToast('Configure Blizzard API key first in settings, then test.', 'warning');
  } catch (e) {
    console.error('testBlizzard: failed', e);
  }
}

// --------------------------------------------------------------------------
// Characters
// --------------------------------------------------------------------------

async function loadCharacters() {
  try {
    var container = document.getElementById('characterList');
    if (!container) return;

    container.innerHTML = '<div class="loading">Loading characters...</div>';

    var result = await apiFetch('/characters', 'GET');

    if (result.error) {
      container.innerHTML = '<div class="error-msg">Failed to load characters: '
        + escapeHtml(result.error) + '</div>';
      return;
    }

    var chars = Array.isArray(result) ? result : (result.characters || []);

    if (chars.length === 0) {
      container.innerHTML =
        '<div class="empty-state">'
        + '<p>No characters found. Import one to get started!</p>'
        + '</div>';
      return;
    }

    var html = '<div class="character-grid">';
    chars.forEach(function (ch) {
      try {
        var color = getClassColor(ch.class || ch.className);
        var ilvl = ch.ilvl || ch.itemLevel || ch.item_level || '?';
        var name = ch.name || 'Unknown';
        var charClass = ch.class || ch.className || 'unknown';
        var spec = ch.spec || ch.specialization || '';
        var realm = ch.realm || '';

        html += '<div class="character-card" onclick="selectCharacter(\''
          + escapeHtml(String(ch.id || ch._id)) + '\')">'
          + '<div class="char-card-header" style="border-left:4px solid ' + color + '">'
          + '<span class="char-name" style="color:' + color + '">'
          + escapeHtml(name) + '</span>'
          + '<span class="char-ilvl">ilvl ' + escapeHtml(String(ilvl)) + '</span>'
          + '</div>'
          + '<div class="char-card-body">'
          + '<span class="char-spec">' + escapeHtml(spec) + ' ' + escapeHtml(charClass) + '</span>';

        if (realm) {
          html += '<span class="char-realm">' + escapeHtml(realm) + '</span>';
        }

        html += '</div>'
          + '<div class="char-card-actions">'
          + '<button class="btn btn-sm btn-danger" onclick="event.stopPropagation();deleteChar(\''
          + escapeHtml(String(ch.id || ch._id)) + '\')">Delete</button>'
          + '</div>'
          + '</div>';
      } catch (cardErr) {
        console.error('loadCharacters: failed to render card', cardErr);
      }
    });
    html += '</div>';

    container.innerHTML = html;
  } catch (e) {
    console.error('loadCharacters: failed', e);
    var c = document.getElementById('characterList');
    if (c) c.innerHTML = '<div class="error-msg">Error loading characters.</div>';
  }
}

function showSimcImport() {
  try {
    var modal = document.getElementById('import-modal');
    if (!modal) return;

    modal.style.display = 'flex';
    modal.innerHTML =
      '<div class="modal-content">'
      + '<div class="modal-header">'
      + '<h3>Import from SimC</h3>'
      + '<button class="btn-close" onclick="closeImportModal()">&times;</button>'
      + '</div>'
      + '<div class="modal-body">'
      + '<p>Paste your /simc output below:</p>'
      + '<textarea id="simcInput" rows="12" style="width:100%;font-family:monospace;'
      + 'background:#1a1a2e;color:#eee;border:1px solid #444;border-radius:4px;padding:8px;"'
      + ' placeholder="Paste /simc string here..."></textarea>'
      + '</div>'
      + '<div class="modal-footer">'
      + '<button class="btn btn-primary" onclick="doSimcImport()">Import</button>'
      + '<button class="btn btn-secondary" onclick="closeImportModal()">Cancel</button>'
      + '</div>'
      + '</div>';
  } catch (e) {
    console.error('showSimcImport: failed', e);
  }
}

function showArmoryImport() {
  try {
    var modal = document.getElementById('import-modal');
    if (!modal) return;

    var realmOptions = '';
    REALMS.forEach(function (r) {
      realmOptions += '<option value="' + escapeHtml(r) + '">' + escapeHtml(r) + '</option>';
    });

    modal.style.display = 'flex';
    modal.innerHTML =
      '<div class="modal-content">'
      + '<div class="modal-header">'
      + '<h3>Import from Armory</h3>'
      + '<button class="btn-close" onclick="closeImportModal()">&times;</button>'
      + '</div>'
      + '<div class="modal-body">'
      + '<div class="form-notice" style="background:#3a2a0a;border:1px solid #f39c12;'
      + 'padding:10px;border-radius:4px;margin-bottom:12px;color:#f39c12;">'
      + 'Requires Blizzard API key configured in Settings.'
      + '</div>'
      + '<div class="form-group">'
      + '<label>Character Name</label>'
      + '<input type="text" id="armoryName" placeholder="Character name" '
      + 'style="width:100%;padding:8px;background:#1a1a2e;color:#eee;border:1px solid #444;'
      + 'border-radius:4px;" />'
      + '</div>'
      + '<div class="form-group" style="margin-top:10px;">'
      + '<label>Realm</label>'
      + '<select id="armoryRealm" style="width:100%;padding:8px;background:#1a1a2e;'
      + 'color:#eee;border:1px solid #444;border-radius:4px;">'
      + '<option value="">-- Select Realm --</option>'
      + realmOptions
      + '</select>'
      + '</div>'
      + '<div class="form-group" style="margin-top:10px;">'
      + '<label>Region</label>'
      + '<select id="armoryRegion" style="width:100%;padding:8px;background:#1a1a2e;'
      + 'color:#eee;border:1px solid #444;border-radius:4px;">'
      + '<option value="eu">EU</option>'
      + '<option value="us">US</option>'
      + '<option value="kr">KR</option>'
      + '<option value="tw">TW</option>'
      + '</select>'
      + '</div>'
      + '</div>'
      + '<div class="modal-footer">'
      + '<button class="btn btn-primary" onclick="doArmoryImport()">Import</button>'
      + '<button class="btn btn-secondary" onclick="closeImportModal()">Cancel</button>'
      + '</div>'
      + '</div>';
  } catch (e) {
    console.error('showArmoryImport: failed', e);
  }
}

function closeImportModal() {
  try {
    var modal = document.getElementById('import-modal');
    if (modal) {
      modal.style.display = 'none';
      modal.innerHTML = '';
    }
  } catch (e) {
    console.error('closeImportModal: failed', e);
  }
}

async function doSimcImport() {
  try {
    var textarea = document.getElementById('simcInput');
    if (!textarea) return;

    var simcString = textarea.value.trim();
    if (!simcString) {
      showToast('Please paste a /simc string.', 'error');
      return;
    }

    showToast('Importing character...', 'info');

    var result = await apiFetch('/characters/import-simc', 'POST', { simcString: simcString });

    if (result.error) {
      showToast('Import failed: ' + result.error, 'error');
      return;
    }

    showToast('Character imported successfully!', 'success');
    closeImportModal();
    loadCharacters();
  } catch (e) {
    console.error('doSimcImport: failed', e);
    showToast('Import failed.', 'error');
  }
}

async function doArmoryImport() {
  try {
    var nameInput = document.getElementById('armoryName');
    var realmSelect = document.getElementById('armoryRealm');
    var regionSelect = document.getElementById('armoryRegion');

    if (!nameInput || !realmSelect || !regionSelect) return;

    var name = nameInput.value.trim();
    var realm = realmSelect.value;
    var region = regionSelect.value;

    if (!name || !realm) {
      showToast('Please enter character name and select a realm.', 'error');
      return;
    }

    showToast('Importing from Armory...', 'info');

    var result = await apiFetch('/characters/import-armory', 'POST', {
      name: name,
      realm: realm,
      region: region,
    });

    if (result.error) {
      if (result.error.indexOf('non configurata') !== -1 || result.error.indexOf('credentials') !== -1) {
        showToast('Blizzard API non configurata. Vai nelle Impostazioni.', 'error');
      } else {
        showToast('Errore import: ' + result.error, 'error');
      }
      return;
    }

    showToast('Character imported from Armory!', 'success');
    closeImportModal();
    loadCharacters();
  } catch (e) {
    console.error('doArmoryImport: failed', e);
    showToast('Armory import failed. Ensure Blizzard API key is configured.', 'error');
  }
}

async function selectCharacter(id) {
  try {
    showToast('Loading character...', 'info');

    var result = await apiFetch('/characters/' + encodeURIComponent(id), 'GET');

    if (result.error) {
      showToast('Failed to load character: ' + result.error, 'error');
      return;
    }

    currentChar = result;
    renderDashboard();
    navigateTo('dashboard');
  } catch (e) {
    console.error('selectCharacter: failed', e);
    showToast('Failed to load character.', 'error');
  }
}

async function deleteChar(id) {
  try {
    if (!confirm('Are you sure you want to delete this character?')) return;

    var result = await apiFetch('/characters/' + encodeURIComponent(id), 'DELETE');

    if (result.error) {
      showToast('Failed to delete character: ' + result.error, 'error');
      return;
    }

    if (currentChar && String(currentChar.id || currentChar._id) === String(id)) {
      currentChar = null;
    }

    showToast('Character deleted.', 'success');
    loadCharacters();
  } catch (e) {
    console.error('deleteChar: failed', e);
    showToast('Failed to delete character.', 'error');
  }
}

// --------------------------------------------------------------------------
// Dashboard
// --------------------------------------------------------------------------

function renderDashboard() {
  try {
    var container = document.getElementById('page-dashboard');
    if (!container) return;

    if (!currentChar) {
      container.innerHTML =
        '<div class="empty-state"><p>No character selected. Go to Characters and select one.</p></div>';
      return;
    }

    var ch = currentChar;
    var color = getClassColor(ch.class || ch.className);
    var name = ch.name || 'Unknown';
    var spec = ch.spec || ch.specialization || '';
    var charClass = ch.class || ch.className || '';
    var realm = ch.realm || '';
    var ilvl = ch.ilvl || ch.itemLevel || ch.item_level || '?';
    var race = ch.race || '';
    var level = ch.level || '?';

    // Stats
    var stats = ch.stats || {};
    var stamina = stats.stamina || stats.sta || 0;
    var intellect = stats.intellect || stats.int || 0;
    var strength = stats.strength || stats.str || 0;
    var agility = stats.agility || stats.agi || 0;
    var crit = stats.crit || stats.criticalStrike || 0;
    var haste = stats.haste || 0;
    var mastery = stats.mastery || 0;
    var vers = stats.versatility || stats.vers || 0;

    var html = '<div class="dashboard">';

    // Character header
    html += '<div class="dash-header" style="border-left:4px solid ' + color + ';'
      + 'padding:16px;background:#16213e;border-radius:6px;margin-bottom:16px;">'
      + '<h2 style="color:' + color + ';margin:0 0 4px 0;">' + escapeHtml(name) + '</h2>'
      + '<p style="margin:0;color:#aaa;">'
      + escapeHtml(race) + ' ' + escapeHtml(spec) + ' ' + escapeHtml(charClass)
      + ' &mdash; Level ' + escapeHtml(String(level))
      + ' &mdash; ilvl ' + escapeHtml(String(ilvl));
    if (realm) html += ' &mdash; ' + escapeHtml(realm);
    html += '</p></div>';

    // Stats panel
    html += '<div class="dash-stats" style="display:grid;grid-template-columns:repeat(auto-fill,'
      + 'minmax(180px,1fr));gap:10px;margin-bottom:16px;">';

    var statEntries = [
      { label: 'Stamina', value: stamina, color: '#e74c3c' },
      { label: 'Strength', value: strength, color: '#c0392b' },
      { label: 'Agility', value: agility, color: '#27ae60' },
      { label: 'Intellect', value: intellect, color: '#2980b9' },
      { label: 'Critical Strike', value: crit, color: STAT_COLORS.crit },
      { label: 'Haste', value: haste, color: STAT_COLORS.haste },
      { label: 'Mastery', value: mastery, color: STAT_COLORS.mastery },
      { label: 'Versatility', value: vers, color: STAT_COLORS.vers },
    ];

    statEntries.forEach(function (s) {
      try {
        html += '<div class="stat-card" style="background:#1a1a2e;padding:12px;'
          + 'border-radius:6px;border-left:3px solid ' + s.color + ';">'
          + '<div style="color:#888;font-size:12px;">' + s.label + '</div>'
          + '<div style="font-size:20px;font-weight:bold;color:#eee;">' + fmt(s.value) + '</div>'
          + '</div>';
      } catch (_) { /* ignore */ }
    });
    html += '</div>';

    // Gear
    html += '<h3 style="color:#eee;margin-top:20px;">Equipped Gear</h3>';
    html += '<div class="gear-grid" style="display:grid;grid-template-columns:repeat(auto-fill,'
      + 'minmax(300px,1fr));gap:8px;">';

    var gear = ch.gear || ch.equipment || ch.items || {};

    GEAR_SLOTS.forEach(function (slot) {
      try {
        var item = gear[slot] || null;
        var itemName = item ? (item.name || 'Unknown Item') : 'Empty';
        var itemIlvl = item ? (item.ilvl || item.itemLevel || item.item_level || '?') : '-';
        var quality = item ? (item.quality || 'common') : 'poor';
        var qColor = getQualityColor(quality);
        var icon = (item && item.iconUrl) ? item.iconUrl : ((item && item.icon) ? item.icon : PLACEHOLDER_ICON);
        var enchant = item ? (item.enchant || item.enchantment || '') : '';
        var gem = item ? (item.gem || '') : '';

        // Handle gem arrays
        if (Array.isArray(gem)) gem = gem.join(', ');
        if (Array.isArray(enchant)) enchant = enchant.join(', ');

        html += '<div class="gear-slot" style="display:flex;align-items:center;gap:10px;'
          + 'background:#1a1a2e;padding:10px;border-radius:6px;">'
          + '<img src="' + escapeHtml(icon) + '" alt="" style="width:36px;height:36px;'
          + 'border-radius:4px;border:2px solid ' + qColor + ';" '
          + 'onerror="this.src=\'' + PLACEHOLDER_ICON + '\';" />'
          + '<div style="flex:1;min-width:0;">'
          + '<div style="color:#888;font-size:11px;text-transform:uppercase;">'
          + escapeHtml(slotLabel(slot)) + '</div>'
          + '<div style="color:' + qColor + ';font-weight:bold;white-space:nowrap;'
          + 'overflow:hidden;text-overflow:ellipsis;">'
          + escapeHtml(itemName);

        if (item) html += ' <span style="color:#aaa;font-weight:normal;">(' + escapeHtml(String(itemIlvl)) + ')</span>';

        html += '</div>';

        // Badges
        if (enchant) {
          html += '<span style="display:inline-block;background:#2c3e50;color:#1abc9c;'
            + 'font-size:11px;padding:1px 6px;border-radius:3px;margin-top:2px;">'
            + 'Enchant: ' + escapeHtml(String(enchant)) + '</span> ';
        }
        if (gem) {
          html += '<span style="display:inline-block;background:#2c3e50;color:#e67e22;'
            + 'font-size:11px;padding:1px 6px;border-radius:3px;margin-top:2px;">'
            + 'Gem: ' + escapeHtml(String(gem)) + '</span>';
        }

        html += '</div></div>';
      } catch (slotErr) {
        console.error('renderDashboard: gear slot error', slot, slotErr);
      }
    });

    html += '</div></div>';

    container.innerHTML = html;
  } catch (e) {
    console.error('renderDashboard: failed', e);
    var c = document.getElementById('page-dashboard');
    if (c) c.innerHTML = '<div class="error-msg">Failed to render dashboard.</div>';
  }
}

// --------------------------------------------------------------------------
// Simulation
// --------------------------------------------------------------------------

function renderSimPage() {
  try {
    var container = document.getElementById('page-simulate');
    if (!container) return;

    if (!currentChar) {
      container.innerHTML =
        '<div class="empty-state"><p>No character selected.</p></div>';
      return;
    }

    var charId = currentChar.id || currentChar._id;
    var name = currentChar.name || 'Unknown';

    var html = '<div class="sim-page">'
      + '<h2 style="color:#eee;">Simulation &mdash; ' + escapeHtml(name) + '</h2>'
      + '<div class="sim-actions" style="display:flex;gap:10px;margin-bottom:20px;flex-wrap:wrap;">'
      + '<button class="btn btn-primary" onclick="runSim(\'dps\')">Run DPS Sim</button>'
      + '<button class="btn btn-secondary" onclick="runSim(\'stat-weights\')">Calculate Stat Weights</button>'
      + '<button class="btn btn-danger" onclick="cancelAllSims()">Annulla Tutto</button>'
      + '</div>'
      + '<div id="sim-status" style="margin-bottom:16px;"></div>'
      + '<div id="sim-result"></div>'
      + '<h3 style="color:#eee;margin-top:24px;">Simulation History</h3>'
      + '<div id="sim-history"><div class="loading">Loading history...</div></div>'
      + '</div>';

    container.innerHTML = html;
    loadSimHistory();
  } catch (e) {
    console.error('renderSimPage: failed', e);
  }
}

async function runSim(type) {
  try {
    if (!currentChar) {
      showToast('No character selected.', 'error');
      return;
    }

    var charId = currentChar.id || currentChar._id;
    var statusEl = document.getElementById('sim-status');
    var resultEl = document.getElementById('sim-result');

    if (statusEl) {
      statusEl.innerHTML =
        '<div style="padding:12px;background:#1a1a2e;border-radius:6px;color:#3498db;">'
        + 'Starting simulation... <span class="spinner"></span>'
        + '</div>';
    }
    if (resultEl) resultEl.innerHTML = '';

    var endpoint;
    if (type === 'stat-weights') {
      endpoint = '/simulate/' + encodeURIComponent(charId) + '/stat-weights';
    } else {
      endpoint = '/simulate/' + encodeURIComponent(charId);
    }

    var result = await apiFetch(endpoint, 'POST');

    if (result.error) {
      if (statusEl) {
        statusEl.innerHTML =
          '<div style="padding:12px;background:#2c1a1a;border-radius:6px;color:#e74c3c;">'
          + 'Simulation failed: ' + escapeHtml(result.error) + '</div>';
      }
      return;
    }

    var jobId = result.jobId || result.job_id || result.id;

    if (jobId) {
      activeSimJobId = jobId;
      if (statusEl) {
        statusEl.innerHTML =
          '<div style="padding:12px;background:#1a1a2e;border-radius:6px;color:#f39c12;display:flex;align-items:center;gap:12px;">'
          + '<span>Simulation running (Job: ' + escapeHtml(String(jobId)) + ')... <span class="spinner"></span></span>'
          + '<button class="btn btn-sm btn-danger" onclick="cancelSim(\'' + escapeHtml(String(jobId)) + '\')" '
          + 'style="margin-left:auto;">Annulla</button>'
          + '</div>';
      }
      pollSimStatus(jobId, type);
    } else {
      // Immediate result (no queuing)
      if (statusEl) {
        statusEl.innerHTML =
          '<div style="padding:12px;background:#1a2e1a;border-radius:6px;color:#2ecc71;">'
          + 'Simulation complete!</div>';
      }
      renderSimResult(result, type);
      loadSimHistory();
    }
  } catch (e) {
    console.error('runSim: failed', e);
    showToast('Simulation failed.', 'error');
    var s = document.getElementById('sim-status');
    if (s) s.innerHTML = '<div style="color:#e74c3c;">Simulation error.</div>';
  }
}

function pollSimStatus(jobId, type) {
  try {
    var timer = setInterval(async function () {
      try {
        var result = await apiFetch(
          '/simulate/status/' + encodeURIComponent(jobId), 'GET'
        );

        var statusEl = document.getElementById('sim-status');
        var status = result.status || result.state || '';

        if (result.error && !status) {
          clearInterval(timer);
          if (statusEl) {
            statusEl.innerHTML =
              '<div style="padding:12px;background:#2c1a1a;border-radius:6px;color:#e74c3c;">'
              + 'Poll error: ' + escapeHtml(result.error) + '</div>';
          }
          return;
        }

        if (status === 'complete' || status === 'done' || status === 'completed' || status === 'finished') {
          clearInterval(timer);
          activeSimJobId = null;
          if (statusEl) {
            statusEl.innerHTML =
              '<div style="padding:12px;background:#1a2e1a;border-radius:6px;color:#2ecc71;">'
              + 'Simulation complete!</div>';
          }
          renderSimResult(result.result || result, type);
          loadSimHistory();
        } else if (status === 'cancelled') {
          clearInterval(timer);
          activeSimJobId = null;
          if (statusEl) {
            statusEl.innerHTML =
              '<div style="padding:12px;background:#2c2c1a;border-radius:6px;color:#f39c12;">'
              + 'Simulazione annullata</div>';
          }
          loadSimHistory();
        } else if (status === 'failed' || status === 'error') {
          clearInterval(timer);
          activeSimJobId = null;
          if (statusEl) {
            statusEl.innerHTML =
              '<div style="padding:12px;background:#2c1a1a;border-radius:6px;color:#e74c3c;">'
              + 'Simulation failed: ' + escapeHtml(result.error || result.error_message || result.message || 'Unknown error')
              + '</div>';
          }
        } else {
          // Still running
          var progress = result.progress || '';
          if (statusEl) {
            statusEl.innerHTML =
              '<div style="padding:12px;background:#1a1a2e;border-radius:6px;color:#f39c12;display:flex;align-items:center;gap:12px;">'
              + '<span>Simulation running... '
              + (progress ? '(' + escapeHtml(String(progress)) + '%) ' : '')
              + '<span class="spinner"></span></span>'
              + '<button class="btn btn-sm btn-danger" onclick="cancelSim(\'' + escapeHtml(String(jobId)) + '\')" '
              + 'style="margin-left:auto;">Annulla</button>'
              + '</div>';
          }
        }
      } catch (pollErr) {
        console.error('pollSimStatus: poll tick error', pollErr);
      }
    }, 2000);

    pollTimers.push(timer);
  } catch (e) {
    console.error('pollSimStatus: failed to start', e);
  }
}

function generatePawnString(weights, charName) {
  try {
    if (!weights || typeof weights !== 'object') return '';

    var name = charName || (currentChar ? (currentChar.name || 'SimC') : 'SimC');

    // Map old-format stat keys to Pawn stat names
    var pawnMap = {
      strength: 'Strength',
      agility: 'Agility',
      intellect: 'Intellect',
      crit_rating: 'CritRating',
      critrating: 'CritRating',
      crit: 'CritRating',
      haste_rating: 'HasteRating',
      hasterating: 'HasteRating',
      haste: 'HasteRating',
      mastery_rating: 'MasteryRating',
      masteryrating: 'MasteryRating',
      mastery: 'MasteryRating',
      versatility_rating: 'Versatility',
      versatilityrating: 'Versatility',
      versatility: 'Versatility',
      vers: 'Versatility',
    };

    var parts = [];
    Object.keys(weights).forEach(function (key) {
      try {
        var val = parseFloat(weights[key]);
        if (isNaN(val) || val <= 0) return;

        // Check SimC format first (Agi, Crit, Haste, etc.)
        if (SIMC_PAWN_MAP[key]) {
          parts.push(SIMC_PAWN_MAP[key] + '=' + val.toFixed(2));
          return;
        }

        // Fall back to old format
        var lk = key.toLowerCase().replace(/[\s-]/g, '_');
        var pawnName = pawnMap[lk] || pawnMap[lk.replace(/_/g, '')] || null;
        if (pawnName) {
          parts.push(pawnName + '=' + val.toFixed(2));
        }
      } catch (_) { /* ignore */ }
    });

    if (parts.length === 0) return '';

    return '( Pawn: v1: "' + name + '": ' + parts.join(', ') + ' )';
  } catch (e) {
    console.error('generatePawnString: failed', e);
    return '';
  }
}

function renderSimResult(result, type) {
  try {
    var container = document.getElementById('sim-result');
    if (!container) return;

    var html = '<div class="sim-result" style="background:#16213e;padding:16px;'
      + 'border-radius:6px;margin-top:12px;">';

    if (type === 'stat-weights') {
      // Stat weights
      html += '<h3 style="color:#eee;margin-top:0;">Stat Weights</h3>';

      // Try stat_weights_json first (the raw SimC scale_factors saved by simc-runner),
      // then fall back to the other possible keys
      var weights = result.stat_weights_json
        || result.statWeights || result.stat_weights || result.weights || {};

      // If weights is a string (e.g. from DB JSON serialization), parse it
      if (typeof weights === 'string') {
        try { weights = JSON.parse(weights); } catch (_) { weights = {}; }
      }

      var dps = result.dps || result.baseDps || result.base_dps || null;

      if (dps) {
        html += '<p style="color:#aaa;">Base DPS: <strong style="color:#eee;">'
          + fmt(dps) + '</strong></p>';
      }

      html += renderStatBars(weights);

      // Pawn import string
      var pawnStr = generatePawnString(weights);
      if (pawnStr) {
        html += '<div class="panel" style="margin-top:16px;background:#1a1a2e;padding:12px;border-radius:6px;">'
          + '<div class="panel-title" style="color:#ffd100;font-weight:bold;margin-bottom:8px;">Pawn Import String</div>'
          + '<input type="text" readonly value="' + escapeHtml(pawnStr) + '" onclick="this.select()" '
          + 'style="width:100%;font-family:monospace;font-size:11px;background:#0a0a1a;color:#ccc;'
          + 'border:1px solid #444;border-radius:4px;padding:6px;box-sizing:border-box;" />'
          + '<button onclick="navigator.clipboard.writeText(this.previousElementSibling.value)" '
          + 'style="margin-top:6px;padding:4px 12px;background:#ffd100;color:#000;border:none;'
          + 'border-radius:4px;cursor:pointer;font-weight:bold;">Copia</button>'
          + '</div>';
      }
    } else {
      // DPS result
      var dpsVal = result.dps || result.mean || result.averageDps || 0;
      var minDps = result.min || result.minDps || null;
      var maxDps = result.max || result.maxDps || null;
      var error = result.error_pct || result.errorPct || result.error_percent || null;
      var duration = result.duration || result.fightLength || null;

      html += '<h3 style="color:#eee;margin-top:0;">DPS Result</h3>';
      html += '<div style="font-size:36px;font-weight:bold;color:#e74c3c;margin:10px 0;">'
        + fmt(dpsVal) + ' <span style="font-size:16px;color:#aaa;">DPS</span></div>';

      if (minDps !== null && maxDps !== null) {
        html += '<p style="color:#aaa;">Range: ' + fmt(minDps) + ' &mdash; ' + fmt(maxDps) + '</p>';
      }
      if (error !== null) {
        html += '<p style="color:#aaa;">Error: ' + fmt(error) + '%</p>';
      }
      if (duration !== null) {
        html += '<p style="color:#aaa;">Fight Duration: ' + fmt(duration) + 's</p>';
      }
    }

    html += '</div>';
    container.innerHTML = html;
  } catch (e) {
    console.error('renderSimResult: failed', e);
    var c = document.getElementById('sim-result');
    if (c) c.innerHTML = '<div class="error-msg">Failed to render simulation result.</div>';
  }
}

function renderStatBars(weights) {
  try {
    if (!weights || typeof weights !== 'object') return '<p style="color:#888;">No stat weight data.</p>';

    // If weights is a string (e.g. from DB JSON serialization), parse it
    if (typeof weights === 'string') {
      try { weights = JSON.parse(weights); } catch (_) { return '<p style="color:#888;">No stat weight data.</p>'; }
    }

    var entries = [];
    var maxVal = 0;

    // Old-format display names (lowercase/snake_case keys)
    var displayNames = {
      strength: 'Strength',
      agility: 'Agility',
      intellect: 'Intellect',
      crit_rating: 'Critical Strike',
      critrating: 'Critical Strike',
      crit: 'Critical Strike',
      haste_rating: 'Haste',
      hasterating: 'Haste',
      haste: 'Haste',
      mastery_rating: 'Mastery',
      masteryrating: 'Mastery',
      mastery: 'Mastery',
      versatility_rating: 'Versatility',
      versatilityrating: 'Versatility',
      versatility: 'Versatility',
      vers: 'Versatility',
    };

    Object.keys(weights).forEach(function (key) {
      try {
        var val = parseFloat(weights[key]) || 0;

        // Filter out zero and negative values
        if (val <= 0) return;

        // Check SimC format first (Agi, Crit, Haste, Mastery, Vers, etc.)
        var simcInfo = SIMC_STAT_MAP[key];
        if (simcInfo) {
          if (val > maxVal) maxVal = val;
          entries.push({ stat: key, label: simcInfo.name, value: val, color: simcInfo.color });
          return;
        }

        // Skip unknown SimC keys like Wdps, WOHdps
        if (key === 'Wdps' || key === 'WOHdps') return;

        // Fall back to old format
        if (val > maxVal) maxVal = val;
        var normalizedKey = key.toLowerCase().replace(/[\s-]/g, '_');
        var displayKey = normalizedKey.replace(/_/g, '');
        var label = displayNames[normalizedKey] || displayNames[displayKey] || key;
        var color = STAT_COLORS[displayKey] || '#3498db';
        entries.push({ stat: key, label: label, value: val, color: color });
      } catch (_) { /* ignore */ }
    });

    entries.sort(function (a, b) { return b.value - a.value; });

    if (entries.length === 0) return '<p style="color:#888;">No stat weight data.</p>';
    if (maxVal === 0) maxVal = 1;

    var html = '<div class="stat-bars" style="display:flex;flex-direction:column;gap:10px;">';

    entries.forEach(function (entry) {
      try {
        var pct = ((entry.value / maxVal) * 100).toFixed(1);

        html += '<div class="stat-bar-row">'
          + '<div style="display:flex;justify-content:space-between;margin-bottom:3px;">'
          + '<span style="color:#ccc;font-size:13px;font-weight:600;">'
          + escapeHtml(entry.label) + '</span>'
          + '<span style="color:#eee;font-weight:bold;font-size:13px;">'
          + entry.value.toFixed(2) + '</span>'
          + '</div>'
          + '<div style="background:#0a0a1a;border-radius:4px;height:22px;overflow:hidden;position:relative;">'
          + '<div style="background:' + entry.color + ';width:' + pct + '%;height:100%;'
          + 'border-radius:4px;transition:width 0.4s ease;box-shadow:0 0 6px ' + entry.color + '44;"></div>'
          + '</div></div>';
      } catch (_) { /* ignore */ }
    });

    html += '</div>';
    return html;
  } catch (e) {
    console.error('renderStatBars: failed', e);
    return '<p style="color:#888;">Error rendering stat bars.</p>';
  }
}

function drawDpsChart(canvasId, history) {
  try {
    var canvas = document.getElementById(canvasId);
    if (!canvas) return;

    var ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Filter entries with valid DPS and sort by date ascending
    var dataPoints = [];
    history.forEach(function (entry) {
      try {
        var dps = parseFloat(entry.dps || entry.result_dps || 0);
        var date = entry.date || entry.createdAt || entry.created_at || '';
        if (dps > 0 && date) {
          dataPoints.push({ dps: dps, date: new Date(date) });
        }
      } catch (_) { /* ignore */ }
    });

    dataPoints.sort(function (a, b) { return a.date.getTime() - b.date.getTime(); });

    if (dataPoints.length < 2) return;

    var W = canvas.width;
    var H = canvas.height;
    var padL = 70;
    var padR = 20;
    var padT = 20;
    var padB = 40;
    var chartW = W - padL - padR;
    var chartH = H - padT - padB;

    // Clear canvas
    ctx.clearRect(0, 0, W, H);

    // Background
    ctx.fillStyle = '#0a0a1a';
    ctx.fillRect(0, 0, W, H);

    // Compute min/max DPS with padding
    var minDps = dataPoints[0].dps;
    var maxDps = dataPoints[0].dps;
    dataPoints.forEach(function (dp) {
      if (dp.dps < minDps) minDps = dp.dps;
      if (dp.dps > maxDps) maxDps = dp.dps;
    });
    var dpsPadding = (maxDps - minDps) * 0.1 || 100;
    minDps = Math.max(0, minDps - dpsPadding);
    maxDps = maxDps + dpsPadding;
    var dpsRange = maxDps - minDps || 1;

    // Grid lines
    ctx.strokeStyle = '#222';
    ctx.lineWidth = 1;
    ctx.font = '11px monospace';
    ctx.fillStyle = '#666';
    ctx.textAlign = 'right';

    var gridSteps = 5;
    for (var i = 0; i <= gridSteps; i++) {
      var yVal = minDps + (dpsRange * i / gridSteps);
      var yPos = padT + chartH - (chartH * i / gridSteps);
      ctx.beginPath();
      ctx.moveTo(padL, yPos);
      ctx.lineTo(padL + chartW, yPos);
      ctx.stroke();
      ctx.fillText(Math.round(yVal).toLocaleString(), padL - 8, yPos + 4);
    }

    // Date labels
    ctx.textAlign = 'center';
    ctx.fillStyle = '#666';
    var labelCount = Math.min(dataPoints.length, 6);
    var labelStep = Math.max(1, Math.floor((dataPoints.length - 1) / (labelCount - 1)));
    for (var li = 0; li < dataPoints.length; li += labelStep) {
      var xPos = padL + (chartW * li / (dataPoints.length - 1));
      var d = dataPoints[li].date;
      var lbl = (d.getMonth() + 1) + '/' + d.getDate();
      ctx.fillText(lbl, xPos, H - 8);
    }

    // Draw line
    ctx.strokeStyle = '#ffd100';
    ctx.lineWidth = 2.5;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.beginPath();

    dataPoints.forEach(function (dp, idx) {
      var x = padL + (chartW * idx / (dataPoints.length - 1));
      var y = padT + chartH - (chartH * (dp.dps - minDps) / dpsRange);
      if (idx === 0) {
        ctx.moveTo(x, y);
      } else {
        ctx.lineTo(x, y);
      }
    });
    ctx.stroke();

    // Glow effect
    ctx.strokeStyle = '#ffd10044';
    ctx.lineWidth = 6;
    ctx.beginPath();
    dataPoints.forEach(function (dp, idx) {
      var x = padL + (chartW * idx / (dataPoints.length - 1));
      var y = padT + chartH - (chartH * (dp.dps - minDps) / dpsRange);
      if (idx === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.stroke();

    // Data points (dots)
    dataPoints.forEach(function (dp, idx) {
      var x = padL + (chartW * idx / (dataPoints.length - 1));
      var y = padT + chartH - (chartH * (dp.dps - minDps) / dpsRange);

      ctx.beginPath();
      ctx.arc(x, y, 4, 0, Math.PI * 2);
      ctx.fillStyle = '#ffd100';
      ctx.fill();
      ctx.strokeStyle = '#0a0a1a';
      ctx.lineWidth = 2;
      ctx.stroke();
    });

    // Title
    ctx.fillStyle = '#888';
    ctx.font = '12px sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText('DPS', padL, padT - 6);
  } catch (e) {
    console.error('drawDpsChart: failed', e);
  }
}

async function loadSimHistory() {
  try {
    var container = document.getElementById('sim-history');
    if (!container) return;
    if (!currentChar) {
      container.innerHTML = '<p style="color:#888;">No character selected.</p>';
      return;
    }

    var charId = currentChar.id || currentChar._id;
    var result = await apiFetch('/simulate/history/' + encodeURIComponent(charId), 'GET');

    if (result.error) {
      container.innerHTML = '<p style="color:#888;">Could not load history.</p>';
      return;
    }

    var history = Array.isArray(result) ? result : (result.history || []);

    if (history.length === 0) {
      container.innerHTML = '<p style="color:#888;">No simulation history yet.</p>';
      return;
    }

    var html = '';

    // DPS history chart (only if we have multiple entries with DPS data)
    var dpsEntries = history.filter(function (e) {
      return parseFloat(e.dps || e.result_dps || 0) > 0;
    });

    if (dpsEntries.length >= 2) {
      html += '<div style="background:#0a0a1a;border-radius:6px;padding:12px;margin-bottom:16px;">'
        + '<h4 style="color:#ffd100;margin:0 0 8px 0;">DPS History</h4>'
        + '<canvas id="dps-history-chart" width="700" height="260" '
        + 'style="width:100%;max-width:700px;height:auto;border-radius:4px;"></canvas>'
        + '</div>';
    }

    html += '<table style="width:100%;border-collapse:collapse;color:#ccc;">'
      + '<thead><tr style="border-bottom:1px solid #333;">'
      + '<th style="text-align:left;padding:8px;">Date</th>'
      + '<th style="text-align:left;padding:8px;">Type</th>'
      + '<th style="text-align:right;padding:8px;">DPS</th>'
      + '<th style="text-align:right;padding:8px;">Status</th>'
      + '<th style="text-align:right;padding:8px;">Actions</th>'
      + '</tr></thead><tbody>';

    history.forEach(function (entry) {
      try {
        var date = entry.date || entry.createdAt || entry.created_at || '';
        if (date) {
          try { date = new Date(date).toLocaleString(); } catch (_) { /* use as-is */ }
        }
        var simType = entry.type || entry.simType || 'dps';
        var dps = entry.dps || entry.result_dps || '-';
        var status = entry.status || 'done';
        var entryId = entry.id || entry._id || '';

        var statusColor = '#f39c12';
        if (status === 'done' || status === 'completed' || status === 'complete') {
          statusColor = '#2ecc71';
        } else if (status === 'error' || status === 'failed') {
          statusColor = '#e74c3c';
        } else if (status === 'cancelled') {
          statusColor = '#888';
        }

        html += '<tr style="border-bottom:1px solid #222;">'
          + '<td style="padding:8px;">' + escapeHtml(String(date)) + '</td>'
          + '<td style="padding:8px;text-transform:capitalize;">' + escapeHtml(simType) + '</td>'
          + '<td style="padding:8px;text-align:right;font-weight:bold;">'
          + (dps !== '-' ? fmt(dps) : '-') + '</td>'
          + '<td style="padding:8px;text-align:right;">'
          + '<span style="color:' + statusColor + ';">'
          + escapeHtml(status) + '</span></td>'
          + '<td style="padding:8px;text-align:right;">';

        if (status === 'queued' || status === 'running') {
          html += '<button class="btn btn-sm btn-danger" onclick="cancelSim(\''
            + escapeHtml(String(entryId)) + '\')">Annulla</button>';
        }

        html += '</td></tr>';
      } catch (_) { /* ignore */ }
    });

    html += '</tbody></table>';
    container.innerHTML = html;

    // Draw chart after DOM update
    if (dpsEntries.length >= 2) {
      setTimeout(function () {
        drawDpsChart('dps-history-chart', history);
      }, 50);
    }
  } catch (e) {
    console.error('loadSimHistory: failed', e);
    var c = document.getElementById('sim-history');
    if (c) c.innerHTML = '<p style="color:#888;">Error loading history.</p>';
  }
}

// --------------------------------------------------------------------------
// Optimizations
// --------------------------------------------------------------------------

async function loadOptimizations() {
  try {
    var container = document.getElementById('page-' + currentPage);
    if (!container) return;

    if (!currentChar) {
      container.innerHTML =
        '<div class="empty-state"><p>No character selected.</p></div>';
      return;
    }

    var charId = currentChar.id || currentChar._id;
    var name = currentChar.name || 'Unknown';

    container.innerHTML =
      '<div class="opt-page">'
      + '<h2 style="color:#eee;">Optimization &mdash; ' + escapeHtml(name) + '</h2>'
      + '<div class="loading">Loading optimization data...</div>'
      + '</div>';

    // First, check if stat weights are available
    var statWeightsData = await apiFetch('/optimize/' + encodeURIComponent(charId) + '/stat-weights', 'GET');

    // Determine if we have valid stat weights
    var hasStatWeights = false;
    var weights = null;

    if (!statWeightsData.error) {
      weights = statWeightsData.stat_weights_json || statWeightsData.statWeights
        || statWeightsData.stat_weights || statWeightsData.weights || null;

      // Parse if string
      if (typeof weights === 'string') {
        try { weights = JSON.parse(weights); } catch (_) { weights = null; }
      }

      if (weights && typeof weights === 'object' && Object.keys(weights).length > 0) {
        // Check that at least one value is > 0
        hasStatWeights = Object.keys(weights).some(function (k) {
          return parseFloat(weights[k]) > 0;
        });
      }
    }

    var noWeightsMsg = '<div style="padding:16px;background:#2c2c1a;border:1px solid #f39c12;'
      + 'border-radius:6px;color:#f39c12;text-align:center;">'
      + '<p style="margin:0 0 8px 0;font-weight:bold;">Esegui prima Stat Weights</p>'
      + '<p style="margin:0;color:#ccc;font-size:13px;">Go to the Simulate page and run '
      + '"Calculate Stat Weights" first to enable optimization recommendations.</p>'
      + '</div>';

    // If we have stat weights, fetch other optimization data in parallel
    var bisData = { error: 'no_stat_weights' };
    var enchantsData = { error: 'no_stat_weights' };
    var gemsData = { error: 'no_stat_weights' };
    var upgradesData = { error: 'no_stat_weights' };

    if (hasStatWeights) {
      try {
        var optResults = await Promise.all([
          apiFetch('/optimize/' + encodeURIComponent(charId) + '/bis', 'GET'),
          apiFetch('/optimize/' + encodeURIComponent(charId) + '/enchants', 'GET'),
          apiFetch('/optimize/' + encodeURIComponent(charId) + '/gems', 'GET'),
          apiFetch('/optimize/' + encodeURIComponent(charId) + '/upgrades', 'GET'),
        ]);
        bisData = optResults[0];
        enchantsData = optResults[1];
        gemsData = optResults[2];
        upgradesData = optResults[3];
      } catch (optErr) {
        console.error('loadOptimizations: error fetching optimization data', optErr);
      }
    }

    var html = '<div class="opt-page">'
      + '<h2 style="color:#eee;">Optimization &mdash; ' + escapeHtml(name) + '</h2>';

    // ---- Stat Weights ----
    html += '<div class="opt-section" style="background:#16213e;padding:16px;'
      + 'border-radius:6px;margin-bottom:16px;">'
      + '<h3 style="color:#eee;margin-top:0;">Stat Weights</h3>';

    if (statWeightsData.error) {
      html += '<p style="color:#888;">Could not load stat weights: '
        + escapeHtml(String(statWeightsData.error)) + '</p>';
    } else if (!hasStatWeights) {
      html += noWeightsMsg;
    } else {
      html += renderStatBars(weights);

      // Also show Pawn string on the optimization page
      var pawnStr = generatePawnString(weights);
      if (pawnStr) {
        html += '<div class="panel" style="margin-top:16px;background:#1a1a2e;padding:12px;border-radius:6px;">'
          + '<div class="panel-title" style="color:#ffd100;font-weight:bold;margin-bottom:8px;">Pawn Import String</div>'
          + '<input type="text" readonly value="' + escapeHtml(pawnStr) + '" onclick="this.select()" '
          + 'style="width:100%;font-family:monospace;font-size:11px;background:#0a0a1a;color:#ccc;'
          + 'border:1px solid #444;border-radius:4px;padding:6px;box-sizing:border-box;" />'
          + '<button onclick="navigator.clipboard.writeText(this.previousElementSibling.value)" '
          + 'style="margin-top:6px;padding:4px 12px;background:#ffd100;color:#000;border:none;'
          + 'border-radius:4px;cursor:pointer;font-weight:bold;">Copia</button>'
          + '</div>';
      }
    }
    html += '</div>';

    // ---- BiS List ----
    html += '<div class="opt-section" style="background:#16213e;padding:16px;'
      + 'border-radius:6px;margin-bottom:16px;">'
      + '<h3 style="color:#eee;margin-top:0;">Best in Slot</h3>';

    if (!hasStatWeights) {
      html += noWeightsMsg;
    } else if (bisData.error) {
      html += '<p style="color:#888;">Could not load BiS list: '
        + escapeHtml(String(bisData.error)) + '</p>';
    } else if (bisData.raw) {
      // API returned non-JSON (likely HTML error page) — handle gracefully
      html += '<p style="color:#888;">Could not load BiS list. Server returned unexpected response.</p>';
    } else {
      html += renderBisList(bisData);
    }
    html += '</div>';

    // ---- Enchants ----
    html += '<div class="opt-section" style="background:#16213e;padding:16px;'
      + 'border-radius:6px;margin-bottom:16px;">'
      + '<h3 style="color:#eee;margin-top:0;">Recommended Enchants</h3>';

    if (!hasStatWeights) {
      html += noWeightsMsg;
    } else if (enchantsData.error) {
      html += '<p style="color:#888;">Could not load enchant recommendations: '
        + escapeHtml(String(enchantsData.error)) + '</p>';
    } else if (enchantsData.raw) {
      html += '<p style="color:#888;">Could not load enchant recommendations. Server returned unexpected response.</p>';
    } else {
      html += renderEnchantRecs(enchantsData);
    }
    html += '</div>';

    // ---- Gems ----
    html += '<div class="opt-section" style="background:#16213e;padding:16px;'
      + 'border-radius:6px;margin-bottom:16px;">'
      + '<h3 style="color:#eee;margin-top:0;">Recommended Gems</h3>';

    if (!hasStatWeights) {
      html += noWeightsMsg;
    } else if (gemsData.error) {
      html += '<p style="color:#888;">Could not load gem recommendations: '
        + escapeHtml(String(gemsData.error)) + '</p>';
    } else if (gemsData.raw) {
      html += '<p style="color:#888;">Could not load gem recommendations. Server returned unexpected response.</p>';
    } else {
      html += renderGemRecs(gemsData);
    }
    html += '</div>';

    // ---- Upgrades ----
    html += '<div class="opt-section" style="background:#16213e;padding:16px;'
      + 'border-radius:6px;margin-bottom:16px;">'
      + '<h3 style="color:#eee;margin-top:0;">Upgrade Priority</h3>';

    if (!hasStatWeights) {
      html += noWeightsMsg;
    } else if (upgradesData.error) {
      html += '<p style="color:#888;">Could not load upgrade data: '
        + escapeHtml(String(upgradesData.error)) + '</p>';
    } else if (upgradesData.raw) {
      html += '<p style="color:#888;">Could not load upgrade data. Server returned unexpected response.</p>';
    } else {
      html += renderUpgradeTable(upgradesData);
    }
    html += '</div>';

    html += '</div>';
    container.innerHTML = html;
  } catch (e) {
    console.error('loadOptimizations: failed', e);
    var c = document.getElementById('page-' + currentPage);
    if (c) {
      c.innerHTML = '<div class="error-msg">Failed to load optimization data.</div>';
    }
  }
}

function renderBisList(data) {
  try {
    var items = data.bis || data.items || data.slots || data;

    if (!items || typeof items !== 'object') {
      return '<p style="color:#888;">No BiS data available.</p>';
    }

    // If it's an object keyed by slot
    if (!Array.isArray(items)) {
      var html = '<div class="bis-grid" style="display:grid;grid-template-columns:'
        + 'repeat(auto-fill,minmax(280px,1fr));gap:8px;">';

      GEAR_SLOTS.forEach(function (slot) {
        try {
          var item = items[slot];
          if (!item) return;

          var itemName = typeof item === 'string' ? item : (item.name || 'Unknown');
          var quality = item.quality || 'epic';
          var qColor = getQualityColor(quality);
          var source = item.source || '';
          var ilvl = item.ilvl || item.itemLevel || '';

          html += '<div style="background:#1a1a2e;padding:10px;border-radius:4px;">'
            + '<div style="color:#888;font-size:11px;text-transform:uppercase;">'
            + escapeHtml(slotLabel(slot)) + '</div>'
            + '<div style="color:' + qColor + ';font-weight:bold;">'
            + escapeHtml(String(itemName));
          if (ilvl) html += ' <span style="color:#aaa;font-weight:normal;">(' + escapeHtml(String(ilvl)) + ')</span>';
          html += '</div>';
          if (source) html += '<div style="color:#888;font-size:12px;">' + escapeHtml(source) + '</div>';
          html += '</div>';
        } catch (_) { /* ignore */ }
      });

      html += '</div>';
      return html;
    }

    // Array format
    var html = '<div class="bis-grid" style="display:grid;grid-template-columns:'
      + 'repeat(auto-fill,minmax(280px,1fr));gap:8px;">';

    items.forEach(function (item) {
      try {
        var quality = item.quality || 'epic';
        var qColor = getQualityColor(quality);
        html += '<div style="background:#1a1a2e;padding:10px;border-radius:4px;">'
          + '<div style="color:#888;font-size:11px;text-transform:uppercase;">'
          + escapeHtml(slotLabel(item.slot || '')) + '</div>'
          + '<div style="color:' + qColor + ';font-weight:bold;">'
          + escapeHtml(item.name || 'Unknown') + '</div>'
          + '</div>';
      } catch (_) { /* ignore */ }
    });

    html += '</div>';
    return html;
  } catch (e) {
    console.error('renderBisList: failed', e);
    return '<p style="color:#888;">Error rendering BiS list.</p>';
  }
}

function renderEnchantRecs(data) {
  try {
    var enchants = data.enchants || data.recommendations || data;

    if (!enchants || typeof enchants !== 'object') {
      return '<p style="color:#888;">No enchant recommendations.</p>';
    }

    var entries = Array.isArray(enchants) ? enchants : [];
    if (!Array.isArray(enchants)) {
      Object.keys(enchants).forEach(function (slot) {
        try {
          var val = enchants[slot];
          if (typeof val === 'string') {
            entries.push({ slot: slot, name: val });
          } else if (val && typeof val === 'object') {
            entries.push(Object.assign({ slot: slot }, val));
          }
        } catch (_) { /* ignore */ }
      });
    }

    if (entries.length === 0) {
      return '<p style="color:#888;">No enchant recommendations available.</p>';
    }

    var html = '<table style="width:100%;border-collapse:collapse;color:#ccc;">'
      + '<thead><tr style="border-bottom:1px solid #333;">'
      + '<th style="text-align:left;padding:8px;">Slot</th>'
      + '<th style="text-align:left;padding:8px;">Enchant</th>'
      + '<th style="text-align:right;padding:8px;">DPS Gain</th>'
      + '</tr></thead><tbody>';

    entries.forEach(function (e) {
      try {
        html += '<tr style="border-bottom:1px solid #222;">'
          + '<td style="padding:8px;text-transform:capitalize;">'
          + escapeHtml(slotLabel(e.slot || '')) + '</td>'
          + '<td style="padding:8px;color:#1abc9c;">' + escapeHtml(e.name || e.enchant || '-') + '</td>'
          + '<td style="padding:8px;text-align:right;">'
          + (e.dpsGain || e.dps_gain ? '+' + fmt(e.dpsGain || e.dps_gain) : '-') + '</td>'
          + '</tr>';
      } catch (_) { /* ignore */ }
    });

    html += '</tbody></table>';
    return html;
  } catch (e) {
    console.error('renderEnchantRecs: failed', e);
    return '<p style="color:#888;">Error rendering enchant recommendations.</p>';
  }
}

function renderGemRecs(data) {
  try {
    var gems = data.gems || data.recommendations || data;

    if (!gems || typeof gems !== 'object') {
      return '<p style="color:#888;">No gem recommendations.</p>';
    }

    var entries = Array.isArray(gems) ? gems : [];
    if (!Array.isArray(gems)) {
      Object.keys(gems).forEach(function (slot) {
        try {
          var val = gems[slot];
          if (typeof val === 'string') {
            entries.push({ slot: slot, name: val });
          } else if (val && typeof val === 'object') {
            entries.push(Object.assign({ slot: slot }, val));
          }
        } catch (_) { /* ignore */ }
      });
    }

    if (entries.length === 0) {
      return '<p style="color:#888;">No gem recommendations available.</p>';
    }

    var html = '<table style="width:100%;border-collapse:collapse;color:#ccc;">'
      + '<thead><tr style="border-bottom:1px solid #333;">'
      + '<th style="text-align:left;padding:8px;">Slot</th>'
      + '<th style="text-align:left;padding:8px;">Gem</th>'
      + '<th style="text-align:right;padding:8px;">DPS Gain</th>'
      + '</tr></thead><tbody>';

    entries.forEach(function (g) {
      try {
        html += '<tr style="border-bottom:1px solid #222;">'
          + '<td style="padding:8px;text-transform:capitalize;">'
          + escapeHtml(slotLabel(g.slot || '')) + '</td>'
          + '<td style="padding:8px;color:#e67e22;">' + escapeHtml(g.name || g.gem || '-') + '</td>'
          + '<td style="padding:8px;text-align:right;">'
          + (g.dpsGain || g.dps_gain ? '+' + fmt(g.dpsGain || g.dps_gain) : '-') + '</td>'
          + '</tr>';
      } catch (_) { /* ignore */ }
    });

    html += '</tbody></table>';
    return html;
  } catch (e) {
    console.error('renderGemRecs: failed', e);
    return '<p style="color:#888;">Error rendering gem recommendations.</p>';
  }
}

function renderUpgradeTable(data) {
  try {
    var upgrades = data.upgrades || data.items || data;

    if (!upgrades || (!Array.isArray(upgrades) && typeof upgrades !== 'object')) {
      return '<p style="color:#888;">No upgrade data available.</p>';
    }

    var entries = Array.isArray(upgrades) ? upgrades : [];
    if (!Array.isArray(upgrades)) {
      Object.keys(upgrades).forEach(function (slot) {
        try {
          var val = upgrades[slot];
          if (val && typeof val === 'object') {
            entries.push(Object.assign({ slot: slot }, val));
          }
        } catch (_) { /* ignore */ }
      });
    }

    if (entries.length === 0) {
      return '<p style="color:#888;">No upgrade data available.</p>';
    }

    // Sort by DPS gain descending
    entries.sort(function (a, b) {
      try {
        return (parseFloat(b.dpsGain || b.dps_gain) || 0)
          - (parseFloat(a.dpsGain || a.dps_gain) || 0);
      } catch (_) { return 0; }
    });

    var html = '<table style="width:100%;border-collapse:collapse;color:#ccc;">'
      + '<thead><tr style="border-bottom:1px solid #333;">'
      + '<th style="text-align:left;padding:8px;">Slot</th>'
      + '<th style="text-align:left;padding:8px;">Current</th>'
      + '<th style="text-align:left;padding:8px;">Upgrade</th>'
      + '<th style="text-align:right;padding:8px;">ilvl</th>'
      + '<th style="text-align:right;padding:8px;">DPS Gain</th>'
      + '<th style="text-align:left;padding:8px;">Source</th>'
      + '</tr></thead><tbody>';

    entries.forEach(function (u) {
      try {
        var quality = u.quality || 'epic';
        var qColor = getQualityColor(quality);
        var gain = u.dpsGain || u.dps_gain || 0;

        html += '<tr style="border-bottom:1px solid #222;">'
          + '<td style="padding:8px;text-transform:capitalize;">'
          + escapeHtml(slotLabel(u.slot || '')) + '</td>'
          + '<td style="padding:8px;color:#888;">'
          + escapeHtml(u.currentItem || u.current_item || u.current || '-') + '</td>'
          + '<td style="padding:8px;color:' + qColor + ';font-weight:bold;">'
          + escapeHtml(u.name || u.item || u.upgrade || '-') + '</td>'
          + '<td style="padding:8px;text-align:right;">'
          + escapeHtml(String(u.ilvl || u.itemLevel || '-')) + '</td>'
          + '<td style="padding:8px;text-align:right;color:#2ecc71;font-weight:bold;">'
          + (gain ? '+' + fmt(gain) : '-') + '</td>'
          + '<td style="padding:8px;color:#888;">'
          + escapeHtml(u.source || u.dropLocation || '-') + '</td>'
          + '</tr>';
      } catch (_) { /* ignore */ }
    });

    html += '</tbody></table>';
    return html;
  } catch (e) {
    console.error('renderUpgradeTable: failed', e);
    return '<p style="color:#888;">Error rendering upgrade table.</p>';
  }
}

// --------------------------------------------------------------------------
// Initialization
// --------------------------------------------------------------------------

function init() {
  try {
    initNavigation();
    navigateTo('characters');

    // Settings button
    var settingsBtn = document.getElementById('btnOpenSettings');
    if (settingsBtn) {
      settingsBtn.addEventListener('click', function () {
        try { showSettings(); } catch (e) { console.error('settings btn click error', e); }
      });
    }

    // Close modal on backdrop click
    var settingsModal = document.getElementById('settings-modal');
    if (settingsModal) {
      settingsModal.addEventListener('click', function (e) {
        try {
          if (e.target === settingsModal) hideSettings();
        } catch (_) { /* ignore */ }
      });
    }

    var importModal = document.getElementById('import-modal');
    if (importModal) {
      importModal.addEventListener('click', function (e) {
        try {
          if (e.target === importModal) closeImportModal();
        } catch (_) { /* ignore */ }
      });
    }

    console.log('WoW Optimizer app initialized.');
  } catch (e) {
    console.error('init: failed', e);
  }
}

// --------------------------------------------------------------------------
// Boot
// --------------------------------------------------------------------------

try {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
} catch (e) {
  console.error('Init error:', e);
}
