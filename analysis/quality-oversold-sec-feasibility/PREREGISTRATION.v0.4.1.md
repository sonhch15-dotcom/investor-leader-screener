# 품질 우량주 과매도 스크리너 — 사전등록 v0.4.1

## 문서 상태

- 버전: 0.4.1
- 기록일: 2026-07-30
- 상위 문서: `PREREGISTRATION.v0.4.md`
- 상태: 공식 재무상태표 presentation 기반 재검증 직전
- 수익률 결과 열람·계산: 없음
- 현재 비율 분포 계산: 없음
- 관측한 예비 커버리지: Companyfacts 단독 매핑 304/362(84.0%)
- 백테스트용 임계값: 미확정

이 문서는 v0.4의 지표, 60개월 사전 보정 P90 규칙, 90%/80%
커버리지 최소선과 실패 시 행동을 변경하지 않는다. SEC Companyfacts가
XBRL 차원과 재무상태표 presentation 문맥을 보존하지 않아 발생한
두 매핑 오류만 수정한다.

## Companyfacts 단독 매핑이 최종 판정이 아닌 이유

예비 실행에서 다음 문제가 확인됐다.

1. 일부 발행사에서
   `StockholdersEquityIncludingPortionAttributableToNoncontrollingInterest`
   하위 차원 구성요소가 Companyfacts에서는 차원 정보 없이 총계 후보처럼
   보였다.
2. 비지배지분이 없는 발행사가 재무상태표에
   `Total stockholders' equity`를 최종 연결 자기자본으로 제시해도,
   별도 `MinorityInterest` 사실이 없다는 이유로 v0.4 구현이 이를
   거부했다.

첫 번째는 잘못된 총계 선택이고, 두 번째는 공시된 최종 총계의 의미를
버린 과잉 결측 판정이다. 따라서 84.0%를 지표 정의의 실패로 판정하지
않고 공식 재무상태표 presentation 문맥으로 재검증한다.

## 현재 횡단면 검증의 원천

현재 데이터 가능성 검증에는 SEC Financial Statement Data Set의
다음 파일을 결합한다.

- `sub.txt`: 접수번호, 공시일, 보고기간
- `pre.txt`: 재무상태표의 표시 순서와 공식 라벨
- `num.txt`: entity-wide USD 수치와 차원 정보

`stmt = BS`, `qtrs = 0`, `uom = USD`, `coreg` 없음, 동일 접수번호와
동일 보고기간 말인 사실만 사용한다. 차원 값이 없는 entity-wide 사실을
항상 우선하며, entity-wide 값이 없을 때 차원 합산으로 총계를 만들지
않는다.

Companyfacts는 태그 존재와 공시 provenance를 교차검증하는 보조 원천으로
사용할 수 있지만, presentation 문맥과 충돌하면 FSDS의 entity-wide
재무상태표 사실을 우선한다.

## 연결 총자기자본의 허용 공식

`E`는 아래 순서로 복원한다.

1. entity-wide
   `StockholdersEquityIncludingPortionAttributableToNoncontrollingInterest`
2. 위 총계가 없고 entity-wide `StockholdersEquity`와
   entity-wide `MinorityInterest`가 모두 있으면 두 값을 합산
3. 위 두 방식이 모두 없을 때, entity-wide `StockholdersEquity`를
   재무상태표가 **최종 총자기자본**으로 명시한 경우 그 공시 총계를 사용

3번의 최종 총계 판정은 다음을 모두 충족해야 한다.

- 태그 버전이 표준 `us-gaap` taxonomy
- 공식 라벨에 `total`이 포함됨
- entity-wide 수치임
- 동일 재무상태표에서 `LiabilitiesAndStockholdersEquity`보다 앞에 표시
- entity-wide 자기자본 관련 행 중 `LiabilitiesAndStockholdersEquity`
  직전의 마지막 총계 행임
- entity-wide `MinorityInterest`와 비지배지분 포함 총자기자본 행이
  별도로 존재하지 않음

이는 `MinorityInterest` 결측을 숫자 0으로 대입하는 규칙이 아니다.
발행사가 공식 재무상태표에서 해당 값을 최종 `Total stockholders'
equity`로 표시했다는 presentation 증거를 사용하는 규칙이다.

## 연결 총부채의 허용 공식

`L`은 아래 순서로 복원한다.

1. entity-wide `Liabilities`
2. 위 값이 없고 `T`와 유효한 `E`가 있으면 `L = T - E`

`T`는 entity-wide `LiabilitiesAndStockholdersEquity`만 허용한다.
`LiabilitiesCurrent`와 여러 비유동 항목을 임의로 합산하지 않는다.

## 일치 검사와 결측

- `L`, `E`, `T`가 모두 있으면 v0.4의 0.5% 회계등식 검사를 적용
- 직접 총자기자본과 `StockholdersEquity + MinorityInterest`가 모두
  있으면 0.5% 일치 검사 적용
- `L < 0`: 데이터 오류로 미해결
- `E <= 0`: 비율 분포에서 제외하고 품질 게이트 자동 미통과
- 필수 공식 미충족: 미해결
- custom 태그, 차원 합산, 종목별 수동 예외, 결측 0 대입 금지

## 이번 재검증의 행동 규칙

공식 presentation 기반 재검증 결과가 다음을 모두 충족하면 지표 정의를
유지한다.

- 전체 판정 가능 비율 90% 이상
- 각 포함 GICS 섹터 판정 가능 비율 80% 이상
- 사용 사실의 공시일·접수번호 존재율 100%

통과한 경우에만 현재 횡단면 분위수를 데이터 품질 진단용으로 계산한다.
현재 P90은 백테스트 임계값으로 사용하지 않는다.

재검증에서도 하나라도 미달하면 v0.4의 최종 실패 규칙을 적용한다.
세 번째 부채 지표나 추가 매핑 완화안을 찾지 않는다.

## 변경하지 않은 백테스트 규칙

- 최초 신호일 직전 60개 연속 월말
- 당시 구성 종목과 당시 공시된 사실만 사용
- 60개 월말 모두 90%/80%/provenance 최소선 충족
- 유효 발행사-월 관측치의 선형보간 P90을 한 번 계산
- 계산 원시 정밀도를 모든 신호일에 고정 적용
- 현재 2026년 분포는 임계값 계산에서 제외
- 백테스트 시작일과 사전 보정 데이터 유효성 확정 전 수익률 계산 금지
