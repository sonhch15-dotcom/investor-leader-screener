# Android App Build Notes

Development log: `android_app_development_log.md`
Team roles and update rules: `android_app_team_roles.md`
Current app map: `android_app_map.md`

작성일: 2026-07-09

## 현재 상태

- 현재 소스 버전: `0.3.43`
- 현재 소스 versionCode: `55`
- 최신 빌드 완료 APK: `artifacts/investor-run-debug-0.3.43.apk`
- 앱 ID: `com.sweethome.investor`
- 앱 이름: `Investor Run`
- 빌드 타입: debug

주의:

- `0.3.43` APK 빌드와 전달용 복사 완료.
- SHA-256: `666EE48B2BFD3FEE2FE48DBE8AAF77EFE6AF8F606872A4431AC24DC2A8697025`

## 다시 빌드하는 방법

PowerShell에서 아래 명령을 실행한다.

```powershell
$env:JAVA_HOME='C:\Program Files\Android\Android Studio\jbr'
$env:ANDROID_HOME='C:\Users\SweetHome\OneDrive\Documents\Investor\android-sdk'
.\gradlew.bat :app:assembleDebug --offline --no-daemon
```

처음 빌드하는 PC에서는 Gradle/Android Gradle Plugin/Android SDK 의존성을 내려받아야 할 수 있으므로 `--offline`을 빼고 한 번 실행한다.

```powershell
$env:JAVA_HOME='C:\Program Files\Android\Android Studio\jbr'
$env:ANDROID_HOME='C:\Users\SweetHome\OneDrive\Documents\Investor\android-sdk'
.\gradlew.bat :app:assembleDebug --no-daemon
```

현재 PC에서 필요한 SDK 구성:

- `platform-tools`
- `platforms;android-36`
- `build-tools;36.0.0`

2026-07-09 현재 `android-sdk/cmdline-tools/latest`, `platform-tools`, `platforms;android-36`, `build-tools;36.0.0` 설치가 완료되었다.

## v0.3.43 빌드 기록

- 빌드 일시: 2026-07-10
- APK: `artifacts/investor-run-debug-0.3.43.apk`
- versionCode: `55`
- versionName: `0.3.43`
- SHA-256: `666EE48B2BFD3FEE2FE48DBE8AAF77EFE6AF8F606872A4431AC24DC2A8697025`
- 검증:
  - `:app:testDebugUnitTest` 성공
  - `:app:assembleDebug` 성공
  - JUnit tests: `12`, failures: `0`, errors: `0`
  - `aapt dump badging`으로 package/version 확인
- 주요 변경:
  - 운용 탭의 현금 부족 추천 카드 버튼을 `입금 기록`에서 `매수 가이드`로 변경
  - 예수금 입력은 계좌 탭 책임으로 유지
  - 매수 가이드에서는 예수금 입력 전이라 수량 계산 대기 상태임을 설명
  - 현금 부족 상태에서는 가이드에서 체결 기록을 바로 열지 않고 `계좌 보기`만 제공
  - 오늘 할 일의 현금 부족 추천 액션도 `매수 가이드`로 통일

## v0.3.42 빌드 기록

- 빌드 일시: 2026-07-10
- APK: `artifacts/investor-run-debug-0.3.42.apk`
- versionCode: `54`
- versionName: `0.3.42`
- SHA-256: `609FF1D8B652D551A7A3B4B5E56611FEE4B54CFE972DEC913A9CC2448EA3BF98`
- 검증:
  - `:app:testDebugUnitTest` 성공
  - `:app:assembleDebug` 성공
  - JUnit tests: `12`, failures: `0`, errors: `0`
  - `aapt dump badging`으로 package/version 확인
- 주요 변경:
  - 예수금이 없거나 1주 매수 현금이 부족해도 추천 신호 카드는 숨기지 않음
  - 해당 상태를 `현금 입력 필요`로 보여주고 `입금 기록` 버튼으로 연결
  - 완료 판정은 단순히 추가 수량 0주가 아니라 `완료: 목표 범위` 상태일 때만 적용
  - 오늘 할 일에서도 현금 부족 추천 신호는 `입금 기록` 액션으로 표시
  - 미국/한국 주식 매수 신호에 적용, ETF 리밸런싱은 별도 비중 조정 정책 유지

## v0.3.41 빌드 기록

- 빌드 일시: 2026-07-10
- APK: `artifacts/investor-run-debug-0.3.41.apk`
- versionCode: `53`
- versionName: `0.3.41`
- SHA-256: `AC4A51CFE27F72ED227234CD6E166B06B5C2E585CA9D6E8DDC4F88A1CBA21210`
- 검증:
  - `:app:testDebugUnitTest` 성공
  - `:app:assembleDebug` 성공
  - JUnit tests: `12`, failures: `0`, errors: `0`
  - `aapt dump badging`으로 package/version 확인
- 주요 변경:
  - 완료된 추천 요약 카드에 종목별 `목표/체결`, `목표 수량/보유 수량`, 진행 막대 복구
  - 큰 주문 카드는 숨긴 상태를 유지해 보유 카드와의 중복은 줄임
  - 완료 판단 기준은 `목표 범위 달성 + 추가 매수 수량 0주`
  - 미국/한국 주식 매수 신호에는 같은 완료 요약 정책 적용
  - ETF 리밸런싱은 별도 ETF 전용 카드 정책 유지

## v0.3.40 빌드 기록

- 빌드 일시: 2026-07-10
- APK: `artifacts/investor-run-debug-0.3.40.apk`
- versionCode: `52`
- versionName: `0.3.40`
- SHA-256: `3A7E521F20C715B8FDE79C3B798DD9D26879BDFAF916C05759312BFDAE96ED96`
- 검증:
  - `:app:testDebugUnitTest` 성공
  - `:app:assembleDebug` 성공
  - JUnit tests: `12`, failures: `0`, errors: `0`
  - `aapt dump badging`으로 package/version 확인
- 주요 변경:
  - 완료된 추천 매수 신호는 큰 종목별 주문 카드에서 제거하고 `이번 달 목표 완료` 요약 카드로 접음
  - 남은 매수 또는 데이터 확인이 필요한 추천 신호만 주문 카드로 표시
  - 보유 종목 카드 하단에 `추가 매수`, `매도 입력` 버튼을 항상 표시
  - `추가 매수`는 전략 목표 계산을 건드리지 않는 수동 체결 기록으로 저장
  - 수동 매수/매도는 가격 데이터가 잠시 지연되어도 사용자가 직접 단가를 입력해 기록 가능

## v0.3.39 빌드 기록

- 빌드 일시: 2026-07-10
- APK: `artifacts/investor-run-debug-0.3.39.apk`
- versionCode: `51`
- versionName: `0.3.39`
- SHA-256: `08F228CC46759BE2384F7501F418C6E82F495C287F6CCFC7F4179A5969F65210`
- 검증:
  - `:app:testDebugUnitTest` 성공
  - `:app:assembleDebug` 성공
  - JUnit tests: `12`, failures: `0`, errors: `0`
  - `aapt dump badging`으로 package/version 확인
- 주요 변경:
  - 운용 탭 보유 종목 카드를 핵심 운용 정보 중심으로 단순화
  - 정상 주봉 상태 pill, 가격 소스, 정상 가격 상태, 평시 주봉 기준선 상시 노출 제거
  - 기본 표시를 `평가/손익`, `평단/현재가`, `수익률`, `다음 일정` 중심으로 축소
  - 주봉 훼손일 때만 `매도 검토` pill과 주봉 기준선 표시
  - 시세가 비정상일 때만 `시세 확인` 표시
  - lot 상세 박스와 평시 큰 `매도 기록` 버튼 제거
  - 6개월/12개월/주봉 훼손 매도 이벤트가 실제로 있을 때만 매도 버튼 표시

## v0.3.38 빌드 기록

