# Android App Development Log

작성일: 2026-07-09

이 문서는 Android 앱 개발 중 발견한 문제, 판단, 수정 방향, 검증 결과를 계속 누적하는 로그다.  
짧은 버전 정보는 `android_app_build_notes.md`와 `android_app_v0_2_release_report.md`에 남기고, 맥락이 필요한 내용은 이 문서에 함께 기록한다.

Team roles and update rules: `android_app_team_roles.md`
Agent coding constitution: `android_app_agent_coding_rules.md`
Current app map: `android_app_map.md`

## 기록 원칙

- APK를 새로 만들 때마다 버전, 수정 이유, 영향 범위, 검증 결과를 남긴다.
- 전략 계산 로직이 바뀌면 단순히 "수정"이라고 쓰지 않고 원 전략과 앱 계산식의 차이를 같이 적는다.
- UX 피드백은 화면 문제, 사용 흐름 문제, 입력 불편, 데이터/캐시 문제로 나누어 기록한다.
- APK 전달용 파일명은 항상 `artifacts/investor-run-debug-x.y.z.apk` 형식으로 남긴다.

## v0.3.30 전략 버전 메타데이터와 C안 후보 신호 연결

작성일: 2026-07-10

요청:

- 다른 스레드에서 추가된 미국 주식 C안(`C Half Sector10 Normalized`)을 앱에 적용할 수 있는지 검토하고, 앞으로 전략 변경이 잦아도 흔들리지 않는 앱/Pages 구조를 잡는다.

판단:

- C안은 앱이 직접 종목을 계산할 문제가 아니라 GitHub Actions/Pages 신호 생성 엔진이 확정 신호를 만들고, 앱은 그 신호를 개인 계좌 상태에 맞춰 주문 가이드로 변환해야 한다.
- 기존 전략 키에 C안 결과를 덮어쓰면 전략 변경과 유니버스/섹터 입력 변경을 구분할 수 없으므로 새 전략 키를 사용한다.

수정 내용:

- `scripts/build-signal-package.mjs`
  - schemaVersion을 `1.1.0`으로 올렸다.
  - 전략 정의를 상수화하고 `scoreFormulaVersion`, `sectorMapVersion`, `universeHash`, `backtestRunId`, `dataAsOf`, `strategyStatus`를 모든 신호에 추가했다.
  - 기존 A안은 `us_leader2_repeat_theme_combo_cap27_5`, C안 후보는 `us_leader2_score_c_cap27_5`로 분리했다.
  - C안 후보 신호는 `USC-...` prefix를 사용해 기존 A안 lot 식별자와 충돌하지 않게 했다.
  - APK asset에도 manifest가 가리키는 전체 API 파일을 포함하도록 고쳤다.
- Android 앱
  - `StrategyMath.STRATEGY_US_SCORE_C_CAP_27_5`와 `isUsCap275Strategy()`를 추가했다.
  - C안 후보도 기존 Cap27.5 자금배분/종목한도/추가수량 계산을 재사용하도록 했다.
  - 미국 전략 선택지에 `Leader2 Score C Cap27.5 · 후보`를 추가했다.
  - 추천 카드에 `전략 근거`를 표시해 active/candidate, 점수 산식, 유니버스 해시, dataAsOf를 확인할 수 있게 했다.
- 문서
  - `signal_package_schema.md`, `android_app_strategy_plan.md`, `android_app_map.md`에 C안 후보와 전략 메타데이터 규칙을 반영했다.

검증:

- `node --check scripts/build-signal-package.mjs` 통과.
- `node scripts/build-signal-package.mjs --app-assets` 성공.
  - 총 7개 신호 생성: 기존 미국 2개, C안 후보 미국 2개, 한국 2개, ETF 1개.
  - C안 후보: `INTC`, `KLAC`.
- `:app:testDebugUnitTest` 성공.
- `:app:assembleDebug` 성공.
- `aapt dump badging` 확인:
  - versionCode: `42`
  - versionName: `0.3.30`
  - package: `com.sweethome.investor`

산출물:

- `artifacts/investor-run-debug-0.3.30.apk`
- SHA-256: `318C811009CA9219D3EDDB152795021682EF6841E304D628247FC82DB343AF74`

## v0.3.29 백업 파일 저장/복원과 데이터 실패 메시지 정리
작성일: 2026-07-10

목표:

- 남은 P1 항목 중 서로 같이 처리할 수 있는 `백업 파일 저장/복원`과 `데이터 실패 메시지 사용자화`를 한 번에 진행한다.
- 클립보드 백업만으로는 장기 운용 데이터 보호가 부족하므로 파일 기반 백업 경로를 추가한다.
- 무료 시세/환율 경로 실패 메시지가 기술적으로 노출되는 문제를 줄인다.

반영:

- `백업 파일 저장` 버튼을 추가했다.
  - Android 문서 저장 화면을 사용한다.
  - 파일명은 `investor-run-backup-yyyyMMdd-HHmmss.json` 형식이다.
  - 앱 권한을 추가하지 않고 사용자가 선택한 저장 위치에 JSON을 쓴다.
- `백업 파일 불러오기` 버튼을 추가했다.
  - Android 문서 선택 화면을 사용한다.
  - 선택한 JSON은 복원 확인 다이얼로그를 거친 뒤 `LedgerStore.importBackup()`으로 복원한다.
  - 복원 성공 시 자산 스냅샷을 갱신한다.
- 기존 `장부 백업 복사`, `백업 붙여넣기 복원`은 유지했다.
- 데이터 상태 카드와 데이터 동기화 카드에 `사용 중 시세` 기준을 추가했다.
- 동기화 실패 메시지를 사용자 행동 중심으로 변환했다.
  - `HTTP 404`: GitHub Pages API URL과 `/api` 배포 확인
  - `HTTP 401/403`: 무료 시세 서버 요청 거절, 잠시 후 재시도
  - timeout/connect 실패: 네트워크 확인
  - Frankfurter/Yahoo 동시 실패: 환율 무료 경로 재시도
- 데이터가 잠겨도 마지막 정상 시세/환율 캐시가 있으면 유지된다는 안내를 표시한다.

검증:

- `StrategyMathSelfTest` 통과.
- `:app:assembleDebug` 빌드 성공.
- `aapt dump badging` 확인:
  - versionCode: `41`
  - versionName: `0.3.29`
  - package: `com.sweethome.investor`
- `git diff --check` 통과. 단, 기존 tracked 파일의 CRLF 변환 경고는 유지됨.

APK:

- `artifacts/investor-run-debug-0.3.29.apk`
- SHA-256: `AF8EB41DCA62ADC889E6DBCCD70CBD5BC8B9B9AC7EECFCED24F4B8BC98A02B06`

## v0.3.28 장부 점검 필터와 환율 보정 후 자산 확인
작성일: 2026-07-10

목표:

- 리뷰 회의에서 결정한 P0 항목인 `장부 점검 -> 문제 기록 바로가기/필터 -> 정정 -> 자산 요약 확인` 흐름을 구현한다.
- 사용자가 긴 타임라인에서 문제 기록을 직접 찾아야 하는 부담을 줄인다.

반영:

- 기록 탭 순서를 조정했다.
  - 빠른 기록
  - 장부 점검
  - 기록 타임라인
  - 데이터 동기화
  - 백업과 안전장치
- 기록 타임라인에 필터 버튼을 추가했다.
  - 전체
  - 점검
  - 입출금
  - 체결
  - 환전
  - 취소
- `점검` 필터는 활성 기록 중 다음 문제 기록만 표시한다.
  - USD 입금/출금인데 `fxRateKrw`가 없는 기록
  - KRW/USD 환전인데 `fxRateKrw`가 없는 기록
- 장부 점검 카드의 버튼을 `점검 필요 기록만 보기`로 바꾸고, 누르면 타임라인을 점검 필터로 펼친다.
- USD 입출금 정정 저장 후 자산 스냅샷을 갱신하고 `자산 확인` 또는 `기록 보기`를 선택하는 다이얼로그를 표시한다.
- 환전 기록 환율 누락은 현재 정정 UI가 없으므로 취소 후 재입력 방식으로 보정해야 한다는 안내를 추가했다.

검증:

- `StrategyMathSelfTest` 통과.
- `:app:assembleDebug` 빌드 성공.
- `aapt dump badging` 확인:
  - versionCode: `40`
  - versionName: `0.3.28`
  - package: `com.sweethome.investor`
- `git diff --check` 통과. 단, 기존 tracked 파일의 CRLF 변환 경고는 유지됨.

APK:

- `artifacts/investor-run-debug-0.3.28.apk`
- SHA-256: `CA2F9F8CB65837DA4E5320F0D7FC506DAB7FF25F66C1B2ADA41B61EF8B5853ED`

## v0.3.27 장부 점검과 원금 기준 계산 회귀 테스트
작성일: 2026-07-10

목표:

- 사용자가 직접 계산 오류를 찾아내기 전에 앱이 먼저 장부/시세 위험 신호를 보여주게 한다.
- 원금 기준 자산 변화가 다시 스냅샷 기준 플러스로 잘못 해석되지 않도록 실제 사례를 회귀 테스트로 고정한다.

반영:

- `StrategyMath.usdAssetChange()`와 `AssetChangeBreakdown`을 추가했다.
- `StrategyMathSelfTest`에 실제 사용 사례를 추가했다.
  - 입금: `80,692 USD`
  - TECH: `112주`, 매수가 `70.92`, 현재가 `71.15`
  - STX: `11주`, 매수가 `906.52`, 현재가 `890.09`
  - 현재 USD/KRW: `1,510.6`
  - 입금 당시 환율은 현재보다 `2.21` 높다고 가정
- 이 케이스의 기대값을 고정했다.
  - 남은 현금: `62,777.24 USD`
  - 현재 총 USD: `80,537.03 USD`
  - 투자 손익: `-154.97 USD`
  - 투자 손익 원화: 약 `-234,098 KRW`
  - 환율 영향: 약 `-178,329 KRW`
  - 원금 대비 변화: 약 `-412,427 KRW`
- 기록 탭에 `장부 점검` 카드를 추가했다.
  - USD 입출금 환율 누락
  - 환전 환율 누락
  - 평균원가 임시평가 종목
  - 가격/환율 데이터 문제
  - 자산 스냅샷 수
- 환율 누락 USD 입출금이 있으면 기록 타임라인을 펼쳐 정정 입력으로 안내한다.
- 자산 탭 `원금 기준 요약` 상단에 `원금 대비`, `투자 손익`, `환율 영향` 3칸 요약을 추가했다.
- 3칸 요약은 작은 화면에서 읽히도록 `만/억` 단위의 짧은 원화 표기를 사용한다.

검증:

- `StrategyMathSelfTest` 통과.
- `:app:assembleDebug` 빌드 성공.
- `aapt dump badging` 확인:
  - versionCode: `39`
  - versionName: `0.3.27`
  - package: `com.sweethome.investor`

APK:

- `artifacts/investor-run-debug-0.3.27.apk`
- SHA-256: `4D69439D6837CBE102E78A3F651D8211DED62D0EA780F0006C5E356678C79C10`

## v0.3.26 입금 당시 환율 저장과 원금 기준 자산 변화
작성일: 2026-07-10

사용자 피드백:

- 80,692달러를 입금한 뒤 TECH 112주를 70.92달러, STX 11주를 906.52달러에 매수했다.
- 현재가가 TECH 71.15달러, STX 890.09달러이고 현재 환율이 1,510.6원이라면 투자 손익은 마이너스여야 한다.
- 그런데 앱의 `자산 변화`는 플러스로 보여 이해할 수 없다는 피드백이 있었다.

계산 점검:

- TECH 원금: `112 * 70.92 = 7,943.04 USD`
- STX 원금: `11 * 906.52 = 9,971.72 USD`
- 총 매수 원금: `17,914.76 USD`
- 남은 현금: `80,692 - 17,914.76 = 62,777.24 USD`
- TECH 현재 평가: `112 * 71.15 = 7,968.80 USD`
- STX 현재 평가: `11 * 890.09 = 9,790.99 USD`
- 현재 총 USD: `62,777.24 + 7,968.80 + 9,790.99 = 80,537.03 USD`
- 투자 손익: `80,537.03 - 80,692 = -154.97 USD`, 현재 환율 기준 약 `-234,098 KRW`

원인:

- 기존 장부는 USD 입금 당시 환율을 기록하지 않았다.
- 자산 화면은 `첫 스냅샷 대비 변화`를 크게 보여주고 있었고, 이 값이 `입금 원금 대비 변화`처럼 읽혔다.
- 입금이 첫 스냅샷에 이미 반영된 상태에서는 스냅샷 시작값만으로 투자 성과를 설명하면 사용자가 보는 실제 원금 기준 손익과 어긋난다.

반영:

- USD 입금/출금 기록에 `fxRateKrw`를 저장한다.
- 환전 기록에도 원화/달러 환산에서 계산 가능한 `fxRateKrw`를 저장한다.
- 기존 USD 입금처럼 환율이 없는 기록은 가장 이른 자산 스냅샷 환율로 원금을 추정한다.
- 기록 타임라인의 USD 입출금에는 저장 환율을 표시한다.
- USD 입출금 `정정 입력`에서 입금/출금 당시 USD/KRW 환율을 함께 보정할 수 있게 했다.
- 자산 탭의 상단 변화 기준을 `현재 총자산 - 입금 원금` 중심으로 바꿨다.
- `원금 기준 요약` 카드에 `현재 총자산`, `입금 원금`, `원금 대비`, `현재 투자 손익`, `환율 영향`, `USD/KRW 변화`를 표시한다.
- 기존 기록에 환율이 없어서 추정값을 쓰는 경우 화면에 명시한다.

검증:

- `:app:assembleDebug` 빌드 성공.
- `aapt dump badging` 확인:
  - versionCode: `38`
  - versionName: `0.3.26`
  - package: `com.sweethome.investor`

APK:

- `artifacts/investor-run-debug-0.3.26.apk`
- SHA-256: `8B8AE6154087E092F8FC6D672F794FB086D8BF70DE64F674CF7C0EE4DD91C10C`

## v0.3.25 자산 변화 요약 재보정
작성일: 2026-07-10

