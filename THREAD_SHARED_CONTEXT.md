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

완료된 선행 조건:

- Android `v0.4.2` / versionCode 59 배포 완료
  - private commit: `1f1a09d`
  - Release: `https://github.com/sonhch15-dotcom/investor-run-android/releases/tag/v0.4.2`
  - execution plan lock, 신규 사용자 대기, 기존 A migration, 중앙 실행 정책, backup/import 검증 완료
- Public live Score C 생성 경로 구현 완료
  - 원본: `data/score-c-live.json`
  - API: `/api/selections/us-score-c/latest.json`
  - 선택 기준: 마지막 완료 월간 금요일
  - 산식: `score_c_half_sector10_normalized_v1`
  - 현재·직전 3개 기준일로 그룹 가속도 재현
  - 유니버스 가격 커버리지 98% 이상, 가격 지연 3일 이내, 서로 다른 주도 그룹 2종목을 강제
  - 고정 스냅샷 재현 결과: 2026-07 C 후보 INTC/KLAC 일치
  - 재현 입력 유니버스: `data/universe-corrected-frozen-20260711.json`
  - live 운용도 같은 고정 종목·섹터 매핑을 사용하고 가격만 최신화한다. live Wikipedia 구성으로 C 유니버스를 다시 만들지 않는다.
  - 2026-08 모의 패키지: C active, A testing, minAppVersionCode 59, validFrom 2026-08-03 검증 통과
  - 8월인데 7월 선택이 남은 모의 패키지는 fail-closed 검증 통과

남은 실제 전환 조건:

- 2026-07-31 미국 종가가 실제로 수집되어야 한다.
- 그 데이터로 생성된 2026-08 Score C 추천 2종목이 품질 게이트를 통과해야 한다.
- 성공하면 같은 Pages 실행에서 C active/A testing/minAppVersionCode 59로 자동 전환한다.
- 실패하면 새 패키지를 배포하지 않고 기존 7월 신호는 유효기간 만료 상태로 남겨 주문을 차단한다.

## 13. 2026-07-11 조기청산·재진입 연구

- Run ID: `us-score-c-early-exit-reentry-frozen-20260711-v1`
- 종목 선정은 Score C, 자금 배분은 Cap27.5로 고정하고 청산·재진입 규칙만 비교했다.
- 현재 기준선은 6개월 50% 매도 + 잔여 50% 주봉 연장이며 기존 결과를 정확히 재현했다.
  - 누적 +520.0%, CAGR 45.6%, MDD -20.4%, robust +464.6%
- 보수적 연구안 `6M Half + Relative 3W`:
  - 4주 유예 후 종가 < MA10, QQQ 대비 상대강도 < 상대강도 MA10, RSI14 < 50 상태를 3주 확인하면 청산
  - 종가 >= MA10, 상대강도 >= 상대강도 MA10, RSI14 >= 52 상태를 3주 확인하면 재진입
  - 누적 +530.4%, MDD -21.3%, robust +475.0%
  - 5개 독립 시작 구간 중 1개에서만 현재 전략을 이겨 안정성 관문 실패
- 6개월 제거 연구안 `Adaptive 12M + Market 2W`:
  - 종목 < MA10 및 QQQ < MA20 상태를 2주 확인하면 청산
  - 종목과 QQQ가 각각 MA10을 회복하고 RSI14 >= 52이면 2주 확인 후 재진입
  - 누적 +632.0%, MDD -22.1%, robust +549.2%
  - 신규 추천 매수 94/118건, 지표 준비 완료 2022년 이후에는 현재 전략보다 부진하여 관문 실패
- 결론: 현재 6개월 50/50 규칙을 유지한다. 두 대안은 연구 결과일 뿐 active/testing 전략으로 승격하지 않는다.
- Public API, `six_month_extension_v1`, Android ExecutionPolicy 및 APK에는 변경이 없다.
- 상세 보고서: `early_exit_reentry_test.md`

## 14. Android v0.4.3-v0.4.4 Material 3 입력 전환

Private Android 적용 상태:

