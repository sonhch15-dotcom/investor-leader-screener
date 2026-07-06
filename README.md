# Investor Leader Screener

미국 주식/ETF 주도주 후보를 자동으로 점수화하고 웹 대시보드에서 확인하는 첫 버전입니다.

## 현재 구현 범위

- 나스닥100/S&P500 목록 자동 수집 시도
- 실패 시 `config/universe.json`의 시드 종목 사용
- 주요 시장/섹터/테마/레버리지 ETF 포함
- Yahoo Finance 무료 차트 데이터 사용
- 상대강도, 가격 모멘텀, 섹터/테마, 거래량/수급 점수 계산
- 시장 상태 점수 계산
- 매수 가능/감시/제외 분류
- 웹 대시보드 표시

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

## 산출 파일

- `data/universe.json`: 이번 실행에서 사용한 종목 유니버스
- `data/screener-results.json`: 점수 계산 결과와 대시보드 데이터
- `stock_selection_system.md`: 투자 기준 문서
