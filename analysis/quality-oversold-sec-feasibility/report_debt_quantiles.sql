SELECT
    method,
    n,
    median,
    p75,
    p90,
    p95,
    decision_status
FROM debt_quantile_inputs
ORDER BY method;
