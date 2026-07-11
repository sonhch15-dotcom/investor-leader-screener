import assert from "node:assert/strict";
import { validateStrategyTransitions } from "./strategy-transition-contract.mjs";

const A = "us_leader2_repeat_theme_combo_cap27_5";
const C = "us_leader2_score_c_cap27_5";
const transition = {
  market: "US_STOCK",
  fromStrategyKey: A,
  toStrategyKey: C,
  effectiveSignalMonth: "2026-08",
  newEnrollmentPolicy: "wait_for_effective_signal",
  existingMonthlyPlanPolicy: "finish_locked_month",
  existingLotPolicy: "keep_original_strategy"
};

function rows(aStatus, cStatus) {
  return {
    signals: [
      { market: "US_STOCK", strategyKey: A, strategyStatus: aStatus },
      { market: "US_STOCK", strategyKey: C, strategyStatus: cStatus }
    ],
    catalogStrategies: [
      { market: "US_STOCK", strategyKey: A, status: aStatus },
      { market: "US_STOCK", strategyKey: C, status: cStatus }
    ]
  };
}

function errors(signalMonth, aStatus, cStatus) {
  return validateStrategyTransitions({
    transitions: [transition],
    signalMonth,
    ...rows(aStatus, cStatus)
  });
}

assert.deepEqual(errors("2026-07", "active", "candidate"), []);
assert.ok(errors("2026-07", "testing", "active").some((error) => error.includes("must be active")));
assert.deepEqual(errors("2026-08", "testing", "active"), []);
assert.ok(errors("2026-08", "active", "candidate").some((error) => error.includes("must be testing")));

console.log("Strategy transition contract tests passed.");
