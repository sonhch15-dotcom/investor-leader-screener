SELECT
    display_order AS "order",
    bin,
    issuer_count,
    ROUND(share, 10) AS share,
    sample_size,
    lower_bound,
    upper_bound
FROM total_liabilities_histogram_inputs
ORDER BY display_order;
