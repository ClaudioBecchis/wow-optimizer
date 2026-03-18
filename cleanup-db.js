var fs = require("fs");
var dbPath = "/opt/wow-optimizer/server/data/db.json";
var data = JSON.parse(fs.readFileSync(dbPath, "utf8"));

// Remove duplicate characters - keep only the latest of each name
var seen = {};
var kept = [];
for (var i = data.characters.length - 1; i >= 0; i--) {
  var c = data.characters[i];
  var key = c.name + "-" + c.spec;
  if (!seen[key]) {
    seen[key] = true;
    kept.unshift(c);
  }
}
data.characters = kept;
console.log("Characters after dedup:", data.characters.length);
data.characters.forEach(function(c) { console.log("  ", c.id, c.name, c.spec, c.ilvl); });

// Clean result_json from all simulations (huge and unnecessary)
data.simulations.forEach(function(s) {
  delete s.result_json;
});

// Remove old queued/cancelled sims
data.simulations = data.simulations.filter(function(s) {
  return s.status === "done" || s.status === "completed" || s.status === "error";
});
console.log("Simulations after cleanup:", data.simulations.length);

// Renumber character IDs
var idMap = {};
data.characters.forEach(function(c, i) {
  var newId = i + 1;
  idMap[c.id] = newId;
  c.id = newId;
});
data.nextCharId = data.characters.length + 1;

// Update simulation character_id references
data.simulations.forEach(function(s) {
  if (idMap[s.character_id]) {
    s.character_id = idMap[s.character_id];
  }
});

fs.writeFileSync(dbPath, JSON.stringify(data, null, 2));
var size = fs.statSync(dbPath).size;
console.log("DB size:", Math.round(size / 1024) + "KB");
