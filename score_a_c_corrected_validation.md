# Corrected Score A vs Score C Validation

Run ID: us-score-a-c-corrected-frozen-20260711
Grade: Candidate
Selection period: 2021-07-10 to 2026-07-10
Account period: 2021-08-30 to 2026-07-10
Universe: 551
Price snapshot: 493d56b6083cdf39d9d93920b9dbe051f7230b6478f465ce2843dc7eeefa3820

## Corrected Account Results

| Metric | Score A | Score C |
|---|---:|---:|
| Selection return | 532.5% | 957.2% |
| Account return | 416.1% | 520.0% |
| Account CAGR | 40.2% | 45.6% |
| Market-value MDD | -19.8% | -20.4% |
| Robust return | 341.6% | 464.6% |
| QQQ return | 96.4% | 96.4% |

## Annual Signal Cohorts

| Cohort | Score A | Score C | Winner | A MDD | C MDD |
|---|---:|---:|---|---:|---:|
| 2021-2022 신호 | 7.4% | 9.8% | Score C | -15.8% | -14.8% |
| 2023 신호 | 50.4% | 70.5% | Score C | -9.8% | -11.4% |
| 2024 신호 | 66.1% | 105.0% | Score C | -20.8% | -24.7% |
| 2025 신호 | 253.0% | 265.5% | Score C | -11.4% | -12.2% |
| 2026 YTD 신호 | 18.0% | 64.0% | Score C | -16.2% | -20.8% |

## Promotion Gates

- PASS: 동일 고정 가격 스냅샷
- PASS: 전체 계좌 수익률 우위
- PASS: 300% 초과 거래 제외 계좌 수익률 우위
- PASS: 연도별 독립 계좌 4개 이상 우위
- PASS: 시장가 MDD 악화 3%p 이내
- PASS: 전체 계좌 QQQ 초과
- PASS: 유니버스·가격 해시 기록

## Decision

- Candidate result: validated_candidate
- Live active: Score A Leader2 Cap27.5
- Official promotion: false
- Blocker: The fixed universe is a current-constituent snapshot rather than a point-in-time historical membership dataset, and Score C has no untouched forward observation period yet.
- Next: Keep Score C in shadow/testing status and collect forward signals while building a point-in-time universe audit.
