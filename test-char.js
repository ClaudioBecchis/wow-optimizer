var https = require('https');
function post(url, body, headers) {
  return new Promise(function(ok) {
    var u = new URL(url);
    var r = https.request({hostname:u.hostname,path:u.pathname,method:'POST',headers:headers}, function(s) {
      var d='';s.on('data',function(c){d+=c});s.on('end',function(){ok(d)});
    }); r.write(body); r.end();
  });
}

async function main() {
  var t = JSON.parse(await post('https://oauth.battle.net/token','grant_type=client_credentials',{
    'Authorization':'Basic '+Buffer.from('7e62e4ac2af840e9b220f6b6da088b05:iNmhg9Dpg8qvulQDSnKDdwblSY7UYdcr').toString('base64'),
    'Content-Type':'application/x-www-form-urlencoded'
  })).access_token;
  console.log('Token OK');

  // The key: keep the accent in the path, properly encoded
  var path = '/profile/wow/character/pozzo-delleternit%C3%A0/rinalds?namespace=profile-eu&access_token=' + t;
  console.log('Path:', path);

  return new Promise(function(ok) {
    https.get({
      hostname: 'eu.api.blizzard.com',
      path: path,
      headers: { 'Accept': 'application/json' }
    }, function(res) {
      var data = '';
      res.on('data', function(c) { data += c; });
      res.on('end', function() {
        console.log('Status:', res.statusCode);
        console.log('Body:', data.substring(0, 500));
        ok();
      });
    });
  });
}
main();
