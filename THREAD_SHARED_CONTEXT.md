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
- 6개월에는 항상 원 lot의 50%를 매도한다. 같은 시점의 주봉 종가가 10주선 이상이고 RSI14가 50 이상일 때만 나머지 50%를 연장한다.
- 연장된 잔여 lot은 10주선 2주 연속 하회 또는 12개월 도달 때 매도한다. 연장 중 RSI14 50 미만 단독은 최종 매도 조건이 아니다.
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
- 교정 검증 run `us-score-a-c-corrected-frozen-20260711`에서 C가 7/7 게이트와 5개 연도별 코호트를 통과해, 다음 미확정 월인 2026-08 신규 신호부터 controlled active로 승격하는 것이 권고됐다.
- 2026-07 A 신호는 월간 고정 원칙에 따라 바꾸지 않는다.
- 기존 A lot은 C로 재분류하지 않으며 원래 `strategyKey`와 매수일을 보존해 청산한다. A의 신규 매수만 중단하고 shadow/testing control로 남긴다.
- C안이 active로 승격될 때는 public API 청산 계약 보정과 Android 호환 버전 검증을 먼저 완료한다. 현재 API의 C는 candidate이므로 주문 가이드를 열지 않는다.

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
- 교정 검증 결과의 권고는 2026-08 신규 신호부터 controlled active 승격이다. 단, 주봉/6개월 청산 계약 보정과 Android 호환 확인 전에는 API active 전환을 보류한다.
- API/문서 기준 파일: `data/score-a-c-corrected-validation.json`, `score_a_c_corrected_validation.md`, `backtest_reproducibility_whitepaper.md`.

## 11. 완료 P0: 6개월 연장과 잔여 청산 계약 분리

적용 계약:

- public API는 `sixMonthExtensionEligible`과 `postExtensionExitConfirmed`를 별도 필드로 제공한다.
- 6개월 연장은 주봉 종가가 10주선 이상이고 RSI14가 50 이상인 경우에만 허용한다. 자격이 없으면 6개월에 전량 정리한다.
- 연장된 잔여 lot은 10주선 2주 연속 하회 또는 12개월 도달 때 정리한다. 연장 중 RSI14 50 미만 단독 청산은 금지한다.
- 판단 지표가 없거나 오래되어 당시 결정을 재현할 수 없으면 자동 매도 주문을 만들지 않고 `검토 필요`로 닫는다.
- manifest capability `six_month_extension_v1`과 `minAppVersionCode 58`로 이전 앱의 보정 신호 사용을 차단한다.

Android 적용:

- `WeeklyTrend`가 RSI14, 연속 하회 주수, 종료 사유와 두 명시적 결정 필드를 파싱한다.
- 6개월 도달 시 연장 결정을 lot별로 저장하고 백업/복원에도 포함한다.
- 신규 주문은 API의 active 전략만 사용하고 기존 lot은 매수 당시 `strategyKey`를 유지한다. A→C 일괄 migration은 하지 않는다.
- C가 추후 active로 전환되면 C 신규 신호만 주문 가이드를 만들며 A/C 기존 lot 일정은 각각 계속 관리한다.

자동 회귀 테스트:

- 6개월 alive
- 6개월 one-week-below
- 6개월 RSI14 < 50
- 연장 중 RSI14 < 50 only
- 연장 중 2주 MA10 하회
- 12개월 도달
- A/C 혼재 lot

## 12. 2026-08 미국 Score C 전환 계약

현재 상태:

- 2026-07 신호는 Score A가 `active`, Score C가 `candidate`다.
- 2026-07 C 후보 INTC/KLAC는 계획 진입일이 지난 신호이므로 소급해 active로 바꾸지 않는다.
- 기존 A 사용자는 7월 A 월간 계획을 유지하고 기존 A lot의 `strategyKey`, 매수일, 청산 일정도 그대로 보존한다.
- 7월 신규 사용자는 월중 진입하지 않고 계좌 설정 후 2026-08 공식 C 신호를 기다린다.

Public API 계약:

- manifest capability: `strategy_transition_v1`
- `signals/latest.json`과 `signals/us/latest.json`에 `strategyTransitions`를 제공한다.
- 전환: `us_leader2_repeat_theme_combo_cap27_5` -> `us_leader2_score_c_cap27_5`
- 적용 월: `2026-08`
- 신규 사용자: `wait_for_effective_signal`
- 기존 월간 계획: `finish_locked_month`
- 기존 lot: `keep_original_strategy`
- 적용 월 전에는 A active/C candidate, 적용 월부터는 A testing/C active가 아니면 verifier가 Pages 배포를 차단한다.
- Android v0.4.2가 선택적 전환 계약을 먼저 지원한 뒤, 2026-08 패키지에서 `minAppVersionCode`를 59로 올린다.

남은 선행 조건:

- 2026-07 월말 최신 데이터로 Score C 추천 2종목을 새로 계산하는 live 생성 경로를 검증한다.
- Android v0.4.2의 계좌별 월간 실행 잠금과 신규 사용자 대기 정책을 배포한다.
- 두 조건을 통과한 뒤에만 2026-08 신호에서 C를 active로 전환한다.