사용자 피드백:

- 달러 자산을 입력하고 투자를 진행했는데 투자 손익은 마이너스이고 환율도 하락했는데, 자산 변화가 플러스로 찍히는 것이 이해되지 않는다는 피드백이 있었다.
- `입출금 +1.21억`과 `투자/환율/시세 -1.21억`이 동시에 표시되는 구조는 실사용자가 납득하기 어렵고, 앱도 원인을 제대로 증명하지 못하고 있었다.

판단:

- 현재 화면의 플러스 총자산 변화는 투자 손익과 환율 하락만으로 설명되지 않는다.
- 큰 입금 기록이 시작 스냅샷에 이미 반영된 상태인데, 설명 카드에서 다시 입출금 원인으로 세면서 큰 양수와 큰 음수 상쇄가 발생했다.
- 따라서 앱이 이를 환율효과나 투자성과처럼 단정하면 안 된다.

반영:

- `자산 변화 요약`에서 비정상적으로 큰 입출금 상쇄가 감지되면 해당 입출금을 원인으로 다시 세지 않는다.
- 이 경우 `입출금: 시작 스냅샷에 이미 반영`으로 표시한다.
- `투자/환율/시세`라는 큰 상쇄값 대신 `현재 투자 손익`, `스냅샷 차이`, `USD/KRW 변화`를 표시한다.
- 안내 문구를 `총자산 변화는 스냅샷 차이입니다. 투자 성과는 현재 투자 손익을 기준으로 보세요.`로 단순화했다.

검증:

- `StrategyMathSelfTest` 통과.
- `:app:assembleDebug` 빌드 성공.
- `aapt dump badging` 확인:
  - versionCode: `37`
  - versionName: `0.3.25`
  - package: `com.sweethome.investor`

APK:

- `artifacts/investor-run-debug-0.3.25.apk`
- SHA-256: `FE7DC4AAEBDEE491050C10248805E6145BEE146BCC0E0284BD868E971229F844`

## v0.3.24 자산 변화 요약 단순화와 입출금 기간 보정
작성일: 2026-07-10

사용자 피드백:

- `자산 변화 해석` 카드가 여전히 이해하기 어렵고, 계산이 맞는지 확인이 필요하다는 피드백이 있었다.
- 실제 화면에서 `기간 입출금 +1.21억`과 `환율/현금/평가기준 잔차 -1.21억`이 동시에 표시되어 의미가 불명확했다.

원인:

- 기간 입출금 계산이 날짜 기준 inclusive로 되어 있어 시작 스냅샷 날짜의 입금까지 다시 포함했다.
- 시작 스냅샷에 이미 반영된 입금을 기간 입출금으로 다시 세면, 같은 금액이 반대 방향 잔차로 빠져 사용자가 보기에는 계산 오류처럼 보인다.

반영:

- 입출금 계산 기준을 `첫 스냅샷 날짜부터`가 아니라 `첫 스냅샷 시각 이후부터 마지막 스냅샷 시각까지`로 변경했다.
- 자산 변화 카드를 `자산 변화 요약`으로 단순화했다.
- 표시 항목을 다음 중심으로 줄였다.
  - 총자산 변화
  - 입출금
  - 투자/환율/시세
  - 투자 손익 변화 또는 새 기준 시작
  - 필요 시 USD/KRW 변화
- 기존 `현금 변화`, `투자 중 자산 변화`, `환율/현금/평가기준 잔차`를 기본 노출에서 제거해 큰 상쇄 숫자가 튀는 문제를 줄였다.

검증:

- `StrategyMathSelfTest` 통과.
- `:app:assembleDebug` 빌드 성공.
- `aapt dump badging` 확인:
  - versionCode: `36`
  - versionName: `0.3.24`
  - package: `com.sweethome.investor`

APK:

- `artifacts/investor-run-debug-0.3.24.apk`
- SHA-256: `0976D1B32B67422A852A4FD8C9841A19BC6613075C4894A3E97F0CE1C578AABC`

## v0.3.23 자산 변화 해석 카드
작성일: 2026-07-10

사용자 피드백:

- 투자 손익은 마이너스인데 자산 변화가 플러스로 표시되어 환율 효과인지 이해하기 어렵다는 피드백이 있었다.
- 총자산 변화와 투자 손익이 서로 다른 지표인데 화면에서 충분히 설명하지 못하고 있었다.

반영:

- 자산 탭의 `자산 변화` 카드 아래에 `자산 변화 해석` 카드를 추가했다.
- 선택한 일/주/월 범위의 시작/현재 스냅샷을 비교해 다음 항목을 표시한다.
  - 총자산 변화
  - 현금 변화
  - 투자 중 자산 변화
  - 투자 손익 변화
  - 기간 입출금
  - 환율/현금/평가기준 잔차
  - USD/KRW 변화
- 투자 손익은 줄었지만 총자산은 늘어난 경우, 입출금/달러 현금/환율/평가기준 효과가 더 컸다는 설명 문구를 표시한다.
- 기존 `손익 분해` 카드 제목을 `투자 손익 분해`로 바꾸고, 총자산 변화가 아니라 투자 손익만 분해한다는 안내를 추가했다.

판단:

- 현재 장부에는 모든 과거 시점의 환율과 USD 원금별 환율 히스토리가 완전히 저장되어 있지 않다.
- 따라서 이번 버전의 `환율/현금/평가기준 잔차`는 정확한 단일 환율효과가 아니라, 투자 손익 변화와 입출금을 제외한 설명용 잔차다.
- 향후 배당/세금/환율효과를 독립 분해하려면 환율 히스토리와 장부 이벤트 타입 확장이 필요하다.

검증:

- `StrategyMathSelfTest` 통과.
- `:app:assembleDebug` 빌드 성공.
- `aapt dump badging` 확인:
  - versionCode: `35`
  - versionName: `0.3.23`
  - package: `com.sweethome.investor`

APK:

- `artifacts/investor-run-debug-0.3.23.apk`
- SHA-256: `7F100341BC4E808E253B01A5B4E8E1BFA9066DDF8266160050D66229EC41CCA6`

## v0.3.22 전략 계산 모듈화와 실전 시나리오 self-test
작성일: 2026-07-10

사용자 요청:

- 남은 단계 중 함께 처리할 수 있는 작업을 묶고, 잠자는 동안 중요한 작업을 진행해 달라는 요청이 있었다.
- 우선순위가 높은 묶음은 계산 신뢰도, 실전 시나리오 검증, 데이터 신뢰도/주문 가이드 안정화, UI QA로 정리했다.

반영:

- 주문 목표, 추가 주문 가능액, 추가 권장 수량, 미국 Cap27.5 목표 금액, 한국 Leader2 목표 금액, ETF 리밸런싱 계산을 `StrategyMath` 순수 계산 모듈로 분리했다.
- `MainActivity`는 화면 표시와 입력 흐름을 담당하고, 핵심 계산식은 `StrategyMath`를 호출하도록 정리했다.
- `StrategyMathSelfTest`를 추가해 외부 의존성 없이 순수 Java로 핵심 실전 시나리오를 검증할 수 있게 했다.
- self-test 시나리오:
  - 80,000 USD 계좌에서 Cap27.5 STX 목표가 10,000 USD 수준으로 계산되는지
  - TECH 같은 비테마 종목은 기본 10% 수준으로 계산되는지
  - 목표보다 이미 많이 산 경우 추가 매수 수량이 0으로 나오는지
  - 목표 금액보다 1주 가격이 큰 경우 1주를 강제 추천하지 않는지
  - 남은 매수 금액을 기준으로 추가 권장 수량을 내림 계산하는지
  - 한국 Leader2 월간 목표가 신호 수로 나뉘는지
  - ETF 리밸런싱이 허용 오차 안에서는 `유지`, 밖에서는 정수 주식 단위 매수/매도로 계산되는지

검증:

- `StrategyMathSelfTest` 통과.
- `:app:assembleDebug` 빌드 성공.
- `aapt dump badging` 확인:
  - versionCode: `34`
  - versionName: `0.3.22`
  - package: `com.sweethome.investor`

APK:

- `artifacts/investor-run-debug-0.3.22.apk`
- SHA-256: `BA58ECED8B3BD10801FD4ADCDF505424DE7BB8F5881DA8AC7E8CBC7AF9CDEEA5`

## v0.3.21 기록 타임라인 기본 접힘
작성일: 2026-07-10

사용자 피드백:

- 실사용 중 기록 타임라인이 너무 길어져 기록 탭을 쓰기 불편하다는 피드백이 있었다.
- 평소에는 타임라인을 숨김 처리하고 필요할 때만 펼쳐서 보고 싶다는 요청이 있었다.

반영:

- 기록 탭의 `기록 타임라인`은 기본 접힘 상태로 표시한다.
- 접힌 상태에서는 전체 기록 건수와 최근 기록 1건 요약만 보여준다.
- `기록 타임라인 펼치기` 버튼을 누르면 기존처럼 전체 기록 카드가 표시된다.
- 펼친 상태에서는 `기록 타임라인 접기` 버튼으로 다시 접을 수 있다.
- 빠른 기록, 데이터 동기화, 백업 패널은 타임라인이 길어도 항상 바로 접근할 수 있게 유지했다.

검증:

- `:app:assembleDebug` 빌드 성공.
- `aapt dump badging` 확인:
  - versionCode: `33`
  - versionName: `0.3.21`
  - package: `com.sweethome.investor`
- `git diff --check` 통과.

APK:

- `artifacts/investor-run-debug-0.3.21.apk`
- SHA-256: `FBF3D95F5C3E922B2A3E7B5A87209FA6BBAE5D08F59EB9D94B99DFEA10279508`

## v0.3.20 손익 추세 기준선 보정
작성일: 2026-07-10

사용자 피드백:

- 미국 주식을 비중에 맞춰 매수했을 뿐인데 손익 추세의 `기간 변화`가 약 100만원 플러스로 표시되어 이상하다는 지적이 있었다.

원인:

- 매수 자체는 현금이 주식으로 바뀌는 자산 배분 변화이므로 손익이 크게 발생한 것으로 보이면 안 된다.
- 현재 손익 계산은 평균 원가와 live quote 기준으로 정상화됐지만, 과거 자산 스냅샷에는 stale quote 기준으로 계산된 손익 값이 남아 있었다.
- 손익 추세는 범위 첫 스냅샷과 마지막 스냅샷의 `investmentPnlKrw` 차이를 보여주므로, stale quote 기반 과거 손익과 live quote 기반 현재 손익을 비교해 큰 플러스 변화처럼 보였다.

반영:

- 자산 스냅샷에 `pnlBasisVersion`을 저장한다.
- 손익 추세는 현재 손익 기준 버전의 스냅샷만 사용한다.
- 기존 stale quote 기준 손익 스냅샷은 자산 변화 기록에는 남기되, 손익 추세 비교에서는 제외한다.
- 손익 추세에 비교 대상이 1개뿐이면 `기간 변화`를 `새 기준 시작`으로 표시한다.
- 화면 하단에 이전 손익 스냅샷이 기준 차이로 제외되었다는 안내를 표시한다.

검증:

- `:app:assembleDebug` 빌드 성공.
- `aapt dump badging` 확인:
  - versionCode: `32`
  - versionName: `0.3.20`
  - `INTERNET`, `POST_NOTIFICATIONS`, `RECEIVE_BOOT_COMPLETED` 권한 포함
- `git diff --check` 통과.

APK:

- `artifacts/investor-run-debug-0.3.20.apk`
- SHA-256: `271E8528E53DED77D150FB1B9B4FB6787094D352470D95553E99ECAB1E326445`

## v0.3.19 직접 시세 오류 표시 보정
작성일: 2026-07-10

사용자 피드백:

- 직접 시세 갱신 후 화면에 `Yahoo batch: HTTP 401`, `KR_ETF_BASKET: HTTP 404`, `Frankfurter ... JSONArray` 오류가 표시됐다.
- 가격 상태와 환율 상태는 정상으로 보였으나 실패 메시지가 길게 노출되어 실제 장애처럼 보였다.

원인:

- Yahoo batch quote endpoint는 direct client를 401로 거절할 수 있는데, 이후 per-symbol chart fallback이 성공해도 batch 실패가 사용자 오류로 남았다.
- `KR_ETF_BASKET`은 실제 거래 종목이 아니라 ETF 리밸런싱 전략 묶음 심볼인데, 앱이 이를 가격 조회 대상으로 넣었다.
- Frankfurter 공개 endpoint가 array 형태 응답을 반환하는 경우를 object 형태로만 파싱하고 있었다.

반영:

- Yahoo batch 실패는 per-symbol chart fallback으로 보강되므로, 실제 종목 조회가 실패한 경우에만 오류로 표시한다.
- 직접 시세 조회 대상에서 `rebalance` 전략 신호와 `KR_ETF_BASKET` 가상 심볼을 제외했다.
- 실제 ETF 가격은 `targetWeights`의 `360750.KS`, `395160.KS`, `458730.KS` 등 개별 ETF 종목으로만 조회한다.
- Frankfurter 환율 파서는 object 응답과 array 응답을 모두 처리한다.
- Frankfurter가 실패해도 Yahoo FX fallback이 성공하면 환율 실패 로그를 남기지 않는다.

검증:

- `:app:assembleDebug` 빌드 성공.
- `aapt dump badging` 확인:
  - versionCode: `31`
  - versionName: `0.3.19`
  - `INTERNET`, `POST_NOTIFICATIONS`, `RECEIVE_BOOT_COMPLETED` 권한 포함
- `git diff --check` 통과.

APK:

- `artifacts/investor-run-debug-0.3.19.apk`
- SHA-256: `848FC5E16257B0C0A09DEEA1405A3DA6AB467FBAC0B79782D89A5DED5A12792B`

## v0.3.18 API 키 없는 직접 시세/환율 갱신
작성일: 2026-07-10

사용자 요청:

- Yahoo가 아니더라도 무료 경로로 가격과 환율을 갱신할 수 있는지 검토했다.
- 우선 API key가 필요 없는 방식으로 진행하기로 했다.

반영:

