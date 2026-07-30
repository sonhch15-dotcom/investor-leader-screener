SELECT
    method,
    resolved_issuers,
    population,
    ROUND(coverage, 10) AS coverage
FROM debt_coverage_inputs
ORDER BY display_order;
