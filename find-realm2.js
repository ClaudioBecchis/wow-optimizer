var https = require('https');

function get(url) {
  return new Promise(function(resolve, reject) {
    https.get(url, function(res) {
      var data = '';
      res.on('data', function(c) { data += c; });
      res.on('end', function() { resolve({ status: res.statusCode, body: data }); });
    }).on('error', reject);
  });
}

function post(url, body, headers) {
  return new Promise(function(resolve, reject) {
    var u = new URL(url);
    var req = https.request({ hostname: u.hostname, path: u.pathname, method: 'POST', headers: headers }, function(res) {
      var data = '';
      res.on('data', function(c) { data += c; });
      res.on('end', function() { resolve({ status: res.statusCode, body: data }); });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

async function main() {
  var tokenRes = await post('https://oauth.battle.net/token', 'grant_type=client_credentials', {
    'Authorization': 'Basic ' + Buffer.from('7e62e4ac2af840e9b220f6b6da088b05:iNmhg9Dpg8qvulQDSnKDdwblSY7UYdcr').toString('base64'),
    'Content-Type': 'application/x-www-form-urlencoded',
  });
  var token = JSON.parse(tokenRes.body).access_token;
  console.log('Token OK');

  var slugs = ['pozzo-delleternita', 'pozzo-dell-eternita', 'pozzo-delleternit%C3%A0'];
  for (var i = 0; i < slugs.length; i++) {
    var r = await get('https://eu.api.blizzard.com/data/wow/realm/' + slugs[i] + '?namespace=dynamic-eu&access_token=' + token);
    console.log(slugs[i], '->', r.status);
    if (r.status === 200) {
      var d = JSON.parse(r.body);
      console.log('  Slug:', d.slug, 'Name:', JSON.stringify(d.name));
    }
  }

  // Try character with working realm
  var charRes = await get('https://eu.api.blizzard.com/profile/wow/character/pozzo-delleternita/rinalds?namespace=profile-eu&access_token=' + token);
  console.log('Character rinalds:', charRes.status, charRes.body.substring(0, 200));
}
main();
