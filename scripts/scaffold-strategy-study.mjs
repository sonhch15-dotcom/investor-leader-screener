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
const catalog = JSON.parse(await fs.readFile(path.join(root, "config", "backtest-experiment-catalog.json"), "utf8"));
if (catalog.experiments.some((experiment) => experiment.id === id)) {
  throw new Error(`Experiment id ${id} already exists in the backtest catalog. Use a new id and record rerunOf when a justified rerun is required.`);
}
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
  await fs.writeFile(
    path.join(targetDir, "notes.md"),
    `# ${title}\n\n## 가설\n\n## 가장 가까운 과거 실험\n\n## 중복 검사\n\n## 새로 바뀌는 한 가지\n\n## 결과\n\n## 결정\n`,
    "utf8"
  );
  console.log(`Created studies/${id}/study.json`);
}
