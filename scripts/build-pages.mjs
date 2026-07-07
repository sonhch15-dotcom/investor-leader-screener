import fs from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const dist = path.join(root, "dist");

async function exists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function copyFile(source, target) {
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.copyFile(source, target);
}

async function copyDir(source, target) {
  await fs.mkdir(target, { recursive: true });
  const entries = await fs.readdir(source, { withFileTypes: true });
  for (const entry of entries) {
    const sourcePath = path.join(source, entry.name);
    const targetPath = path.join(target, entry.name);
    if (entry.isDirectory()) {
      await copyDir(sourcePath, targetPath);
    } else if (entry.isFile()) {
      await copyFile(sourcePath, targetPath);
    }
  }
}

async function main() {
  await fs.rm(dist, { recursive: true, force: true });
  await fs.mkdir(dist, { recursive: true });

  await copyDir(path.join(root, "dashboard"), dist);
  await copyDir(path.join(root, "data"), path.join(dist, "data"));
  await copyFile(path.join(root, "chart_review.md"), path.join(dist, "chart_review.md"));
  if (await exists(path.join(root, "backtest_report.md"))) {
    await copyFile(path.join(root, "backtest_report.md"), path.join(dist, "backtest_report.md"));
  }
  if (await exists(path.join(root, "monthly_selection_test_plan.md"))) {
    await copyFile(path.join(root, "monthly_selection_test_plan.md"), path.join(dist, "monthly_selection_test_plan.md"));
  }
  if (await exists(path.join(root, "monthly_selection_report.md"))) {
    await copyFile(path.join(root, "monthly_selection_report.md"), path.join(dist, "monthly_selection_report.md"));
  }
  await copyFile(path.join(root, "stock_selection_system.md"), path.join(dist, "stock_selection_system.md"));
  await fs.writeFile(path.join(dist, ".nojekyll"), "", "utf8");

  if (!(await exists(path.join(dist, "data", "screener-results.json")))) {
    throw new Error("Missing dist/data/screener-results.json");
  }

  console.log("Built GitHub Pages site in dist/");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
