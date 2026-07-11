const SIGNAL_MONTH = /^\d{4}-\d{2}$/;

const allowedPolicies = {
  newEnrollmentPolicy: new Set(["wait_for_effective_signal"]),
  existingMonthlyPlanPolicy: new Set(["finish_locked_month"]),
  existingLotPolicy: new Set(["keep_original_strategy"])
};

function strategyStatus(rows, strategyKey) {
  const statuses = new Set(
    rows
      .filter((row) => row.strategyKey === strategyKey)
      .map((row) => row.strategyStatus)
      .filter(Boolean)
  );
  if (!statuses.size) return null;
  return statuses.size === 1 ? [...statuses][0] : "mixed";
}

export function validateStrategyTransitions({
  transitions,
  signalMonth,
  signals,
  catalogStrategies
}) {
  const errors = [];
  if (!SIGNAL_MONTH.test(String(signalMonth ?? ""))) {
    return [`invalid signalMonth ${signalMonth}`];
  }
  if (!Array.isArray(transitions) || !transitions.length) {
    return ["strategyTransitions must contain at least one transition"];
  }

  const catalog = new Map((catalogStrategies ?? []).map((row) => [row.strategyKey, row]));
  for (const transition of transitions) {
    const prefix = transition?.market || "unknown market";
    if (!transition?.market || !transition.fromStrategyKey || !transition.toStrategyKey) {
      errors.push(`${prefix} transition identity is incomplete`);
      continue;
    }
    if (transition.fromStrategyKey === transition.toStrategyKey) {
      errors.push(`${prefix} transition must use different strategy keys`);
    }
    if (!SIGNAL_MONTH.test(String(transition.effectiveSignalMonth ?? ""))) {
      errors.push(`${prefix} has invalid effectiveSignalMonth`);
      continue;
    }
    for (const [field, allowed] of Object.entries(allowedPolicies)) {
      if (!allowed.has(transition[field])) {
        errors.push(`${prefix} has invalid ${field}`);
      }
    }

    const fromCatalog = catalog.get(transition.fromStrategyKey);
    const toCatalog = catalog.get(transition.toStrategyKey);
    if (!fromCatalog || !toCatalog) {
      errors.push(`${prefix} transition strategy is missing from catalog`);
      continue;
    }
    if (fromCatalog.market !== transition.market || toCatalog.market !== transition.market) {
      errors.push(`${prefix} transition catalog market mismatch`);
    }

    const marketSignals = (signals ?? []).filter((row) => row.market === transition.market);
    const fromStatus = strategyStatus(marketSignals, transition.fromStrategyKey);
    const toStatus = strategyStatus(marketSignals, transition.toStrategyKey);
    const beforeEffectiveMonth = signalMonth < transition.effectiveSignalMonth;
    const expectedFromStatus = beforeEffectiveMonth ? "active" : "testing";
    const expectedToStatus = beforeEffectiveMonth ? "candidate" : "active";

    if (fromStatus !== expectedFromStatus) {
      errors.push(`${prefix} ${transition.fromStrategyKey} must be ${expectedFromStatus} in ${signalMonth}, got ${fromStatus}`);
    }
    if (toStatus !== expectedToStatus) {
      errors.push(`${prefix} ${transition.toStrategyKey} must be ${expectedToStatus} in ${signalMonth}, got ${toStatus}`);
    }
    if (fromCatalog.status !== expectedFromStatus) {
      errors.push(`${prefix} catalog ${transition.fromStrategyKey} must be ${expectedFromStatus}`);
    }
    if (toCatalog.status !== expectedToStatus) {
      errors.push(`${prefix} catalog ${transition.toStrategyKey} must be ${expectedToStatus}`);
    }
  }
  return errors;
}