- 빌드 일시: 2026-07-10
- APK: `artifacts/investor-run-debug-0.3.38.apk`
- versionCode: `50`
- versionName: `0.3.38`
- SHA-256: `448D8D11F8C03DFFD3CC3FAE9E2F6F9E5B1BE9791D584C4221FD75DD4EDF9600`
- 검증:
  - `:app:testDebugUnitTest` 성공
  - `:app:assembleDebug` 성공
  - JUnit tests: `12`, failures: `0`, errors: `0`
  - `aapt dump badging`으로 package/version 확인
- 주요 변경:
  - 운용 탭 추천 매수 카드를 핵심 정보 중심으로 단순화
  - `예산 정책`, `유효 시작`, `전략 근거`, `목표 기준`, `추가 권장`, `가격 상태` 상시 노출 제거
  - `목표/체결`, `남은 매수`, `추가 수량`, `평단/현재가`, `상태`만 기본 표시
  - 시세 상태는 정상일 때 숨기고, 문제 있을 때만 `시세 확인`으로 표시
  - 종목 한도는 한도에 가까울 때만 표시
  - 완료된 신호는 큰 `주문 가이드` 버튼을 숨김

## v0.3.37 빌드 기록

- 빌드 일시: 2026-07-10
- APK: `artifacts/investor-run-debug-0.3.37.apk`
- versionCode: `49`
- versionName: `0.3.37`
- SHA-256: `502CB093539B0F7628ACE9BB52BD7598D780F2F2CE80A80006ABB2383452AE9D`
- 검증:
  - `:app:testDebugUnitTest` 성공
  - `:app:assembleDebug` 성공
  - JUnit tests: `12`, failures: `0`, errors: `0`
  - `aapt dump badging`으로 package/version 확인
- 주요 변경:
  - 배당 장부 이벤트 `dividend` 추가
  - 보유 종목 기반 배당 입력 UI 추가
  - 세전 배당, 배당세, 세후 입금액 분리 저장
  - 배당 세후 금액을 현금과 투자 손익에 반영
  - 손익 분해에 세후 배당, 세전 배당, 배당세, 배당 기록 수 표시
  - 백업/복원 검증과 기록 취소/되돌리기에 배당 이벤트 반영
  - 손익 스냅샷 기준 버전을 `3`으로 올려 기존 기준 손익 추세와 섞이지 않게 처리

## v0.3.36 빌드 기록

- 빌드 일시: 2026-07-10
- APK: `artifacts/investor-run-debug-0.3.36.apk`
- versionCode: `48`
- versionName: `0.3.36`
- SHA-256: `E033D056D8D1614FFB59EEF0E70EC6D56A402B77F56B372AD628DB5296FCA720`
- 검증:
  - `:app:testDebugUnitTest` 성공
  - `:app:assembleDebug` 성공
  - JUnit tests: `12`, failures: `0`, errors: `0`
  - `aapt dump badging`으로 package/version 확인
- 주요 변경:
  - 매도 체결 정정 UI와 장부 정정 로직 추가
  - 일반 매도/매도 정정 입력에 lot 선택 및 예상 실현손익 미리보기 추가
  - 손익 분해에 누적 비용, 매수 비용, 매도 비용 표시
  - 미국장 2028년 이후 휴장 규칙과 조기폐장 판별 추가
  - 버튼/카드 여백을 줄여 모바일 화면 밀도 개선
  - Compose/Material 3 전환은 전면 교체가 아니라 화면별 점진 전환 단계로 유지

## 전략 계산 self-test

계산식만 빠르게 검증할 때는 Android 빌드 전에 아래 명령을 실행한다.

```powershell
$out='build\strategy-self-test'
New-Item -ItemType Directory -Force -Path $out | Out-Null
& 'C:\Program Files\Android\Android Studio\jbr\bin\javac.exe' -encoding UTF-8 -d $out app\src\main\java\com\sweethome\investor\StrategyMath.java app\src\test\java\com\sweethome\investor\StrategyMathSelfTest.java
& 'C:\Program Files\Android\Android Studio\jbr\bin\java.exe' -cp $out com.sweethome.investor.StrategyMathSelfTest
```

## 설치 방법

Android 기기가 USB 디버깅으로 연결되어 있으면 아래 명령으로 설치할 수 있다.

```powershell
& 'C:\Users\SweetHome\OneDrive\Documents\Investor\android-sdk\platform-tools\adb.exe' install -r app\build\outputs\apk\debug\app-debug.apk
```

## 현재 구현 범위

- 5개 탭: `오늘`, `계좌`, `운용`, `자산`, `기록`
- 3개 기본 계좌: `미국 주식 계좌`, `한국 주식 계좌`, `연금 ETF 계좌`
- 계좌별 사용자 지정 이름 저장
- 계좌 화면 미니탭: `전체`, `미국`, `한국`, `ETF`
- 운용 화면 미니탭: `미국`, `한국`, `ETF`
- 계좌별 전략 선택 다이얼로그
- 계좌별 현금, 거래, 보유 종목, 평가액 분리
- 미국 주식 계좌의 USD 주 운용 현금과 KRW 보조 현금 표시
- 전체 총자산은 KRW 기준으로 통합 표시
- 계좌별 투자 중 자산/현금 비중 막대 표시
- 도넛 파이 그래프: 계좌별 자산 비중, 현금/보유 비중, 보유 종목 비중
- 자산 탭 일/주/월 총자산 변화 라인 그래프
- 장부 기록, 원격 동기화, 백업 복원, 자산 탭 진입 시 일자별 자산 스냅샷 자동 갱신
- 계좌별 Action Inbox와 주문 가이드
- 운용 카드의 추가 권장 금액/수량 표시
- 운용 화면을 미국 주식, 한국 주식, 연금 ETF 미니탭으로 완전 분리
- 주문 후 목표 금액 대비 5% 이내 또는 최소 주문 단위 이내면 현실적 완료 처리
- 첫 체결 이후 월간 주문 목표 스냅샷 저장
- 정적 JSON asset 파싱: 월간 신호, ETF 목표 비중, 주봉 훼손, 종목별 최신가, 환율
- GitHub Pages `/api` 원격 URL 설정, 동기화, 캐시 저장, 캐시 삭제
- 원격 URL 저장 후 앱 실행 시 신호, 종목별 최신가, 환율 자동 동기화
- 앱 foreground 복귀와 오늘/운용/자산 화면 진입 시 15분 throttle로 원격 신호/시세 자동 동기화
- API key 없는 직접 시세/환율 갱신: Yahoo quote/chart, Frankfurter, Yahoo KRW=X fallback
- 직접 시세는 GitHub 신호 패키지와 분리된 live overlay로 저장
- 체결 이후 최신 시세가 아직 없으면 보유 평가/총자산/미실현손익/파이 그래프는 평균 원가로 임시 평가
- 평균 원가 임시 평가 중이면 보유 카드에 평가 기준가, 수신 시세, 임시 평가 경고 표시
- 계좌별 장부: 입금, 출금, 매수, 매도 기록
- 기록 타임라인 기본 접힘, 최근 기록 요약, 펼치기/접기
- 기록 타임라인 필터: 전체, 점검, 입출금, 체결, 환전, 취소
- 과거 기록 취소/정정: 원본을 삭제하지 않고 취소 표시와 정정 기록을 남김
- 입금/출금/매수 기록 정정 입력: 기존 값을 미리 채운 폼으로 원본 취소 + 새 정정 기록 생성
- 증권사 보유 수량/평단과 앱 장부 대조
- 보유 수량, 현금, 평가금액 계산
- 보유 종목 평가는 최신 quote가 유효하면 quote를 쓰고, 체결보다 오래된 quote이거나 quote가 없으면 평균 원가로 임시 평가
- 주문 가이드와 체결 기록 흐름
- 주봉 훼손 감시/매도 검토 카드
- 주식 계좌 FIFO lot 계산, 6개월 50% 매도, 12개월 전량 매도, 주봉 훼손 매도 이벤트 표시
- 매도 시 FIFO 자동 또는 특정 lot 직접 선택
- 매도 기록의 원가, 순매도대금, 실현손익, 실현손익률 저장과 타임라인 표시
- 전체/계좌별 실현손익, 미실현손익, 투자 손익 합계 표시
- 자산 스냅샷에 실현손익, 미실현손익, 투자 손익 합계 저장
- 자산 탭 손익 추세 라인 그래프
- 손익 추세는 현재 손익 기준 버전의 스냅샷만 비교
- 자산 탭 자산 변화 요약 카드: 현재 총자산, 입금 원금, 원금 대비, 현재 투자 손익, 환율 영향, USD/KRW 변화
- 자산 탭 원금 기준 3칸 요약: 원금 대비, 투자 손익, 환율 영향
- USD 입금/출금과 환전 기록의 원화 환산 기준 환율 저장
- 기록 타임라인의 USD 입출금 저장 환율 표시와 USD 입출금 정정 시 환율 보정
- 기록 탭 장부 점검 카드: 환율 누락, 평균원가 임시평가, 가격/환율 데이터, 스냅샷 상태 확인
- 장부 점검 카드에서 점검 필요 기록 필터로 바로 이동
- USD 입출금 환율 보정 후 자산 요약 확인 다이얼로그
- 장부 백업 파일 저장/불러오기
- 데이터 실패 메시지 사용자화와 사용 중 시세 기준 표시
- 운용 카드, 주문 가이드, ETF 리밸런싱 가이드에 사용자의 매수 평균가와 평단 대비 수익률 표시
- Android 알림 채널, 즉시 알림, 1분 뒤 테스트 알림
- 한국 주식, 연금 ETF, 미국 주식 시장 시간 기반 반복 알림
- 2026-2027 한국/미국 시장 휴장일을 건너뛰는 알림 캘린더
- 현재 신호/보유/lot 매도/데이터 상태를 반영한 시장 알림 문구
- 전략 계산 순수 모듈 `StrategyMath`
- 외부 의존성 없는 `StrategyMathSelfTest` 실전 시나리오 검증

