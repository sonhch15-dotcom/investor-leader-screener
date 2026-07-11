# Score Variant Final Validation

> Superseded for official comparison by `score_a_c_corrected_validation.md` and run `us-score-a-c-corrected-frozen-20260711`. The figures below use the legacy forced-exit and cost-based MDD engine and are retained only for audit history.

Generated at: 2026-07-10

## Purpose

기존 백테스트 방식과 동일하게 `data/universe.json`의 유니버스/섹터 분류를 고정한 뒤, 개별 종목 점수 산식 A/B/C를 비교했다.

이번 추가 검증은 1차 선정력 테스트에서 끝내지 않고, 실제 운용 전략에 가까운 다음 조건까지 적용했다.

- Leader2 방식: 월간 주도 섹터 상위 2개에서 각 1종목 선정
- 매수: 월말 확정 후 다음 거래일 매수
- 매도: 6개월 후 50% 매도
- 잔여 50%: 주봉 10주선 + RSI 조건으로 연장, 최대 12개월
- 자금배분: Repeat + Theme Combo Cap27.5
- 초기 자본: 10,000,000원
- 거래 비용: 매수/매도 10 bps
- 종목별 원금 한도: 27.5%

## Variants

| Variant | Description |
|---|---|
| A Current Sector20 | 현재 공식 방식. 개별 종목 점수에 섹터/테마 20점을 그대로 포함 |
| B No Sector Normalized | 개별 종목 점수에서 섹터/테마를 제거하고 100점으로 재환산 |
| C Half Sector10 Normalized | 개별 종목 점수에서 섹터/테마를 절반만 반영하고 100점으로 재환산 |

## Selection Engine Test

먼저 단순 종목 선정력 기준으로 보면 B/C가 A보다 강했다.

| Rank | Variant | Total Return | CAGR | QQQ | Excess vs QQQ | MDD |
|---:|---|---:|---:|---:|---:|---:|
| 1 | B No Sector Normalized | +919.1% | +61.7% | +96.2% | +822.9% | -22.0% |
| 2 | C Half Sector10 Normalized | +913.1% | +61.5% | +96.2% | +816.9% | -14.7% |
| 3 | A Current Sector20 | +532.5% | +46.5% | +96.2% | +436.3% | -18.0% |

해석:

- B는 섹터/테마 점수를 개별 종목 점수에서 완전히 제거했을 때 가장 높은 단순 선정력 수익률을 보였다.
- C는 B와 거의 비슷한 수익률이면서 MDD가 더 낮았다.
- A는 기존 공식 방식이며, 재실행 결과 최근 선정 종목이 기존 백테스트와 일치했다.

## Trade-Level Exit Test

다음으로 각 종목을 실제 매도 규칙으로 검증했다.

| Variant | Completed Trades | Avg Trade Return | Median | Win Rate | Avg QQQ | Avg Excess QQQ |
|---|---:|---:|---:|---:|---:|---:|
| A Current Sector20 | 106 | +42.2% | +11.0% | 76.4% | +9.1% | +33.1% |
| B No Sector Normalized | 106 | +48.1% | +11.4% | 68.9% | +9.6% | +38.5% |
| C Half Sector10 Normalized | 106 | +51.6% | +11.0% | 72.6% | +9.6% | +42.0% |

매도 사유 분포:

| Variant | 6M 50% Sell | Trend Not Alive at 6M | Two-Week 10W Break | Max 12M |
|---|---:|---:|---:|---:|
| A | 106 | 48 | 45 | 13 |
| B | 106 | 50 | 42 | 14 |
| C | 106 | 48 | 43 | 15 |

해석:

- C가 평균 거래 수익률과 QQQ 초과 수익률 모두 가장 좋았다.
- A는 승률은 가장 높지만 평균 수익률이 낮았다.
- B는 선정력은 강하지만 승률과 계좌 MDD 측면에서 C보다 불리했다.

## Cap27.5 Account Test

최종적으로 실제 운용 전략인 Repeat + Theme Combo Cap27.5를 적용했다.

| Rank | Variant | Final Capital | Total Return | CAGR | MDD at Cost | Buys | Skips | Min Cash |
|---:|---|---:|---:|---:|---:|---:|---:|---:|
| 1 | C Half Sector10 Normalized | 58,999,912 | +490.0% | +44.4% | -6.5% | 104/106 | 2 | 0 |
| 2 | B No Sector Normalized | 56,609,421 | +466.1% | +43.2% | -15.2% | 103/106 | 3 | 0 |
| 3 | A Current Sector20 | 53,173,738 | +431.7% | +41.3% | -8.8% | 106/106 | 0 | 0 |

해석:

- 최종 계좌 기준 1등은 C안이다.
- B안은 단순 선정력은 가장 강하지만, Cap27.5 계좌 검증에서는 C보다 최종 수익률과 MDD가 모두 불리했다.
- C안은 A안 대비 최종 수익률이 약 +58.3%p 높고, MDD도 -8.8%에서 -6.5%로 개선됐다.
- A안은 매수 스킵이 없고 기존 공식 방식과 일치하므로 기준 전략으로서 안정적이다.

## Decision

현재 공식 전략을 즉시 교체하기보다는 다음 판정이 합리적이다.

| Variant | Status | Reason |
|---|---|---|
| A Current Sector20 | active baseline | 현재 공식 전략, 최근 선정 일치 확인 |
| B No Sector Normalized | testing | 선정력은 가장 강하지만 계좌 MDD가 C보다 큼 |
| C Half Sector10 Normalized | candidate | 계좌 최종 성과 1위, MDD도 가장 낮음 |

## Required Next Checks

C안을 공식 전략으로 승격하기 전 필요한 검증:

1. 가격 데이터 스냅샷을 고정하고 재실행해 동일 결과가 나오는지 확인
2. 최근 12개월 선정 종목을 수동 리뷰
3. Cap27.5 외 Cap25, Cap30에서도 안정적인지 확인
4. 3년/5년/구간별 성과를 나눠 과최적화 여부 확인
5. 현재 월 추천 종목이 A안 대비 어떻게 바뀌는지 확인
6. 대시보드 반영 시 공식 전략 교체가 아니라 `candidate` 전략으로 먼저 노출

## Conclusion

이번 추가 검증에서는 `C Half Sector10 Normalized`가 가장 균형 잡힌 결과를 냈다.

현재 공식 A안보다 수익률과 MDD가 모두 개선되었고, B안보다 계좌 리스크가 낮다. 따라서 다음 단계에서는 C안을 공식 후보 전략으로 두고, 가격 스냅샷 고정 재현성 검증과 최근 선정 종목 리뷰를 진행하는 것이 맞다.