- GitHub Actions/GitHub Pages는 추천주 선정, 월간 신호, 주봉 훼손, ETF 목표 비중을 계속 담당한다.
- Android 앱은 추천 종목, ETF 목표 종목, 실제 보유 종목만 모아 API key 없이 직접 시세를 갱신한다.
- 주식/ETF 가격은 Yahoo quote batch를 먼저 시도하고, 빠진 종목은 Yahoo chart endpoint로 보강한다.
- USD/KRW 환율은 Frankfurter 공개 endpoint를 먼저 시도하고, 실패하면 Yahoo `KRW=X` chart로 fallback한다.
- 직접 시세 결과는 GitHub 신호 패키지와 분리된 live overlay로 저장한다.
- 앱을 재실행해도 마지막 직접 시세/환율 overlay가 적용된다.
- 원격 GitHub 동기화 버튼은 원격 신호 갱신 후 직접 시세 보강까지 이어서 수행한다.
- 기록 화면에 `키 없는 시세/환율 갱신` 버튼을 추가했다.
- 앱 실행/복귀/오늘/운용/자산 화면 진입 시 15분 throttle로 직접 시세도 자동 갱신한다.
- 단일 주식 주문 가이드는 전체 가격 패키지가 partial이어도 해당 종목 가격과 환율이 정상이라면 사용할 수 있게 조정했다.
- ETF 리밸런싱은 목표 ETF 전 종목 가격이 정상일 때만 가이드를 연다.

판단:

- API key를 APK에 하드코딩하지 않는 원칙을 유지한다.
- Yahoo는 공식 보장 API가 아니므로 실패 가능성을 전제로 GitHub Pages 가격 스냅샷과 평균 원가 임시 평가를 fallback으로 유지한다.
- 이 구조는 나중에 Twelve Data, 한국투자증권 Open API 같은 key 기반 provider를 추가해도 기존 앱 계산식을 흔들지 않는다.

검증:

- `:app:assembleDebug` 빌드 성공.
- `aapt dump badging` 확인:
  - versionCode: `30`
  - versionName: `0.3.18`
  - `INTERNET`, `POST_NOTIFICATIONS`, `RECEIVE_BOOT_COMPLETED` 권한 포함
- `git diff --check` 통과.

APK:

- `artifacts/investor-run-debug-0.3.18.apk`
- SHA-256: `5E7AEEDF3448573476538B6066C8540A07D212B4314694D3F18477C4A9CF2B9A`

## v0.3.17 체결 후 평균 원가 임시 평가
작성일: 2026-07-10

사용자 피드백:

- 손익은 추천 당시 가격이 아니라 실제 매수한 가격 또는 평균단가 기준으로 계산하는 것이 맞다는 지적이 있었다.
- 추천 후 가격이 오른 상태에서 매수했는데, 앱의 시세가 이전 날짜 기준이면 방금 산 종목이 즉시 손실처럼 보이는 문제가 있었다.

원칙:

- 전략 추천과 주문 목표 계산은 전략 기준가/목표 비중을 유지한다.
- 내 자산, 보유 평가, 파이 그래프, 미실현손익은 사용자의 실제 체결로 만들어진 평균 원가를 기준으로 해석한다.
- 체결 이후 최신 시세가 아직 들어오지 않은 종목은 오래된 quote를 현재가처럼 쓰지 않는다.

반영:

- `LedgerStore.valuationPrice()`를 추가해 자산/손익 평가용 가격을 한 곳에서 결정한다.
- 종목 quote가 없거나, quote 기준일이 최신 매수/매도 체결일보다 오래되면 해당 보유 종목은 평균 원가로 임시 평가한다.
- 총자산, 계좌별 보유 평가, 미실현손익, 보유 종목 도넛 차트가 모두 같은 평가 기준을 사용한다.
- 보유 카드에 `평가 기준가`와 `수신 시세`를 분리 표시하고, 평균 원가 임시 평가 상태를 경고 문구로 표시한다.

판단:

- 무료 GitHub Pages 정적 API 구조에서는 앱이 열린 순간의 완전한 실시간 시세를 항상 보장할 수 없다.
- 따라서 stale quote로 사용자의 실제 손익을 왜곡하는 것보다, 최신 quote가 들어올 때까지 평균 원가로 0% 근처 임시 평가를 하는 쪽이 실전 운용 UX에 더 안전하다.
- 최신 시세가 들어오면 앱은 자동으로 quote 기준 평가로 돌아간다.

검증:

- `:app:assembleDebug` 빌드 성공.
- `aapt dump badging` 확인:
  - versionCode: `29`
  - versionName: `0.3.17`
  - `INTERNET`, `POST_NOTIFICATIONS`, `RECEIVE_BOOT_COMPLETED` 권한 포함
- `git diff --check` 통과.

APK:

- `artifacts/investor-run-debug-0.3.17.apk`
- SHA-256: `F9B61F877754E82E12643C95250D8819328F0C07CF0E33FEC8553E59FD4AE4E8`

## v0.3.16 시세 동기화와 체결 후 손익 기준 표시
작성일: 2026-07-10

사용자 피드백:

- 추천 시점보다 오른 가격에 매수했더니 앱에서 바로 마이너스 손익으로 보였다.
- 앱을 볼 때 너무 자주가 아니더라도 시세가 업데이트되면 좋겠다는 요청이 있었다.

원인:

- 앱 손익은 `현재 앱 기준가 - 사용자의 평균 매수가`로 계산한다.
- STX 예시처럼 매수가가 `906.52 USD`인데 앱 기준가가 오래된 `860.02 USD`이면 앱 계산상 즉시 손실로 표시된다.
- 이는 계산식 자체는 맞지만, 체결일보다 가격 기준일이 오래된 경우 실제 증권사 손익과 다를 수 있어 화면 경고가 필요했다.
- 앱은 실행 시 원격 동기화를 시도했지만, 앱을 계속 켜둔 상태에서 탭 이동/재개 시 저빈도 동기화가 충분하지 않았다.
- GitHub Pages API 생성 스케줄도 하루 1회 중심이라 원격 파일 자체가 늦게 갱신될 수 있었다.

반영:

- 앱 시작 후 `onResume`, 오늘/운용/자산 화면 진입 시 원격 시세 동기화를 자동 시도한다.
- 자동 동기화는 15분 throttle을 적용해 과도한 호출을 피한다.
- 오늘 화면 데이터 카드에 마지막 동기화 성공 시각을 표시한다.
- 보유 카드에서 최근 체결일이 종목 가격 기준일보다 최신이면 `현재 손익은 이전 시세 기준` 경고를 표시한다.
- GitHub Pages Actions 스케줄을 한국장 개장/마감, 미국장 개장, 미국장 마감, Yahoo 지연 반영 재시도 시점으로 확장했다.

판단:

- 앱은 증권사 실시간 시세 API를 직접 호출하지 않고 GitHub Pages 정적 API를 가져온다.
- 따라서 앱을 열 때마다 원격 API를 확인할 수는 있지만, 원격 API 자체는 GitHub Actions가 갱신한 시점까지만 최신이다.
- 개인 무료 운용을 우선하므로 실시간 초단위 갱신이 아니라 저빈도 자동 갱신 + 명확한 시세 기준 표시를 선택했다.

검증:

- `:app:assembleDebug` 빌드 성공.
- `aapt dump badging` 확인:
  - versionCode: `28`
  - versionName: `0.3.16`
  - `INTERNET`, `POST_NOTIFICATIONS`, `RECEIVE_BOOT_COMPLETED` 권한 포함
- `git diff --check` 통과.

APK:

- `artifacts/investor-run-debug-0.3.16.apk`
- SHA-256: `5C34202A0A081C40A9A9600E9880B1AD846EAD85A78A25F9295A0B4E279CFF77`

## v0.3.15 기록 정정 UX
작성일: 2026-07-09

사용자 요청:

- 다음 단계에서 카톡/문자 자동화는 일단 제외하고 구현을 진행해 달라고 했다.
- 따라서 자동 알림 캡처, 카톡 메시지 파싱, 문자 파싱은 이번 범위에서 제외했다.

반영:

- 기록 타임라인의 입금/출금/매수 기록에 `정정 입력` 버튼을 추가했다.
- 정정 입력은 원본 기록을 직접 덮어쓰지 않고, 원본을 취소 표시한 뒤 새 정정 기록을 추가한다.
- 입금/출금 정정은 금액과 메모를 미리 채운 상태에서 수정할 수 있다.
- 매수 체결 정정은 수량, 평균단가, 비용, 메모를 미리 채운 상태에서 수정할 수 있다.
- 정정 저장 실패 시 다이얼로그가 닫히지 않도록 했다.
- 매수 정정은 수량/단가/비용 입력 검증과 총액-단가 혼동 방지를 적용한다.
- 매수 정정 기록은 원본 위치 바로 뒤에 삽입해 이후 매도 FIFO와 lot 일정 계산이 흐트러지지 않게 했다.
- 증권사 보유 대조 결과에서 차이가 있으면 최근 매수 기록 정정으로 바로 이동할 수 있게 했다.

판단:

- 매도 정정은 이번 범위에서 직접 수정으로 열지 않았다. 매도는 lot 원가, 실현손익, 특정 lot 배분을 함께 다시 계산해야 하므로 현재의 `기록 취소` 흐름을 유지한다.
- 카톡/문자 자동화는 개인정보 권한과 메시지 포맷 테스트셋이 필요하므로 별도 설계 항목으로 남긴다.

검증:

- `:app:assembleDebug` 빌드 성공.
- `aapt dump badging` 확인:
  - versionCode: `27`
  - versionName: `0.3.15`
  - `INTERNET`, `POST_NOTIFICATIONS`, `RECEIVE_BOOT_COMPLETED` 권한 포함
- `git diff --check` 통과.

APK:

- `artifacts/investor-run-debug-0.3.15.apk`
- SHA-256: `D9F0EE9F42C54B3198A8174090A8CB2016F0FB3F8AC76C5D25EA5A4F19E89407`

## v0.3.14 실행 UX 1-12 묶음 개선
작성일: 2026-07-09

사용자 요청:

- 남은 작업 1-12를 한 번에 진행할 수 있는지 확인했고, 실제 사용 전에 처리 가능한 항목을 계속 진행해 달라고 했다.
- 특히 `몇 주 더 사면 되는지`, 목표 초과 상태, ETF 리밸런싱 카드, 체결 입력 실수 방지, 장부 대조가 필요했다.

반영:

- 운용 카드에 `추가 권장` 금액과 `추가 수량`을 표시한다.
- 주문 가이드는 `남은 매수`, `추가 가능 예산`, `추가 권장 수량`, `예상 주문금액`을 분리해 보여준다.
- ETF 리밸런싱 카드에도 목표 금액, 현재 금액, 차이, 권장 수량을 바로 표시한다.
- ETF 카드와 리밸런싱 팝업이 같은 `EtfRebalancePlan` 계산을 사용한다.
- 주식 매수 목표는 첫 체결 이후 `orderTargets` 월간 스냅샷으로 고정하고, 백업/복원에도 포함한다.
- 체결 저장 전 수량/단가/비용을 검증하고, 현재가 대비 비정상 단가는 총액을 단가 칸에 넣은 실수로 보고 차단한다.
- 체결 저장 다이얼로그는 검증 실패 시 닫히지 않는다.
- 전략 체결은 가격/환율 데이터가 정상일 때만 저장할 수 있게 강화했다. 단, 수동/주봉 매도는 사용자가 직접 단가를 확인해 입력할 수 있도록 예외로 둔다.
- 기록 탭에 `증권사 보유 대조`를 추가해 앱 장부 수량/평단과 증권사 수량/평단 차이를 즉시 비교한다.
- Action Inbox에 추가 권장 수량을 표시한다.
- 목표 초과/부족 상태는 `완료`, `확인 필요`, `조정 필요`에 따라 색상을 다르게 표시한다.

검증:

- `:app:assembleDebug` 빌드 성공.
- `aapt dump badging` 확인:
  - versionCode: `26`
  - versionName: `0.3.14`
  - `INTERNET`, `POST_NOTIFICATIONS`, `RECEIVE_BOOT_COMPLETED` 권한 포함
- `git diff --check` 통과.

APK:

- `artifacts/investor-run-debug-0.3.14.apk`
- SHA-256: `B78124A7D2583B65360E3CE5B98C2C7DE45C9C6FF7AAF32844A412C3A76F9344F`

남은 한계:

- 과거 기록을 필드 단위로 직접 수정하는 편집기는 아직 없다. 현재는 취소 기록을 남기고 다시 입력하는 안전한 정정 방식이다.
- 백그라운드 원격 동기화는 앱 시작/수동 동기화 중심이며, Android WorkManager 기반 주기 동기화는 아직 아니다.
- 카카오톡/문자 체결 내역 자동 파싱은 아직 설계 단계다.

## 2026-07-09 Android App Map 추가

사용자 요청:

- 현재 작성된 앱 지도를 MD로 기록해 달라는 요청이 있었다.

반영 내용:

- 새 문서 `android_app_map.md`를 추가했다.
- 현재 APK `0.2.9` 기준으로 5개 탭, 3계좌 구조, 신호/가격/환율 데이터 흐름, 전략 계산식, 장부 저장 구조, 알림 구조, 디자인 시스템, 빌드/배포 흐름, 백로그를 지도 형태로 정리했다.
- `android_app_team_roles.md`의 필수 업데이트 문서 목록에 앱 지도를 추가했다.

## 2026-07-09 팀별 앱 감사 보고서 추가

사용자 요청:

- 현재 작성된 앱을 규정된 규칙에 따라 각 팀 에이전트가 검토하고 개선할 부분을 보고해 달라는 요청이 있었다.

반영 내용:

- 새 문서 `android_app_team_audit_report.md`를 추가했다.
- Product, UX, Design, 자산 운용, 데이터/자동화, Android/QA, 문서/릴리즈 관점의 감사 결과를 통합했다.
- 다음 APK 전 P0 개선으로 장부 무결성, 고가주 1주 강제 제안 방지, delayed/fallback 가격·환율 주문 차단, ETF 리밸런싱 체결 기록 연결을 지정했다.

## 2026-07-09 Agent Coding Rules 추가

사용자 요청:

