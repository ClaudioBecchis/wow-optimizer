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

const jobs = {};
let jobCounter = 0;

// Slot names recognized by SimC
const SLOTS = ['head','neck','shoulder','back','chest','wrist','hands','waist','legs','feet','finger1','finger2','trinket1','trinket2','main_hand','off_hand'];

/**
 * Parse a /simc string and extract:
 * - baseProfile: the character profile (everything before bag items)
 * - bagItems: array of {slot, gear, name} from commented bag items
 */
function parseSimcBags(simcText) {
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

  return {
    baseProfile: profileLines.join('\n'),
    bagItems: bagItems
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
          name: ps.name,
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
app.post('/api/simulate', function(req, res) {
  try {
    var simcText = req.body.simcProfile;
    if (!simcText) return res.status(400).json({ error: 'Missing simcProfile' });

    // Parse profile and bag items
    var parsed = parseSimcBags(simcText);
    var bagItems = parsed.bagItems;

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

    // Add each bag item as a profileset
    bagItems.forEach(function(item, i) {
      var name = item.name || ('Bag_' + (i + 1));
      name = name.replace(/"/g, '').substring(0, 50);
      itemMap[name] = { slot: item.slot, itemId: item.itemId, ilvl: item.ilvl, name: item.name };
      input += 'profileset."' + name + '"+=' + item.gear + '\n';
    });

    fs.writeFileSync(inputFile, input);

    jobs[jobId] = {
      status: 'running', progress: 0, dps: null, results: null,
      bagItemCount: bagItems.length, htmlReport: null, error: null,
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

    res.json({ jobId: jobId, bagItems: bagItems.length });
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

app.listen(80, '0.0.0.0', function() {
  console.log('Top Gear server on port 80');
});