## v0.3.29 백업 파일 저장/복원과 데이터 실패 메시지 정리

- 기록 탭 `백업과 안전장치`에 파일 기반 백업/복원을 추가했다.
  - `백업 파일 저장`: Android 문서 저장 화면으로 JSON 백업 파일 생성
  - `백업 파일 불러오기`: Android 문서 선택 화면에서 JSON 백업 파일 선택 후 확인 다이얼로그를 거쳐 복원
- 기존 클립보드 백업/복원은 유지했다.
- 백업 파일명은 `investor-run-backup-yyyyMMdd-HHmmss.json` 형식이다.
- 데이터 상태 카드와 데이터 동기화 카드에 `사용 중 시세` 기준을 표시한다.
- 원격/직접 시세 실패 메시지를 사용자 행동 중심으로 변환했다.
  - 404: GitHub Pages API URL과 `/api` 배포 확인
  - 401/403: 무료 시세 서버 요청 거절, 잠시 후 재시도
  - timeout/connect 실패: 네트워크 상태 확인
  - Frankfurter/Yahoo 동시 실패: 환율 무료 경로 재시도
- 자동 갱신 실패 시에도 마지막 정상 시세/환율 캐시를 유지한다는 안내를 표시한다.

검증:

- `StrategyMathSelfTest` 통과.
- `:app:assembleDebug` 빌드 성공.
- `aapt dump badging` 확인:
  - versionCode: `41`
  - versionName: `0.3.29`

APK:

- `artifacts/investor-run-debug-0.3.29.apk`
- SHA-256: `AF8EB41DCA62ADC889E6DBCCD70CBD5BC8B9B9AC7EECFCED24F4B8BC98A02B06`

## v0.3.28 장부 점검 필터와 환율 보정 후 자산 확인

- 기록 탭 순서를 `빠른 기록 -> 장부 점검 -> 기록 타임라인 -> 데이터 동기화 -> 백업`으로 조정했다.
- 기록 타임라인에 필터를 추가했다.
  - 전체
  - 점검
  - 입출금
  - 체결
  - 환전
  - 취소
- `점검` 필터는 활성 기록 중 USD 입출금 환율 누락과 원화/달러 환전 환율 누락 기록만 보여준다.
- 장부 점검 카드의 `점검 필요 기록만 보기` 버튼이 타임라인을 `점검` 필터로 열도록 연결했다.
- USD 입출금 환율 정정 저장 후 자산 스냅샷을 갱신하고 `자산 확인` 또는 `기록 보기`를 선택하는 다이얼로그를 표시한다.
- 환전 기록 환율 누락은 현재 정정 UI가 없으므로 취소 후 재입력 방식이라는 안내를 추가했다.

검증:

- `StrategyMathSelfTest` 통과.
- `:app:assembleDebug` 빌드 성공.
- `aapt dump badging` 확인:
  - versionCode: `40`
  - versionName: `0.3.28`

APK:

- `artifacts/investor-run-debug-0.3.28.apk`
- SHA-256: `CA2F9F8CB65837DA4E5320F0D7FC506DAB7FF25F66C1B2ADA41B61EF8B5853ED`

## v0.3.27 장부 점검과 원금 기준 계산 회귀 테스트

- 사용자가 제시한 실제 사례를 `StrategyMathSelfTest`에 추가했다.
  - `80,692 USD` 입금
  - TECH `112주 * 70.92`, STX `11주 * 906.52`
  - 현재가 TECH `71.15`, STX `890.09`
  - 현재 환율 `1,510.6`, 입금 당시 환율은 현재보다 `2.21` 높다고 가정
- 이 사례에서 투자 손익, 환율 영향, 원금 대비 변화가 모두 마이너스인지 self-test로 고정했다.
- 기록 탭에 `장부 점검` 카드를 추가했다.
- 장부 점검은 USD 입출금 환율 누락, 환전 환율 누락, 평균원가 임시평가 종목, 가격/환율 데이터 문제, 자산 스냅샷 수를 보여준다.
- 환율 누락 USD 입출금이 있으면 기록 타임라인을 펼쳐 정정 입력으로 이동하도록 안내한다.
- 자산 탭 `원금 기준 요약` 상단에 `원금 대비`, `투자 손익`, `환율 영향` 3칸 요약을 추가했다.
- 3칸 요약은 작은 화면에서 읽히도록 `만/억` 단위의 짧은 원화 표기를 사용한다.

검증:

- `StrategyMathSelfTest` 통과.
- `:app:assembleDebug` 빌드 성공.
- `aapt dump badging` 확인:
  - versionCode: `39`
  - versionName: `0.3.27`

APK:

- `artifacts/investor-run-debug-0.3.27.apk`
- SHA-256: `4D69439D6837CBE102E78A3F651D8211DED62D0EA780F0006C5E356678C79C10`

## v0.3.26 입금 당시 환율 저장과 원금 기준 자산 변화

- USD 입금/출금 기록에 `fxRateKrw`를 저장한다.
- 환전 기록에는 원화/달러 변환 금액으로 계산한 `fxRateKrw`를 저장한다.
- 기존 USD 입금처럼 환율이 없는 기록은 가장 이른 자산 스냅샷 환율로 원금 환산을 추정한다.
- 기록 타임라인에서 USD 입출금 저장 환율을 확인할 수 있다.
- USD 입출금 정정 입력에서 당시 USD/KRW 환율도 함께 보정할 수 있다.
- 자산 탭 상단 변화 기준을 `스냅샷 시작 대비`가 아니라 `현재 총자산 - 입금 원금`으로 바꿨다.
- `원금 기준 요약` 카드에 원금 대비 변화, 현재 투자 손익, 환율 영향을 분리해 표시한다.
- 기존 기록의 환율 추정 사용 여부를 화면에 명시한다.

검증:

- `:app:assembleDebug` 빌드 성공.
- `aapt dump badging` 확인:
  - versionCode: `38`
  - versionName: `0.3.26`

