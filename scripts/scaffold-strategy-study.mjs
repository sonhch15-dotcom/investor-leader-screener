import fs from "node:fs/promises";
import path from "node:path";

const [id, title = id, market = "US_STOCK"] = process.argv.slice(2).filter((arg) => arg !== "--dry-run");
const dryRun = process.argv.includes("--dry-run");
if (!id || !/^[a-z0-9][a-z0-9-]+$/.test(id)) {
  throw new Error("Usage: node scripts/scaffold-strategy-study.mjs <lowercase-id> [title] [market] [--dry-run]");
}

const root = process.cwd();
const targetDir = path.join(root, "studies", id);
const template = JSON.parse(await fs.readFile(path.join(root, "config", "strategy-study-template.json"), "utf8"));
const study = {
  ...template,
  id,
  title,
  market,
  createdAt: new Date().toISOString().slice(0, 10),
  artifacts: {
    resultJson: `data/${id}.json`,
    report: `${id}.md`,
    dashboardHref: `${id}.md`
  }
};

if (dryRun) {
  console.log(JSON.stringify(study, null, 2));
} else {
  await fs.mkdir(targetDir, { recursive: false });
  await fs.writeFile(path.join(targetDir, "study.json"), `${JSON.stringify(study, null, 2)}\n`, "utf8");
  await fs.writeFile(path.join(targetDir, "notes.md"), `# ${title}\n\n## 가설\n\n## 변경점\n\n## 결과\n\n## 결정\n`, "utf8");
  console.log(`Created studies/${id}/study.json`);
}