- v0.4.3 / versionCode 60: 공통 Material 3 테마, 안전 영역, 계좌 입출금, 미국·한국 주식 추천 체결 화면 전환
- v0.4.4 / versionCode 61: 한국 ETF 리밸런싱, 수동 추가매수, FIFO/특정 lot 매도, 입출금·매수·매도 기록 정정 화면 전환
- Compose 화면은 입력과 미리보기만 담당하고 장부 저장, active 신호 확인, 월간 실행 잠금, ETF 목표, 현금, FIFO/lot 흐름은 기존 `LedgerStore`와 `ExecutionPolicy`가 최종 검증한다.
- ETF·수동·정정 화면에서 돌아온 뒤 현재 신호·보유·원 기록을 다시 조회하므로 오래된 화면 상태로 저장하지 않는다.
- 기존 A/C lot의 `strategyKey`, 6개월 연장 판정, 12개월 일정과 2026-08 C 전환 계약은 변경하지 않았다.

Public 영향:

- 신호 JSON 스키마와 Pages 생성 코드는 변경하지 않는다.
- `minAppVersionCode`는 UI 전환만을 이유로 올리지 않는다.
- Android UI 변경이 public 전략 결과나 candidate 신호를 실행 가능하게 만들지 않는다.
- 환전, 배당, 기존 보유 초기 등록, 증권사 보유 대조는 아직 기존 Android 화면을 사용한다.

## 15. Android v0.4.5 시각 디자인 시스템 개선

- Android 공통 색상, 타이포그래피, Shapes, 카드, 버튼, 입력창, 상단 바와 하단 실행 영역을 정리했다.
- 입출금·체결·정정 Compose 화면은 맥락 패널, 여백 기반 입력 섹션, 결과 패널, 키보드 대응 하단 저장 버튼 구조를 사용한다.
- 기존 Java 메인 탭은 계산 구조를 유지한 채 공통 카드·버튼·입력창·내비게이션 스타일만 개선했다.
- UI 전용 변경이며 Public 신호 JSON, `minAppVersionCode`, 전략 상태, A/C 전환, ETF-I, 6개월/주봉/12개월 청산 계약은 변경하지 않는다.

## 16. Android v0.4.6 화면 역할·정보 구조 정리

- 오늘·계좌·운용·자산·기록 탭이 각자의 역할만 담당하도록 중복 카드와 중복 진입 메뉴를 제거했다.
- 계좌 입출금은 계좌 탭, 추천 주문은 운용 탭, 예외 기록·타임라인·백업은 기록 탭에서만 시작한다.
- 운용 화면은 API active 원시 표현 대신 `현재 전략`과 `실행 상태`만 표시한다. 내부 active key와 월간 실행 잠금 검증은 그대로 유지한다.
- 정상 장부 점검은 숨기고 실제 오류가 있을 때만 원인과 복구 행동을 표시한다.
- 원격 API URL, 원시 동기화 상태, 오류 로그, 캐시 초기화는 기록 탭의 `고급 데이터 정보`로 격리했다.
- 자산 화면은 상세 계좌 카드와 장문의 손익 분해를 제거하고 추세, 원금 대비 변화, 배분, 계좌 총액 요약을 유지한다.
- Android versionCode는 `63`, versionName은 `0.4.6`이다.
- UI 정보 구조 전용 변경으로 Public 신호 JSON, `minAppVersionCode`, A/C 전환, ETF-I, 6개월/주봉/12개월 청산 계약은 변경하지 않는다.

## 17. 2026-07-12 미국 Score C 다음 후보 5종 검증

