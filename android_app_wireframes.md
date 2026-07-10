# Android App Wireframes

작성일: 2026-07-09

이 문서는 개인용 네이티브 Android 투자 운용 앱의 1차 화면 와이어프레임이다. 목표는 기존 웹 대시보드를 그대로 옮기는 것이 아니라, 검증된 전략을 실제 투자 행동으로 바꾸는 앱 화면을 정의하는 것이다.

## 1. 화면 원칙

- 기본 탭은 `오늘`, `자산`, `운용`, `기록`, `설정`으로 둔다.
- 백테스트와 전략 설명은 보조 화면으로 이동한다. 첫 화면의 중심은 오늘 해야 할 행동이다.
- 모든 추천은 `왜`, `얼마나`, `언제까지`, `기록했는지`를 함께 보여준다.
- 사용자의 체결 기록, 예수금, lot 상태는 기기 내부에 저장한다.
- 서버나 정적 JSON에는 개인 계좌 정보가 들어가지 않는다.
- 매수/매도 버튼은 증권사 주문을 대신하지 않는다. 앱은 주문 가이드와 기록 도구 역할을 한다.

## 2. 내비게이션 구조

```text
BottomNavigation
  TodayScreen
  AssetsScreen
  OperationsScreen
  RecordScreen
  SettingsScreen

Secondary routes
  OnboardingWizard
  OrderGuideSheet
  ExecutionRecordSheet
  LotDetailSheet
  AlertDetailSheet
  StrategyEvidenceScreen
  DataStatusScreen
  BackupRestoreScreen
```

## 3. 공통 컴포넌트

| 컴포넌트 | 목적 |
|---|---|
| `DataStatusBanner` | 신호 생성일, 지연, 실패, 검토 필요 상태 표시 |
| `ActionCard` | 오늘 해야 할 매수, 매도, 리밸런싱, 기록 누락 작업 표시 |
| `AssetSummaryCard` | 총자산, 투자 손익, 현금, 환율 효과 요약 |
| `AccountSegmentedControl` | 전체, 미국 주식, 한국 주식, 한국 ETF 필터 |
| `OrderGuideSheet` | 증권사 주문 전에 확인할 수량, 금액, 제한가 가이드 |
| `ExecutionRecordSheet` | 실제 체결가, 수량, 수수료, 세금, 메모 기록 |
| `LotTimeline` | 매수 후 6개월, 주봉 훼손, 12개월 도달 상태 표시 |
| `AlertRow` | 미확인 알림, 완료 알림, 연기 알림 표시 |
| `EmptyState` | 아직 계좌나 기록이 없을 때 다음 행동 제시 |
| `SensitiveValue` | 금액 숨김/표시 전환 |

## 4. 오늘

목적: 앱을 열자마자 오늘 실행해야 할 투자 행동을 판단하게 한다.

```text
Top bar
  투자 실행
  금액 숨김 아이콘
  데이터 상태 아이콘

DataStatusBanner
  2026-07-09 08:30 기준 신호

AssetSummaryCard
  총자산
  오늘 해야 할 주문 수
  기록 누락 수

Action Inbox
  ActionCard: 미국 주식 월간 신규 매수
  ActionCard: 한국 ETF 리밸런싱 필요
  ActionCard: 6개월 50% 매도 도달
  ActionCard: 주봉 훼손 감시
  ActionCard: 주문 기록 누락

Upcoming
  다음 예정 이벤트 3개
```

`ActionCard`는 다음 정보를 가진다.

| 영역 | 내용 |
|---|---|
| 제목 | `NVDA 신규 매수`, `KODEX 200 비중 축소` |
| 근거 | 전략명, 점수, 월간 신호, 주봉 상태 |
| 금액 | 권장 매수 금액 또는 매도 수량 |
| 마감 | 오늘 장 시작 전, 오늘 장 마감 전, 다음 거래일 |
| 액션 | `주문 가이드`, `완료 기록`, `연기`, `무시` |

