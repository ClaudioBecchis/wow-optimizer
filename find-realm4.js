var https = require('https');
function getAll(url) {
  return new Promise(function(resolve, reject) {
    https.get(url, {headers:{'Accept-Encoding':'identity'}}, function(res) {
      var chunks = [];
      res.on('data', function(c) { chunks.push(c); });
      res.on('end', function() { resolve(Buffer.concat(chunks).toString()); });
    }).on('error', reject);
  });
}
function post(url, body, headers) {
  return new Promise(function(resolve, reject) {
    var u = new URL(url);
    var req = https.request({hostname:u.hostname,path:u.pathname+u.search,method:'POST',headers:headers}, function(res) {
      var d='';res.on('data',function(c){d+=c});res.on('end',function(){resolve(d)});
    });
    req.on('error',reject);req.write(body);req.end();
  });
}
async function main() {
  var t = JSON.parse(await post('https://oauth.battle.net/token','grant_type=client_credentials',{
    'Authorization':'Basic '+Buffer.from('7e62e4ac2af840e9b220f6b6da088b05:iNmhg9Dpg8qvulQDSnKDdwblSY7UYdcr').toString('base64'),
    'Content-Type':'application/x-www-form-urlencoded'
  })).access_token;
  console.log('Token OK');

  // Get realm index
  var raw = await getAll('https://eu.api.blizzard.com/data/wow/realm/index?namespace=dynamic-eu&locale=en_US&access_token='+t);
  console.log('Response length:', raw.length);
  var data = JSON.parse(raw);
  var realms = data.realms || [];
  console.log('Total realms:', realms.length);
  var found = realms.filter(function(r){return r.name.toLowerCase().indexOf('pozzo')>=0 || (r.slug && r.slug.indexOf('pozzo')>=0)});
  if(found.length){
    found.forEach(function(r){console.log('FOUND:',r.name,'slug:',r.slug,'id:',r.id)});
    // Test character on first found
    var slug = found[0].slug;
    var charRaw = await getAll('https://eu.api.blizzard.com/profile/wow/character/'+slug+'/rinalds?namespace=profile-eu&access_token='+t);
    console.log('Character test on',slug,':',charRaw.substring(0,200));
  } else {
    console.log('No "pozzo" realm found');
    // Print some Italian realms
    var it = realms.filter(function(r){return r.slug.indexOf('nemesis')>=0||r.slug.indexOf('crush')>=0});
    it.forEach(function(r){console.log(' ',r.name,r.slug)});
  }
}
main();