- Run ID: `us-score-c-next-candidates-frozen-20260711-v1`
- 기준선은 Score C 월 2종목, Cap27.5, 6개월 50% 매도 후 잔여 주봉 연장이다.
- 기준 결과를 다시 재현했다: 누적 +520.0%, CAGR +45.6%, MDD -20.4%, QQQ +96.4%.
- QQQ가 200일 평균 아래일 때 신규 매수금을 75%·50%·25%·0%로 줄인 안은 모두 전체 수익과 초대형 상승 제외 결과가 낮아졌다. 최대 하락도 전체 기간에서는 개선되지 않았다.
- 월별 추천은 이미 서로 다른 두 업종에서 한 종목씩 고른다. 계좌 전체 업종 원금 한도 55%·45%·35%·25%는 하락폭을 일부 줄였지만 수익 감소가 더 컸다.
- 6개월에 건강한 종목을 25%만 매도하면 누적 +555.2%, 주봉에 따라 25%·50%·75%를 매도하면 +542.4%였다. 다만 보유 중 종목까지 포함해 +300% 넘은 거래를 제외하면 각각 +262.2%, +283.9%로 현재 규칙의 +319.3%보다 낮고, 세 기간 중 한 구간에서만 앞서 연구 관문을 통과하지 못했다.
- 월 예산을 같게 맞춘 3종목은 +400.8%, 4종목은 +333.3%였다. 종목당 금액을 유지한 3·4종목도 누적 수익이 낮고 MDD가 -27.5%~-28.5%로 악화됐다.
- 과거 실제 지수 구성과 상장폐지 종목을 반영한 검증은 유효한 point-in-time 구성·업종·조정주가 자료가 없어 수익률 계산을 보류했다. 임의 복원 숫자는 사용하지 않는다.
- 결론: 연구 관문을 통과한 후보는 0개다. 월 2종목, 업종 한도 없음, 6개월 50% 매도 규칙을 유지한다.
- Public API, 전략 상태, 2026-08 A→C 전환 계약, Android 주문·알림 로직에는 변경이 없다.
- 상세 파일: `data/us-backtest-candidate-study.json`, `us_backtest_candidate_study.md`.

## 18. 2026-07-12 미국 시점별 구성 종목 감사

- Run ID: `us-score-a-c-quantconnect-pit-20260712-v1`
- QuantConnect Free에서 SPY·QQQ 시점별 구성 종목, 과거 상장폐지 종목 가격, 상장폐지 이벤트 접근을 확인했다.
- 스모크 테스트: 2023-09-01 SPY 503개, QQQ 100개, ATVI 가격 92.04달러, 2023-10-13 경고와 2023-10-14 상장폐지 이벤트 확인.
- 같은 QuantConnect 가격과 기존 업종표 호환 계약에서 현재 종목 517개 고정과 PIT 유니버스를 비교했다.
  - 섹터 흐름형: 고정 +208.1%, PIT +156.9%, 차이 +51.3%포인트
  - 종목 힘 중심형: 고정 +270.6%, PIT +187.8%, 차이 +82.8%포인트
  - PIT QQQ +67.0%
  - PIT MDD: 섹터 흐름형 -24.8%, 종목 힘 중심형 -25.4%
- PIT에서도 종목 힘 중심형이 섹터 흐름형보다 +30.9%포인트 앞섰지만 기존 고정 명단의 우위 폭은 과장돼 있었다.
- 현재 지수에서 빠진 추천은 각 방식 15건이다. 선택 뒤 상장폐지 이벤트는 PXD 한 종목이며 Exxon Mobil 인수에 따른 기업행위 상장폐지다. 파산 상장폐지 추천은 이번 표본에 없었다.
- QuantConnect 마지막 사용 가능 가격은 2026-04-13이므로 2026년 4~6월 신호는 이번 감사에서 제외한다.
- Morningstar 분류만 일관되게 쓴 민감도 값은 공식 비교가 아니라 업종 분류 영향 확인용으로만 보존한다.
- 전략 상태와 운용 계약은 변경하지 않는다. A active/C candidate, 2026-08 전환 계약, Public API, Android 주문·알림 정책은 그대로다.
- Android는 새 PIT 수익률을 주문 로직에 사용하지 않는다. 향후 Public이 C 승격을 다시 판단할 때 PIT 감사와 전진 신호 성과를 함께 검토한다.
- 상세 파일: `quantconnect_point_in_time_audit.md`, `data/quantconnect-point-in-time-audit.json`, `research/quantconnect/us_point_in_time_audit.py`.

## 19. 2026-07-12 미국 Score C 장기 강건성 감사