APK:

- `artifacts/investor-run-debug-0.3.26.apk`
- SHA-256: `8B8AE6154087E092F8FC6D672F794FB086D8BF70DE64F674CF7C0EE4DD91C10C`

## v0.3.25 자산 변화 요약 재보정

- 큰 입금 기록이 시작 스냅샷에 이미 반영된 것으로 보이면, 해당 입금을 기간 원인으로 다시 세지 않는다.
- `입출금 +1.21억`과 `투자/환율/시세 -1.21억`처럼 상쇄되는 설명을 제거했다.
- 자산 변화 요약은 총자산 스냅샷 차이와 현재 투자 손익을 분리해 보여준다.
- 투자 손익과 환율 하락만으로 플러스 총자산 변화가 설명되지 않는 경우, 스냅샷/입출금 시점 확인이 필요하다고 표시한다.

검증:

- `StrategyMathSelfTest` 통과.
- `:app:assembleDebug` 빌드 성공.
- `aapt dump badging` 확인:
  - versionCode: `37`
  - versionName: `0.3.25`

APK:

- `artifacts/investor-run-debug-0.3.25.apk`
- SHA-256: `FE7DC4AAEBDEE491050C10248805E6145BEE146BCC0E0284BD868E971229F844`

## v0.3.24 자산 변화 요약 단순화

- 입출금 계산을 날짜 기준이 아니라 스냅샷 시각 기준으로 보정했다.
- 첫 스냅샷에 이미 반영된 입금은 기간 입출금에 다시 포함하지 않는다.
- 자산 변화 해석을 `총자산 변화 = 입출금 + 투자/환율/시세` 구조로 단순화했다.
- 큰 양수 입출금과 큰 음수 잔차가 동시에 표시되는 문제를 줄였다.

검증:

- `StrategyMathSelfTest` 통과.
- `:app:assembleDebug` 빌드 성공.
- `aapt dump badging` 확인:
  - versionCode: `36`
  - versionName: `0.3.24`

APK:

- `artifacts/investor-run-debug-0.3.24.apk`
- SHA-256: `0976D1B32B67422A852A4FD8C9841A19BC6613075C4894A3E97F0CE1C578AABC`

## v0.3.23 자산 변화 해석 카드

- 자산 탭의 `자산 변화` 카드 아래에 `자산 변화 해석` 카드를 추가했다.
- 총자산 변화와 투자 손익이 서로 다른 지표임을 화면에서 설명한다.
- 선택 범위의 시작/현재 스냅샷 기준으로 현금 변화, 투자 중 자산 변화, 투자 손익 변화, 기간 입출금, 환율/현금/평가기준 잔차를 표시한다.
- 기존 `총자산 변화 공식` 문구를 `투자 손익 분해`로 바꿔 카드의 의미를 명확히 했다.

한계:

- 환율/현금/평가기준 잔차는 정밀한 단일 환율효과가 아니라 투자 손익 변화와 입출금을 제외한 설명용 값이다.
- 정밀 환율효과 분해는 환율 히스토리와 장부 이벤트 확장이 필요하다.

검증:

- `StrategyMathSelfTest` 통과.
- `:app:assembleDebug` 빌드 성공.
- `aapt dump badging` 확인:
  - versionCode: `35`
  - versionName: `0.3.23`

APK:

- `artifacts/investor-run-debug-0.3.23.apk`
- SHA-256: `7F100341BC4E808E253B01A5B4E8E1BFA9066DDF8266160050D66229EC41CCA6`

## v0.3.22 전략 계산 모듈화와 self-test

- 주문 목표, 추가 주문 가능액, 추가 권장 수량 계산을 `StrategyMath.orderPlan()`으로 분리했다.
- 미국 Cap27.5, 한국 Leader2, ETF 리밸런싱 계산을 `StrategyMath` 순수 함수로 분리했다.
- `MainActivity`는 화면과 입력 흐름을 유지하고 계산 결과만 받아 표시하도록 정리했다.
- `StrategyMathSelfTest`에 80,000 USD Cap27.5, 초과 매수, 고가주 1주 강제 추천 방지, 추가 권장 수량, 한국 Leader2, ETF 허용오차 시나리오를 추가했다.

검증:

- `StrategyMathSelfTest` 통과.
- `:app:assembleDebug` 빌드 성공.
- `aapt dump badging` 확인:
  - versionCode: `34`
  - versionName: `0.3.22`

APK:

- `artifacts/investor-run-debug-0.3.22.apk`
- SHA-256: `BA58ECED8B3BD10801FD4ADCDF505424DE7BB8F5881DA8AC7E8CBC7AF9CDEEA5`

## v0.3.21 기록 타임라인 기본 접힘

- 기록 탭의 타임라인을 기본 접힘 상태로 표시한다.
- 접힌 상태에서는 전체 기록 건수와 최근 기록 1건 요약만 표시한다.
- `기록 타임라인 펼치기` / `기록 타임라인 접기` 버튼으로 전체 기록 표시를 전환한다.
- 빠른 기록, 데이터 동기화, 백업 패널은 타임라인 길이와 관계없이 바로 접근 가능하게 유지한다.

APK:

- `artifacts/investor-run-debug-0.3.21.apk`
- SHA-256: `FBF3D95F5C3E922B2A3E7B5A87209FA6BBAE5D08F59EB9D94B99DFEA10279508`

## v0.3.20 손익 추세 기준선 보정

- 자산 스냅샷에 `pnlBasisVersion`을 저장한다.
- 손익 추세는 현재 손익 기준 버전의 스냅샷만 사용한다.
- stale quote 기준 과거 손익 스냅샷은 자산 변화 기록에는 남기되 손익 추세 비교에서는 제외한다.
- 비교 대상이 1개뿐이면 `기간 변화`를 `새 기준 시작`으로 표시한다.
- 이전 손익 스냅샷이 기준 차이로 제외되었다는 안내 문구를 표시한다.

APK:

- `artifacts/investor-run-debug-0.3.20.apk`
- SHA-256: `271E8528E53DED77D150FB1B9B4FB6787094D352470D95553E99ECAB1E326445`

## v0.3.19 직접 시세 오류 표시 보정

- Yahoo batch quote endpoint가 401을 반환해도 per-symbol chart fallback이 실제 종목 가격을 가져오면 사용자 오류로 표시하지 않는다.
- ETF 리밸런싱용 가상 심볼 `KR_ETF_BASKET`은 직접 가격 조회 대상에서 제외한다.
- ETF 직접 가격은 `targetWeights`의 실제 ETF 종목만 조회한다.
- Frankfurter 환율 파서는 object 응답과 array 응답을 모두 처리한다.
- Frankfurter가 실패해도 Yahoo `KRW=X` fallback이 성공하면 환율 실패 로그를 남기지 않는다.

APK:

- `artifacts/investor-run-debug-0.3.19.apk`
- SHA-256: `848FC5E16257B0C0A09DEEA1405A3DA6AB467FBAC0B79782D89A5DED5A12792B`

## v0.3.18 API 키 없는 직접 시세/환율 갱신

- GitHub Pages는 추천 신호와 전략 판단을 담당하고, 앱은 추천/보유 종목의 현재가만 직접 보강한다.
- 주식/ETF 가격은 Yahoo quote batch를 먼저 시도하고 빠진 종목은 Yahoo chart endpoint로 재시도한다.
- USD/KRW 환율은 Frankfurter 공개 endpoint를 먼저 사용하고 실패하면 Yahoo `KRW=X` chart로 fallback한다.
- 직접 시세 결과는 `SignalRepository` live overlay로 저장되어 앱 재실행 후에도 적용된다.
- 기록 화면에 `키 없는 시세/환율 갱신` 버튼을 추가했다.
- 원격 GitHub 동기화 버튼은 원격 신호 갱신 뒤 직접 시세 보강까지 이어서 수행한다.
- 단일 주식 주문 가이드는 해당 종목 quote와 환율이 정상이면 열고, ETF 리밸런싱은 목표 ETF 전 종목 quote가 정상일 때만 연다.