- Andrej Karpathy의 `CLAUDE.md` 기준을 확인하고 앞으로 앱 개발 기준에 반영해 달라는 요청이 있었다.
- 사용자가 제공한 저장소는 `multica-ai/andrej-karpathy-skills`이며, 저장소 설명상 Karpathy의 LLM 코딩 관찰에서 파생된 가이드라인이다.

반영 내용:

- 새 문서 `android_app_agent_coding_rules.md`를 추가했다.
- 핵심 원칙은 구현 전 사고, 단순성 우선, 외과적 변경, 목표 기반 실행으로 정리했다.
- Investor Run에는 전략 계산 검증, 계좌/통화 분리, 업데이트 설치/캐시 검증, UI 겹침 검증을 필수 기준으로 연결했다.
- `android_app_team_roles.md`와 이 로그에서 새 규칙 문서를 참조하도록 업데이트했다.

## 2026-07-09 Agent Coding Constitution 지정

사용자 요청:

- `CLAUDE.md` 기반 규칙을 헌법으로 지정하고 항상 작업할 때 생각해 달라는 요청이 있었다.

반영 내용:

- `android_app_agent_coding_rules.md`를 Agent Coding Constitution으로 격상했다.
- 모든 앱 설계, 코드 수정, APK 빌드, 문서 업데이트 전에 이 문서의 원칙을 먼저 적용하도록 명시했다.
- `android_app_team_roles.md`에서도 해당 문서를 단순 규칙이 아니라 헌법으로 참조하도록 수정했다.

## v0.2.4 계좌/차트 UX

사용자 피드백:

- 계좌를 전체 카드로 나열하는 방식보다 `전체/미국/한국/ETF` 미니탭으로 구분하는 것이 더 깔끔하다.
- 계좌별 자산 구성과 보유 종목 비중을 파이 또는 도넛 그래프로 보고 싶다.

수정 내용:

- 계좌 화면에 미니탭을 추가했다.
- 전체 계좌 화면에는 계좌별 자산 비중 도넛 차트를 추가했다.
- 개별 계좌 화면에는 현금/보유 구성 도넛 차트와 보유 종목 비중 차트를 추가했다.
- 외부 라이브러리 없이 `DonutChartView` 커스텀 View를 구현했다.

## v0.2.5 도넛 차트 잘림 수정

문제:

- 실제 폰 화면에서 도넛 차트의 상하단이 카드 안에서 잘려 보였다.
- 빈 차트 상태에서도 회색 링이 과하게 커서 UI가 답답해 보였다.

원인:

- 차트 높이와 원 반지름 계산이 너무 빡빡했다.
- stroke 두께 대비 안전 여백이 부족했다.

수정 내용:

- 빈 차트는 compact 모드로 표시하도록 변경했다.
- 차트 높이, 원 크기, stroke 두께를 조정했다.
- 카드 내부에서 상하단이 잘리지 않도록 안전 여백을 추가했다.

APK:

- `artifacts/investor-run-debug-0.2.5.apk`

## v0.2.6 미국 Cap27.5 주문금액 보정

사용자 피드백:

- 미국 계좌에 8만 달러를 넣었을 때 추천 2종목에 거의 반반으로 전체 자금을 넣으라고 표시됐다.
- `Leader2 + Repeat Theme Combo Cap27.5` 전략이 정말 이렇게 운용되는 것이 맞는지 확인이 필요했다.

확인 결과:

- 기존 앱은 미국 주식 추천 종목 수가 2개라는 이유로 `가용 현금 / 2`를 목표 원금으로 계산하고 있었다.
- 이는 `Cap27.5` 전략의 핵심인 종목당 누적 원금 상한, 기본 매수 비율, 반복/테마 가중을 반영하지 못한 단순화였다.

수정 내용:

- 미국 `Leader2 + Repeat Theme Combo Cap27.5`는 계좌 평가 원금 기준으로 계산하도록 변경했다.
- 초기 매수 기본 비율 10%, 일반 구간 7.5%, 방어 구간 5% 구조를 반영했다.
- 반복 추천 이력과 AI/하드웨어 테마 가중을 반영했다.
- 종목당 누적 원금 상한 27.5%를 적용했다.
- 신호 패키지에 미국 종목 `sector`와 `strategy_position_sizing` 메타데이터를 추가했다.

검증 예시:

- 미국 계좌 80,000 USD 기준
- TECH: 목표 약 8,000 USD
- STX: AI/하드웨어 가중 적용, 목표 약 10,000 USD
- 종목당 상한: 22,000 USD

APK:

- `artifacts/investor-run-debug-0.2.6.apk`

## v0.2.7 한국 주식/ETF 전략 보정

사용자 요청:

- 미국뿐 아니라 한국 주식과 ETF도 실제 전략이 들어가 있는지 확인이 필요했다.

확인 결과:

- 미국은 v0.2.6에서 전략 계산이 반영됐다.
- 한국 주식은 추천 종목 선정은 들어가 있었지만 주문금액은 여전히 단순 2분할 정책이었다.
- ETF는 50/40/10 목표비중 데이터는 들어가 있었지만, 실제 계좌 평가금액 기준 매수/매도 수량 안내는 부족했다.

수정 내용:

- 한국 주식 `Leader2`에 capital-account sizing을 반영했다.
- 초기 3개월은 월 30%, 이후는 월 15%를 추천 종목 수로 나누어 주문 목표를 계산한다.
- 한국 주식 종목당 누적 원금 상한 22.5%를 적용했다.
- 한국 주식 1주 가격이 목표금액보다 큰 경우에도 1주 단위 체결을 현실적 완료로 볼 수 있게 검증 기준을 보정했다.
- ETF `Core/Satellite/Defense 50/40/10`은 계좌 평가금액 기준 목표금액, 현재 평가액, 매수/매도 수량을 계산하도록 확장했다.

검증 예시:

- 한국 주식 계좌 10,000,000 KRW 기준
- 추천 종목 2개일 때 초기 구간 목표: 각 1,500,000 KRW
- 종목당 상한: 2,250,000 KRW
- ETF 계좌 10,000,000 KRW 기준
- 50%: 5,000,000 KRW
- 40%: 4,000,000 KRW
- 10%: 1,000,000 KRW

APK:

- `artifacts/investor-run-debug-0.2.7.apk`

## v0.2.8 업데이트 캐시 보정

문제:

- 기존 앱 위에 새 APK를 업데이트 설치했는데도 화면과 추천이 예전처럼 보일 수 있었다.

원인:

- Android는 앱 업데이트 시 앱 내부 저장 데이터를 유지한다.
- 앱은 기존에 저장된 원격 신호 캐시를 새 APK에 들어있는 내장 asset보다 먼저 읽고 있었다.
- 따라서 APK는 업데이트됐지만 추천 패키지는 예전 캐시가 계속 적용될 수 있었다.

수정 내용:

- 새 APK 내장 `manifest.json`의 `packageVersion`이 기존 캐시보다 최신이면 캐시를 자동 삭제하도록 변경했다.
- 캐시 삭제 후 새 내장 데이터를 로드하도록 했다.

APK:

- `artifacts/investor-run-debug-0.2.8.apk`

## v0.2.9 오래된 원격 동기화 차단

추가 문제:

- GitHub Pages API URL이 앱에 저장되어 있으면 앱 시작 후 자동 동기화가 실행된다.
- 이때 서버에 올라간 데이터가 APK 내장 데이터보다 오래되면, 새 APK 설치 직후에도 다시 오래된 데이터로 덮어쓸 수 있다.

수정 내용:

- 원격 `manifest.json`의 `packageVersion`이 APK 내장 `packageVersion`보다 오래되면 동기화를 실패 처리한다.
- 오래된 원격 데이터는 저장하지 않고 현재 내장 데이터를 유지한다.

검증 결과:

- `versionCode 11`, `versionName 0.2.9`
- APK 내부 포함 확인:
  - `assets/api/manifest.json`
  - `assets/api/signals/latest.json`
  - `assets/api/prices/latest.json`
  - `assets/api/fx/latest.json`
  - `classes.dex`

APK:

- `artifacts/investor-run-debug-0.2.9.apk`

## 현재 남은 개발 과제

- 체결/입출금 입력 UX를 더 앱답게 개선해야 한다.
- Room 기반 영구 저장소로 이전해야 한다.
- 실제 매수/매도 기록 수정, 삭제, 되돌리기 UX가 필요하다.
- ETF 리밸런싱 가이드를 카드 UI로 분리하고 바로 체결 기록으로 연결해야 한다.
- 미국/한국 주식의 6개월 매도, 50% 부분매도, 주봉 이탈 감시를 더 명확한 액션 카드로 만들어야 한다.
- 앱 내 데이터 소스 상태에 `asset`, `remote cache`, `remote`와 packageVersion을 사용자에게 더 명확히 보여주는 것이 좋다.
- 최종적으로 Compose/Material 3 기반으로 UI를 재구성하는 것이 좋다.

## 앞으로 업데이트할 문서

- `android_app_development_log.md`: 개발 과정, 문제 원인, 의사결정 기록
- `android_app_team_roles.md`: 팀 역할, 기능 설계 전 체크 순서, 완료 기준
- `android_app_build_notes.md`: 최신 APK, 빌드 방법, 버전별 요약
- `android_app_v0_2_release_report.md`: 릴리즈 단위 결과 보고
- `signal_package_schema.md`: 신호 JSON 구조 변경 시 업데이트
- `native_android_app_development_plan.md`: 큰 개발 방향 변경 시 업데이트

## v0.3.0 감사 보고서 P0/P1 반영

작성일: 2026-07-09

기준:

- `android_app_team_audit_report.md`
- `android_app_agent_coding_rules.md`
- `android_app_map.md`

반영한 코드 변경:

- `LedgerStore`
  - 입금/출금/매수/매도 저장 API를 `ValidationResult` 반환 방식으로 변경했다.
  - 금액, 수량, 체결가, 수수료/세금 검증을 저장소 레벨에서 수행한다.
  - 출금은 해당 통화 현금 부족을 차단한다.
  - 매수는 해당 계좌/통화 현금 부족을 차단한다.
  - 매도는 보유 수량 초과 저장을 차단한다.
  - 장부 JSON 파싱 실패 시 원문을 보존하고 새 쓰기를 차단한다.
  - 가장 최근 기록 되돌리기 기능을 추가했다.
  - 오늘 하루 Action Inbox 보류 상태를 저장한다.
  - 한국 주식/ETF 계좌는 KRW만 허용하고, 미국 주식 계좌만 USD/KRW 현금을 허용한다.

- `SignalRepository`
  - 환율 상태(`fxStatus`, `fxAsOf`, `fxSource`)를 파싱한다.
  - quote 실패/지연 개수를 계산한다.
  - 마지막 원격 동기화 성공 시각과 실패 메시지를 저장한다.
  - 가격/환율/quote 상태가 모두 정상일 때만 `hasReliableTradingData()`가 true가 되도록 했다.
  - 원격 패키지 동기화 시 manifest schema, 필수 파일, 파일 status, sha256을 검증한 뒤 캐시를 교체한다.
  - `validFrom`, `warnings`, `orderHint.budgetPolicy`를 `StrategySignal`에 보존한다.

- `MainActivity`
  - 데이터가 지연/대체/실패 상태이면 신규 매수/ETF 리밸런싱 주문 가이드를 차단하고 기록 탭으로 안내한다.
  - 목표 금액이 1주 가격보다 작으면 자동 1주 추천을 하지 않고 `자동 추천 없음`으로 표시한다.
  - 체결/입출금 저장 결과를 사용자에게 성공/실패 메시지로 보여준다.
  - ETF 리밸런싱을 target별 카드형 다이얼로그로 바꾸고 `매수 기록`, `매도 기록`으로 연결했다.
  - 기록 탭의 `현재 추천 매수 기록`을 추천 신호 선택 다이얼로그로 바꿨다.
  - 최신 기록 되돌리기 버튼을 타임라인 카드에 추가했다.
  - Action Inbox의 `보류`를 실제 오늘 보류 저장으로 연결했다.
  - 연구 전략 선택 시 추천 패키지 미연결 가능성을 경고한다.
  - 음수 입력을 줄이기 위해 숫자 입력 키보드에서 signed flag를 제거했다.
  - 미국 USD 주문 가능액 계산에서 KRW 보조 현금을 암묵적으로 USD로 환산하던 fallback을 제거했다.

버전:

- `versionCode 12`
- `versionName 0.3.0`

빌드 상태:

- 초기 시도에서는 Android SDK가 비어 있어 `platforms;android-36`을 찾지 못했고 `0.3.0` APK 생성을 완료하지 못했다.
- 이후 `v0.3.0 APK 빌드 완료` 단계에서 SDK 설치와 빌드를 마쳤다.

남은 과제:

- Room 기반 장부 저장소와 migration.
- lot 단위 매수/매도 이벤트 모델.
- 자산 변화 일/주/월 그래프.
- Compose/Material 3 기반 화면 재구성.

## v0.3.0 APK 빌드 완료

작성일: 2026-07-09

진행:

- `android-sdk/cmdline-tools/latest` 상태를 재확인했다.
- `platform-tools`, `platforms;android-36`, `build-tools;36.0.0`을 설치했다.
- Gradle 빌드가 로컬 loopback daemon 연결을 사용해 샌드박스에서 실패했으므로 빌드 명령만 승격 실행했다.
- `:app:assembleDebug` 빌드 성공.
- `app/build/outputs/apk/debug/app-debug.apk`를 `artifacts/investor-run-debug-0.3.0.apk`로 복사했다.

검증:

- `aapt dump badging` 확인:
  - package: `com.sweethome.investor`
  - versionCode: `12`
  - versionName: `0.3.0`
  - minSdk: `26`
  - targetSdk: `36`
- APK 내부 포함 확인:
  - `classes.dex`
  - `assets/api/manifest.json`
  - `assets/api/signals/latest.json`
  - `assets/api/prices/latest.json`
  - `assets/api/fx/latest.json`
  - `assets/api/weekly-trends/latest.json`
- 전달용 APK SHA-256:
  - `639355F93BACA78282F99DE8A43C829059CD7E4BEB9B61C25A5AE7B9C898F6C6`

APK:

- `artifacts/investor-run-debug-0.3.0.apk`

## v0.3.1 장부 백업/복원과 환전 기록

