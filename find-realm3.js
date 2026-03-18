var https = require('https');
function get(url) {
  return new Promise(function(resolve, reject) {
    https.get(url, function(res) {
      var data = '';
      res.on('data', function(c) { data += c; });
      res.on('end', function() { resolve(data); });
    }).on('error', reject);
  });
}
function post(url, body, headers) {
  return new Promise(function(resolve, reject) {
    var u = new URL(url);
    var req = https.request({ hostname: u.hostname, path: u.pathname, method: 'POST', headers: headers }, function(res) {
      var data = '';
      res.on('data', function(c) { data += c; });
      res.on('end', function() { resolve(data); });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}
async function main() {
  var t = JSON.parse(await post('https://oauth.battle.net/token', 'grant_type=client_credentials', {
    'Authorization': 'Basic ' + Buffer.from('7e62e4ac2af840e9b220f6b6da088b05:iNmhg9Dpg8qvulQDSnKDdwblSY7UYdcr').toString('base64'),
    'Content-Type': 'application/x-www-form-urlencoded',
  })).access_token;
  var body = await get('https://eu.api.blizzard.com/data/wow/realm/index?namespace=dynamic-eu&access_token=' + t);
  var realms = JSON.parse(body).realms;
  var found = realms.filter(function(r) { return r.name.toLowerCase().indexOf('pozzo') >= 0; });
  found.forEach(function(r) { console.log('Name:', r.name, '| Slug:', r.slug, '| ID:', r.id); });
  if (!found.length) console.log('Nessun realm con "pozzo" trovato. Totale realms:', realms.length);
}
main();
