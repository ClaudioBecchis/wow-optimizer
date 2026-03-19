const express = require('express');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const app = express();

app.use(express.json({ limit: '5mb' }));
app.use(express.static(path.join(__dirname, 'public')));

const SIMC = '/opt/simc/build/simc';
const REPORTS = '/reports';
const TMP = '/tmp/topgear';
try { fs.mkdirSync(TMP, { recursive: true }); } catch(e) {}

const https = require('https');
var blizzToken = null;
var blizzTokenExpiry = 0;

function getBlizzToken() {
  return new Promise(function(ok) {
    if (blizzToken && Date.now() < blizzTokenExpiry) return ok(blizzToken);
    var r = https.request({ hostname: 'oauth.battle.net', path: '/token', method: 'POST',
      headers: { Authorization: 'Basic ' + Buffer.from((process.env.BLIZZARD_CLIENT_ID || '') + ':' + (process.env.BLIZZARD_CLIENT_SECRET || '')).toString('base64'), 'Content-Type': 'application/x-www-form-urlencoded' }
    }, function(s) { var d = ''; s.on('data', function(c) { d += c; }); s.on('end', function() { try { var j = JSON.parse(d); blizzToken = j.access_token; blizzTokenExpiry = Date.now() + (j.expires_in - 60) * 1000; ok(blizzToken); } catch(e) { ok(null); } }); });
    r.write('grant_type=client_credentials'); r.end();
  });
}

function checkItemBlizzard(itemId) {
  return new Promise(function(ok) {
    getBlizzToken().then(function(token) {
      if (!token) return ok(null);
      var r = https.request({ hostname: 'eu.api.blizzard.com', path: '/data/wow/item/' + itemId + '?namespace=static-eu', method: 'GET',
        headers: { Authorization: 'Bearer ' + token }
      }, function(s) { var d = ''; s.on('data', function(c) { d += c; }); s.on('end', function() { try { ok(JSON.parse(d)); } catch(e) { ok(null); } }); });
      r.end();
    });
  });
}

// Item cache to avoid repeated API calls
var itemCache = {};

async function isItemValid(itemId) {
  if (!itemId || itemId === '0') return true;
  if (itemCache[itemId] !== undefined) return itemCache[itemId];
  try {
    var item = await checkItemBlizzard(itemId);
    if (!item || !item.level) { itemCache[itemId] = true; return true; }
    var valid = true;
    // Block Artifact quality items (old legendaries/artifacts)
    var qualityEN = item.quality && item.quality.en_US ? item.quality.en_US : '';
    if (qualityEN === 'Artifact') { valid = false; console.log('[topgear] Blizzard API blocked Artifact: ' + (item.name?.en_US || itemId)); }
    // Block items with Blizzard ilvl below 400
    if (item.level < 400) { valid = false; console.log('[topgear] Blizzard API blocked low ilvl: ' + (item.name?.en_US || itemId) + ' ilvl=' + item.level); }
    // Block items requiring level below 78 (pre-TWW)
    if (item.required_level && item.required_level < 78) { valid = false; console.log('[topgear] Blizzard API blocked low req level: ' + (item.name?.en_US || itemId) + ' req=' + item.required_level); }
    itemCache[itemId] = valid;
    return valid;
  } catch(e) { return true; }
}

const jobs = {};
let jobCounter = 0;

// Slot names recognized by SimC
const SLOTS = ['head','neck','shoulder','back','chest','wrist','hands','waist','legs','feet','finger1','finger2','trinket1','trinket2','main_hand','off_hand'];

/**
 * Parse a /simc string and extract:
 * - baseProfile: the character profile (everything before bag items)
 * - bagItems: array of {slot, gear, name} from commented bag items
 */
