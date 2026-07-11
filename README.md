# Investor Leader Screener

미국 주식, 한국 주식, 한국 ETF 전략 신호를 생성하고 GitHub Pages API와 웹 대시보드로 배포하는 public repository입니다.

Android 앱 코드는 별도 private repository에서 관리합니다.

- Android app repo: `sonhch15-dotcom/investor-run-android`
- Pages/API URL: `https://sonhch15-dotcom.github.io/investor-leader-screener/api`

## 현재 구현 범위

- 나스닥100/S&P500 목록 자동 수집 시도
- 실패 시 `config/universe.json`의 시드 종목 사용
- 주요 시장/섹터/테마/레버리지 ETF 포함
- Yahoo Finance 무료 차트 데이터 사용
- 상대강도, 가격 모멘텀, 섹터/테마, 거래량/수급 점수 계산
- 시장 상태 점수 계산
- 매수 가능/감시/제외 분류
- 웹 대시보드 표시
- Android 앱이 읽는 정적 signal package 생성

## 실행

Codex 번들 Node 경로를 쓰는 경우:

```powershell
& "C:\Users\SweetHome\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe" src/refresh.mjs --sample
& "C:\Users\SweetHome\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe" src/server.mjs
```

일반 Node가 PATH에 있으면:

```powershell
npm run refresh:sample
npm run serve
```

대시보드:

```text
http://localhost:4173
```

## 실데이터 실행

인터넷 연결이 가능한 환경에서:

```powershell
npm run refresh
```

실데이터는 Yahoo Finance 무료 데이터를 사용하므로, 일시적인 차단이나 누락이 발생할 수 있습니다.

## Android Signal API

Android 앱은 이 repo의 GitHub Pages API를 읽습니다. 앱 코드는 private repo에 있지만, 전략 신호와 가격/환율 패키지는 public Pages에서 계속 제공합니다.

로컬에서 API 패키지만 생성:

```powershell
npm run build:signals
```

주요 API 경로:

```text
https://sonhch15-dotcom.github.io/investor-leader-screener/api/manifest.json
https://sonhch15-dotcom.github.io/investor-leader-screener/api/signals/latest.json
https://sonhch15-dotcom.github.io/investor-leader-screener/api/signals/us/latest.json
https://sonhch15-dotcom.github.io/investor-leader-screener/api/signals/kr-stock/latest.json
https://sonhch15-dotcom.github.io/investor-leader-screener/api/signals/kr-etf/latest.json
```

API 계약 문서:

- `signal_package_schema.md`

## 산출 파일

- `data/universe.json`: 이번 실행에서 사용한 종목 유니버스
- `data/screener-results.json`: 점수 계산 결과와 대시보드 데이터
- `data/score-c-live.json`: 마지막 완료 월간 금요일 기준 Score C Leader2 선택과 재현 메타데이터
- `data/backtest-results.json`: 과거 기준일 종목 선정력 검증 결과
- `data/monthly-selection-test.json`: 최근 3년 월간 반복 선정력 검증 결과
- `backtest_report.md`: 백테스트 요약 리포트
- `monthly_selection_report.md`: 월간 반복 선정력 검증 요약 리포트
- `monthly_selection_test_plan.md`: 월간 반복 선정력 검증 설계와 개발 단계
- `stock_selection_system.md`: 투자 기준 문서

## 1년 전 기준 검증

현재 기준을 과거 특정 날짜에 적용했을 때의 결과를 확인할 수 있습니다.

예시:

```powershell
npm run backtest -- --top 10
```

특정 날짜를 지정하려면:

```powershell
node src/backtest.mjs --as-of 2025-07-06 --top 10
```

현재 백테스트는 전체 매매 전략 검증이 아니라, 과거 시점에서 상위 후보를 골랐을 때 이후 수익률이 어땠는지 확인하는 `종목 선정력 검증`입니다.

## GitHub Pages 배포

이 프로젝트는 GitHub Actions로 정적 Pages 사이트를 만들 수 있습니다.

빌드 구조:

```text
dashboard/ + data/
→ dist/
→ GitHub Pages artifact
```

Pages workflow는 다음 순서로 실행됩니다.

```text
src/refresh.mjs
→ src/strategy-dashboard-data.mjs
→ src/korea-strategy-test.mjs
→ scripts/build-pages.mjs
→ scripts/build-signal-package.mjs
→ dist/
```

로컬에서 Pages용 파일만 만들려면:

```powershell
npm run build:pages
```

GitHub에서 Pages를 보려면 repository의 Settings → Pages에서 Source를 `GitHub Actions`로 설정합니다.

배포 주소 예시:

```text
https://sonhch15-dotcom.github.io/investor-leader-screener/
```
