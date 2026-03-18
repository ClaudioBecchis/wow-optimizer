var https = require("https");
function req(opts, body) {
  return new Promise(function(ok) {
    var r = https.request(opts, function(s) {
      var d = ""; s.on("data", function(c) { d += c; }); s.on("end", function() { ok({ status: s.statusCode, body: d }); });
    });
    if (body) r.write(body);
    r.end();
  });
}

async function test() {
  // Get token
  var t = JSON.parse((await req({
    hostname: "oauth.battle.net", path: "/token", method: "POST",
    headers: { Authorization: "Basic " + Buffer.from("7e62e4ac2af840e9b220f6b6da088b05:iNmhg9Dpg8qvulQDSnKDdwblSY7UYdcr").toString("base64"), "Content-Type": "application/x-www-form-urlencoded" }
  }, "grant_type=client_credentials")).body).access_token;

  // Check multiple items
  var items = ["235499", "228411", "158075", "210781"];
  for (var i = 0; i < items.length; i++) {
    var r = await req({ hostname: "eu.api.blizzard.com", path: "/data/wow/item/" + items[i] + "?namespace=static-eu", method: "GET", headers: { Authorization: "Bearer " + t } });
    if (r.status === 200) {
      var item = JSON.parse(r.body);
      console.log("ID:", items[i], "| Name:", item.name, "| Level:", item.level, "| ReqLvl:", item.required_level, "| Quality:", item.quality?.name, "| Slot:", item.inventory_type?.name);
    } else {
      console.log("ID:", items[i], "| Status:", r.status);
    }
  }
}
test();
