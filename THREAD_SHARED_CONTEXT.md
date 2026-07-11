# Thread Shared Context

Last updated: 2026-07-11

이 문서는 `investor-leader-screener` public repo 작업 스레드와 `investor-run-android` private Android repo 작업 스레드가 같은 전제를 공유하기 위한 공통 메모다. 두 스레드 중 한쪽에서 repo 구조, API 계약, 전략 키, 배포 방식, 앱 연동 방식이 바뀌면 이 문서를 먼저 업데이트하고 다른 스레드에 알려준다.

## 1. Repository Split

### Public Strategy Repo

- Repo: `sonhch15-dotcom/investor-leader-screener`
- Current known baseline: `d59f0aa Add cross-thread shared context`
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
- Current known baseline: `ff99e84 Clarify local debug APK release flow`
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

- Android version: `0.4.0`
- versionCode: `57`
- Local file: `investor-run-android/artifacts/InvestorRun-v0.4.0-debug-local.apk`
- SHA-256: `1C632B1EDF43F32C0150C57BA24B883F5CAB224D78F4E396CF335028A127B5D6`
- 기존 설치본과 동일한 local debug 인증서를 사용한다. stable release key workflow는 준비됐지만 사용자 백업/재설치/복원 전에는 전환하지 않는다.

## 4. Strategy Change Flow

전략 변경은 항상 public repo에서 먼저 처리한다.

1. public repo에서 전략 코드, 백테스트, 문서, Pages API를 수정한다.
2. `scripts/build-signal-package.mjs`로 `/api` 정적 JSON을 생성한다.
3. GitHub Pages에 배포한다.
4. Android repo는 `/api` JSON을 읽어 앱 화면, 주문 가이드, 알림에 반영한다.
5. Android 앱 내부에서 전략을 재계산하지 않는다.

실행 호환성 규칙:

- Android는 `strategyStatus = active`인 신호만 주문 가능 상태로 만든다.
- `candidate`, `testing`, `paused`, `retired` 신호는 비교/설명용이며 주문 가이드를 열지 않는다.
- 현재 날짜가 `validFrom` 이전이거나 `validUntil` 이후이면 주문 가이드를 차단한다.
- 가격과 환율은 상태뿐 아니라 기준일의 최대 허용 경과일도 확인한다.
- ETF 리밸런싱은 `현재 보유 종목 ∪ 목표 종목`으로 계산한다. 새 목표에서 빠진 기존 ETF는 목표 비중 0% 매도 대상으로 본다.
- 주식 잔여 lot의 주봉 매도는 6개월 50% 매도 이후에만 가능하며, 10주선 2주 연속 이탈 또는 RSI 50 하회가 확정된 경우만 실행 대상으로 본다.
- 전략 변경은 `앱 호환 버전 준비 -> Pages API active 전환` 순서로 진행한다.

전략 변경 시 Android 스레드에 알려야 할 항목:

- 변경된 strategyKey
- 변경된 signal JSON path
- 목표 비중 계산 방식
- 주문 가이드에서 필요한 추가 필드
- 사용자에게 보여줄 경고 문구
- 기존 앱 데이터 마이그레이션 필요 여부

## 5. Current Korea ETF Strategy Context

한국 ETF 공식 앱 전략은 `ETF-I KR ETF Benchmark Or Alpha Defensive`로 전환 완료됐다.

관련 문서:

- 10년 검증: `korea_etf_10y_validation.md`
- 5년 비교: `korea_etf_score_variant_test.md`

ETF-I 규칙 요약:

1. 매월 말 KODEX200 추세를 확인한다.
2. KODEX200이 200일선 위이고 모멘텀이 양수이면 국내 알파 ETF 후보 중 점수 1위 ETF에 100% 리밸런싱한다.
3. KODEX200이 약세이면 KODEX200을 보유하지 않고 방어 ETF 후보 중 점수 1위 ETF에 100% 리밸런싱한다.
4. 월 1회 리밸런싱한다.

현재 상태:

