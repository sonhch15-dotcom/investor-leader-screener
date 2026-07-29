SELECT
    1 AS "order",
    '평가 가능' AS state,
    'GrossProfit 직접 사실 또는 범위가 검증된 매출-원가' AS condition,
    'YoY 5%p 하락 여부를 계산' AS action
UNION ALL
SELECT
    2,
    '적신호 발동',
    '비교 가능한 총이익률이 전년 동기보다 5%p 이상 하락',
    '종목 제외 및 사유 로그'
UNION ALL
SELECT
    3,
    '평가 불가',
    '비교 가능한 총이익률을 복원할 수 없음',
    '해당 적신호만 미적용하고 GROSS_MARGIN_NOT_EVALUABLE 태그'
ORDER BY "order";
