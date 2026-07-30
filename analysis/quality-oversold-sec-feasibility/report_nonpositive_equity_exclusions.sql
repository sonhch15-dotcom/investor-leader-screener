SELECT
    symbols,
    name,
    sector,
    equity,
    financial_period_end,
    filed,
    accession,
    'NONPOSITIVE_EQUITY_AUTO_FAIL' AS exclusion_reason
FROM total_liabilities_rows
WHERE status = 'nonpositive_equity_auto_fail'
ORDER BY symbols;