APK:

- `artifacts/investor-run-debug-0.3.18.apk`
- SHA-256: `5E7AEEDF3448573476538B6066C8540A07D212B4314694D3F18477C4A9CF2B9A`

## v0.3.17 평균 원가 임시 평가

- 손익 기준은 추천가가 아니라 실제 체결로 만들어진 평균 원가를 기준으로 해석한다.
- 최신 체결일이 quote 가격 기준일보다 새롭거나 quote가 없으면, 보유 평가/총자산/미실현손익/파이 그래프는 평균 원가를 임시 평가 기준으로 사용한다.
- 최신 quote가 들어오면 자동으로 quote 기준 평가로 돌아간다.
- 주문 추천과 목표 비중 계산은 기존 전략 기준가/목표 비중 로직을 유지한다.

APK:

- `artifacts/investor-run-debug-0.3.17.apk`
- SHA-256: `F9B61F877754E82E12643C95250D8819328F0C07CF0E33FEC8553E59FD4AE4E8`

## v0.3.13 목표 초과 상태 문구 보정

- 주식 매수 신호에서 목표보다 허용 오차 이상 많이 산 경우 `완료: 목표 범위`로 표시하지 않는다.
- 목표보다 초과 매수했지만 종목 한도 안이면 `확인 필요: 목표보다 N 초과 · 한도 이내`로 표시한다.
- 종목 한도를 넘은 경우에만 `조정 필요: 종목 한도 N 초과`로 표시한다.
- 예: 목표 10,000 USD, 체결 12,000 USD는 목표 범위가 아니라 목표 대비 2,000 USD 초과 상태다.

APK:

- `artifacts/investor-run-debug-0.3.13.apk`
- SHA-256: `A1CB1A84EADD4EF1F031B2927DE680EE8A8697B4FD2F0A242E209D6CF9F2004F`

## v0.3.12 이번 체결 잔여 원가 기준 보정

- `이번 체결`을 이번 신호 기간 매수 총액이 아니라 현재 open lot에 남아 있는 이번 신호 잔여 원가로 계산한다.
- 같은 신호 기간에 매도한 lot 원가가 `이번 체결`에서 자동 차감된다.
- 주식 매수 신호는 리밸런싱이 아니므로 목표 이상 매수했더라도 종목 한도 안이면 `완료: 목표 이상, 한도 이내`로 처리한다.
- 종목 한도 초과일 때만 주식 매수 카드에서 초과 조정 필요를 표시한다.
- STX 사례 기준 매수 총액 약 17,215 USD에서 매도 원가 약 4,501 USD가 차감되어 이번 체결은 약 12,714 USD로 계산된다.

APK:

- `artifacts/investor-run-debug-0.3.12.apk`
- SHA-256: `16093F21D7F2FE038AD4930835C6C4783420530DA1FAC457054F858656BC109C`

## v0.3.11 월간 목표 고정과 체결 검증 보정

- 운용 추천 카드의 `목표 원금` 개념을 `이번 목표`, `이번 체결`, `남은 매수`, `총 보유 원금`으로 분리했다.
- 미국/한국 주식 주문 목표는 현재 신호의 `validFrom` 이후 체결분을 제외한 체결 전 기준으로 계산한다.
- 이미 매수한 금액은 이번 신호의 체결 금액으로 합산하고, 남은 현금으로 줄어든 추가 주문 가능액과 누적 보유 원금을 직접 비교하지 않는다.
- STX처럼 목표 대비 5% 또는 1주 가격 이내로 체결된 경우 초과가 아니라 현실적 완료로 판정한다.
- 주문 가이드는 전체 목표가 아니라 아직 채워야 할 추가 권장 금액으로 예상 수량을 계산한다.

APK:

- `artifacts/investor-run-debug-0.3.11.apk`
- SHA-256: `89BC1EC9B1B385246DA090CE4A586B38A766E0F067B8319E6B898699F87284D6`

## v0.3.10 손익 추세 그래프

- 자산 탭에 `손익 추세` 카드를 추가했다.
- 손익 추세 카드는 선택한 일/주/월 범위의 투자 손익, 실현손익, 미실현손익을 표시한다.
- 기존 `AssetLineChartView`를 음수 값도 그릴 수 있게 확장했다.
- 투자 손익, 실현손익, 미실현손익 3개 선을 같은 차트에 표시한다.
- 0.3.8 이전 스냅샷처럼 손익 필드가 없는 경우 안내 문구를 표시한다.

0.3.10 당시 한계:

- 손익 추세는 앱 내부 자산 스냅샷 기준이다.
- 배당, 세금, 환율효과 독립 분해는 당시에는 없었다. 배당/배당세는 v0.3.37에서 1차 반영했다.

APK:

- `artifacts/investor-run-debug-0.3.10.apk`
- SHA-256: `68AC50E370D8B3A7420F7E70AD8A1F173EC9A8935C6F3C3E1737D60B1FD15191`

## v0.3.9 매수 평균가 표시

- `LedgerStore.averageBuyPrice()`를 추가해 open lot 잔여 수량 기준 가중 평균 매수가를 계산한다.
- 운용 카드의 추천 종목에 `매수 평균가`와 `평단 대비`를 표시한다.
- 주문 가이드 다이얼로그에 기존 보유 종목의 매수 평균가와 평단 대비 수익률을 표시한다.
- ETF 리밸런싱 가이드에도 보유 ETF의 매수 평균가와 평단 대비 수익률을 표시한다.
- `현재 원금`은 잔여 원가, `매수 평균가`는 사용자가 입력한 체결 평균가 기반으로 분리했다.

APK:

- `artifacts/investor-run-debug-0.3.9.apk`
- SHA-256: `CAC8E75F847AF958C4C9A322CEFEC50FFFC146E336F5C7568BF56EEE76670FB2`

## v0.3.8 자산 손익 집계

- `PnlSummary`를 추가해 전체/계좌별 실현손익, 미실현손익, 투자 손익 합계를 계산한다.
- 실현손익은 `0.3.7` 이후 매도 기록의 `realizedPnl`과 `costBasis` 기준으로 집계한다.
- 미실현손익은 현재가와 open lot 잔여 원가 기준으로 계산한다.
- USD 손익은 현재 USD/KRW 환율로 원화 환산한다.
- 총자산 카드에 투자 손익, 실현손익, 미실현손익을 표시한다.
- 계좌 카드에 기준 통화별 실현손익과 미실현손익을 표시한다.
- 자산 탭 손익 분해 카드의 placeholder를 실제 손익 집계값으로 교체했다.
- 원가 필드가 없는 과거 매도 기록은 미집계 매도로 표시한다.
- 자산 스냅샷에 `realizedPnlKrw`, `unrealizedPnlKrw`, `investmentPnlKrw`를 저장한다.

0.3.8 당시 한계:

- 손익 추세 그래프는 아직 총자산/현금/보유 평가 선만 표시한다. 이 항목은 `0.3.10`에서 1차 반영했다.
- 배당, 세금, 환율효과를 독립 항목으로 분해하는 계산은 당시에는 없었다. 배당/배당세는 v0.3.37에서 1차 반영했다.

APK:

- `artifacts/investor-run-debug-0.3.8.apk`
- SHA-256: `A42D0683B39AFAE34FE48B37E58DAF0FD79B5A37B089ACE64A74AA8D569D74BC`

## v0.3.7 특정 lot 매도와 실현손익 기록