상태 규칙:

- 할 일이 없으면 "오늘은 전략상 실행할 주문이 없습니다"와 다음 점검일을 보여준다.
- 데이터가 지연되면 주문 가이드 버튼을 비활성화하고 데이터 상태 화면으로 연결한다.
- 알림 권한이 꺼져 있으면 상단 배너에서 권한 설정으로 이동한다.

## 5. 자산

목적: 사용자가 전략대로 운용했을 때 자산이 어떻게 변했는지 빠르게 이해하게 한다.

```text
Top bar
  자산
  기간 선택: 1M / 3M / 6M / 1Y / 전체

AssetSummaryCard
  총자산
  투자 원금
  평가 손익
  현금

Cause Breakdown
  투자 손익
  환율 효과
  입금/출금
  배당
  수수료/세금

Portfolio Chart
  총자산 곡선
  원금 곡선
  현금 비중

Allocation
  미국 주식
  한국 주식
  한국 ETF
  현금
```

자산 변화 설명 공식:

```text
총자산 변화 = 투자 손익 + 환율 효과 + 입금/출금 + 배당 - 수수료 - 세금
```

필터:

- 전체
- 미국 주식
- 한국 주식
- 한국 ETF
- 현금

## 6. 운용

목적: 현재 보유 lot과 전략 상태를 확인하고 다음 매도/유지 판단을 돕는다.

```text
Top bar
  운용
  필터: 전체 / 미국 / 한국 / ETF

Holdings
  HoldingCard
    종목명
    보유 수량
    평가 금액
    수익률
    전략 상태
    다음 이벤트

Signals
  이번 달 추천
  후보였지만 제외된 종목
  감시 중인 주봉 훼손 후보
```

개별 주식 `HoldingCard`:

- 전략: `Leader2`, `KR Stock Leader2`
- 매수일
- 6개월 50% 매도 예정일
- 잔여 50% 주봉 훼손 감시 상태
- 12개월 만기 예정일
- lot 상세로 이동

ETF `HoldingCard`:

- 목표 비중
- 현재 비중
- 차이
- 리밸런싱 필요 여부
- 주문 가이드로 이동

## 7. Lot 상세

목적: 한 번의 매수 lot이 지금 어떤 규칙 아래에 있는지 보여준다.

```text
Header
  종목명
  매수 lot
  현재 상태

LotTimeline
  매수
  6개월 50% 매도
  주봉 훼손 감시
  12개월 만기

Rules
  적용 전략
  매도 규칙
  예외 규칙

Actions
  주문 가이드
  체결 기록
  메모 추가
```

## 8. 기록

목적: 실제 주문 후 앱 내부 계좌 장부를 유지한다.

```text
Top bar
  기록
  빠른 추가 버튼

Quick Actions
  매수 기록
  매도 기록
  입금
  출금
  배당
  수수료/세금

Timeline
  오늘
  이번 주
  이번 달
```

매수 기록 필드:

- 계좌
- 종목
- 주문 근거 신호
- 체결일
- 수량
- 체결가
- 수수료
- 환율
- 메모

매도 기록 필드:

- 연결 lot
- 매도 사유: 6개월 50%, 주봉 훼손, 12개월, 리밸런싱, 수동
- 체결일
- 수량
- 체결가
- 세금
- 수수료
- 메모

기록 저장 후 앱이 하는 일:

- 보유 수량 갱신
- lot 상태 갱신
- 실현 손익 계산
- 자산 그래프 갱신
- 완료된 알림 닫기

## 9. 설정

목적: 개인용 운영에 필요한 최소 설정만 제공한다.

```text
Top bar
  설정

Account
  기준 통화
  금액 숨김 기본값
  백업/복원

Strategies
  미국 주식 전략
  한국 주식 전략
  한국 ETF 전략

Alerts
  알림 켜기
  조용한 시간대
  장 시작 전 알림
  장 마감 전 알림
  기록 누락 알림

Data
  GitHub Pages 데이터 주소
  마지막 동기화
  수동 동기화
  데이터 상태
```