- active strategyKey: `kr_etf_benchmark_or_alpha_defensive`
- 현재 목표 구조: 강세 시 국내 알파 ETF 1종 100%, 약세 시 방어 ETF 1종 100%
- Android는 `api/signals/kr-etf/latest.json`의 `targetWeights`, `warnings`, `orderHint`를 실행 입력으로 사용한다.
- 연금계좌 매수 가능 여부, 최소 주문금액, 수수료와 세금은 주문 전 사용자 확인 항목으로 유지한다.

## 6. Current US Strategy Context

- 공식 active 전략: `us_leader2_repeat_theme_combo_cap27_5`
- 비교 candidate 전략: `us_leader2_score_c_cap27_5`
- C안은 앱에서 성과와 신호를 비교할 수 있지만 active 전환 전에는 주문 가이드를 열지 않는다.
- C안이 active로 승격될 때는 public repo 검증, API 계약 검증, Android 호환 버전 배포를 먼저 완료한다.

## 7. Cross-Thread Update Protocol

두 스레드는 아래 규칙을 따른다.

1. repo 구조나 역할이 바뀌면 이 문서를 먼저 업데이트한다.
2. 전략 키, API 경로, JSON schema가 바뀌면 이 문서와 `signal_package_schema.md`를 같이 확인한다.
3. Android 앱 작업 스레드는 public repo 전략 결과를 이 문서와 Pages API에서 확인한다.
4. public repo 작업 스레드는 Android 구현 세부사항을 private repo 문서에서 확인한다.
5. 서로 다른 스레드의 기억에 의존하지 않고, 이 문서를 기준점으로 삼는다.

## 8. Current Improvement Cycle

2026-07-11 아래 1~4단계를 구현하고 로컬 검증을 완료했다.

1. 주봉/ETF 회전/신호 유효성 안전성 핫픽스
2. 장부 원자성, 전체 백업, Pages 계약 검증, APK 서명 연속성
3. 주문 실행 세션, 기존 보유 초기 등록, 계좌 전체 대조
4. 저장소와 UI 상태 경계 분리, Room 전환 준비, 화면 단위 Compose 전환

검증 상태:

- Pages signal verifier: 7 signals, 7 trends, 24 quotes 통과
- Android JUnit: 17 tests, failures 0, errors 0
- Android lint: 0 errors
- debug/release APK 빌드 성공

다음 구조 단계:

- public Pages 배포 후 private repo asset sync CI를 순서대로 실행
- `LedgerPersistence`의 Room 구현과 migration/rollback 계측 테스트
- 검증된 화면 단위 Compose 전환과 스크린샷 회귀 테스트

## 9. Quick Links

- Public Pages API: `https://sonhch15-dotcom.github.io/investor-leader-screener/api`
- Latest KR ETF signal: `https://sonhch15-dotcom.github.io/investor-leader-screener/api/signals/kr-etf/latest.json`
- 10Y Korea ETF validation: `https://sonhch15-dotcom.github.io/investor-leader-screener/korea_etf_10y_validation.md`
- 5Y Korea ETF comparison: `https://sonhch15-dotcom.github.io/investor-leader-screener/korea_etf_score_variant_test.md`

## 10. 2026-07-11 미국 Score A·C 교정 검증

- 검증 Run ID: `us-score-a-c-corrected-frozen-20260711`
- Score A는 계속 `active`이다.
- Score C는 `candidate`이며 세부 단계는 `validated_candidate`이다.
- Android 앱은 계속 `active` 신호만 실제 주문 가이드로 사용해야 한다.
- Score C 신호를 앱에서 보여줄 경우 주문 지시가 아닌 shadow/testing 비교 정보로만 표시한다.
- 미국 공식 운용 종목 수는 월 2개를 유지한다.
- 한국 주식 Leader2 월 2개, 한국 ETF ETF-I 1개 전략은 변경하지 않았다.
- 교정 계좌 결과: Score A +416.1%, Score C +520.0%, QQQ +96.4%.
- 시장가 MDD: Score A -19.8%, Score C -20.4%.
- Score C는 연도별 5개 신호 구간에서 모두 A보다 높은 수익률을 기록했다.
- 공식 승격 보류 사유는 시점별 과거 유니버스와 완전한 전진 관찰 구간이 아직 없기 때문이다.
- API/문서 기준 파일: `data/score-a-c-corrected-validation.json`, `score_a_c_corrected_validation.md`, `backtest_reproducibility_whitepaper.md`.