- 매도 체결 기록 다이얼로그에 `FIFO 자동`과 개별 lot 선택 버튼을 추가했다.
- 운용 화면의 lot 이벤트 버튼은 해당 lot을 미리 선택한 상태로 매도 기록을 연다.
- 특정 lot을 선택하면 해당 lot의 잔여 수량을 기준으로 50%/전량 빠른 입력이 동작한다.
- 저장소는 선택 lot이 존재하지 않거나 잔여 수량보다 큰 매도이면 저장을 차단한다.
- 선택하지 않은 매도는 기존처럼 FIFO 자동 배분으로 원가를 계산한다.
- 매도 기록 JSON에 `lotMode`, `selectedLotId`, `netProceeds`, `costBasis`, `realizedPnl`, `realizedPnlPercent`, `lotDispositions`를 저장한다.
- 보유 종목의 평균 원가와 cap 계산 기준을 open lot 잔여 원가 합산으로 맞췄다.
- 기록 타임라인에서 매도 건의 실현손익과 원가, lot 배분 방식을 표시한다.
- 백업 복원 검증에 매도 lot 손익 필드의 기본 검증을 추가했다.

0.3.7 당시 한계:

- 실현손익은 개별 매도 기록에 저장되지만, 자산 탭 손익 분해 차트에는 아직 합산 표시하지 않는다. 이 항목은 `0.3.8`에서 1차 반영했다.
- 특정 lot 선택 UI는 Java View 기반의 1차 형태이며, lot이 많아질 경우 접기/검색 UX가 필요하다.

APK:

- `artifacts/investor-run-debug-0.3.7.apk`
- SHA-256: `001B236D57CD340221356A8B90D8C70C9F5523F967E4B292B486AC08C8C501D8`

## v0.3.6 FIFO lot 운용 모델

- `LedgerStore.lots()`를 추가해 기존 장부 `entries_v2`에서 open lot을 파생 계산한다.
- 매수 기록은 lot 생성, 매도 기록은 같은 종목 open lot을 FIFO 순서로 차감한다.
- 취소된 원본 기록은 lot 계산에서 제외한다.
- 각 lot에 매수일, 잔여 수량, 원가, 6개월 예정일, 12개월 예정일, D-day를 계산한다.
- 미국/한국 주식 운용 화면에 lot 일정 요약을 추가했다.
- 보유 주식 카드에 lot별 6개월 50% 매도, 12개월 전량 매도, 주봉 훼손 잔여 매도 버튼을 추가했다.
- lot 이벤트 버튼은 매도 체결 다이얼로그에 추천 수량과 매도 사유를 기본값으로 전달한다.
- ETF 운용 화면은 월간 리밸런싱 중심으로 유지하고 6개월/12개월 lot 만기 UI를 표시하지 않는다.
- 시장 알림 본문에 주식 계좌의 lot 만기 매도 검토 건수를 반영한다.

0.3.6 당시 한계:

- lot은 기존 장부에서 파생 계산하며 별도 DB row로 저장하지 않는다.
- 매도 체결은 FIFO 차감 기준이며, 특정 lot을 사용자가 직접 선택하는 UI는 아직 없다. 이 항목은 `0.3.7`에서 1차 반영했다.
- 실현손익을 lot별 확정 필드로 저장하지 않는다. 이 항목은 `0.3.7`에서 매도 기록 필드로 1차 반영했다.

APK:

- `artifacts/investor-run-debug-0.3.6.apk`
- SHA-256: `4756D0F03B2E33680133315E19E96F12CBBB4D59A01624D1BBC6F22C83926228`

## v0.3.5 휴장일 캘린더와 동적 알림 문구

- `MarketCalendar`를 추가해 2026-2027 한국/미국 주요 시장 휴장일을 앱에 내장했다.
- 한국 주식/연금 ETF 알림은 주말과 한국 휴장일을 건너뛴다.
- 미국 주식 알림은 뉴욕 기준 주말과 NYSE/Nasdaq 휴장일을 건너뛴다.
- 기록 탭 다음 알림 요약에 `휴장일 반영` 문구를 추가했다.
- 시장 알림이 울릴 때 앱의 현재 신호 패키지, 선택 전략, 장부 보유 상태, 데이터 신뢰도를 읽어 알림 본문을 생성한다.
- 알림 본문은 신규 매수 건수, 매도 검토 건수, ETF 리밸런싱 건수, 데이터 정상/확인 필요 상태를 요약한다.

현재 한계:

- 2028년 이후 휴장일은 추후 캘린더 업데이트가 필요하다.
- 조기 폐장일은 아직 별도 알림으로 분리하지 않는다.

APK:

- `artifacts/investor-run-debug-0.3.5.apk`
- SHA-256: `2D54ECB990CC52E1FF5459D1AADA05B127C034965DBCCF81B44C06A6C0D23513`

## v0.3.4 시장 시간 기반 반복 알림

- 한국 주식 운용 점검 알림을 평일 08:55 KST로 예약한다.
- 연금 ETF 리밸런싱 점검 알림을 평일 09:05 KST로 예약한다.
- 미국 주식 운용 점검 알림을 뉴욕 09:20 기준으로 계산해 한국 시간에 예약한다.
- 시장 알림 receiver가 알림을 보낸 뒤 같은 종류의 다음 알림을 다시 예약한다.
- 앱 시작, 앱 업데이트, 기기 재부팅 후 시장 알림을 재예약한다.
- 기록 탭 `백업과 안전장치`에 다음 시장 알림 요약과 `시장 알림 재예약` 버튼을 추가했다.
- Android manifest에 `RECEIVE_BOOT_COMPLETED` 권한과 `BootScheduleReceiver`를 추가했다.

현재 한계:

- 휴장일 캘린더와 동적 문구는 `0.3.5`에서 반영했다.

APK:

- `artifacts/investor-run-debug-0.3.4.apk`
- SHA-256: `0051ED4DDE582E4066991A21411CF0F1D3B678A040B60C4160A3B5140463CF5F`

## v0.3.3 자산 스냅샷과 변화 그래프

- `asset_snapshots_v1` 저장소를 추가했다.
- 자산 탭 진입, 입출금/체결/환전 기록, 기록 취소/되돌리기, 백업 복원, 원격 동기화 성공 시 오늘 자산 스냅샷을 갱신한다.
- 스냅샷에는 총자산, 현금, 투자 중 자산, 계좌별 평가액, 환율, 장부 기록 수가 저장된다.
- 자산 탭에 `일/주/월` 미니탭 기반 자산 변화 라인 그래프를 추가했다.
- 그래프는 총자산, 투자 중 자산, 현금 3개 선을 표시한다.
- 장부 백업 JSON에 자산 스냅샷을 함께 포함하고, 복원 시 기본 검증한다.

APK:

- `artifacts/investor-run-debug-0.3.3.apk`
- SHA-256: `0B12B5C19C3AA8A906FC1383A006F9498B8383B809979A5D56B7BD1BD3867860`

## v0.3.2 과거 기록 취소/정정

- 타임라인의 과거 입금/출금/매수/매도/환전 기록을 `기록 취소`로 정정할 수 있게 했다.
- 원본 기록은 삭제하지 않고 `취소됨` 상태로 남긴다.
- 별도 `정정` 기록을 추가해 어떤 기록을 취소했는지 감사 추적이 남도록 했다.
- 취소된 원본은 보유 수량 계산에서 제외된다.
- 입금 취소, 매도 취소, 환전 취소처럼 현금이 음수가 될 수 있는 작업은 저장소에서 차단한다.
- 매수 취소는 이후 매도 기록의 수량 흐름이 깨지는 경우 차단한다.
- 최신 `정정` 기록은 `최근 정정 되돌리기`로 원본 취소 상태를 해제할 수 있다.
- 백업/복원 검증에 `cancel` 정정 기록 타입을 추가했다.

APK:

- `artifacts/investor-run-debug-0.3.2.apk`
- SHA-256: `32750605C759C265974AEF108C74B3B63EBAF1A0ED4E02EC958B3F172890A6A5`

## v0.3.1 장부 안전장치 확장