- Run ID: `us-score-a-c-quantconnect-long-robustness-20260712-v1`
- QuantConnect PIT 기간을 2010-08부터 2026-03까지 188개월로 확장했다.
- Morningstar 섹터·산업군을 모든 종목에 일관되게 적용한 결과:
  - Score A +202.17%, MDD -20.54%
  - Score C +202.21%, MDD -35.46%
  - 수익 차이는 +0.04%포인트뿐이고 C 위험이 크게 나빠 승격 관문 실패
- 기존 동결 업종표 호환 장기 기본 결과:
  - Score A +244.31%, MDD -57.91%, 실제 매수 341/376
  - Score C +248.95%, MDD -59.45%, 실제 매수 315/376
  - C 우위는 +4.64%포인트, CAGR 차이는 +0.09%포인트에 그침
- 매수·매도 각각 25bp 비용에서는 A +254.73%, C +210.71%로 순위가 역전됐다. C는 현금 부족으로 85/376건을 건너뛰었다.
- 매수 1일 지연과 구성 종목 5거래일 지연만 적용하면 A +246.81%, C +254.87%로 C의 작은 우위는 남지만 MDD는 C가 더 깊다.
- 비용과 시차를 함께 적용하면 A +254.57%, C +230.88%로 다시 역전된다.
- 최고 수익 lot 두 개를 제외한 결과는 A +197.19%, C +203.16%다. C의 작은 우위가 한 종목 하나에만 의존한 것은 아니다.
- 데이터 감사: 동결 517종목의 `sector` 필드는 57개 라벨이지만 11개 넓은 GICS 섹터와 46개 세부 산업명이 섞여 있다. 새 버전에서는 `sector`와 `industryGroup`을 분리해야 한다.

전략·Android 판단:

- 장기 승격 관문 상태: `failed`
- 권고 상태: Score A `active`, Score C `candidate` 유지
- 2026-08 C 자동 승격은 분류 계약과 자금 배분 규칙 보정 후 재검증할 때까지 보류 권고
- 이번 연구 커밋은 Public API active key, transition payload, `minAppVersionCode`, Android ExecutionPolicy를 직접 변경하지 않는다.
- Android는 현재와 같이 API의 단일 active 전략만 주문 가능하게 유지한다. Public에서 별도 승인 없이 C를 active로 바꾸지 않는다.
- 기존 A lot의 `strategyKey`, 매수일, 6개월·주봉·12개월 일정은 그대로 보존한다.
- 상세 자료: `quantconnect_c_robustness_audit.md`, `data/quantconnect-c-robustness-audit.json`, `research/quantconnect/us_long_horizon_audit.py`

## 20. 2026-07-12 미국 전략 1억원 실계좌형 검증

- Run ID: `us-100m-coherent-capital-audit-20260712-v1`
- 초기 자금: 100,000,000원
- 고정 환율: 2026-07-10 기획재정부 원/달러 종가 1,501.4원
- 초기 달러: 66,604.50달러
- 소수점 거래, 당시 SPY·QQQ 구성 종목, Morningstar 섹터·산업그룹 일관 분류를 사용했다.
- 신호 뒤 한 거래일 추가 지연, 구성 종목 정보 5거래일 지연, 상장폐지 이벤트를 반영했다.
- 매도 계약은 6개월 50% 매도, 잔여분 주봉 연장, 최대 12개월을 유지했다.

현실 비용 스트레스의 3개월 램프형 결과:

- 비용: 매수·매도 각각 25bp, 최초 환전 25bp
- Score A: +411.75%, CAGR 11.02%, MDD -29.15%, 최종 340,850.58달러
- Score C: +389.51%, CAGR 10.70%, MDD -32.08%, 최종 326,036.67달러
- 같은 비용의 QQQ: +1,519.07%
- 현금 부족 매수 누락: A 0건, C 0건
- 27.5% 종목 한도 누락: A 22건, C 25건
- 평균 현금 비중: A 13.44%, C 14.45%
- 최고 수익 lot 두 개 제외: A +362.36%, C +342.75%
- 선택 후 상장폐지 이벤트: AGN, ANDV, CA, CSRA

결론:

