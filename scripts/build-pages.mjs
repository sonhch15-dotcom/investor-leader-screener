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

  const optionalFiles = [
    "backtest_report.md",
    "monthly_selection_test_plan.md",
    "monthly_selection_report.md",
    "strategy_summary.md",
    "daily_entry_filter_test.md",
    "weekly_exit_rule_test.md",
    "scale_execution_test.md",
    "weekly_dropout_rule_test.md",
    "monthly_buy_rule_test-5y.md",
    "monthly_buy_rule_test.md",
    "holding_period_test.md",
    "stop_rule_test.md",
    "position_cap_test.md",
    "sleeve_size_test.md",
    "portfolio_simulation_test.md",
    "capital_account_simulation.md",
    "strategy_development_team.md",
    "strategy_common_template.md",
    "strategy_development_lab.md",
    "korea_strategy_backtest.md",
    "full_candidate_diversification_test.md",
    "sector_diversification_test.md",
  ];

  await copyDir(path.join(root, "dashboard"), dist);
  await copyDir(path.join(root, "data"), path.join(dist, "data"));
  await copyFile(path.join(root, "chart_review.md"), path.join(dist, "chart_review.md"));

  for (const file of optionalFiles) {
    const source = path.join(root, file);
    if (await exists(source)) {
      await copyFile(source, path.join(dist, file));
    }
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