작성일: 2026-07-09

반영:

- 장부 백업 JSON export를 추가했다.
- 기록 탭 `백업과 안전장치`에서 장부 백업을 클립보드로 복사할 수 있게 했다.
- 백업 JSON 붙여넣기 복원을 추가했다.
- 복원 전 기존 `entries_v2`는 `pre_import_entries_backup`으로 앱 내부에 보존한다.
- 복원 시 account, currency, type, amount, quantity, price, fee, fx 필드를 기본 검증한다.
- 미국 계좌 전용 환전 이벤트 `fx`를 추가했다.
- 환전 기록은 KRW -> USD, USD -> KRW 방향을 지원한다.
- 환전 기록은 현금 차감/증가, 타임라인 표시, 최신 기록 되돌리기, 백업/복원에 반영된다.

검증:

- `:app:assembleDebug` 빌드 성공.
- `aapt dump badging` 확인:
  - versionCode: `13`
  - versionName: `0.3.1`
- APK 내부 포함 확인:
  - `classes.dex`
  - `assets/api/manifest.json`
  - `assets/api/signals/latest.json`
  - `assets/api/prices/latest.json`
  - `assets/api/fx/latest.json`
  - `assets/api/weekly-trends/latest.json`
- 전달용 APK SHA-256:
  - `6D3CD8D6CC516F520FD93776BD3A4455B8AF619C3D4D12BBB7A1CC8BD95FF6A2`

APK:

- `artifacts/investor-run-debug-0.3.1.apk`

## v0.3.2 과거 기록 취소/정정

작성일: 2026-07-09

반영:

- 장부 타임라인의 과거 기록에 `기록 취소` 액션을 추가했다.
- 원본 기록은 삭제하지 않고 `voidedAt`, `voidedBy`로 취소 상태를 남긴다.
- 취소 작업은 별도 `cancel` 기록을 추가해 어떤 기록을 정정했는지 추적 가능하게 했다.
- 취소된 매수/매도 기록은 보유 수량 계산에서 제외한다.
- 입금 취소, 매도 취소, 환전 취소처럼 현금이 음수가 될 수 있는 작업은 저장소에서 차단한다.
- 매수 취소는 이후 매도 기록의 수량 흐름이 깨지는 경우 차단한다.
- 최신 `cancel` 정정 기록은 `최근 정정 되돌리기`로 취소 상태를 해제할 수 있게 했다.
- 백업/복원 검증에 `cancel` 타입을 추가했다.
- 기록 타임라인에서 취소된 원본은 `취소됨`으로 표시하고, 정정 기록은 `정정`으로 표시한다.

검증:

- `:app:assembleDebug` 빌드 성공.
- `aapt dump badging` 확인:
  - versionCode: `14`
  - versionName: `0.3.2`
- APK 내부 포함 확인:
  - `classes.dex`
  - `assets/api/manifest.json`
  - `assets/api/signals/latest.json`
  - `assets/api/prices/latest.json`
  - `assets/api/fx/latest.json`
  - `assets/api/weekly-trends/latest.json`
- `git diff --check`는 통과했고 CRLF 변환 경고만 확인했다.
- 전달용 APK SHA-256:
  - `32750605C759C265974AEF108C74B3B63EBAF1A0ED4E02EC958B3F172890A6A5`

APK:

- `artifacts/investor-run-debug-0.3.2.apk`

## v0.3.3 자산 스냅샷과 변화 그래프

작성일: 2026-07-09

반영:

- `LedgerStore`에 `asset_snapshots_v1` 일자별 자산 스냅샷 저장소를 추가했다.
- 자산 탭 진입, 입출금/체결/환전 저장, 기록 취소/되돌리기, 백업 복원, 원격 동기화 성공 시 오늘 스냅샷을 갱신한다.
- 스냅샷에는 총자산, 현금, 투자 중 자산, 미국/한국/ETF 계좌별 원화 평가액, 환율, 장부 기록 수를 저장한다.
- 일간은 최근 14개 스냅샷, 주간/월간은 각 기간의 마지막 스냅샷 기준으로 최근 12개 구간을 보여준다.
- `AssetLineChartView`를 추가해 총자산, 투자 중 자산, 현금 3개 선을 표시한다.
- 자산 탭에 `일/주/월` 미니탭, 시작/현재/변화/마지막 스냅샷 요약을 추가했다.
- 장부 백업 JSON에 `assetSnapshots`를 포함하고, 복원 시 기본 검증한다.

검증:

- `:app:assembleDebug` 빌드 성공.
- `aapt dump badging` 확인:
  - versionCode: `15`
  - versionName: `0.3.3`
- APK 내부 포함 확인:
  - `classes.dex`
  - `assets/api/manifest.json`
  - `assets/api/signals/latest.json`
  - `assets/api/prices/latest.json`
  - `assets/api/fx/latest.json`
  - `assets/api/weekly-trends/latest.json`
- `git diff --check`는 통과했고 CRLF 변환 경고만 확인했다.
- 전달용 APK SHA-256:
  - `0B12B5C19C3AA8A906FC1383A006F9498B8383B809979A5D56B7BD1BD3867860`

APK:

- `artifacts/investor-run-debug-0.3.3.apk`

## v0.3.4 시장 시간 기반 반복 알림

작성일: 2026-07-09

반영:

- `NotificationHelper`에 시장별 반복 알림 스케줄러를 추가했다.
- 한국 주식 운용 알림은 평일 08:55 KST로 예약한다.
- 연금 ETF 리밸런싱 알림은 평일 09:05 KST로 예약한다.
- 미국 주식 운용 알림은 뉴욕 09:20 기준으로 계산해 한국 시간에 예약한다.
- `StrategyNotificationReceiver`가 시장 알림을 수신하면 알림을 표시한 뒤 같은 종류의 다음 알림을 재예약한다.
- `BootScheduleReceiver`를 추가해 기기 재부팅 또는 앱 업데이트 후 시장 알림을 다시 예약한다.
- 앱 시작 시 시장 알림을 자동 예약한다.
- 기록 탭 `백업과 안전장치`에 다음 알림 요약과 `시장 알림 재예약` 버튼을 추가했다.
- Android manifest에 `RECEIVE_BOOT_COMPLETED` 권한과 boot/update receiver를 등록했다.

당시 한계:

- 휴장일 캘린더는 아직 반영하지 않는다. 이후 `0.3.5`에서 2026-2027 정적 캘린더를 반영했다.
- Action Inbox 개별 미체결 상태와 알림 문구의 정밀 합성은 다음 단계로 남겼다. 이후 `0.3.5`에서 현재 신호/보유/데이터 상태 기반 요약 문구를 1차 반영했다.

검증:

- `:app:assembleDebug` 빌드 성공.
- `aapt dump badging` 확인:
  - versionCode: `16`
  - versionName: `0.3.4`
  - `RECEIVE_BOOT_COMPLETED` 권한 포함
- APK 내부 포함 확인:
  - `classes.dex`
  - `assets/api/manifest.json`
  - `assets/api/signals/latest.json`
  - `assets/api/prices/latest.json`
  - `assets/api/fx/latest.json`
  - `assets/api/weekly-trends/latest.json`
- `git diff --check`는 통과했고 CRLF 변환 경고만 확인했다.
- 전달용 APK SHA-256:
  - `0051ED4DDE582E4066991A21411CF0F1D3B678A040B60C4160A3B5140463CF5F`

APK:

- `artifacts/investor-run-debug-0.3.4.apk`

## v0.3.5 휴장일 캘린더와 동적 알림 문구

작성일: 2026-07-09

반영:

- `MarketCalendar`를 추가했다.
- 2026-2027 한국 시장 휴장일과 미국 NYSE/Nasdaq 주요 휴장일을 정적 캘린더로 내장했다.
- 한국 주식/연금 ETF 알림은 KST 기준 주말과 한국 휴장일을 건너뛴다.
- 미국 주식 알림은 뉴욕 기준 주말과 미국 시장 휴장일을 건너뛴다.
- 기록 탭 다음 알림 요약에 `휴장일 반영` 문구를 추가했다.
- 시장 알림 수신 시 `SignalRepository`와 `LedgerStore`를 읽어 현재 상태 기반 본문을 생성한다.
- 동적 알림 본문은 신규 매수 건수, ETF 리밸런싱 건수, 보유 종목 주봉 훼손 매도 검토 건수, 데이터 신뢰도 상태를 요약한다.

현재 한계:

- 2028년 이후 휴장일은 캘린더 업데이트가 필요하다.
- 미국 조기 폐장일은 아직 별도 알림으로 분리하지 않는다.

참고 기준:

- NYSE 공식 Market Hours & Holidays 페이지
- Nasdaq Stock Market Holiday Schedule
- KRX 거래일/휴장일 규칙과 한국 공휴일/대체공휴일 기준

검증:

- `:app:assembleDebug` 빌드 성공.
- `aapt dump badging` 확인:
  - versionCode: `17`
  - versionName: `0.3.5`
  - `RECEIVE_BOOT_COMPLETED` 권한 포함
- APK 내부 포함 확인:
  - `classes.dex`
  - `assets/api/manifest.json`
  - `assets/api/signals/latest.json`
  - `assets/api/prices/latest.json`
  - `assets/api/fx/latest.json`
  - `assets/api/weekly-trends/latest.json`
- `git diff --check`는 통과했고 CRLF 변환 경고만 확인했다.
- 전달용 APK SHA-256:
  - `2D54ECB990CC52E1FF5459D1AADA05B127C034965DBCCF81B44C06A6C0D23513`

APK:

- `artifacts/investor-run-debug-0.3.5.apk`

## v0.3.6 FIFO lot 운용 모델

작성일: 2026-07-09

반영:

- `LedgerStore`에 장부 기반 FIFO lot 계산 모델을 추가했다.
- 기존 `entries_v2`의 취소되지 않은 매수 기록은 lot으로 생성하고, 매도 기록은 같은 종목 open lot을 FIFO 순서로 차감한다.
- lot마다 매수일, 원래 수량, 잔여 수량, 원가, 잔여 원가, 6개월 예정일, 12개월 예정일, D-day를 계산한다.
- 미국/한국 주식 운용 화면에 `lot 일정 요약`을 추가했다.
- 보유 주식 카드에 lot별 일정 행을 추가했다.
- 6개월이 지났고 잔여 수량이 원래 수량의 50%를 초과하면 `6개월 50% 매도` 액션을 표시한다.
- 12개월이 지나면 `12개월 전량 매도` 액션을 표시한다.
- 주봉 훼손 상태이면 남은 lot에 대해 `주봉 훼손 잔여 매도` 액션을 표시한다.
- lot 액션 버튼은 매도 체결 다이얼로그에 추천 수량과 매도 사유를 기본값으로 전달한다.
- 연금 ETF 운용 화면은 월간 리밸런싱 전략이므로 6개월/12개월 lot 만기 UI를 숨겼다.
- 시장 알림 본문에 주식 계좌의 lot 만기 매도 검토 건수를 추가했다.

전략 해석:

- 미국/한국 주식은 장기 보유 기간 이벤트와 주봉 훼손 이벤트가 중요하므로 lot 단위로 관리한다.
- ETF는 월간 목표 비중 리밸런싱이 핵심이므로 같은 6개월/12개월 lot 매도 규칙을 적용하지 않는다.
- 현재 매도 차감은 FIFO 기준이다. 이는 평균 원가 집계보다 보수적이고 예측 가능한 기본 정책이다.

0.3.6 당시 한계:

- 특정 lot을 사용자가 직접 지정해서 매도하는 UI는 아직 없다. 이 항목은 `0.3.7`에서 1차 반영했다.
- 실현손익을 lot별 확정 필드로 저장하지 않는다. 이 항목은 `0.3.7`에서 매도 기록 필드로 1차 반영했다.
- 전략 엔진을 순수 로직/JUnit 테스트로 분리하는 작업은 다음 단계로 남아 있다.

검증:

- `:app:assembleDebug` 빌드 성공.
- `aapt dump badging` 확인:
  - versionCode: `18`
  - versionName: `0.3.6`
  - `INTERNET`, `POST_NOTIFICATIONS`, `RECEIVE_BOOT_COMPLETED` 권한 포함
- APK 내부 포함 확인:
  - `classes.dex`
  - `assets/api/manifest.json`
  - `assets/api/signals/latest.json`
  - `assets/api/prices/latest.json`
  - `assets/api/fx/latest.json`
  - `assets/api/weekly-trends/latest.json`
- `git diff --check` 통과.
- 전달용 APK SHA-256:
  - `4756D0F03B2E33680133315E19E96F12CBBB4D59A01624D1BBC6F22C83926228`

APK:

- `artifacts/investor-run-debug-0.3.6.apk`

## v0.3.7 특정 lot 매도와 실현손익 기록

작성일: 2026-07-09

반영:

- 매도 체결 기록 다이얼로그에 `FIFO 자동`과 개별 lot 선택 버튼을 추가했다.
- 일반 `매도 기록` 버튼은 기본적으로 FIFO 자동 상태로 열리며, 사용자가 특정 lot을 선택할 수 있다.
- 운용 화면의 6개월/12개월/주봉 훼손 lot 이벤트 버튼은 해당 lot을 미리 선택한 상태로 매도 기록을 연다.
- 특정 lot 선택 시 빠른 입력 `50% 수량`, `전량`은 전체 보유 수량이 아니라 선택 lot의 잔여 수량 기준으로 동작한다.
- 저장소 레벨에서 선택 lot 존재 여부와 잔여 수량 초과 매도를 검증한다.
- 선택 lot이 없으면 기존 정책대로 FIFO 자동 배분으로 원가를 계산한다.
- 매도 기록 JSON에 다음 필드를 저장한다.
  - `lotMode`: `fifo` 또는 `specific`
  - `selectedLotId`
  - `netProceeds`
  - `costBasis`
  - `realizedPnl`
  - `realizedPnlPercent`
  - `lotDispositions`
- lot 재계산 로직은 새 매도 기록의 `selectedLotId`를 읽어 해당 lot을 먼저 차감한다.
- 보유 종목 집계는 평균원가 차감 방식이 아니라 open lot 잔여 수량/잔여 원가 합산 기준으로 보정했다.
- 기록 타임라인에 매도 건의 실현손익, 원가, lot 배분 방식을 표시한다.
- 백업 복원 검증에 매도 lot 손익 필드의 음수 방지 검증을 추가했다.

