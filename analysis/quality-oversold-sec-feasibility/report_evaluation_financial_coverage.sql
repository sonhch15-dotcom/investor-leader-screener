SELECT
  year,
  period_start || '~' || period_end AS period,
  minimum_overall_coverage,
  minimum_sector_coverage,
  minimum_provenance_rate,
  CAST(passing_months AS TEXT) || '/' ||
    CAST(months_evaluated AS TEXT) AS passing_months_label,
  CASE
    WHEN year_passes = 0 THEN '실패'
    WHEN year_scope = 'PARTIAL_YEAR' THEN '통과 (부분 연도)'
    ELSE '통과'
  END AS status
FROM evaluation_financial_coverage_2015_2026q1_annual
ORDER BY year;
