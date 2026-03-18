const blizz = require('./server/modules/blizzard-api');

async function test() {
  try {
    // Test specializations endpoint
    const result = await blizz.apiGet('/profile/wow/character/pozzo-delleternit%C3%A0/rinalds/specializations', 'eu', 'profile-eu');
    console.log('=== Rinalds Specializations ===');
    console.log('Keys:', Object.keys(result));
    
    if (result.specializations) {
      result.specializations.forEach(function(s) {
        console.log('Spec:', s.specialization?.name);
        console.log('  loadout_code:', s.loadout_code || 'MISSING');
        console.log('  talents count:', s.talents?.length || 0);
        console.log('  glyphs:', s.glyphs?.length || 0);
      });
    }
    if (result.active_specialization) {
      console.log('Active spec:', result.active_specialization.name);
    }

    // Also test Haiga
    const result2 = await blizz.apiGet('/profile/wow/character/pozzo-delleternit%C3%A0/haiga/specializations', 'eu', 'profile-eu');
    console.log('\n=== Haiga Specializations ===');
    if (result2.specializations) {
      result2.specializations.forEach(function(s) {
        console.log('Spec:', s.specialization?.name);
        console.log('  loadout_code:', s.loadout_code || 'MISSING');
        console.log('  talents count:', s.talents?.length || 0);
      });
    }
  } catch(e) {
    console.log('Error:', e.message);
  }
}
test();
