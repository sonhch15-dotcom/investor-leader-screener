SELECT
    display_order AS "order",
    statistic,
    ROUND(ratio, 4) AS ratio,
    interpretation
FROM total_liabilities_quantile_inputs
ORDER BY display_order;