판단:

- 기존 장부와 호환성을 유지하기 위해 별도 migration 없이 새 매도 기록부터 손익 필드를 저장한다.
- 과거 매도 기록은 `lotMode`가 없으면 기존 FIFO 해석으로 계속 남긴다.
- 특정 lot 선택이 없는 경우에도 실현손익은 FIFO 기준으로 저장되므로, 앞으로 손익 집계의 기반으로 쓸 수 있다.
- 보유 카드의 평균 원가와 전략 cap 판단은 남은 lot 원가 기준으로 맞춰진다.

0.3.7 당시 한계:

- 실현손익은 타임라인에 표시되지만 자산 탭 손익 분해에는 아직 집계하지 않는다. 이 항목은 `0.3.8`에서 1차 반영했다.
- lot이 매우 많아질 때 선택 버튼 목록이 길어질 수 있다. 다음 UI 정리 때 접기/검색/상세 화면이 필요하다.
- 전략 엔진과 lot 손익 계산의 단위 테스트 분리는 아직 남아 있다.

검증:

- `:app:assembleDebug` 빌드 성공.
- `aapt dump badging` 확인:
  - versionCode: `19`
  - versionName: `0.3.7`
  - `INTERNET`, `POST_NOTIFICATIONS`, `RECEIVE_BOOT_COMPLETED` 권한 포함
- APK 내부 포함 확인:
  - `classes.dex`
  - `assets/api/manifest.json`
  - `assets/api/signals/latest.json`
  - `assets/api/prices/latest.json`
  - `assets/api/fx/latest.json`
  - `assets/api/weekly-trends/latest.json`
- `git diff --check` 통과.
- 전달용 APK SHA-256:
  - `001B236D57CD340221356A8B90D8C70C9F5523F967E4B292B486AC08C8C501D8`

APK:

- `artifacts/investor-run-debug-0.3.7.apk`

## v0.3.8 자산 손익 집계

작성일: 2026-07-09

반영:

- `LedgerStore`에 `PnlSummary` 집계 모델을 추가했다.
- 전체 자산 기준과 계좌별 기준으로 실현손익, 미실현손익, 투자 손익 합계를 계산한다.
- 실현손익은 `0.3.7` 이후 매도 기록의 `realizedPnl`, `costBasis`, `netProceeds`를 기준으로 집계한다.
- 원가 필드가 없는 과거 매도 기록은 실현손익에서 제외하고 `미집계 매도`로 따로 카운트한다.
- 미실현손익은 현재가와 open lot 잔여 원가 기준으로 계산한다.
- 미국 계좌 USD 손익은 계좌 화면에서는 USD 기준, 전체 손익에서는 현재 USD/KRW 기준 원화 환산으로 표시한다.
- `AccountSnapshot`에 실현손익, 미실현손익, 투자 손익 필드를 추가했다.
- 총자산 카드에 투자 손익, 실현손익, 미실현손익을 추가했다.
- 계좌 카드에 기준 통화별 실현손익과 미실현손익을 추가했다.
- 자산 탭 손익 분해 카드의 placeholder를 실제 집계값으로 교체했다.
- 자산 스냅샷 JSON에 `realizedPnlKrw`, `unrealizedPnlKrw`, `investmentPnlKrw`를 저장한다.

판단:

- 실현손익은 매도 시점 환율이 아니라 현재 USD/KRW 기준으로 원화 환산한다. 아직 매도 당시 환율을 체결 기록에 저장하지 않기 때문이다.
- 배당, 세금, 환율효과는 별도 장부 이벤트와 환율 히스토리가 필요하므로 이번 버전에서는 분리 계산하지 않았다.

0.3.8 당시 한계:

- 손익 추세 그래프는 아직 별도 선으로 표시하지 않는다. 이 항목은 `0.3.10`에서 1차 반영했다.
- 배당/세금/환율효과 분해는 다음 장부 이벤트 확장이 필요하다.

검증:

- `:app:assembleDebug` 빌드 성공.
- `aapt dump badging` 확인:
  - versionCode: `20`
  - versionName: `0.3.8`
  - `INTERNET`, `POST_NOTIFICATIONS`, `RECEIVE_BOOT_COMPLETED` 권한 포함
- APK 내부 포함 확인:
  - `classes.dex`
  - `assets/api/manifest.json`
  - `assets/api/signals/latest.json`
  - `assets/api/prices/latest.json`
  - `assets/api/fx/latest.json`
  - `assets/api/weekly-trends/latest.json`
- `git diff --check` 통과.
- 전달용 APK SHA-256:
  - `A42D0683B39AFAE34FE48B37E58DAF0FD79B5A37B089ACE64A74AA8D569D74BC`

APK:

- `artifacts/investor-run-debug-0.3.8.apk`

## v0.3.9 매수 평균가 표시

작성일: 2026-07-09

사용자 피드백:

- 운용 카드에서 `현재 원금`과 `기준가`만 보이면 사용자가 실제로 얼마에 매수했는지 판단하기 어렵다.
- 매수한 평균가가 운용 화면에 들어가야 한다는 피드백이 있었다.

반영:

- `LedgerStore.averageBuyPrice(accountId, symbol)`를 추가했다.
- open lot의 잔여 수량을 기준으로 사용자가 입력한 체결 평균가를 가중 평균한다.
- 운용 카드의 추천 종목에 `매수 평균가`를 표시한다.
- 운용 카드에 기준가와 매수 평균가의 차이를 `평단 대비` 퍼센트로 표시한다.
- 주문 가이드 다이얼로그에도 기존 보유 종목의 매수 평균가와 평단 대비 수익률을 표시한다.
- ETF 리밸런싱 가이드에도 보유 ETF의 매수 평균가와 평단 대비 수익률을 표시한다.

판단:

- `현재 원금`은 open lot 잔여 원가이고, `매수 평균가`는 체결 평균가 기반이다.
- 수수료/세금을 포함한 원가/주와 사용자가 입력한 체결 평균가는 성격이 다르므로 분리해서 표시한다.

검증:

- `:app:assembleDebug` 빌드 성공.
- `aapt dump badging` 확인:
  - versionCode: `21`
  - versionName: `0.3.9`
  - `INTERNET`, `POST_NOTIFICATIONS`, `RECEIVE_BOOT_COMPLETED` 권한 포함
- APK 내부 포함 확인:
  - `classes.dex`
  - `assets/api/manifest.json`
  - `assets/api/signals/latest.json`
  - `assets/api/prices/latest.json`
  - `assets/api/fx/latest.json`
  - `assets/api/weekly-trends/latest.json`
- `git diff --check` 통과.
- 전달용 APK SHA-256:
  - `CAC8E75F847AF958C4C9A322CEFEC50FFFC146E336F5C7568BF56EEE76670FB2`

APK:

- `artifacts/investor-run-debug-0.3.9.apk`

## v0.3.13 목표 초과 상태 문구 보정
작성일: 2026-07-09

사용자 피드백:

- 목표가 10,000 USD인데 12,000 USD를 매수했을 때 목표 이내처럼 표시되는 것은 맞지 않다.

판정:

- 맞지 않다. 12,000 USD는 목표 10,000 USD 대비 20% 초과이므로 목표 범위가 아니다.
- 다만 종목 한도 안이면 즉시 매도 지시가 아니라 확인 필요 상태로 보여주는 것이 맞다.

반영:

- 주식 매수 신호에서 목표보다 허용 오차 이상 많이 산 경우 `확인 필요: 목표보다 N 초과 · 한도 이내`로 표시한다.
- 목표 대비 5% 또는 1주 가격 이내일 때만 `완료: 목표 범위`로 표시한다.
- 종목 한도 자체를 넘으면 `조정 필요: 종목 한도 N 초과`로 표시한다.

검증:

- `:app:assembleDebug` 빌드 성공.
- `aapt dump badging` 확인:
  - versionCode: `25`
  - versionName: `0.3.13`
- `git diff --check` 통과.

APK:

- `artifacts/investor-run-debug-0.3.13.apk`
- SHA-256: `A1CB1A84EADD4EF1F031B2927DE680EE8A8697B4FD2F0A242E209D6CF9F2004F`

## v0.3.12 이번 체결 잔여 원가 기준 보정
작성일: 2026-07-09

사용자 피드백:

- 0.3.11 설치 후 STX의 `이번 목표`와 `이번 체결`이 여전히 이상하게 보였다.
- 기록 타임라인에는 STX 매수 4주, 4주, 7주, 4주와 중간 매도 5주가 있었는데, 앱은 매도 원가를 이번 체결에서 차감하지 않았다.

원인:

- `executedOrderValue()`가 이번 신호 기간의 매수 기록 총액만 더했다.
- `LedgerStore.lots()`는 매도 차감 후 open lot 잔여 원가를 이미 계산하고 있었지만, 운용 검증은 이 값을 쓰지 않았다.
- 주식 매수 신호를 ETF 리밸런싱처럼 목표 초과 시 조정 필요로 보는 판정도 실전 운용과 맞지 않았다.

반영:

- `HoldingLot`에 `signalId`, `strategyKey`를 추가해 이번 신호 lot을 식별한다.
- `이번 체결`은 `ledger.lots(accountId, symbol)`의 open lot 잔여 원가 중 이번 신호 lot만 합산한다.
- 매도한 lot의 원가는 open lot에서 이미 빠지므로 `이번 체결`에도 자동 반영된다.
- 주식 매수 신호는 목표 이상 매수했더라도 종목 한도 안이면 완료로 표시한다.
- 종목 한도 초과일 때만 초과 조정 필요로 표시한다.

STX 검산:

- 매수 총액 약 17,215.92 USD
- 매도 원가 약 4,501.43 USD
- 이번 신호 잔여 원가 약 12,714.49 USD
- 0.3.12에서는 이 잔여 원가가 `이번 체결` 기준이 된다.

검증:

- `:app:assembleDebug` 빌드 성공.
- `aapt dump badging` 확인:
  - versionCode: `24`
  - versionName: `0.3.12`
- `git diff --check` 통과.

APK:

- `artifacts/investor-run-debug-0.3.12.apk`
- SHA-256: `16093F21D7F2FE038AD4930835C6C4783420530DA1FAC457054F858656BC109C`

## v0.3.11 월간 목표 고정과 체결 검증 보정
작성일: 2026-07-09

사용자 피드백:

- STX를 추천 목표에 맞춰 매수했는데 앱이 초과로 표시했다.
- 증권사 기준 STX 14주 매입금액은 약 12,691 USD였고, 앱은 남은 현금/현재 상태로 목표를 다시 줄인 뒤 누적 보유 원금과 비교하고 있었다.

원인:

- 운용 추천 카드의 `target`은 사실상 현재 시점의 추가 주문 가능액인데, 화면에서는 누적 보유 원금과 직접 비교했다.
- 매수 후 현금이 줄어들면 `deployable`이 작아지고, 같은 신호의 목표가 실행 과정에서 축소됐다.
- 이번 신호에서 이미 체결한 금액과 전체 누적 보유 원금이 분리되지 않았다.

반영:

- `OrderPlan`을 추가해 이번 목표, 이번 체결, 남은 매수, 추가 권장 금액, 총 보유 원금, 종목 한도를 분리 계산한다.
- 미국/한국 주식 목표 산식은 신호 `validFrom` 이후의 매수 체결을 제외한 체결 전 기준으로 계산한다.
- 이번 신호의 체결 금액은 `signalId` 우선, 구버전 기록은 종목/전략/유효기간 기준으로 합산한다.
- 추천 카드, Action Inbox, 주문 가이드, 체결 저장 후 토스트가 모두 `이번 목표` 대비 `이번 체결`을 기준으로 검증한다.
- STX처럼 목표 대비 약간 초과한 체결은 기존 허용 기준인 5% 또는 최소 주문 단위 안에서 완료로 처리한다.

검증:

- `:app:assembleDebug` 빌드 성공.

APK:

- `artifacts/investor-run-debug-0.3.11.apk`
- SHA-256: `89BC1EC9B1B385246DA090CE4A586B38A766E0F067B8319E6B898699F87284D6`

## v0.3.10 손익 추세 그래프

작성일: 2026-07-09

반영:

- 자산 탭에 `손익 추세` 카드를 추가했다.
- 기존 자산 변화와 같은 일/주/월 범위를 사용한다.
- 손익 추세 카드에는 현재 투자 손익, 실현손익, 미실현손익, 기간 변화를 표시한다.
- `AssetLineChartView`가 음수 값을 그릴 수 있도록 확장했다.
- 손익 차트는 투자 손익, 실현손익, 미실현손익 3개 선을 표시한다.
- 손익 필드가 없는 과거 스냅샷만 있는 경우 `0.3.8 이후 생성된 스냅샷부터 손익 값이 쌓입니다.` 안내를 표시한다.

판단:

- 손익 추세는 별도 저장소를 만들지 않고 기존 자산 스냅샷의 `realizedPnlKrw`, `unrealizedPnlKrw`, `investmentPnlKrw`를 재사용한다.
- 손익은 음수가 자연스러운 지표이므로 차트 최소값을 0으로 강제하지 않도록 고쳤다.

현재 한계:

- 배당, 세금, 환율효과는 아직 독립 분해하지 않는다.
- 손익 추세는 앱 내부 스냅샷 기준이므로 과거 브로커 기록을 자동 역산하지 않는다.

검증:

- `:app:assembleDebug` 빌드 성공.
- `aapt dump badging` 확인:
  - versionCode: `22`
  - versionName: `0.3.10`
  - `INTERNET`, `POST_NOTIFICATIONS`, `RECEIVE_BOOT_COMPLETED` 권한 포함
- APK 내부 포함 확인:
  - `classes.dex`
  - `assets/api/manifest.json`
  - `assets/api/signals/latest.json`
  - `assets/api/prices/latest.json`
  - `assets/api/fx/latest.json`
  - `assets/api/weekly-trends/latest.json`
- `git diff --check` 통과.
- 전달용 APK SHA-256:
  - `68AC50E370D8B3A7420F7E70AD8A1F173EC9A8935C6F3C3E1737D60B1FD15191`

