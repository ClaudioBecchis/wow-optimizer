// Test script - run on the container
var db = require("/opt/wow-optimizer/server/modules/db");
var c = db.getCharacter(1);
var fs = require("fs");
var simc = c.simc_string;
console.log("SimC string length:", simc.length);
console.log("Has newlines:", simc.indexOf("\n") >= 0);
console.log("Lines:", simc.split("\n").length);
console.log("First 3 lines:", simc.split("\n").slice(0, 3));
fs.writeFileSync("/tmp/wow-optimizer/haiga.simc", simc);
console.log("Written to /tmp/wow-optimizer/haiga.simc");