- 장부 백업 JSON을 클립보드로 복사하는 기능 추가
- 백업 JSON 붙여넣기 복원 기능 추가
- 복원 전 기존 장부를 앱 내부 직전 백업으로 보존
- 백업 복원 시 account/currency/type/amount/quantity/price 기본 검증
- 미국 계좌 KRW ↔ USD 환전 기록 추가
- 환전 기록은 현금 차감/증가, 타임라인 표시, 최신 기록 되돌리기, 백업/복원에 반영

APK:

- `artifacts/investor-run-debug-0.3.1.apk`
- SHA-256: `6D3CD8D6CC516F520FD93776BD3A4455B8AF619C3D4D12BBB7A1CC8BD95FF6A2`

## v0.3.0 감사 보고서 반영 범위

- 장부 저장소 레벨 입력 검증과 실패 메시지 연결
- 현금 부족 매수/출금 차단
- 보유 수량 초과 매도 차단
- 장부 JSON 손상 시 쓰기 차단과 원문 보존
- 최신 기록 되돌리기
- Action Inbox 오늘 보류 저장
- 데이터 신뢰도 카드: 가격, 환율, quote 문제, 마지막 동기화 실패 표시
- 가격/환율/quote 지연·대체·실패 시 주문 가이드 차단
- 목표 금액이 1주 가격보다 작을 때 자동 1주 추천 제거
- ETF 리밸런싱 target별 매수/매도 기록 연결
- 추천 매수 선택 다이얼로그
- 연구 전략 선택 경고
- 미국 USD 주문 가능액 계산에서 KRW 보조 현금 암묵 환산 제거

## 현재 내장 추천 신호

`scripts/build-signal-package.mjs --app-assets`로 현재 전략 데이터에서 생성한 신호가 APK에 포함되어 있다.

- 미국 주식: `TECH` Bio-Techne
- 미국 주식: `STX` Seagate Technology
- 한국 주식: `009150.KS` 삼성전기
- 한국 주식: `000660.KS` SK하이닉스
- 한국 ETF: `KR_ETF_BASKET` 리밸런싱

## GitHub Pages 데이터 연동

GitHub Actions는 아래 순서로 동작한다.

```text
src/refresh.mjs
src/strategy-dashboard-data.mjs
src/korea-strategy-test.mjs --years 5
scripts/build-pages.mjs
scripts/build-signal-package.mjs
```

생성되는 Android 앱용 API는 `dist/api` 아래에 배치된다.

```text
dist/api/manifest.json
dist/api/signals/latest.json
dist/api/signals/us/latest.json
dist/api/signals/kr-stock/latest.json
dist/api/signals/kr-etf/latest.json
dist/api/weekly-trends/latest.json
dist/api/prices/latest.json
dist/api/fx/latest.json
```

앱에서는 `설정 > GitHub Pages API URL 설정`에 `https://username.github.io/repo/api` 형태의 URL을 입력하고 `원격 신호 동기화`를 누르면 된다. URL이 저장된 뒤부터는 앱 실행 시 같은 API에서 신호, 종목별 최신가, 환율을 조용히 자동 갱신한다.

`fx/latest.json`은 `USD_KRW` 환경변수가 있으면 그 값을 우선 사용하고, 없으면 Yahoo Finance의 `KRW=X`를 조회한다. 조회 실패 시 앱이 중단되지 않도록 수동 기본값을 지연 상태로 저장한다.

`prices/latest.json`은 현재 추천 종목, ETF 목표 종목, 전략상 open trade, 기존 포트폴리오 보유 종목의 최신 종가를 Yahoo Finance에서 조회한다. 조회 실패 종목은 기존 전략 대시보드에 들어 있던 기준가를 지연 상태로 저장한다.

## v0.2 디자인/UX 반영

- 하단 Android 시스템 버튼과 겹치지 않도록 navigation bar inset 반영
- 중립 배경, 흰색 카드, 계좌별 낮은 채도 배지 색상 적용
- 금액/비중/상태를 한 화면에서 스캔할 수 있도록 카드 정보 위계 재배치
- 설정성 기능은 별도 탭 대신 `기록` 탭 하단의 데이터/백업 섹션으로 이동
- 사용자 입력 흐름을 `가이드 -> 실제 주문 -> 체결 기록 -> 검증`으로 재구성

## v0.2.1 입력 UX 개선

- 입금/출금 기록에서 통화를 텍스트로 입력하지 않고 `KRW`, `USD` 버튼으로 선택
- 입금/출금 기록에 빠른 금액 버튼을 시험 적용했으나 v0.2.3에서 제거
- 체결 기록에서 전략 키 입력칸 제거
- 체결 기록의 전략은 읽기 전용 정보로 표시
- 체결 기록은 실제 수량, 평균단가, 비용, 선택 메모만 입력
- 매도 기록에 `50% 수량`, `전량` 빠른 선택 버튼 추가
- 운용 화면에서 계좌별 전략 사용/중지 가능

## v0.2.2 운용/입력 UX 개선

- 운용 화면을 한 화면 나열 방식에서 `미국`, `한국`, `ETF` 미니탭 전환 방식으로 변경
- `이 전략 잠시 중지` 버튼 제거
- 각 운용 미니탭에 `전략 바꾸기` 버튼 추가
- 미국 기본 전략명을 `Leader2 + Repeat Theme Combo Cap27.5`로 정확히 표시
- 선택 가능한 연구 전략은 표시하되, 현재 신호 패키지가 없는 경우 안내 문구 표시
- 입금/출금 금액 입력 시 `1,000,000` 형식으로 자동 콤마 표시
- 전반적인 버튼 높이와 카드 여백 축소

## v0.2.3 입력 UX 정리

- 입금/출금 다이얼로그의 빠른 금액 버튼 제거
- 사용자가 금액을 직접 입력하고, 입력 중 자동 콤마만 적용

## v0.2.4 계좌/차트 UX

- 계좌 화면에 `전체`, `미국`, `한국`, `ETF` 미니탭 추가
- 전체 계좌 화면에 계좌별 자산 비중 도넛 차트 추가
- 개별 계좌 화면에 현금/보유 구성 도넛 차트 추가
- 보유 종목이 있는 경우 보유 종목 비중 도넛 차트 표시
- 자산 화면에 총자산 계좌 비중과 보유 종목 비중 도넛 차트 추가

## v0.2.5 차트 표시 보정

- 도넛 차트가 카드 안에서 위아래로 잘리지 않도록 차트 높이와 원 크기 계산을 조정
- 빈 상태 차트는 compact 모드로 표시해서 회색 링이 과하게 커지지 않도록 변경
- 도넛 stroke 두께를 줄이고 안전 여백을 추가

## v0.2.6 미국 전략 주문금액 보정

- 미국 `Leader2 + Repeat Theme Combo Cap27.5` 운용에서 단순 2종목 균등분할을 제거
- 계좌 평가 원금 기준 기본 매수 비율, 반복/AI 하드웨어 가중, 종목당 27.5% 상한을 주문 가이드에 반영
- 신호 패키지에 미국 종목 sector와 strategy position sizing 메타데이터 추가

## v0.2.7 한국 주식/ETF 전략 보정

- 한국 주식 `Leader2` 주문 가이드에 초기 3개월 월 30%, 이후 월 15%, 종목당 22.5% 상한 적용
- 한국 주식 신호 패키지에 업종과 capital-account sizing 메타데이터 추가
- ETF 리밸런싱 가이드에 계좌 평가금액 기준 목표금액, 현재 평가액, 매수/매도 수량 계산 추가

## v0.2.8 업데이트 캐시 보정

- 기존 앱 위에 APK를 업데이트 설치했을 때 오래된 원격 신호 캐시가 새 내장 데이터보다 우선 적용되던 문제 수정
- 새 APK에 포함된 asset packageVersion이 기존 캐시보다 최신이면 캐시를 자동 삭제하고 새 내장 데이터를 로드

## v0.2.9 오래된 원격 동기화 차단

- 앱 시작 후 자동 원격 동기화가 오래된 GitHub Pages 데이터를 다시 덮어쓰지 못하도록 차단
- 원격 manifest packageVersion이 APK 내장 packageVersion보다 오래되면 동기화 실패로 처리하고 내장 데이터를 유지

