# Signal Package Schema

작성일: 2026-07-09

이 문서는 개인용 Android 투자 운용 앱이 GitHub Pages에서 받아올 정적 JSON 신호 패키지 규격이다. 목적은 별도 서버를 두지 않고도 GitHub Actions가 정해진 시간에 종목 선정, 주봉 상태, ETF 리밸런싱 신호를 계산해 앱에 전달하게 하는 것이다.

## 1. 기본 원칙

- 모든 앱 입력 데이터는 정적 JSON 파일로 제공한다.
- 앱은 먼저 `manifest.json`을 읽고, 필요한 최신 파일만 내려받는다.
- 개인 계좌, 보유 수량, 체결가, 예수금, 메모는 JSON 패키지에 포함하지 않는다.
- 날짜는 `YYYY-MM-DD`, 시각은 UTC ISO-8601 문자열을 사용한다.
- 수익률과 비중은 앱 계산 안정성을 위해 퍼센트가 아니라 소수로 제공한다.
- 추천은 자동 주문이 아니라 주문 판단 보조 신호다.
- 데이터 실패나 지연은 숨기지 않고 명시적인 상태로 앱에 전달한다.

## 2. 파일 구조

```text
/api/manifest.json
/api/signals/latest.json
/api/signals/2026-07.json
/api/signals/us/latest.json
/api/signals/kr-stock/latest.json
/api/signals/kr-etf/latest.json
/api/weekly-trends/latest.json
/api/prices/latest.json
/api/fx/latest.json
/api/backtests/summary.json
/api/strategies/catalog.json
```

앱은 `manifest.json`의 버전과 파일 해시를 보고 캐시 갱신 여부를 판단한다.

## 3. 공통 타입

```text
Market = US_STOCK | KR_STOCK | KR_ETF
DataStatus = normal | delayed | needs_review | failed
StrategyStatus = active | candidate | paused | testing | retired
ActionType = buy | sell | rebalance | watch | record_missing
TrendState = alive | weakening | broken | needs_review
```

## 4. manifest.json

```json
{
  "schemaVersion": "1.1.0",
  "packageVersion": "2026-07-09T00:30:00Z",
  "generatedAt": "2026-07-09T00:30:00Z",
  "baseUrl": "https://example.github.io/investor-api/api",
  "status": "normal",
  "files": [
    {
      "path": "/signals/latest.json",
      "version": "2026-07",
      "sha256": "replace-with-file-hash",
      "updatedAt": "2026-07-09T00:30:00Z",
      "status": "normal"
    },
    {
      "path": "/weekly-trends/latest.json",
      "version": "2026-W28",
      "sha256": "replace-with-file-hash",
      "updatedAt": "2026-07-09T00:25:00Z",
      "status": "normal"
    }
  ],
  "markets": [
    "US_STOCK",
    "KR_STOCK",
    "KR_ETF"
  ],
  "nextExpectedRunAt": "2026-07-10T00:30:00Z"
}
```

앱 처리 규칙:

- `schemaVersion`의 major 버전이 앱 지원 범위를 벗어나면 데이터 갱신을 중단한다.
- `status`가 `failed`이면 주문 가이드를 비활성화한다.
- `sha256`이 기존 캐시와 같으면 파일을 다시 파싱하지 않는다.

## 5. signals/latest.json

전체 시장의 최신 실행 신호를 한 번에 내려받는 파일이다.

```json
{
  "schemaVersion": "1.1.0",
  "signalMonth": "2026-07",
  "generatedAt": "2026-07-09T00:30:00Z",
  "asOf": "2026-07-08",
  "status": "normal",
  "signals": [
    {
      "signalId": "US-2026-07-NVDA-Leader2-01",
      "market": "US_STOCK",
      "strategyKey": "us_leader2_repeat_theme_combo_cap27_5",
      "scoreFormulaVersion": "score_a_sector20_v1",
      "sectorMapVersion": "universe_sector_snapshot_v1",
      "universeHash": "sha256-of-data-universe-json",
      "backtestRunId": "official-cap27.5-baseline",
      "dataAsOf": "2026-07-08",
      "strategyStatus": "active",
      "actionType": "buy",
      "symbol": "NVDA",
      "name": "NVIDIA Corp.",
      "currency": "USD",
      "rank": 1,
      "score": 92.4,
      "targetWeight": null,
      "referencePrice": 151.20,
      "referenceDate": "2026-07-08",
      "validFrom": "2026-07-09",
      "validUntil": "2026-07-31",
      "reasons": [
        "Leader2 monthly rank 1",
        "Repeat theme confirmation",
        "Momentum above strategy threshold"
      ],
      "warnings": [],
      "orderHint": {
        "budgetPolicy": "monthly_available_cash_split",
        "minCashReserveRatio": 0.05,
        "rounding": "floor_to_whole_share"
      }
    }
  ],
  "excludedCandidates": [
    {
      "market": "US_STOCK",
      "symbol": "AAPL",
      "name": "Apple Inc.",
      "reason": "Already held by active lot"
    }
  ]
}
```

