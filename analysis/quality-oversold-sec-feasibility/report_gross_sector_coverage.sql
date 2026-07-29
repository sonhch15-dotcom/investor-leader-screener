SELECT
    sector,
    issuers,
    direct_8_of_8 AS direct_issuers,
    ROUND(direct_coverage, 10) AS direct_coverage,
    ROUND(upper_bound_coverage_before_scope_validation, 10)
        AS upper_bound_coverage
FROM gross_sector_inputs
ORDER BY direct_coverage, sector;
