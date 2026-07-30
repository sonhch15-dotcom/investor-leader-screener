SELECT
  year,
  legacy_episodes,
  passing_episodes,
  episode_pass_rate,
  session_coverage,
  CASE WHEN year_passes = 1 THEN '통과' ELSE '실패' END AS status
FROM legacy_price_coverage_2015_2026q2_annual
WHERE segment = 'QUALITY_UNIVERSE'
ORDER BY year;