전략 메타데이터 처리 규칙:

- `strategyKey`는 앱의 전략 선택과 lot 매칭 기준이므로 산식이 바뀌면 새 키를 쓴다.
- `scoreFormulaVersion`은 개별 종목 점수 산식 버전이다. 예: `score_a_sector20_v1`, `score_c_half_sector10_normalized_v1`.
- `sectorMapVersion`과 `universeHash`는 유니버스/섹터 스냅샷 재현성 검증에 사용한다.
- `backtestRunId`는 해당 신호가 근거로 삼은 공식 검증 run 또는 문서 ID다.
- `strategyStatus`는 `active`, `candidate`, `testing`, `paused`, `retired` 중 하나다.
- Android 앱은 종목 선정은 다시 계산하지 않고, 이 메타데이터를 표시/기록해 전략 변경과 입력 데이터 변경을 구분한다.

실행 게이트:

- `strategyStatus = active`인 신호만 주문 가능하다.
- `candidate`, `testing`, `paused`, `retired` 신호는 비교/설명 전용이다.
- 현재 날짜가 `validFrom..validUntil` 범위를 벗어나면 주문 가이드를 차단한다.
- 정상 상태라도 가격/환율 기준일이 앱의 최대 허용 경과일을 넘으면 주문 가이드를 차단한다.

## 6. 미국 주식 신호

```json
{
  "schemaVersion": "1.1.0",
  "market": "US_STOCK",
  "strategyKey": "us_leader2_repeat_theme_combo_cap27_5",
  "generatedAt": "2026-07-09T00:30:00Z",
  "asOf": "2026-07-08",
  "status": "normal",
  "currentBuys": [
    {
      "signalId": "US-2026-07-NVDA-Leader2-01",
      "symbol": "NVDA",
      "name": "NVIDIA Corp.",
      "rank": 1,
      "score": 92.4,
      "close": 151.20,
      "currency": "USD",
      "lastDate": "2026-07-08",
      "reasons": [
        "Leader2 monthly rank 1",
        "Theme repeat score passed"
      ],
      "metrics": {
        "sixMonthReturn": 0.412,
        "twelveMonthReturn": 0.786,
        "volatility": 0.318
      }
    }
  ],
  "rules": {
    "buyCadence": "monthly",
    "firstSellAfterMonths": 6,
    "firstSellRatio": 0.5,
    "remainingLotRule": "sell_on_weekly_break_or_12_months"
  }
}
```

앱 계산:

- 월간 매수 예산은 사용자가 앱에 입력한 현금과 설정값으로 계산한다.
- 이미 보유 중인 활성 lot과 중복되는 추천은 앱에서 경고한다.
- 6개월/12개월 날짜는 앱의 lot 기록 기준으로 다시 계산한다.
- 주봉 매도는 6개월 50% 매도 이후 잔여 lot에만 적용한다.
- 잔여 lot은 10주선 2주 연속 이탈 또는 RSI 50 하회가 확정된 경우에만 최종 매도 검토 대상으로 만든다.

## 7. 한국 주식 신호

```json
{
  "schemaVersion": "1.0.0",
  "market": "KR_STOCK",
  "strategyKey": "kr_stock_leader2",
  "generatedAt": "2026-07-09T00:30:00Z",
  "asOf": "2026-07-08",
  "status": "normal",
  "currentBuys": [
    {
      "signalId": "KRSTOCK-2026-07-000660-01",
      "symbol": "000660.KS",
      "name": "SK하이닉스",
      "rank": 1,
      "score": 88.7,
      "close": 270000,
      "currency": "KRW",
      "lastDate": "2026-07-08",
      "reasons": [
        "KR Stock Leader2 rank 1",
        "Relative momentum passed"
      ],
      "metrics": {
        "threeMonthReturn": 0.184,
        "sixMonthReturn": 0.392,
        "relativeStrength": 0.91
      }
    }
  ],
  "rules": {
    "buyCadence": "monthly",
    "positionCount": 2,
    "firstSellAfterMonths": 6,
    "firstSellRatio": 0.5,
    "remainingLotRule": "sell_on_weekly_break_or_12_months"
  }
}
```