- 일관된 분류와 같은 1억원 계좌에서는 A가 수익, CAGR, MDD, 최고 2개 lot 제거 결과에서 모두 C보다 우수했다.
- 3개월 램프형은 9개월 슬롯형보다 수익과 자금 활용은 높지만 MDD가 더 깊다. 공격형 기본 계좌는 램프형을 유지하고 슬롯형은 저위험 비교안으로 보존한다.
- A `active`, C `candidate` 유지 권고가 강화됐다.
- 2026-08 C 자동 승격을 그대로 실행하지 않는다.

전환 취소 관련 Public·Android 공동 작업:

- 현재 `strategy_transition_v1`은 예정 전환만 표현하며 안전한 취소 상태가 없다.
- 이번 연구 커밋에서는 기존 July API를 갑자기 깨지 않기 위해 transition payload와 `minAppVersionCode`를 직접 바꾸지 않는다.
- 8월 신호 생성 전에 public 계약에 `cancelled` 또는 `paused` 전환 상태, 계속 운용할 전략 키 A, 취소 사유를 추가해야 한다.
- Android는 이 상태를 받으면 기존 2026-08 C 대기 상태를 해제하고 새 월 A active 신호를 실행 가능하게 해야 한다.
- 기존 A/C lot은 매수 당시 전략 키와 청산 일정을 그대로 유지한다.
- 취소 계약을 이해하는 Android 버전을 먼저 배포한 다음 public 전환 payload를 변경한다.

상세 자료:

- `dashboard/us-100m-capital-audit.html`
- `data/quantconnect-us-100m-capital-audit.json`
- `research/quantconnect/us_100m_coherent_capital_audit.py`
- `strategy_validation_pipeline.md`

## 21. 2026-07-12 미국 업종 분류와 Leader2 구조 감사

- Run ID: `us-taxonomy-structure-frozen-20260712-v1`
- 기존 517주식의 `sector` 필드는 의도적으로 설계한 57개 업종 체계가 아니다.
- S&P 500에서는 넓은 GICS 섹터를 읽고 Nasdaq-100에서는 세부 분류를 읽은 뒤, 중복 종목의 나중 값을 덮어써 11개 넓은 섹터와 46개 세부 업종명이 섞였다.
- 57개 라벨의 중앙 종목 수는 1개다. 40개 라벨은 2종목 이하, 44개는 8종목 미만이다.
- 5년 고정 스냅샷에서 개별 점수와 가격을 고정하고 업종 처리만 바꿨다.
  - 57개 혼합 원형: +919.5%, MDD -22.0%
  - 소형 그룹 표본 보정 8: +680.7%, MDD -18.0%
  - 8종목 미만 제외: +423.7%, MDD -22.2%
  - 업종 단계 제거: +242.8%, MDD -37.3%
- 원형에서 4종목짜리 `Electronic Components`가 25회 선택됐다. 8종목 미만을 제외하면 2025~2026 구간 수익은 +335.0%에서 +75.8%로 낮아졌다.
- 이 5년 실험은 현재 구성 종목 고정이므로 공식 성과가 아니라 분류 구조 민감도 증거로만 사용한다.
- 완료된 2010~2026 QuantConnect PIT에서는 Morningstar 일관 분류가 혼합 호환 분류보다 수익은 낮지만 MDD는 크게 얕았다. 두 분류 모두 QQQ를 크게 밑돌았다.
- 판정: 57개 혼합 라벨을 새 공식 분류로 승격하지 않는다. Morningstar `sector`·`industryGroup` 일관 분류를 향후 연구 기준선으로 유지한다.
- 표본 보정 강도 8은 다음 PIT 검증의 1순위 연구 후보이며 아직 추천·주문·알림에 연결하지 않는다.
- Public API, A/C 상태, 월간 실행 잠금, Android ExecutionPolicy와 기존 lot 일정에는 변경이 없다.
- 상세 자료: `dashboard/taxonomy-leader-group-audit.html`, `taxonomy_leader_group_audit.md`, `data/taxonomy-structure-audit.json`, `src/taxonomy-structure-audit.mjs`.
