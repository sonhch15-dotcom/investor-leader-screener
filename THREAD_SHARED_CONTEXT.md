# Thread Shared Context

Last updated: 2026-07-10

이 문서는 `investor-leader-screener` public repo 작업 스레드와 `investor-run-android` private Android repo 작업 스레드가 같은 전제를 공유하기 위한 공통 메모다. 두 스레드 중 한쪽에서 repo 구조, API 계약, 전략 키, 배포 방식, 앱 연동 방식이 바뀌면 이 문서를 먼저 업데이트하고 다른 스레드에 알려준다.

## 1. Repository Split

### Public Strategy Repo

- Repo: `sonhch15-dotcom/investor-leader-screener`
- Current known commit: `d5d3166 Separate Android app into private repo`
- Role:
  - 전략 검증
  - 백테스트
  - 종목 선정
  - GitHub Pages API 생성
  - 웹 대시보드 운영
- Android 앱 소스, Gradle 파일, APK, 앱 전용 문서는 public repo에서 제거되었다.
- 앞으로 public repo에서는 Android 앱 코드를 수정하지 않는다.

### Private Android Repo

- Repo: `sonhch15-dotcom/investor-run-android`
- Current known commit: `ff99e84 Clarify local debug APK release flow`
- Role:
  - Android 앱 코드
  - 앱 전용 문서
  - APK 빌드/Release 관리
  - 앱 UI, 알림, 계좌/보유/현금 기반 주문 가이드
- Android 관련 작업은 이 repo에서 진행한다.

## 2. API Boundary

Android 앱은 종목을 직접 선정하지 않는다.

전략, 종목 선정, ETF 목표 비중, 백테스트 결과, 신호 생성은 public repo에서 처리한다. Android 앱은 public GitHub Pages API의 정적 JSON을 받아 사용자별 계좌 상태에 맞게 해석한다.

- API base URL: `https://sonhch15-dotcom.github.io/investor-leader-screener/api`
- Signal package script: `scripts/build-signal-package.mjs`
- API contract document: `signal_package_schema.md`

앱에서 처리할 것:

- 사용자 계좌, 보유 종목, 현금, 입금/출금
- 현재 보유 비중과 API 목표 비중 비교
- 매수/매도 주문 금액 계산
- 알림 생성
- 수수료, 세금, 최소 주문금액, 주문 가능 여부 검증

앱에서 처리하지 않을 것:

- 전략 점수 계산
- 신규 종목 선정
- ETF 리밸런싱 목표 비중 산출
- 백테스트 수행

## 3. Android APK Release Rule

APK는 git에 커밋하지 않는다. APK는 GitHub Release asset으로 관리한다.

중요한 서명 규칙:

- GitHub Actions가 만든 APK는 기존 폰 앱과 서명이 달라 업데이트 설치가 실패할 수 있다.
- 기존 설치 앱 업데이트용 APK는 로컬 PC debug keystore로 빌드한 `*-debug-local.apk`를 Release asset으로 올려야 한다.
- CI APK는 검증용 artifact로만 사용한다.

현재 알려진 설치용 APK:

- Android version: `0.3.44`
- versionCode: `56`
- Release: `v0.3.44`
- File: `InvestorRun-v0.3.44-debug-local.apk`

## 4. Strategy Change Flow

전략 변경은 항상 public repo에서 먼저 처리한다.

1. public repo에서 전략 코드, 백테스트, 문서, Pages API를 수정한다.
2. `scripts/build-signal-package.mjs`로 `/api` 정적 JSON을 생성한다.
3. GitHub Pages에 배포한다.
4. Android repo는 `/api` JSON을 읽어 앱 화면, 주문 가이드, 알림에 반영한다.
5. Android 앱 내부에서 전략을 재계산하지 않는다.

전략 변경 시 Android 스레드에 알려야 할 항목:

- 변경된 strategyKey
- 변경된 signal JSON path
- 목표 비중 계산 방식
- 주문 가이드에서 필요한 추가 필드
- 사용자에게 보여줄 경고 문구
- 기존 앱 데이터 마이그레이션 필요 여부

## 5. Current Korea ETF Strategy Context

최근 한국 ETF 전략 검증에서 `ETF-I KR ETF Benchmark Or Alpha Defensive`가 MDD 개선 후보로 가장 우수했다.

관련 문서:

- 10년 검증: `korea_etf_10y_validation.md`
- 5년 비교: `korea_etf_score_variant_test.md`

ETF-I 규칙 요약:

1. 매월 말 KODEX200 추세를 확인한다.
2. KODEX200이 200일선 위이고 모멘텀이 양수이면 국내 알파 ETF 후보 중 점수 1위 ETF에 100% 리밸런싱한다.
3. KODEX200이 약세이면 KODEX200을 보유하지 않고 방어 ETF 후보 중 점수 1위 ETF에 100% 리밸런싱한다.
4. 월 1회 리밸런싱한다.

주의:

- 아직 Android API active strategyKey가 ETF-I로 완전히 전환되었는지 확인해야 한다.
- Android 앱 적용 전 `api/signals/kr-etf/latest.json`의 `strategyKey`, `targetWeights`, `warnings`, `orderHint`를 확인한다.

## 6. Cross-Thread Update Protocol

두 스레드는 아래 규칙을 따른다.

1. repo 구조나 역할이 바뀌면 이 문서를 먼저 업데이트한다.
2. 전략 키, API 경로, JSON schema가 바뀌면 이 문서와 `signal_package_schema.md`를 같이 확인한다.
3. Android 앱 작업 스레드는 public repo 전략 결과를 이 문서와 Pages API에서 확인한다.
4. public repo 작업 스레드는 Android 구현 세부사항을 private repo 문서에서 확인한다.
5. 서로 다른 스레드의 기억에 의존하지 않고, 이 문서를 기준점으로 삼는다.

## 7. Quick Links

- Public Pages API: `https://sonhch15-dotcom.github.io/investor-leader-screener/api`
- Latest KR ETF signal: `https://sonhch15-dotcom.github.io/investor-leader-screener/api/signals/kr-etf/latest.json`
- 10Y Korea ETF validation: `https://sonhch15-dotcom.github.io/investor-leader-screener/korea_etf_10y_validation.md`
- 5Y Korea ETF comparison: `https://sonhch15-dotcom.github.io/investor-leader-screener/korea_etf_score_variant_test.md`
