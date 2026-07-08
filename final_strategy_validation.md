# Final Strategy Validation

Generated at: 2026-07-08T14:53:35.734Z
Period: 2021-07-08 to 2026-07-08

## 최종 결론

- 전체 완성 계좌 기준 1등은 **Repeat + Theme Combo Cap30** 입니다. 선정 엔진은 **Leader2 One Each**, 누적 수익률은 **434.9%** 입니다.
- 실전 우선 후보는 **Leader2 One Each + Repeat + Theme Combo Cap27.5** 입니다. 누적 **429.8%**, MDD **-8.8%**로 Cap30보다 조금 보수적입니다.
- 방금 개발한 **Conviction Diverse Top2**는 월별 선정력 테스트에서는 1등이었지만, 완성 계좌 검증에서는 기존 Leader2 기반 전략을 넘지 못했습니다.
- 따라서 Conviction Diverse는 active 승격이 아니라 보관/추가 연구 대상으로 두는 것이 맞습니다.

## 1. 월별 선정력 검증

이 단계는 매달 새 후보 2개를 고르고 6개월 슬리브로 보유했을 때의 순수 선정력입니다. 자금 한도, 중복 매수 제한, 주봉 연장 매도는 아직 완전히 반영하지 않습니다.

| 선정 전략 | 5년 누적 | CAGR | QQQ 누적 | QQQ 초과 | MDD | 월간 플러스 | QQQ 월초과 | 평균 보유 종목 |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| Conviction Diverse Top2 | 669.4% | 52.5% | 96.2% | 573.2% | -22.1% | 62.1% | 58.6% | 6.4 |
| Leader2 One Each | 517.2% | 45.7% | 96.2% | 421.0% | -18.0% | 60.3% | 58.6% | 10.1 |
| Baseline Top2 | 254.6% | 29.9% | 96.2% | 158.4% | -16.2% | 60.3% | 53.4% | 9.9 |

해석: Conviction Diverse Top2는 이 단계에서 가장 좋았습니다. 다만 MDD도 더 크고, 실제 계좌에서 반복 종목이 계속 쌓일 때의 한도 문제는 이 표에 충분히 반영되지 않습니다.

## 2. 매수/매도 실행 검증

두 전략 모두 같은 실행 규칙을 적용했습니다. 월말 확정 후 다음 거래일에 매수하고, 6개월 뒤 50% 매도합니다. 남은 50%는 6개월 시점에 주봉 10주선 위 + RSI 50 이상이면 연장하고, 이후 10주선 2주 연속 이탈 또는 최대 12개월 도달 시 매도합니다.

| 선정 전략 | 완료 거래 | 평균 보유일 | 평균 거래수익 | 중앙값 | 승률 | 평균 QQQ | 평균 QQQ 초과 | 매도 사유 |
|---|---:|---:|---:|---:|---:|---:|---:|---|
| Leader2 One Each | 106 | 151.7 | 41.9% | 10.5% | 76.4% | 9.1% | 32.8% | half_fixed_6m: 106, half_two_week_10w_break: 45, half_trend_not_alive_at_6m: 48, half_max_12m: 13 |
| Conviction Diverse Top2 | 106 | 152.4 | 32.9% | 20.4% | 77.4% | 9.2% | 23.7% | half_fixed_6m: 106, half_two_week_10w_break: 51, half_trend_not_alive_at_6m: 48, half_max_12m: 7 |

해석: Conviction Diverse는 월별 선정력은 강했지만, 실제 50% 매도 + 주봉 연장 매도 기준에서는 평균 거래수익이 Leader2보다 낮았습니다.

## 3. 1천만원 자금 제한 계좌 검증

초기 자본 1천만원, 매수/매도 비용 0.1%, 중복 종목 원금 한도, 현금 부족 시 스킵을 반영했습니다.