function parseSimcBags(simcText, returnAll) {
  var lines = simcText.split('\n');
  var profileLines = [];
  var bagItems = [];
  var inBags = false;

  for (var i = 0; i < lines.length; i++) {
    var line = lines[i].trim();

    // SimC addon marks bag items with ### or # Bag or # bags
    // Format: ### gear_slot=,id=XXXXX,bonus_id=1/2/3,ilevel=639
    // Or: # head=,id=228411,...
    if (line.match(/^#{1,3}\s*(head|neck|shoulder|back|chest|wrist|hands|waist|legs|feet|finger1|finger2|trinket1|trinket2|main_hand|off_hand)=/)) {
      inBags = true;
      var gearLine = line.replace(/^#{1,3}\s*/, '');
      var slotMatch = gearLine.match(/^(\w+)=/);
      if (slotMatch) {
        var slot = slotMatch[1];
        // Extract item name from ,name= if present
        var nameMatch = gearLine.match(/,name=([^,]+)/);
        var itemName = nameMatch ? nameMatch[1].replace(/_/g, ' ') : null;
        // If no name=, try to get a readable name from the line
        if (!itemName) {
          var idMatch2 = gearLine.match(/,id=(\d+)/);
          itemName = idMatch2 ? 'Item #' + idMatch2[1] : slot + ' alt ' + (bagItems.length + 1);
        }
        var idMatch = gearLine.match(/,id=(\d+)/);
        var itemId = idMatch ? idMatch[1] : '0';
        var ilvlMatch = gearLine.match(/,ilevel=(\d+)/);
        var ilvl = ilvlMatch ? ilvlMatch[1] : '';
        bagItems.push({ slot: slot, gear: gearLine, name: itemName, itemId: itemId, ilvl: ilvl });
      }
      continue;
    }

    // Also catch lines like: # Bag item: head=,...
    if (line.match(/^#.*bag.*item/i)) {
      continue; // skip comment header
    }

    // Skip empty comments in bag section
    if (inBags && line.match(/^#\s*$/)) continue;

    // If not a bag item line, add to profile
    if (!inBags || !line.startsWith('#')) {
      profileLines.push(lines[i]); // keep original indentation
    }
  }

  // Obsolete item IDs that should never be suggested
  var OBSOLETE_ITEMS = [
    '158075', // Heart of Azeroth (BfA)
    '169223', // Ashjra'kamas (8.3 cloak)
    '190455', // Unity (SL legendary belt)
    '190456', '190457', '190458', '190459', '190460', // SL legendary slots
    '235499', // Fasciature Reshii (old)
  ];

  // Block ALL items with ID below 210000 (pre-TWW items)
  // Midnight items start around 228000+
  var MIN_ITEM_ID = 210000;

  // Extract equipped item ilvls to calculate minimum threshold
  var equippedIlvls = {};
  profileLines.forEach(function(line) {
    var l = line.trim();
    var slotMatch = l.match(/^(head|neck|shoulder|back|chest|wrist|hands|waist|legs|feet|finger1|finger2|trinket1|trinket2|main_hand|off_hand)=/);
    if (slotMatch) {
      var ilvlMatch = l.match(/,ilevel=(\d+)/);
      if (ilvlMatch) equippedIlvls[slotMatch[1]] = parseInt(ilvlMatch[1]);
    }
  });

  // Calculate minimum ilvl: at least 500 (Midnight minimum), and no lower than lowest equipped - 10
  var ilvlValues = Object.values(equippedIlvls);
  var avgIlvl = ilvlValues.length > 0 ? ilvlValues.reduce(function(a,b){return a+b},0) / ilvlValues.length : 0;
  var lowestEquipped = ilvlValues.length > 0 ? Math.min.apply(null, ilvlValues) : 0;
  var minIlvl = Math.max(500, lowestEquipped - 10, Math.floor(avgIlvl * 0.92));

  // Filter bag items
  var filteredBags = bagItems.filter(function(item) {
    // Block obsolete items by ID
    if (OBSOLETE_ITEMS.indexOf(item.itemId) !== -1) {
      console.log('[topgear] Blocked obsolete item: ' + item.name + ' (id=' + item.itemId + ')');
      return false;
    }
    // Block items with very old item IDs (pre-TWW)
    var numId = parseInt(item.itemId);
    if (numId > 0 && numId < MIN_ITEM_ID) {
      console.log('[topgear] Blocked old expansion item: ' + item.name + ' (id=' + item.itemId + ')');
      return false;
    }
    // Filter by ilvl
    if (!item.ilvl) return true;
    var itemIlvl = parseInt(item.ilvl);
    var equippedSlotIlvl = equippedIlvls[item.slot] || avgIlvl;
    if (itemIlvl < equippedSlotIlvl - 15 || itemIlvl < minIlvl) {
      console.log('[topgear] Filtered low ilvl: ' + item.name + ' (' + item.ilvl + ' vs slot ' + equippedSlotIlvl + ', min ' + minIlvl + ')');
      return false;
    }
    return true;
  });

  if (returnAll) {
    return { allBagItems: bagItems };
  }

  return {
    baseProfile: profileLines.join('\n'),
    bagItems: filteredBags,
    skippedLowIlvl: bagItems.length - filteredBags.length,
    avgIlvl: Math.round(avgIlvl),
    minIlvl: minIlvl
  };
}

function parseResults(jobId, jsonFile, htmlFile, inputFile, duration, itemMap) {
  try {
    var raw = fs.readFileSync(jsonFile, 'utf-8');
    var data = JSON.parse(raw);
    var baseline = data.sim.players[0];
    var baselineDps = baseline.collected_data.dps.mean;

    var results = [];
    results.push({ name: 'Equipaggiato (Attuale)', dps: Math.round(baselineDps), delta: 0, pct: '0.00', isBest: false, slot: '', itemId: '0', ilvl: '' });

    if (data.sim.profilesets && data.sim.profilesets.results) {
      data.sim.profilesets.results.forEach(function(ps) {
        var delta = Math.round(ps.mean - baselineDps);
        var info = (itemMap && itemMap[ps.name]) || {};
        results.push({
          name: info.name || ps.name,
          dps: Math.round(ps.mean),
          delta: delta,
          pct: ((ps.mean - baselineDps) / baselineDps * 100).toFixed(2),
          isBest: false,
          slot: info.slot || '',
          itemId: info.itemId || '0',
          ilvl: info.ilvl || ''
        });
      });
    }

    results.sort(function(a, b) { return b.dps - a.dps; });
    if (results.length > 0) results[0].isBest = true;

    var pawn = null;
    if (baseline.scale_factors) {
      var sf = baseline.scale_factors;
      var pawnMap = {Str:'Strength',Agi:'Agility',Int:'Intellect',Crit:'CritRating',Haste:'HasteRating',Mastery:'MasteryRating',Vers:'Versatility',AP:'Ap',Wdps:'Dps'};
      var charName = baseline.name || 'SimC';
      var parts = [];
      Object.keys(sf).forEach(function(k) { if (pawnMap[k] && sf[k] !== 0) parts.push(' ' + pawnMap[k] + '=' + sf[k].toFixed(2)); });
      pawn = '( Pawn: v1: "' + charName + '":' + parts.join(',') + ' )';
    }

    jobs[jobId].status = 'done';
    jobs[jobId].progress = 100;
    jobs[jobId].dps = Math.round(baselineDps);
    jobs[jobId].results = results;
    jobs[jobId].pawn = pawn;
    jobs[jobId].duration = duration;
    jobs[jobId].htmlReport = '/reports/' + path.basename(htmlFile);
  } catch(e) {
    jobs[jobId].status = 'error';
    jobs[jobId].error = 'Parse error: ' + e.message;
  }
  try { fs.unlinkSync(inputFile); } catch(e) {}
  try { fs.unlinkSync(jsonFile); } catch(e) {}
}

// POST /api/simulate
app.post('/api/simulate', async function(req, res) {
  try {
    var simcText = req.body.simcProfile;
    if (!simcText) return res.status(400).json({ error: 'Missing simcProfile' });

    // Parse profile and bag items
    var parsed = parseSimcBags(simcText);
    var bagItems = parsed.bagItems;

    // Verify each bag item via Blizzard API - track discarded items
    var validatedBags = [];
    var discardedItems = [];
    for (var bi = 0; bi < bagItems.length; bi++) {
      var valid = await isItemValid(bagItems[bi].itemId);
      if (valid) {
        validatedBags.push(bagItems[bi]);
      } else {
        discardedItems.push({
          name: bagItems[bi].name,
          slot: bagItems[bi].slot,
          itemId: bagItems[bi].itemId,
          ilvl: bagItems[bi].ilvl,
          reason: 'Oggetto obsoleto (espansione vecchia)'
        });
      }
    }
    // Also track ilvl-filtered items from parseSimcBags
    var allOriginalBags = parseSimcBags(simcText, true);
    if (allOriginalBags && allOriginalBags.allBagItems) {
      allOriginalBags.allBagItems.forEach(function(item) {
        var inFiltered = validatedBags.some(function(v) { return v.itemId === item.itemId && v.slot === item.slot; });
        var inDiscarded = discardedItems.some(function(d) { return d.itemId === item.itemId && d.slot === item.slot; });
        if (!inFiltered && !inDiscarded) {
          discardedItems.push({
            name: item.name,
            slot: item.slot,
            itemId: item.itemId,
            ilvl: item.ilvl,
            reason: 'ilvl troppo basso'
          });
        }
      });
    }
    bagItems = validatedBags;

    // Also accept manually added alternatives
    if (req.body.alternatives && req.body.alternatives.length > 0) {
      req.body.alternatives.forEach(function(alt) {
        if (alt.gear && alt.gear.trim()) {
          bagItems.push({ slot: '', gear: alt.gear.trim(), name: alt.name || 'Manual ' + bagItems.length });
        }
      });
    }

    var jobId = ++jobCounter;
    var inputFile = path.join(TMP, 'job_' + jobId + '.simc');
    var jsonFile = path.join(TMP, 'job_' + jobId + '.json');
    var htmlFile = path.join(REPORTS, 'topgear_' + jobId + '_' + Date.now() + '.html');

    // Build SimC input
    var input = parsed.baseProfile.trim() + '\n';
    input += 'threads=12\n';
    input += 'iterations=10000\n';
    input += 'target_error=0.5\n';
    input += 'use_item_verification=0\n';
    input += 'profileset_metric=dps\n';
    input += 'profileset_output_data=dps\n';
    input += 'strict_parsing=0\n';
    input += '\n';

    // Build item map for results enrichment
    var itemMap = {};

    // Add each bag item as a profileset - use safe ID as profileset name
    bagItems.forEach(function(item, i) {
      var displayName = item.name || ('Bag ' + (i + 1));
      var safeName = item.slot + '_' + (i + 1) + '_' + (item.itemId || '0');
      itemMap[safeName] = { slot: item.slot, itemId: item.itemId, ilvl: item.ilvl, name: displayName };
      input += 'profileset."' + safeName + '"+=' + item.gear + '\n';
    });

    fs.writeFileSync(inputFile, input);

    jobs[jobId] = {
      status: 'running', progress: 0, dps: null, results: null,
      bagItemCount: bagItems.length, htmlReport: null, error: null,
      discardedItems: discardedItems,
      startTime: Date.now()
    };

    // Run SimC with automatic retry - removes invalid profilesets
    function runWithRetry(currentInput, removedItems, maxRetries) {
      fs.writeFileSync(inputFile, currentInput);
      var stderr = '';
      var proc = spawn(SIMC, [inputFile, 'json2=' + jsonFile, 'html=' + htmlFile], { cwd: TMP });

      proc.stdout.on('data', function(data) {
        var match = data.toString().match(/(\d+)%/);
        if (match) jobs[jobId].progress = parseInt(match[1]);
      });
      proc.stderr.on('data', function(data) { stderr += data.toString(); });

      proc.on('close', function(code) {
        if (code !== 0 && maxRetries > 0) {
          // Find ALL failed profilesets in the error message
          var failMatches = stderr.match(/Profileset '([^']+)'/g) || [];
          var failNames = failMatches.map(function(m) { return m.replace("Profileset '", '').replace("'", ''); });
          
          if (failNames.length > 0) {
            // Remove all failed profilesets from input
            var lines = currentInput.split('\n');
            var filtered = lines.filter(function(line) {
              for (var i = 0; i < failNames.length; i++) {
                if (line.indexOf('profileset."' + failNames[i] + '"') !== -1) {
                  console.log('[topgear] Skipping incompatible item: ' + failNames[i]);
                  removedItems.push(failNames[i]);
                  return false;
                }
              }
              return true;
            });
            
            jobs[jobId].bagItemCount -= failNames.length;
            jobs[jobId].progress = 0;
            runWithRetry(filtered.join('\n'), removedItems, maxRetries - 1);
            return;
          }
        }
        
        if (code !== 0) {
          jobs[jobId].status = 'error';
          jobs[jobId].error = 'SimC exit code ' + code + ': ' + stderr.substring(0, 500);
          return;
        }

        var duration = (Date.now() - jobs[jobId].startTime) / 1000;
        
        // Add removed items info to job
        if (removedItems.length > 0) {
          jobs[jobId].skippedItems = removedItems;
        }
        
        parseResults(jobId, jsonFile, htmlFile, inputFile, duration, itemMap);
      });

      proc.on('error', function(err) {
        jobs[jobId].status = 'error';
        jobs[jobId].error = 'SimC start failed: ' + err.message;
      });
    }

    runWithRetry(input, [], 20);

    res.json({ jobId: jobId, bagItems: bagItems.length, skippedLowIlvl: parsed.skippedLowIlvl || 0, avgIlvl: parsed.avgIlvl || 0 });
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/status/:id', function(req, res) {
  var job = jobs[req.params.id];
  if (!job) return res.status(404).json({ error: 'Not found' });
  res.json(job);
});

app.use('/reports', express.static(REPORTS));

// ═══ SIMC-WEB COMPATIBLE API (SSE live output) ═══

// POST /api/jobs - Create a new sim job (simc-web compatible)
app.post('/api/jobs', async function(req, res) {
  try {
    var profile = req.body.profile;
    if (!profile) return res.status(400).json({ error: 'Missing profile' });

    var jobId = ++jobCounter;
    var inputFile = path.join(TMP, 'job_' + jobId + '.simc');
    var jsonFile = path.join(TMP, 'job_' + jobId + '.json');
    var htmlFile = path.join(REPORTS, 'sim_' + jobId + '_' + Date.now() + '.html');

    // Write profile with defaults
    var input = profile.trim() + '\n';
    input += 'threads=12\n';
    input += 'iterations=25000\n';
    input += 'target_error=0.2\n';
    input += 'use_item_verification=0\n';
    input += 'calculate_scale_factors=1\n';
    input += 'scale_only=strength,agility,intellect,crit_rating,haste_rating,mastery_rating,versatility_rating,weapon_dps,weapon_offhand_dps\n';

    fs.writeFileSync(inputFile, input);

    jobs[jobId] = {
      status: 'queued',
      progress: 0,
      output: '',
      dps: null,
      results: null,
      htmlReport: null,
      error: null,
      startTime: Date.now()
    };

    // Run SimC
    var proc = spawn(SIMC, [inputFile, 'json2=' + jsonFile, 'html=' + htmlFile], { cwd: TMP });

    jobs[jobId].status = 'running';

    proc.stdout.on('data', function(data) {
      var text = data.toString();
      jobs[jobId].output += text;
      var match = text.match(/(\d+)%/);
      if (match) jobs[jobId].progress = parseInt(match[1]);
    });

    proc.stderr.on('data', function(data) {
      jobs[jobId].output += data.toString();
    });

    proc.on('close', function(code) {
      var duration = (Date.now() - jobs[jobId].startTime) / 1000;

      if (code !== 0) {
        jobs[jobId].status = 'failed';
        jobs[jobId].error = 'SimC exit code ' + code;
        return;
      }

      try {
        if (fs.existsSync(jsonFile)) {
          var raw = fs.readFileSync(jsonFile, 'utf-8');
          var data = JSON.parse(raw);
          var player = data.sim.players[0];
          jobs[jobId].dps = Math.round(player.collected_data.dps.mean);
          if (player.scale_factors) jobs[jobId].scaleFactors = player.scale_factors;
          // Don't store full JSON - too big
        }
      } catch(e) {
        console.log('[simc-web] Parse error:', e.message);
      }

      jobs[jobId].status = 'done';
      jobs[jobId].progress = 100;
      jobs[jobId].duration = duration;
      if (fs.existsSync(htmlFile)) jobs[jobId].htmlReport = '/reports/' + path.basename(htmlFile);

      // Cleanup
      try { fs.unlinkSync(inputFile); } catch(e) {}
      try { fs.unlinkSync(jsonFile); } catch(e) {}
    });

    proc.on('error', function(err) {
      jobs[jobId].status = 'failed';
      jobs[jobId].error = err.message;
    });

    res.json({ job_id: jobId });
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/jobs/:id/stream - SSE live output
app.get('/api/jobs/:id/stream', function(req, res) {
  var id = req.params.id;
  var job = jobs[id];
  if (!job) return res.status(404).json({ error: 'Not found' });

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  var lastOutputLen = 0;
  var interval = setInterval(function() {
    var j = jobs[id];
    if (!j) { clearInterval(interval); res.end(); return; }

    // Send new output
    if (j.output && j.output.length > lastOutputLen) {
      var newText = j.output.substring(lastOutputLen);
      lastOutputLen = j.output.length;
      res.write('data: ' + JSON.stringify({ type: 'output', text: newText, progress: j.progress }) + '\n\n');
    }

    // Send completion
    if (j.status === 'done' || j.status === 'failed') {
      var result = {
        type: 'complete',
        status: j.status,
        dps: j.dps,
        scaleFactors: j.scaleFactors || null,
        duration: j.duration,
        htmlReport: j.htmlReport,
        error: j.error
      };

      // Generate Pawn string
      if (j.scaleFactors) {
        var pawnMap = {Str:'Strength',Agi:'Agility',Int:'Intellect',Crit:'CritRating',Haste:'HasteRating',Mastery:'MasteryRating',Vers:'Versatility',Wdps:'Dps',WOHdps:'OffHandDps'};
        var parts = [];
        Object.keys(j.scaleFactors).forEach(function(k) {
          if (pawnMap[k] && j.scaleFactors[k] !== 0) parts.push(' ' + pawnMap[k] + '=' + j.scaleFactors[k].toFixed(2));
        });
        result.pawnString = '( Pawn: v1: "SimC":' + parts.join(',') + ' )';
      }

      res.write('data: ' + JSON.stringify(result) + '\n\n');
      clearInterval(interval);
      res.end();
    }
  }, 500);

  req.on('close', function() { clearInterval(interval); });
});

// GET /api/jobs/:id - Job status (polling alternative)
app.get('/api/jobs/:id', function(req, res) {
  var job = jobs[req.params.id];
  if (!job) return res.status(404).json({ error: 'Not found' });
  res.json({
    status: job.status,
    progress: job.progress,
    dps: job.dps,
    duration: job.duration,
    htmlReport: job.htmlReport,
    error: job.error
  });
});

// ═══ BLOODYTOOLS API ═══
var bloodyJobs = {};
var bloodyCount = 0;

// GET /api/bloody/specs - List available specs from SimC profiles
app.get('/api/bloody/specs', function(req, res) {
  try {
    var profileDir = '/opt/simc/profiles/MID1';
    var files = fs.readdirSync(profileDir).filter(function(f) { return f.endsWith('.simc'); });
    var specs = files.map(function(f) {
      var parts = f.replace('MID1_', '').replace('.simc', '').split('_');
      var cls = parts[0].toLowerCase();
      var spec = parts.slice(1).join('_').toLowerCase();
      return { class: cls, spec: spec, file: f, label: parts.join(' ') };
    });
    res.json(specs);
  } catch(e) { res.json([]); }
});

// POST /api/bloody/run - Launch a bloodytools simulation
app.post('/api/bloody/run', function(req, res) {
  try {
    var simType = req.body.type || 'trinkets';
    var cls = req.body.class || 'shaman';
    var spec = req.body.spec || 'enhancement';
    var fight = req.body.fight || 'patchwerk';

    var validTypes = ['trinkets', 'races', 'talents', 'talent_addition', 'talent_removal', 'secondary_distributions', 'tier_set', 'weapon_enchantments'];
    if (validTypes.indexOf(simType) === -1) return res.status(400).json({ error: 'Invalid type. Valid: ' + validTypes.join(', ') });

    var jobId = ++bloodyCount;
    bloodyJobs[jobId] = { status: 'running', output: '', error: null, startTime: Date.now() };

    var args = ['-m', 'bloodytools', '--executable', '/opt/simc/build/simc', '-s', simType + ',' + cls + ',' + spec + ',' + fight, '--threads', '12', '--target_error', '1', '--pretty'];
    var proc = spawn('/opt/sim_free_venv/bin/python', args, { cwd: '/opt/bloodytools' });

    proc.stdout.on('data', function(data) { bloodyJobs[jobId].output += data.toString(); });
    proc.stderr.on('data', function(data) { bloodyJobs[jobId].output += data.toString(); });

    proc.on('close', function(code) {
      bloodyJobs[jobId].duration = (Date.now() - bloodyJobs[jobId].startTime) / 1000;
      if (code !== 0) {
        bloodyJobs[jobId].status = 'error';
        bloodyJobs[jobId].error = 'Exit code ' + code;
      } else {
        bloodyJobs[jobId].status = 'done';
        // Copy result to reports dir
        var resultFile = '/opt/bloodytools/results/' + simType + '/' + cls + '_' + spec + '_' + fight + '.json';
        var destFile = '/reports/' + cls + '_' + spec + '_' + fight + '_' + simType + '.json';
        try { fs.copyFileSync(resultFile, destFile); bloodyJobs[jobId].resultUrl = '/reports/' + path.basename(destFile); } catch(e) {}
      }
    });

    proc.on('error', function(err) {
      bloodyJobs[jobId].status = 'error';
      bloodyJobs[jobId].error = err.message;
    });

    res.json({ jobId: jobId });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// GET /api/bloody/status/:id
app.get('/api/bloody/status/:id', function(req, res) {
  var job = bloodyJobs[req.params.id];
  if (!job) return res.status(404).json({ error: 'Not found' });
  res.json({ status: job.status, duration: job.duration, error: job.error, resultUrl: job.resultUrl, outputLines: job.output.split('\n').length });
});

// GET /api/bloody/results - List available result files
app.get('/api/bloody/results', function(req, res) {
  try {
    var files = fs.readdirSync(REPORTS).filter(function(f) { return f.match(/_trinkets\.json$|_races\.json$|_talents\.json$|_secondary_distributions\.json$|_weapon_enchantments\.json$/); });
    res.json(files.map(function(f) { return { file: f, url: '/reports/' + f }; }));
  } catch(e) { res.json([]); }
});

app.listen(80, '0.0.0.0', function() {
  console.log('WoW Optimizer server on port 80');
});
