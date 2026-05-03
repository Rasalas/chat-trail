import fs from "node:fs";

const version = process.argv[2];

if (!version || !/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(version)) {
  console.error("Usage: node scripts/set-version.mjs <semver>");
  process.exit(1);
}

updateJson("package.json", (json) => {
  json.version = version;
});

updateJson("package-lock.json", (json) => {
  json.version = version;
  if (json.packages?.[""]) {
    json.packages[""].version = version;
  }
});

updateJson("public/manifest.json", (json) => {
  json.version = version;
});

function updateJson(path, mutate) {
  const json = JSON.parse(fs.readFileSync(path, "utf8"));
  mutate(json);
  fs.writeFileSync(path, `${JSON.stringify(json, null, 2)}\n`);
}