| 최종 계좌 전략 | 선정 엔진 | 최종 자산 | 누적 수익률 | CAGR | MDD | 매수 | 스킵 | 최소 현금 |
|---|---|---:|---:|---:|---:|---:|---:|---:|
| Repeat + Theme Combo Cap30 | Leader2 One Each | 53,490,667 | 434.9% | 41.5% | -8.8% | 106/106 | 0 | 0 |
| Repeat + Theme Combo Cap27.5 | Leader2 One Each | 52,980,140 | 429.8% | 41.2% | -8.8% | 106/106 | 0 | 0 |
| Active Baseline: 3M Ramp | Leader2 One Each | 43,306,821 | 333.1% | 35.5% | -8.1% | 106/106 | 0 | 0 |
| Repeat + Theme Combo Cap30 | Conviction Diverse Top2 | 33,012,434 | 230.1% | 28.1% | -6.8% | 90/106 | 16 | 0 |
| Repeat + Theme Combo Cap27.5 | Conviction Diverse Top2 | 32,026,221 | 220.3% | 27.3% | -6.8% | 88/106 | 18 | 0 |
| Active Baseline: 3M Ramp | Conviction Diverse Top2 | 28,286,608 | 182.9% | 24.0% | -7.1% | 91/106 | 15 | 0 |

해석: 완성 계좌에서는 Leader2 One Each에 Repeat + Theme Combo 배분을 붙인 전략이 가장 강했습니다. Conviction Diverse는 반복 종목 집중 때문에 실제 계좌에서 매수 스킵이 늘고, 최종 누적 성과가 낮아졌습니다.

## 4. 최근 매수 후보 예시

### Leader2 One Each

| 기준월 | 매수일 | 신규 후보 | 섹터 |
|---|---|---|---|
| 2026-01-30 | 2026-02-02 | XOM, STX | Energy, Electronic Components |
| 2026-02-27 | 2026-03-02 | TPL, GNRC | Energy, Industrials |
| 2026-03-27 | 2026-03-30 | XOM, ETR | Energy, Utilities |
| 2026-04-24 | 2026-04-27 | ARM, STX | Semiconductors, Electronic Components |
| 2026-05-29 | 2026-06-01 | ARM, STX | Semiconductors, Electronic Components |
| 2026-06-26 | 2026-06-29 | DAL, KLAC | Industrials, Electronic Components |

### Conviction Diverse Top2

| 기준월 | 매수일 | 신규 후보 | 섹터 |
|---|---|---|---|
| 2026-01-30 | 2026-02-02 | FIX, ECHO | Industrials, Communication Services |
| 2026-02-27 | 2026-03-02 | FIX, NEM | Industrials, Materials |
| 2026-03-27 | 2026-03-30 | FIX, XOM | Industrials, Energy |
| 2026-04-24 | 2026-04-27 | FIX, SLB | Industrials, Energy |
| 2026-05-29 | 2026-06-01 | FIX, AMD | Industrials, Semiconductors |
| 2026-06-26 | 2026-06-29 | FIX, AMD | Industrials, Semiconductors |

## 전략별 매수/매도 방식

- Leader2 One Each: 매월 주도 섹터 상위 2개를 찾고, 각 섹터에서 1등 종목을 하나씩 삽니다.
- Conviction Diverse Top2: 전체 후보 중 기존 점수, 최근 Top20 반복, 최근 섹터 반복, AI/반도체 신호, 주요 이동평균 위치를 합산해 서로 다른 섹터 2개를 삽니다.
- Repeat + Theme Combo 배분: 매수 대상은 Leader2가 고르고, 반복 추천 또는 AI/반도체 하드웨어 성격이면 매수 금액을 키웁니다. 종목당 한도는 Cap25, Cap27.5, Cap30으로 나뉩니다.
- 공통 매도: 6개월에 50% 기본 매도, 잔여 50%는 주봉 추세가 살아 있으면 연장, 10주선 2주 이탈 또는 12개월 도달 시 정리합니다.

## 최종 판정

1. 현재까지 개발한 전략 중 성과 1등은 **Leader2 One Each + Repeat + Theme Combo Cap30**입니다.
2. 실제 운용 우선안은 **Leader2 One Each + Repeat + Theme Combo Cap27.5**입니다. 성과는 거의 비슷하면서 과집중 위험을 조금 낮춥니다.
3. Conviction Diverse Top2는 이번 검증으로 “추가 테스트 필요”가 아니라, **현재 active 전략을 대체하기에는 부족**하다는 판정입니다.
4. Conviction Diverse의 아이디어 중 반복 추천/반복 섹터/AI 하드웨어 가중은 버리지 않고, 이미 성과가 좋은 Repeat + Theme Combo 배분 전략 안에서 활용하는 편이 낫습니다.
