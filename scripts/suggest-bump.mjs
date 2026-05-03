import { execSync } from "node:child_process";

const lastTag = run("git describe --tags --abbrev=0 2>/dev/null");
const range = lastTag ? `${lastTag}..HEAD` : "HEAD";
const commits = run(`git log --format=%B ${range}`) || "";

if (/BREAKING CHANGE:|^[a-z]+(?:\([^)]+\))?!:/m.test(commits)) {
  console.log("major");
} else if (/^feat(?:\([^)]+\))?:/m.test(commits)) {
  console.log("minor");
} else {
  console.log("patch");
}

function run(command) {
  try {
    return execSync(command, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return "";
  }
}
