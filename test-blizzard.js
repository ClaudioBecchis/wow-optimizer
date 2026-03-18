async function test() {
  const clientId = '7e62e4ac2af840e9b220f6b6da088b05';
  const clientSecret = 'iNmhg9Dpg8qvulQDSnKDdwblSY7UYdcr';

  // Get token
  const tokenRes = await fetch('https://oauth.battle.net/token', {
    method: 'POST',
    headers: {
      'Authorization': 'Basic ' + Buffer.from(clientId + ':' + clientSecret).toString('base64'),
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: 'grant_type=client_credentials',
  });
  const tokenData = await tokenRes.json();
  console.log('Token:', tokenData.access_token ? 'OK' : 'FAIL');

  // Test character
  const url = 'https://eu.api.blizzard.com/profile/wow/character/pozzo-delleternita/rinalds?namespace=profile-eu&access_token=' + tokenData.access_token;
  console.log('URL:', url);
  const res = await fetch(url);
  console.log('Status:', res.status);
  const body = await res.text();
  console.log('Body:', body.substring(0, 500));
}
test();
