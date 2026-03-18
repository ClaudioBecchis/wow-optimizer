async function main() {
  var tokenRes = await fetch('https://oauth.battle.net/token', {
    method: 'POST',
    headers: {
      'Authorization': 'Basic ' + Buffer.from('7e62e4ac2af840e9b220f6b6da088b05:iNmhg9Dpg8qvulQDSnKDdwblSY7UYdcr').toString('base64'),
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: 'grant_type=client_credentials',
  });
  var token = (await tokenRes.json()).access_token;

  // Search for realm
  var res = await fetch('https://eu.api.blizzard.com/data/wow/search/realm?namespace=dynamic-eu&name.it_IT=Pozzo%20dell%27Eternit%C3%A0&orderby=id&_page=1&access_token=' + token);
  var data = await res.json();
  console.log('Search results:', data.resultCountCriteria);
  if (data.results) {
    data.results.forEach(function(r) {
      console.log('  Name:', r.data.name.it_IT || r.data.name.en_US, '-> Slug:', r.data.slug, '-> ID:', r.data.id);
    });
  }

  // Also try direct realm lookup with different slugs
  var slugs = ['pozzo-delleternita', 'pozzo-delleternità', 'pozzo-dell-eternita'];
  for (var s of slugs) {
    var r = await fetch('https://eu.api.blizzard.com/data/wow/realm/' + s + '?namespace=dynamic-eu&access_token=' + token);
    console.log('Realm slug "' + s + '":', r.status);
    if (r.status === 200) {
      var d = await r.json();
      console.log('  -> Name:', d.name, 'Slug:', d.slug);
    }
  }
}
main();