APK:

- `artifacts/investor-run-debug-0.3.10.apk`

## v0.3.31 한국 ETF-I 전략 적용
작성일: 2026-07-10

사용자 요청:

- 한국 ETF 전략을 기존 `kr_etf_benchmark_or_alpha` 검토 흐름에서 `kr_etf_benchmark_or_alpha_defensive` 후보로 교체 적용한다.
- KODEX200이 강하면 국내 알파 ETF 1위에 100%, 약하면 방어 ETF 1위에 100% 리밸런싱하는 ETF-I 규칙을 앱 신호와 연금 계좌 기본 전략에 반영한다.

반영:

- `scripts/build-signal-package.mjs`에 `KR_ETF_ACTIVE_STRATEGY_KEY`를 추가하고 현재 공식 앱 ETF 신호 키를 `kr_etf_benchmark_or_alpha_defensive`로 변경했다.
- ETF-I 신호는 `data/korea-etf-score-variant-test.json`의 최신 5년 결과에서 현재 목표 ETF를 읽고, `data/korea-etf-10y-validation.json`의 10년 검증 결과를 카탈로그/백테스트 메타데이터로 함께 제공한다.
- 생성된 `app/src/main/assets/api/signals/kr-etf/latest.json`은 2026-07-10 기준 `395160.KS KODEX 시스템반도체` 100% 목표 비중을 포함한다.
- `strategies/catalog.json`에는 ETF-I를 `active`, 기존 ETF-H `kr_etf_benchmark_or_alpha`를 `candidate` 비교 전략으로 남겼다.
- Android 연금 계좌 기본 전략을 ETF-I로 변경하고 전략 선택 목록에 ETF-I, ETF-H, 이전 Core/Satellite를 구분해 표시한다.

검증:

- 신호 패키지 생성 성공: `Built signal package: 7 signals, 7 trends, 24 quotes`
- `kr-etf/latest.json` 확인:
  - strategyKey: `kr_etf_benchmark_or_alpha_defensive`
  - targetWeight: `395160.KS` 100%
  - 5년 검증: totalReturn `4.9307`, CAGR `0.4193`, MDD `-0.1755`
  - 10년 검증: totalReturn `16.1724`, CAGR `0.3258`, MDD `-0.1757`
- `:app:testDebugUnitTest :app:assembleDebug` 성공.
- `aapt dump badging` 확인:
  - versionCode: `43`
  - versionName: `0.3.31`
  - `INTERNET`, `POST_NOTIFICATIONS`, `RECEIVE_BOOT_COMPLETED` 권한 포함

APK:

- `artifacts/investor-run-debug-0.3.31.apk`
- SHA-256: `3104F9A7B5BF3145A1D29BE1AD617567D2E0BCE6B0AC1ACC647721E8573ACCAA`

## v0.3.32 보안, ETF 실행 정책, 테스트 보강
작성일: 2026-07-10

팀 리뷰 결과를 반영했다.

보안:

- Android OS 자동 앱 백업을 끄기 위해 `allowBackup=false`, `fullBackupContent=false`를 적용했다.
- 평문 HTTP 통신을 차단하기 위해 `usesCleartextTraffic=false`를 적용했다.
- 장부 백업 UI는 파일 저장을 기본 동선으로 바꾸고, 클립보드 백업은 `고급` 기능으로 이동했다.
- 클립보드 백업 실행 전 경고 다이얼로그를 표시하고, 복사 후 1분 뒤 앱이 해당 백업 클립을 자동 삭제한다.
- Android 13 이상에서는 백업 클립을 민감 정보로 표시한다.

ETF 실행 정책:

- `StrategySignal`이 `orderHint.driftThreshold`, `minTradeAmount`, `concentrationLimit`, `requiresPensionTradabilityCheck`를 파싱한다.
- ETF 리밸런싱 계산은 더 이상 1.5%를 하드코딩하지 않고 신호의 `driftThreshold`를 사용한다.
- ETF-I 현재 신호의 5% 허용 괴리와 50,000원 최소 주문금액이 앱 화면과 계산에 반영된다.
- 연금계좌 매수 가능 여부 확인 경고를 ETF 리밸런싱 카드에 표시한다.

테스트:

- 기존 `main()` 기반 자체 테스트를 JUnit4 테스트로 전환했다.
- `testImplementation 'junit:junit:4.13.2'`를 추가했다.
- ETF 5% 괴리 허용 테스트를 추가했다.

검증:

- `--offline :app:testDebugUnitTest :app:assembleDebug` 성공.
- JUnit 테스트 결과:
  - `StrategyMathSelfTest`
  - tests: `8`
  - failures: `0`
  - errors: `0`
- APK manifest 확인:
  - versionCode: `44`
  - versionName: `0.3.32`
  - `allowBackup=false`
  - `fullBackupContent=false`
  - `usesCleartextTraffic=false`

APK:

- `artifacts/investor-run-debug-0.3.32.apk`
- SHA-256: `ED974DCF8890D4942FCB28A1BC413D32DE4510FC2583BC2DE6172CAB04B6FA5C`

## v0.3.33 주봉 훼손 최신 시세 재검증
작성일: 2026-07-10

사용자 확인 이슈:

- STX의 GitHub 주봉 스냅샷은 `종가 868.26`, `주봉 기준선 870.33`이라 `broken`으로 내려왔지만, 앱/사용자 화면의 최신 STX 가격은 `890.09`로 기준선 위에 있었다.
- 기존 앱은 Action Inbox, 보유 lot 매도 버튼, 알림 카운트에서 주봉 스냅샷의 `trendState`만 그대로 사용해 최신 시세로 해소된 경고도 계속 매도 검토로 표시했다.

수정:

- `SignalRepository`에 `effectiveTrendClose`, `effectiveTrendDate`, `effectiveTrendState`, `isTrendBrokenNow`를 추가했다.
- 정상 최신 시세가 있고 그 날짜가 주봉 스냅샷 기준일 이후라면, 기존 `broken` 경고를 최신 가격으로 재확인한다.
- 최신 정상 시세가 주봉 기준선 위이면 Action Inbox의 주봉 매도 경고와 알림 카운트에서 제외한다.
- 보유 종목 카드의 주봉 상태 pill과 lot별 주봉 훼손 매도 버튼도 같은 재검증 결과를 사용한다.
- 주봉 상세 팝업에는 `종가`/`최신가`, 가격 기준일, 주봉 기준선을 함께 보여주도록 보강했다.
- 최신 시세만으로 새로운 주봉 훼손을 만들지는 않는다. 서버/Pages가 내려준 `broken` 신호를 최신 정상 시세로 해소할 때만 사용한다.

검증:

- `StrategyMathSelfTest.weeklyBreakUsesLatestQuoteToClearStaleBreak` 추가.
- `868.26 < 870.33`이면 경고 유지, 최신 `890.09`가 있으면 경고 해소, `869.99`이면 경고 유지 검증.
- `--offline :app:testDebugUnitTest :app:assembleDebug` 성공.
- JUnit tests: `9`, failures: `0`, errors: `0`
- APK manifest 확인:
  - versionCode: `45`
  - versionName: `0.3.33`

APK:

- `artifacts/investor-run-debug-0.3.33.apk`
- SHA-256: `FC2B85FF0981B87A5BCF3002A624B8A279CD897F4E0AC56CA0453C91168BF2BE`

## v0.3.34 데이터 안정성, 장부 점검 UX, 원금 기준 설명 보강
작성일: 2026-07-10

사용자 요청:

- 이전에 작업한 항목과 중복하지 않고 남은 실전 운용 안정화 작업을 진행한다.

범위 선정:

- 이미 반영된 백업 파일 저장/복원, 데이터 실패 메시지, 장부 점검, 원금 기준 요약, 주봉 최신 시세 재검증은 재작업하지 않았다.
- 이번 작업은 `부분 시세 실패 처리`, `거래 대상 시세 상태 표시`, `장부 점검 조치 안내`, `원금 기준 설명 명확화`에 한정했다.

수정:

- 직접 시세 갱신이 일부만 성공해도 새로 받은 정상 시세와 이전 정상 live cache를 병합한다.
- 예: TECH 갱신 성공, STX 갱신 실패라면 기존 STX 정상 캐시를 유지하고 TECH만 새 값으로 교체한다.
- 환율만 성공하고 가격은 모두 실패한 경우 기존 가격 캐시를 건드리지 않는다.
- 오늘 화면과 기록 탭 데이터 카드에 `거래 대상 시세`를 추가해 추천/보유/ETF 대상 중 몇 개가 정상 시세인지 보여준다.
- 문제가 있는 거래 대상은 `확인할 종목`으로 최대 4개까지 표시한다.
- 장부 점검 카드에서 가격/환율 데이터가 불안정할 때 신규 매수/ETF 리밸런싱은 차단되고 수동 기록만 허용된다는 안내를 추가했다.
- 가격/환율 문제 또는 평균원가 임시평가가 있으면 `시세/환율 갱신` 버튼을 한 번만 표시한다.
- 원금 기준 요약 카드에 계산 기준을 추가했다.
  - 순입금 원금이 있으면 `현재 총자산 - 누적 순입금 원금`
  - 순입금 원금이 없으면 `현재 총자산 - 선택 기간 시작 총자산`
- `기타/반올림` 표기를 `현금/시세 잔차`로 바꾸고, 투자 손익으로 보지 않는 값임을 설명했다.

검증:

- 부분 시세 갱신 테스트 `liveQuoteMergeKeepsPreviousNormalQuoteWhenPartialSyncFails` 추가.
- Android local unit test의 `org.json` mock 제약 때문에 JSON 파싱과 순수 병합 로직을 분리했다.
- `--offline :app:testDebugUnitTest :app:assembleDebug` 성공.
- JUnit tests: `10`, failures: `0`, errors: `0`
- APK manifest 확인:
  - versionCode: `46`
  - versionName: `0.3.34`

APK:

- `artifacts/investor-run-debug-0.3.34.apk`
- SHA-256: `1FBCA38C431432087AB032503C79B240B2491FDE7ECCF2B163C58EA3F5C0DEFF`

## v0.3.35 오늘 화면 단순화와 Action Inbox 운용 단계 정리
작성일: 2026-07-10

사용자 확인 이슈:

- 오늘 화면의 데이터 상태 카드가 가격 상태, 환율 상태, 동기화 시각, 실패 원인까지 모두 노출해 실전 운용 화면으로는 너무 복잡했다.
- 이미 전략상 매수를 마친 종목이 Action Inbox에 계속 `신규 매수`로 남아 있었다.
- 전략 운용 흐름상 매수 이후 6개월까지는 `전략 유지중`이어야 하며, 6개월 50% 매도 이후 남은 수량에 대해서만 주봉/12개월 매도 액션을 띄우는 편이 맞다.

수정:

- 오늘 화면의 데이터 상태를 `데이터 양호` / `데이터 확인 필요` 신호등 카드로 단순화했다.
- 가격 상태, 환율 상태, 마지막 동기화 실패 같은 개발자용 세부 정보는 오늘 화면에서 제거하고 기록 탭 데이터 동기화 영역에 남겼다.
- `Action Inbox` 섹션명을 `오늘 할 일`로 바꿨다.
- 오늘 할 일이 없으면 `전략 유지 중입니다` 메시지를 보여주고, 6개월 보유 구간에서는 조용히 관리된다는 설명을 추가했다.
- 신규 매수 액션은 `매수 기록이 있고 추가 권장 수량이 0주`이면 완료로 보고 숨긴다.
- ETF 리밸런싱 액션은 실제 매수/매도 수량이 있을 때만 표시한다.
- 주봉 훼손 일반 감시 카드를 제거하고, lot 기준 매도 이벤트로 통합했다.
- Action Inbox에 lot 기반 매도 액션을 추가했다.
  - 12개월 도달: 전량 매도
  - 6개월 도달: 원래 lot의 50% 매도
  - 6개월 50% 매도 이후 주봉 훼손: 잔여 수량 매도 검토
- 시장 알림 카운트도 같은 운용 단계 기준으로 조정했다.
  - 이미 현재 신호 lot이 있으면 신규 매수 카운트에서 제외
  - 주봉 매도 카운트는 실제 `weeklyBreakDueQuantity`가 있는 lot만 집계

검증:

- `StrategyMath.isBuyActionComplete()` 추가.
- `buyActionCompletesAfterExecutedWhenNoAdditionalShareIsPossible` 테스트 추가.
- `--offline :app:testDebugUnitTest :app:assembleDebug` 성공.
- JUnit tests: `11`, failures: `0`, errors: `0`
- APK manifest 확인:
  - versionCode: `47`
  - versionName: `0.3.35`

APK:

- `artifacts/investor-run-debug-0.3.35.apk`
- SHA-256: `26FC7F76BA6D4AE7DCE0956C48F1E7D1C569D100C2B6D8693BF17B06D4154530`

## v0.3.36 매도 정정, lot 선택 UX, 비용 분해, 캘린더/밀도 개선
작성일: 2026-07-10

사용자 우선순위:

- 중요한 남은 항목으로 `1 매도 기록 정정 UI`, `2 lot 선택 UX`, `4 Action 상태 모델`, `5 입출금/체결 입력 UX`, `6 비용/환전 손익 분해`, `9 휴장일/조기폐장 캘린더`, `10 UI 밀도`, `12 Compose/Material 3 재구성`을 지정했다.

이번 적용 범위:

- 매도 체결 정정 UI를 기록 타임라인에 추가했다.
- 매도 정정은 원본 기록 삭제가 아니라 원본 void 처리, 정정 취소 기록, 새 매도 기록 삽입 방식으로 감사 추적을 남긴다.
- 매도 정정 시 원본 매도 이전 시점의 lot 후보를 기준으로 원가/실현손익을 다시 계산한다.
- 일반 매도와 매도 정정 입력에 lot 선택, 가능 수량, 50%/전량 버튼, 예상 실현손익 미리보기를 추가했다.
- 매도 저장 버튼은 검증 실패 시 다이얼로그를 닫지 않도록 매수 입력과 같은 패턴으로 변경했다.
- 손익 분해 카드에 누적 비용, 매수 비용, 매도 비용을 추가했다.
- 미국장 휴장일은 2028년 이후도 규칙 기반으로 계산하도록 확장했다.
- 미국 조기폐장 후보는 Thanksgiving 다음날, Independence Day 전일, Christmas Eve를 판별한다.
- 한국장 음력 휴장일은 거래소 확정 공지가 필요한 영역이므로 연간 수동 업데이트 대상으로 문서화했다.
- 카드/버튼 여백과 버튼 높이를 줄여 화면 밀도를 개선했다.
- Compose/Material 3는 전면 재작성 대신 기록 입력, 자산 카드 등 독립 화면부터 점진 전환하는 원칙으로 문서화했다.