## 8. 한국 ETF 신호

```json
{
  "schemaVersion": "1.0.0",
  "market": "KR_ETF",
  "strategyKey": "kr_etf_core_satellite_50_40_10",
  "generatedAt": "2026-07-09T00:30:00Z",
  "asOf": "2026-07-08",
  "status": "normal",
  "targetWeights": [
    {
      "symbol": "069500.KS",
      "name": "KODEX 200",
      "role": "core",
      "targetWeight": 0.50,
      "referencePrice": 48320,
      "currency": "KRW"
    },
    {
      "symbol": "102110.KS",
      "name": "TIGER 200",
      "role": "satellite",
      "targetWeight": 0.40,
      "referencePrice": 48290,
      "currency": "KRW"
    },
    {
      "symbol": "153130.KS",
      "name": "KODEX 단기채권",
      "role": "defense",
      "targetWeight": 0.10,
      "referencePrice": 108450,
      "currency": "KRW"
    }
  ],
  "rebalancePolicy": {
    "cadence": "monthly",
    "driftThreshold": 0.05,
    "minTradeAmount": 50000,
    "rounding": "floor_to_whole_share"
  }
}
```

앱 계산:

- 현재 ETF 평가금액은 사용자의 보유 수량과 최신 기준가로 계산한다.
- 목표 비중과 현재 비중의 차이가 `driftThreshold`를 넘으면 리밸런싱 ActionCard를 만든다.
- 최소 주문 금액 미만이면 알림은 만들되 주문 가이드는 "보류 가능" 상태로 표시한다.
- 리밸런싱 계산 대상은 `현재 보유 ETF ∪ targetWeights`다.
- 현재 보유 중이지만 새 `targetWeights`에 없는 ETF는 목표 비중 0%로 계산해 매도 가이드를 만든다.

## 9. weekly-trends/latest.json

주봉 훼손 포착을 위한 파일이다. 앱은 이 파일과 사용자 lot을 결합해 매도 알림을 만든다.

```json
{
  "schemaVersion": "1.0.0",
  "generatedAt": "2026-07-09T00:25:00Z",
  "asOfWeek": "2026-W28",
  "status": "normal",
  "trends": [
    {
      "market": "US_STOCK",
      "symbol": "NVDA",
      "name": "NVIDIA Corp.",
      "currency": "USD",
      "weekEndDate": "2026-07-10",
      "close": 151.20,
      "weeklyTrendLine": 143.80,
      "trendState": "alive",
      "breakDate": null,
      "confirmationRequired": false,
      "exitConfirmed": false,
      "metrics": {
        "distanceToTrendLine": 0.051,
        "weeklyReturn": 0.024,
        "drawdownFromHigh": -0.072
      }
    },
    {
      "market": "KR_STOCK",
      "symbol": "000660.KS",
      "name": "SK하이닉스",
      "currency": "KRW",
      "weekEndDate": "2026-07-10",
      "close": 270000,
      "weeklyTrendLine": 276000,
      "trendState": "broken",
      "breakDate": "2026-07-10",
      "confirmationRequired": false,
      "exitConfirmed": true,
      "metrics": {
        "distanceToTrendLine": -0.022,
        "weeklyReturn": -0.041,
        "drawdownFromHigh": -0.118
      }
    }
  ]
}
```

앱 처리 규칙:

- `trendState = alive`: 보유 유지.
- `trendState = weakening`: `운용` 화면에서 감시 배지를 표시한다.
- `trendState = broken`: 6개월 이후 잔여 lot이 있으면 매도 ActionCard를 만든다.
- `exitConfirmed = true`: 10주선 2주 연속 이탈 또는 RSI 50 하회가 확정됐다.
- `confirmationRequired = true`: 첫 이탈 등 추가 주봉 확인이 필요하며 매도 주문 가이드는 열지 않는다.
- `needs_review`: 데이터 이상 가능성이 있으므로 주문 가이드를 비활성화한다.

## 10. prices/latest.json

자동 자산 평가에 쓰는 최신 주가 파일이다. 앱은 보유 종목 평가 시 `signals`의 기준가보다 이 파일의 quote를 먼저 사용한다.

