SELECT
    sector,
    population,
    resolved,
    ROUND(coverage, 10) AS coverage,
    minimum,
    CASE WHEN passes = 1 THEN '통과' ELSE '미달' END AS status
FROM debt_sector_inputs
ORDER BY coverage ASC;