검증:

- `marketCalendarCoversFutureUsHolidaysAndEarlyClose` 테스트 추가.
- `--offline :app:testDebugUnitTest :app:assembleDebug` 성공.
- JUnit tests: `12`, failures: `0`, errors: `0`
- APK manifest 확인:
  - versionCode: `48`
  - versionName: `0.3.36`

APK:

- `artifacts/investor-run-debug-0.3.36.apk`
- SHA-256: `E033D056D8D1614FFB59EEF0E70EC6D56A402B77F56B372AD628DB5296FCA720`

남은 설계 메모:

- 배당 입력/세후 배당 손익 분해는 v0.3.37에서 장부 이벤트 모델로 처리했다.
- 한국장 장기 휴장일은 매년 KRX 확정 공지 기준으로 업데이트해야 한다.
- Compose/Material 3 전환은 기존 Java 화면을 한 번에 교체하지 않고 화면 단위로 진행한다.

## v0.3.37 배당 기록과 세후 손익 반영
작성일: 2026-07-10

사용자 요청:

- 남은 작업을 계속 진행한다.
- Compose/Material 3 전면 전환보다 실전 운용에 바로 필요한 남은 기능을 우선한다.

수정:

- 새 장부 이벤트 `dividend`를 추가했다.
- 보유 종목 기준 배당 입력 UI를 추가했다.
  - 기록 탭 빠른 기록에서 `배당 기록` 버튼으로 진입한다.
  - 보유 종목을 선택한 뒤 세전 배당과 배당세를 입력한다.
  - 저장 전 세후 입금액과 세율을 미리 보여준다.
- 배당 저장 시 세후 입금액을 해당 계좌 현금에 자동 반영한다.
- 배당 기록은 세전 배당, 배당세, 세후 입금액을 분리 저장한다.
- USD 배당은 기록 당시 USD/KRW 환율도 함께 저장한다.
- 배당 기록 취소/되돌리기 로직을 추가했다.
- 백업/복원 검증이 `dividend` 기록을 지원하도록 확장했다.
- 손익 분해 카드에 아래 항목을 추가했다.
  - 세후 배당
  - 세전 배당
  - 배당세
  - 배당 기록 수
- 투자 손익 기준을 `실현손익 + 미실현손익 + 세후 배당`으로 확장했다.
- 손익 기준 버전을 `3`으로 올려 기존 손익 스냅샷과 새 배당 포함 손익이 섞이지 않게 했다.

검증:

- `--offline :app:testDebugUnitTest :app:assembleDebug` 성공.
- JUnit tests: `12`, failures: `0`, errors: `0`
- APK manifest 확인:
  - versionCode: `49`
  - versionName: `0.3.37`

APK:

- `artifacts/investor-run-debug-0.3.37.apk`
- SHA-256: `502CB093539B0F7628ACE9BB52BD7598D780F2F2CE80A80006ABB2383452AE9D`

남은 설계 메모:

- 배당금 자동 수집은 증권사 문자/카톡/알림 파싱 설계와 함께 별도 단계로 진행한다.
- 한국장 장기 휴장일은 KRX 확정 공지 기준으로 연간 업데이트한다.
- Compose/Material 3는 기능 안정화 후 화면 단위로 전환한다.

## v0.3.38 운용 추천 카드 단순화
작성일: 2026-07-10

사용자 확인 이슈:

- 운용 탭 추천 매수 카드가 `예산 정책`, `유효 시작`, `전략 근거`, `목표 기준`, `가격 상태`까지 모두 보여줘 실전 운용 화면으로는 너무 복잡했다.
- 완료된 매수 카드에도 큰 `주문 가이드` 버튼이 남아 있어 이미 처리한 종목처럼 보이지 않았다.

수정:

- 추천 매수 카드 기본 표시 항목을 아래로 축소했다.
  - 목표/체결
  - 남은 매수
  - 추가 수량
  - 평단/현재가 또는 현재가
  - 진행 바
  - 완료/조정 필요 상태
- `예산 정책`, `유효 시작`, `전략 근거`, `목표 기준`, `추가 권장`, 정상 상태의 `가격 상태` 상시 노출을 제거했다.
- 시세가 정상일 때는 가격 상태를 숨기고, 문제가 있을 때만 `시세 확인`으로 표시한다.
- 종목 한도는 보유 원금이 한도의 90% 이상일 때만 표시한다.
- 월간 스냅샷, 비 active 전략 상태, 데이터 기준일은 작은 보조 문구로만 표시한다.
- 추가 매수 수량이 0주인 완료 카드에서는 큰 `주문 가이드` 버튼을 숨긴다.

검증:

- `--offline :app:testDebugUnitTest :app:assembleDebug` 성공.
- JUnit tests: `12`, failures: `0`, errors: `0`
- APK manifest 확인:
  - versionCode: `50`
  - versionName: `0.3.38`

APK:

- `artifacts/investor-run-debug-0.3.38.apk`
- SHA-256: `448D8D11F8C03DFFD3CC3FAE9E2F6F9E5B1BE9791D584C4221FD75DD4EDF9600`

## v0.3.39 보유 종목 카드 단순화
작성일: 2026-07-10

사용자 확인 이슈:

- 운용 탭의 보유 종목 카드가 평가금액, 현재가, 평균 원가, 원금 기준, 가격 기준, 주봉 기준선, lot 일정, 매도 기록 버튼을 모두 보여줘 화면이 무겁게 느껴졌다.
- 정상 보유 구간에서는 6개월/12개월 일정만 알고 있으면 충분하고, 주봉 훼손이나 매도 이벤트가 있을 때만 눈에 띄게 보여주는 편이 실전 운용에 맞다.

수정:

- 보유 종목 카드 기본 표시 항목을 아래로 축소했다.
  - 평가/손익
  - 평단/현재가
  - 수익률
  - 다음 일정
- 정상 상태의 `alive`/`normal` pill을 숨기고, 주봉 훼손 조건이 유효할 때만 `매도 검토` pill을 표시한다.
- 가격 기준/가격 소스는 정상일 때 숨기고, 비정상일 때만 `시세 확인`으로 표시한다.
- 주봉 기준선은 주봉 훼손 조건이 유효할 때만 표시한다.
- lot 상세 박스와 날짜 목록을 없애고, 가장 가까운 이벤트를 한 줄로 요약한다.
- 평시 큰 `매도 기록` 버튼을 숨기고, 6개월/12개월/주봉 훼손 매도 이벤트가 실제로 도래했을 때만 매도 버튼을 표시한다.

검증:

- `--offline :app:testDebugUnitTest :app:assembleDebug` 성공.
- JUnit tests: `12`, failures: `0`, errors: `0`
- APK manifest 확인:
  - versionCode: `51`
  - versionName: `0.3.39`

APK:

- `artifacts/investor-run-debug-0.3.39.apk`
- SHA-256: `08F228CC46759BE2384F7501F418C6E82F495C287F6CCFC7F4179A5969F65210`

## v0.3.40 운용 화면 중복 제거와 수동 체결 복구
작성일: 2026-07-10

사용자 확인 이슈:

- 완료된 추천 매수 카드와 보유 종목 카드가 연달아 표시되어 같은 종목 정보가 반복되는 느낌이 강했다.
- 보유 카드에서 평시 매수/매도 입력 버튼을 숨기면서, 전략 이벤트와 무관하게 중간에 사거나 팔아야 할 때 기록 통로가 사라졌다.

수정:

- 완료된 추천 매수 신호는 종목별 주문 카드에서 제거하고 `이번 달 목표 완료` 요약 카드로 접었다.
- 남은 매수 또는 데이터 확인이 필요한 추천 신호만 주문 카드로 표시한다.
- 보유 종목 카드는 손익/평단/다음 일정 중심으로 유지하되, 하단에 `추가 매수`와 `매도 입력` 버튼을 항상 표시한다.
- `추가 매수`는 별도 수동 매수 다이얼로그로 기록한다.
  - 전략 추천 목표 체결액에 자동 합산하지 않는다.
  - 사용자가 직접 수량, 평균단가, 비용, 메모를 입력한다.
  - 가격 데이터가 지연되어도 수동 입력은 막지 않는다.
- `매도 입력`은 기존 FIFO/lot 선택 매도 다이얼로그를 그대로 사용한다.

검증:

- `--offline :app:testDebugUnitTest :app:assembleDebug` 성공.
- JUnit tests: `12`, failures: `0`, errors: `0`
- APK manifest 확인:
  - versionCode: `52`
  - versionName: `0.3.40`

APK:

- `artifacts/investor-run-debug-0.3.40.apk`
- SHA-256: `3A7E521F20C715B8FDE79C3B798DD9D26879BDFAF916C05759312BFDAE96ED96`

## v0.3.41 완료 추천 요약에 목표 수량과 진행 막대 복구
작성일: 2026-07-10

사용자 확인 이슈:

- 완료된 추천 매수 카드를 요약으로 접으면서 `목표 수량`, `목표/체결`, 진행 막대까지 사라져 목표만큼 매수했는지 확인하기 어려웠다.
- 매수 가이드가 사라진 이유와 한국 주식/ETF에도 같은 변경이 적용되는지 확인이 필요했다.

수정:

- 완료된 추천 요약 카드 안에 종목별 작은 블록을 추가했다.
  - 목표/체결
  - 목표 수량/보유 수량
  - 진행 막대
  - 완료 상태
- 큰 주문 카드는 계속 숨겨 보유 카드와의 중복은 줄였다.
- 목표 수량은 현재 기준가 기준의 약 목표 수량으로 표시한다.
- 보유 수량은 해당 신호 lot의 현재 잔여 수량으로 표시한다.

적용 범위:

- 미국 주식과 한국 주식의 `buy` 신호 완료 요약에 적용한다.
- ETF 리밸런싱은 목표 비중/매수/매도 판단이 필요한 별도 카드 구조를 유지한다.
- 매수 가이드는 `목표 범위 달성 + 추가 매수 수량 0주`이면 숨긴다.

검증:

- `--offline :app:testDebugUnitTest :app:assembleDebug` 성공.
- JUnit tests: `12`, failures: `0`, errors: `0`
- APK manifest 확인:
  - versionCode: `53`
  - versionName: `0.3.41`

APK:

- `artifacts/investor-run-debug-0.3.41.apk`
- SHA-256: `AC4A51CFE27F72ED227234CD6E166B06B5C2E585CA9D6E8DDC4F88A1CBA21210`

## v0.3.42 현금 부족 추천 신호 표시 개선
작성일: 2026-07-10

사용자 확인 이슈:

- 계좌에 현금이 없으면 추천 신호가 사라지거나 매수 가이드가 안 뜨는 것처럼 보일 수 있었다.
- 실제로는 추천이 없는 것이 아니라, 예수금이 없어 목표 주문금액과 추가 수량을 계산하지 못하는 상태이므로 화면에서 구분해야 한다.

수정:

- 예수금이 없거나 1주 매수 현금이 부족해도 추천 신호 카드를 숨기지 않는다.
- 주문 카드에 `현금 상태`를 추가하고, `예수금 없음 · 입금 후 계산` 또는 `입금 필요`를 표시한다.
- 현금 부족 상태의 기본 버튼은 `입금 기록`으로 바꾸고 해당 계좌 입금 다이얼로그로 연결한다.
- 오늘 할 일에서도 현금 부족 추천 신호는 `입금 기록` 액션으로 표시한다.
- 완료 판정은 단순히 추가 수량 0주가 아니라 `완료: 목표 범위` 상태일 때만 적용한다.

적용 범위:

- 미국 주식과 한국 주식의 `buy` 신호에 적용한다.
- ETF 리밸런싱은 별도 비중 조정 정책을 유지한다.

검증:

- `--offline :app:testDebugUnitTest :app:assembleDebug` 성공.
- JUnit tests: `12`, failures: `0`, errors: `0`
- APK manifest 확인:
  - versionCode: `54`
  - versionName: `0.3.42`

APK:

- `artifacts/investor-run-debug-0.3.42.apk`
- SHA-256: `609FF1D8B652D551A7A3B4B5E56611FEE4B54CFE972DEC913A9CC2448EA3BF98`

## v0.3.43 운용 탭 현금 부족 액션을 매수 가이드로 복구
작성일: 2026-07-10

사용자 확인 이슈:

- 운용 탭 추천 카드에 `입금 기록` 버튼이 직접 표시되어 계좌 관리와 운용 판단의 책임이 섞여 보였다.
- 입금은 계좌 탭에서 하고, 운용 탭에서는 매수 가이드가 떠야 한다.

수정:

- 현금 부족 추천 카드의 버튼을 `입금 기록`에서 `매수 가이드`로 바꿨다.
- 오늘 할 일의 현금 부족 추천 액션도 `매수 가이드`로 통일했다.
- 매수 가이드에서는 예수금 입력 전이라 매수 수량 계산 대기 상태임을 설명한다.
- 현금 부족 상태에서는 체결 기록 다이얼로그를 바로 열지 않는다.
- 필요한 경우 `계좌 보기`로 이동하게 하고, 운용 카드에서 직접 입금 다이얼로그를 열지 않는다.

검증:

- `--offline :app:testDebugUnitTest :app:assembleDebug` 성공.
- JUnit tests: `12`, failures: `0`, errors: `0`
- APK manifest 확인:
  - versionCode: `55`
  - versionName: `0.3.43`

APK:

- `artifacts/investor-run-debug-0.3.43.apk`
- SHA-256: `666EE48B2BFD3FEE2FE48DBE8AAF77EFE6AF8F606872A4431AC24DC2A8697025`