```json
{
  "schemaVersion": "1.0.0",
  "generatedAt": "2026-07-09T00:20:00Z",
  "asOf": "2026-07-08",
  "status": "normal",
  "quotes": [
    {
      "symbol": "TECH",
      "name": "Bio-Techne",
      "market": "US_STOCK",
      "currency": "USD",
      "price": 70.92,
      "priceDate": "2026-07-08",
      "source": "yahoo",
      "status": "normal"
    },
    {
      "symbol": "000660.KS",
      "name": "SK하이닉스",
      "market": "KR_STOCK",
      "currency": "KRW",
      "price": 2076000,
      "priceDate": "2026-07-08",
      "source": "yahoo",
      "status": "normal"
    }
  ]
}
```

앱 처리:

- 보유 종목 평가에는 `prices/latest.json`의 `price`를 우선 사용한다.
- quote가 없으면 `signals`, `targetWeights`, `weekly-trends` 순서로 fallback한다.
- `status = delayed`이면 자산 화면에 가격 지연 배지를 표시한다.
- `status = failed`인 quote는 평가액 계산에서 0으로 두지 않고 마지막 앱 캐시 또는 주문 기록 평균가 fallback을 검토한다.

## 11. fx/latest.json

```json
{
  "schemaVersion": "1.0.0",
  "generatedAt": "2026-07-09T00:20:00Z",
  "asOf": "2026-07-08",
  "status": "normal",
  "baseCurrency": "KRW",
  "rates": [
    {
      "currency": "USD",
      "rate": 1378.50,
      "source": "configured-data-provider"
    }
  ]
}
```

앱 처리:

- 미국 주식 원화 평가액 계산에 사용한다.
- 환율 데이터가 `delayed`이면 자산 화면에 환율 지연 배지를 표시한다.
- 사용자가 수동 환율을 입력하면 앱 내부 값이 우선한다.

## 12. strategies/catalog.json

```json
{
  "schemaVersion": "1.0.0",
  "generatedAt": "2026-07-09T00:30:00Z",
  "strategies": [
    {
      "strategyKey": "us_leader2_repeat_theme_combo_cap27_5",
      "name": "US Leader2 + Repeat Theme Combo Cap27.5",
      "market": "US_STOCK",
      "status": "active",
      "scoreFormulaVersion": "score_a_sector20_v1",
      "sectorMapVersion": "universe_sector_snapshot_v1",
      "universeHash": "sha256-of-data-universe-json",
      "backtestRunId": "official-cap27.5-baseline",
      "dataAsOf": "2026-07-08",
      "description": "미국 주식 월간 Leader2 기반 공식 전략",
      "riskNotice": "과거 검증 결과는 미래 수익을 보장하지 않습니다."
    },
    {
      "strategyKey": "us_leader2_score_c_cap27_5",
      "name": "US Leader2 Score C Half Sector10 Cap27.5",
      "market": "US_STOCK",
      "status": "candidate",
      "scoreFormulaVersion": "score_c_half_sector10_normalized_v1",
      "sectorMapVersion": "universe_sector_snapshot_v1",
      "universeHash": "sha256-of-data-universe-json",
      "backtestRunId": "score_variant_final_validation_2026-07-10",
      "dataAsOf": "2026-07-08",
      "description": "섹터/테마 점수 비중을 절반으로 낮춘 후보 전략. Cap27.5 운용 규칙은 기존과 동일",
      "riskNotice": "candidate 전략이므로 공식 교체 전 기존 active 전략과 비교해야 합니다."
    },
    {
      "strategyKey": "kr_stock_leader2",
      "name": "KR Stock Leader2",
      "market": "KR_STOCK",
      "status": "active",
      "description": "한국 우량주 Leader2 기반 공식 전략",
      "riskNotice": "한국 주식 가격 제한폭과 거래정지 리스크를 확인해야 합니다."
    },
    {
      "strategyKey": "kr_etf_core_satellite_50_40_10",
      "name": "KR ETF Core Satellite 50/40/10",
      "market": "KR_ETF",
      "status": "active",
      "description": "한국 ETF 코어/위성/방어 비중 전략",
      "riskNotice": "리밸런싱 비용과 세금을 확인해야 합니다."
    }
  ]
}
```

## 13. backtests/summary.json

앱의 첫 화면에는 직접 노출하지 않고, 전략 근거 화면에서만 사용한다.

