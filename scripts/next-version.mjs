const current = process.argv[2];
const bump = process.argv[3];

if (!current || !["major", "minor", "patch"].includes(bump)) {
  console.error("Usage: node scripts/next-version.mjs <current-version> <major|minor|patch>");
  process.exit(1);
}

const match = current.match(/^(\d+)\.(\d+)\.(\d+)/);
if (!match) {
  console.error(`Invalid current version: ${current}`);
  process.exit(1);
}

let [, major, minor, patch] = match.map(Number);

if (bump === "major") {
  major += 1;
  minor = 0;
  patch = 0;
} else if (bump === "minor") {
  minor += 1;
  patch = 0;
} else {
  patch += 1;
}

console.log(`${major}.${minor}.${patch}`);