## 다음 개선 후보

- Room 기반 영구 저장소로 이전
- Compose/Material 3 UI로 전환
- WorkManager 기반 주기적 백그라운드 동기화와 자동 시세 갱신 상태를 홈 화면에 노출
- 암호화 백업/복원
- 월말 스냅샷과 기준지수 대비 성과
- release 서명 APK 생성

## v0.3.31 Build Notes

변경:

- 한국 ETF 공식 앱 전략을 `kr_etf_benchmark_or_alpha_defensive`로 변경했다.
- 연금 계좌 기본 전략과 알림 기본 전략을 ETF-I로 맞췄다.
- 신호 패키지에 ETF-I 5년/10년 검증 메타데이터를 포함했다.

검증할 항목:

- `app/src/main/assets/api/signals/kr-etf/latest.json`의 strategyKey가 `kr_etf_benchmark_or_alpha_defensive`인지 확인
- `targetWeights`가 `395160.KS` 100%인지 확인
- Android 앱 운용 탭의 ETF 미니탭에서 현재 전략이 `KR ETF Benchmark Or Alpha Defensive`로 보이는지 확인
- 기존 앱에서 연금 전략을 과거 전략으로 직접 선택해 둔 경우, 전략 변경 버튼으로 ETF-I를 선택해야 한다.

APK:

- `artifacts/investor-run-debug-0.3.31.apk`
- versionCode: `43`
- versionName: `0.3.31`
- SHA-256: `3104F9A7B5BF3145A1D29BE1AD617567D2E0BCE6B0AC1ACC647721E8573ACCAA`

## v0.3.32 Build Notes

변경:

- OS 자동 백업 차단과 평문 HTTP 차단을 적용했다.
- 클립보드 백업은 경고 후 복사하고 1분 뒤 자동 삭제한다.
- ETF 리밸런싱은 신호 JSON의 `driftThreshold`와 `minTradeAmount`를 사용한다.
- 계산 테스트를 JUnit4로 전환했다.

검증할 항목:

- `testDebugUnitTest`가 실제 JUnit 테스트를 실행하는지 확인
- ETF-I 신호의 `driftThreshold: 0.05`가 앱 리밸런싱 기준으로 반영되는지 확인
- 백업 파일 저장/불러오기 동작 확인
- 클립보드 백업 복사 후 1분 뒤 백업 클립이 사라지는지 확인

빌드 결과:

- `--offline :app:testDebugUnitTest :app:assembleDebug` 성공
- JUnit tests: `8`, failures: `0`, errors: `0`
- APK: `artifacts/investor-run-debug-0.3.32.apk`
- versionCode: `44`
- versionName: `0.3.32`
- SHA-256: `ED974DCF8890D4942FCB28A1BC413D32DE4510FC2583BC2DE6172CAB04B6FA5C`

## v0.3.33 Build Notes

변경:

- 주봉 훼손 경고를 최신 정상 시세로 재검증한다.
- STX처럼 패키지 주봉 스냅샷은 `broken`이지만 앱 최신가가 기준선 위에 있으면 Action Inbox와 알림에서 주봉 매도 경고를 숨긴다.
- 보유 카드, lot 주봉 매도 버튼, 알림 카운트가 모두 `SignalRepository.isTrendBrokenNow()`를 공유한다.
- 주봉 상세 팝업에 `종가`/`최신가`, 가격 기준일, 기준선을 같이 표시한다.

검증할 항목:

- 직접 시세 갱신 후 STX 최신가가 `$890.09`이고 기준선 `$870.33` 위라면 “Seagate Technology 주봉 훼손 매도 검토” 카드가 사라지는지 확인한다.
- 최신 시세 갱신이 실패하거나 오래된 시세만 있으면 기존 주봉 스냅샷 경고가 유지되는지 확인한다.
- 보유 lot 목록에서 최신가가 기준선 위일 때 “주봉 훼손 잔여 매도” 버튼이 나오지 않는지 확인한다.

빌드 결과:

- `--offline :app:testDebugUnitTest :app:assembleDebug` 성공
- JUnit tests: `9`, failures: `0`, errors: `0`
- APK: `artifacts/investor-run-debug-0.3.33.apk`
- versionCode: `45`
- versionName: `0.3.33`
- SHA-256: `FC2B85FF0981B87A5BCF3002A624B8A279CD897F4E0AC56CA0453C91168BF2BE`

## v0.3.34 Build Notes

변경:

- 직접 시세 일부 갱신 실패 시 이전 정상 live cache를 유지한다.
- 오늘 화면과 기록 탭 데이터 카드에 `거래 대상 시세`와 `확인할 종목`을 추가했다.
- 장부 점검 카드에서 가격/환율 문제와 평균원가 임시평가가 있을 때 `시세/환율 갱신` 버튼을 한 번만 표시한다.
- 원금 기준 요약 카드에 계산 기준을 추가하고, `기타/반올림`을 `현금/시세 잔차`로 변경했다.

검증할 항목:

- 직접 시세 갱신이 일부 실패했을 때 기존 정상 시세가 사라지지 않는지 확인한다.
- 오늘/기록 데이터 카드에서 실제 추천/보유/ETF 대상 기준 정상 시세 개수가 보이는지 확인한다.
- 장부 점검 카드에서 데이터 문제가 있을 때 시세/환율 갱신 버튼이 중복으로 나오지 않는지 확인한다.
- 자산 탭 원금 기준 요약의 계산 기준과 잔차 설명이 이해 가능한지 확인한다.

빌드 결과:

- `--offline :app:testDebugUnitTest :app:assembleDebug` 성공
- JUnit tests: `10`, failures: `0`, errors: `0`
- APK: `artifacts/investor-run-debug-0.3.34.apk`
- versionCode: `46`
- versionName: `0.3.34`
- SHA-256: `1FBCA38C431432087AB032503C79B240B2491FDE7ECCF2B163C58EA3F5C0DEFF`

## v0.3.35 Build Notes

변경:

- 오늘 화면 데이터 상태 카드를 `데이터 양호` / `데이터 확인 필요` 신호등 형태로 단순화했다.
- 오늘 화면에서 가격 상태, 환율 상태, 동기화 실패 세부 메시지를 제거했다. 세부 진단은 기록 탭 데이터 동기화에 남긴다.
- `Action Inbox`를 `오늘 할 일`로 바꾸고, 할 일이 없으면 `전략 유지 중입니다` 메시지를 보여준다.
- 신규 매수는 매수 기록이 있고 추가 권장 수량이 0주이면 완료로 보고 숨긴다.
- ETF 리밸런싱은 실제 매수/매도 수량이 있을 때만 오늘 할 일에 표시한다.
- 주봉 훼손 일반 감시 카드를 없애고, 6개월 이후 lot 기반 매도 이벤트로 통합했다.
- 시장 알림 신규 매수/주봉 매도 카운트도 같은 운용 단계 기준으로 보정했다.

검증할 항목:

- 오늘 화면 데이터 카드가 한 줄 신호등 중심으로 보이는지 확인한다.
- TECH/STX처럼 이미 매수한 현재 신호 종목이 `신규 매수`로 계속 나오지 않는지 확인한다.
- 6개월 전 lot은 오늘 할 일에 매도 액션이 나오지 않는지 확인한다.
- 6개월 도달 lot은 50% 매도 액션, 그 이후 주봉 훼손 lot은 잔여 매도 검토 액션이 나오는지 확인한다.

빌드 결과:

- `--offline :app:testDebugUnitTest :app:assembleDebug` 성공
- JUnit tests: `11`, failures: `0`, errors: `0`
- APK: `artifacts/investor-run-debug-0.3.35.apk`
- versionCode: `47`
- versionName: `0.3.35`
- SHA-256: `26FC7F76BA6D4AE7DCE0956C48F1E7D1C569D100C2B6D8693BF17B06D4154530`
