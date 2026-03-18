var https = require('https');

function req(opts, body) {
  return new Promise(function(ok) {
    var r = https.request(opts, function(res) {
      var d = ''; res.on('data', function(c) { d += c; }); 
      res.on('end', function() { ok({ status: res.statusCode, body: d, headers: res.headers }); });
    });
    if (body) r.write(body);
    r.end();
  });
}

async function main() {
  // Fresh token
  var tokenRes = await req({
    hostname: 'oauth.battle.net', path: '/token', method: 'POST',
    headers: {
      'Authorization': 'Basic ' + Buffer.from('7e62e4ac2af840e9b220f6b6da088b05:iNmhg9Dpg8qvulQDSnKDdwblSY7UYdcr').toString('base64'),
      'Content-Type': 'application/x-www-form-urlencoded'
    }
  }, 'grant_type=client_credentials');
  var token = JSON.parse(tokenRes.body).access_token;
  console.log('Fresh token:', token.substring(0, 10) + '...');

  // Try the EXACT slug from the Blizzard website URL
  // The website uses: pozzo-delleternit%C3%A0
  // In the path, Node needs the raw UTF-8 character à
  var realmSlug = 'pozzo-delleternit\u00e0';  // à as unicode
  var charName = 'rinalds';
  
  // Method 1: Using the unicode character directly
  var path1 = '/profile/wow/character/' + encodeURIComponent(realmSlug) + '/' + charName + '?namespace=profile-eu&access_token=' + token;
  console.log('\nMethod 1 (encodeURIComponent):');
  console.log('Path:', path1);
  var r1 = await req({ hostname: 'eu.api.blizzard.com', path: path1, method: 'GET' });
  console.log('Status:', r1.status, 'Body:', r1.body.substring(0, 200));

  // Method 2: Pre-encoded path
  var path2 = '/profile/wow/character/pozzo-delleternit%C3%A0/rinalds?namespace=profile-eu&access_token=' + token;
  console.log('\nMethod 2 (pre-encoded %C3%A0):');
  var r2 = await req({ hostname: 'eu.api.blizzard.com', path: path2, method: 'GET' });
  console.log('Status:', r2.status, 'Body:', r2.body.substring(0, 200));

  // Method 3: Raw à in path (no encoding)
  var path3 = '/profile/wow/character/pozzo-delleternit\u00e0/rinalds?namespace=profile-eu&access_token=' + token;
  console.log('\nMethod 3 (raw unicode à):');
  var r3 = await req({ hostname: 'eu.api.blizzard.com', path: path3, method: 'GET' });
  console.log('Status:', r3.status, 'Body:', r3.body.substring(0, 200));
  
  // Method 4: Double encoded
  var path4 = '/profile/wow/character/pozzo-delleternit%25C3%25A0/rinalds?namespace=profile-eu&access_token=' + token;
  console.log('\nMethod 4 (double encoded):');
  var r4 = await req({ hostname: 'eu.api.blizzard.com', path: path4, method: 'GET' });
  console.log('Status:', r4.status, 'Body:', r4.body.substring(0, 200));
}
main();