```json
{
  "schemaVersion": "1.1.0",
  "generatedAt": "2026-07-09T00:30:00Z",
  "summaries": [
    {
      "strategyKey": "us_leader2_repeat_theme_combo_cap27_5",
      "period": "2016-01..2026-07",
      "totalReturn": 4.298,
      "maxDrawdown": -0.088,
      "tradeCount": 128,
      "sourceFile": "data/strategy-dashboard.json"
    },
    {
      "strategyKey": "kr_stock_leader2",
      "period": "2016-01..2026-07",
      "totalReturn": null,
      "maxDrawdown": null,
      "tradeCount": null,
      "sourceFile": "data/korea-strategy-dashboard.json"
    }
  ]
}
```

## 14. 앱 내부 계산

정적 JSON이 제공하지 않고 앱이 직접 계산해야 하는 항목:

- 사용자별 매수 가능 금액
- 계좌별 현금 잔액
- 보유 수량과 평균 단가
- lot별 6개월/12개월 도달 여부
- 주봉 훼손 신호와 lot 규칙 결합 여부
- ETF 현재 비중과 목표 비중 차이
- 실현 손익, 미실현 손익, 총자산 곡선
- 알림 완료, 연기, 무시 상태

## 15. 데이터 실패 정책

| 상태 | 앱 동작 |
|---|---|
| `normal` | 신호 표시, 주문 가이드 활성화 |
| `delayed` | 신호 표시, 지연 배너와 주의 문구 표시 |
| `needs_review` | 신호 표시 가능, 주문 가이드 비활성화 |
| `failed` | 신규 신호 숨김, 이전 캐시 사용 여부 선택 |

## 16. 캐싱과 버전 관리

- 앱은 마지막 정상 패키지를 Room 또는 파일 캐시에 저장한다.
- 새 패키지가 실패하면 마지막 정상 패키지를 읽되 `데이터 지연` 상태를 표시한다.
- `schemaVersion`은 semantic versioning을 따른다.
- `packageVersion`은 생성 시각 기반으로 둔다.
- 과거 월간 신호는 `/signals/YYYY-MM.json`으로 보관한다.

## 17. GitHub Pages 배치 예시

```text
dist/
  api/
    manifest.json
    signals/
      latest.json
      2026-07.json
      us/
        latest.json
      kr-stock/
        latest.json
      kr-etf/
        latest.json
    weekly-trends/
      latest.json
    prices/
      latest.json
    fx/
      latest.json
    backtests/
      summary.json
    strategies/
      catalog.json
```

GitHub Actions는 정해진 시간에 데이터 생성 스크립트를 실행하고, 결과물을 `dist/api`에 저장한 뒤 GitHub Pages로 배포한다. Android 앱은 Pages URL만 알면 최신 신호를 가져올 수 있다.

## 18. 완료 기준

- Android 앱이 `manifest.json` 하나만 보고 최신 파일을 찾을 수 있다.
- 미국 주식, 한국 주식, 한국 ETF 신호가 같은 공통 타입으로 파싱된다.
- 주봉 훼손 데이터가 사용자 lot과 결합되어 매도 알림을 만들 수 있다.
- 데이터 지연과 실패가 앱 화면과 알림 정책에 반영된다.
- 개인 계좌 정보가 정적 JSON 패키지에 포함되지 않는다.

## 19. ETF 전략 교체 규칙

한국 ETF 공식 앱 신호는 `scripts/build-signal-package.mjs`의 `KR_ETF_ACTIVE_STRATEGY_KEY`가 단일 출처다.

현재 값:

```text
KR_ETF_ACTIVE_STRATEGY_KEY = kr_etf_benchmark_or_alpha_defensive
```

ETF-I 신호 생성 규칙:

- 5년 현재 비교 결과: `data/korea-etf-score-variant-test.json`
- 10년 검증 근거: `data/korea-etf-10y-validation.json`
- Android API 파일:
  - `/signals/kr-etf/latest.json`
  - `/signals/latest.json`
  - `/strategies/catalog.json`
  - `/backtests/summary.json`

필수 메타데이터:

- `strategyKey`
- `scoreFormulaVersion`
- `sectorMapVersion`
- `universeHash`
- `backtestRunId`
- `dataAsOf`
- `strategyStatus`
- `validation.fiveYear`
- `validation.tenYear`

Android 앱은 ETF 종목 선정 자체를 수행하지 않는다. 앱은 `targetWeights`를 읽고 사용자 연금 계좌의 현재 보유 비중과 비교해 주문 가이드, 리밸런싱 필요 여부, 100% 집중 경고, 연금계좌 거래 가능성 확인 안내를 만든다.