## 10. 투자 시작 마법사

목적: 처음 사용하는 사람이 계좌를 앱에 맞게 설정하게 한다.

```text
Step 1. 자산군 선택
  미국 주식
  한국 주식
  한국 ETF

Step 2. 초기 자본 입력
  계좌별 현금
  기준 통화

Step 3. 기존 보유 종목 입력
  종목
  수량
  평균 단가
  매수일
  전략 적용 여부

Step 4. 알림 설정
  전략 알림 켜기
  조용한 시간대

Step 5. 데이터 확인
  최신 신호 날짜
  사용 가능한 시장
```

## 11. 주문 가이드 Sheet

목적: 사용자가 증권사 앱에서 직접 주문하기 전에 필요한 값을 한 화면에서 확인하게 한다.

```text
OrderGuideSheet
  종목명 / 티커
  액션: 매수 또는 매도
  전략 근거
  권장 금액
  예상 수량
  기준 가격
  가격 사용 시각
  체크리스트
    데이터 날짜 확인
    장 시간 확인
    보유 현금 확인
    주문 후 기록 필요
  버튼
    증권사 앱 열기
    체결 기록하기
```

## 12. 데이터 상태 화면

목적: 자동 종목 선정과 알림의 신뢰도를 사용자가 확인하게 한다.

```text
DataStatusScreen
  최신 manifest 버전
  미국 주식 신호 생성 시각
  한국 주식 신호 생성 시각
  한국 ETF 신호 생성 시각
  환율 생성 시각
  실패한 데이터 소스
  다음 배치 예정 시간
```

상태별 처리:

| 상태 | 화면 처리 |
|---|---|
| `normal` | 주문 가이드 활성화 |
| `delayed` | 지연 배너 표시, 주문 가이드에 주의 표시 |
| `needs_review` | 주문 가이드 비활성화, 수동 확인 요구 |
| `failed` | 신호 표시 중단, 이전 신호 사용 여부 선택 |

## 13. 빈 상태와 오류 상태

| 상황 | 문구 방향 | 다음 행동 |
|---|---|---|
| 첫 실행 | 아직 계좌 기록이 없습니다 | 투자 시작 |
| 신호 없음 | 이번 달 신규 추천이 없습니다 | 다음 점검일 표시 |
| 보유 없음 | 현재 보유 lot이 없습니다 | 매수 기록 추가 |
| 기록 누락 | 주문 가이드 이후 기록이 없습니다 | 체결 기록 |
| 데이터 실패 | 최신 신호를 가져오지 못했습니다 | 데이터 상태 확인 |

## 14. Figma 작업 목록

1. `TodayScreen`
2. `AssetsScreen`
3. `OperationsScreen`
4. `RecordScreen`
5. `SettingsScreen`
6. `OnboardingWizard`
7. `OrderGuideSheet`
8. `ExecutionRecordSheet`
9. `LotDetailSheet`
10. `DataStatusScreen`
11. Light/Dark color tokens
12. `ActionCard` 상태: normal, urgent, completed, blocked
13. `AlertRow` 상태: unread, done, snoozed, failed

## 15. 완료 기준

- 앱을 연 뒤 5초 안에 오늘 해야 할 일을 판단할 수 있다.
- 자산 변화 원인을 투자 손익, 환율, 입출금, 배당, 비용으로 구분할 수 있다.
- 주문 가이드를 본 뒤 30초 안에 체결 기록을 남길 수 있다.
- 놓친 매수/매도/리밸런싱은 `오늘` 화면의 Action Inbox에 남아 있다.
- 큰 글자 모드와 작은 화면에서도 금액, 종목명, 버튼 텍스트가 겹치지 않는다.
