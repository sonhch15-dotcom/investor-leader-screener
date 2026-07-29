# 품질 우량주 과매도 스크리너 — 사전등록 v0.5

## 문서 상태

- 버전: 0.5
- 기록일: 2026-07-30
- 상위 문서: `PREREGISTRATION.v0.4.md`,
  `PREREGISTRATION.v0.4.1.md`
- 상태: 최초 백테스트 신호일 및 과거 보정기간 조회 전
- 수익률 결과 열람·계산: 없음
- 현재 횡단면에서 확인한 값: 중앙값 1.3931, P90 5.9393
- 백테스트용 절대 임계값: 미확정

이 문서는 연결 총부채비율의 정의, 재구성 공식, 커버리지 최소선과
결측 처리 규칙을 변경하지 않는다. v0.4의 백테스트 임계값 분위수만
P90에서 P50으로 변경하고, 자기자본 0 이하 자동 미통과의 알려진 한계와
감사 로그를 추가한다.

현재 분포는 이미 확인했지만 수익률은 계산하거나 열람하지 않았다.
현재 중앙값 1.3931을 절대 임계값으로 복사하지 않는다.

## 임계값의 목적

재무 안정 항목은 단순 이상치 제거가 아니라 품질 게이트다. P90은
사전 보정분포의 약 90%를 통과시키므로, 심하게 오른쪽으로 치우친
총부채비율 분포에서는 극단값 제거 외에 선별 기능이 약하다.

P50은 양수 자기자본을 가진 사전 보정 관측치의 낮은 레버리지 절반과
높은 레버리지 절반을 나누는 중앙 기준이다. 이는 다음 정책 목적에서
선택한다.

> 양수 자기자본 기업 중 총부채비율이 사전 보정분포의 중앙값 이하인
> 기업만 재무 안정 게이트를 통과시킨다.

이 선택은 수익률을 높이기 위한 최적화 결과가 아니다. 현재 후보 수나
과거 수익률을 보고 조정한 값도 아니다. 품질 게이트가 모집단의
대부분을 통과시키는 장식이 되지 않도록 선별 강도를 약 절반으로
명시한 정책 기준이다.

P50 역시 경제학적으로 유일한 정답은 아니다. 수익률 결과가 나쁘거나
후보가 적다는 이유로 P50을 P60, P70 또는 절대값으로 바꾸지 않는다.
다른 강도를 검토하려면 기존 검증의 실패를 기록하고 독립된 새 가설로
사전등록해야 한다.

## 미래정보를 막는 P50 보정 규칙

v0.4의 60개월 point-in-time 절차와 선형보간 방식은 유지한다.

```python
CALIBRATION_MONTHS = 60
LEVERAGE_THRESHOLD_QUANTILE = 0.50
MAX_TOTAL_LIABILITIES_TO_EQUITY = None
```

1. 최초 백테스트 신호일 직전의 60개 연속 월말을 보정기간으로 고정한다.
2. 각 월말의 당시 S&P 500 구성 발행사를 복원하고 Financials,
   Real Estate, Utilities를 제외한다.
3. 각 월말에 실제로 공시되어 있던 최신 재무사실만 사용한다.
4. 각 월말마다 전체 90%, 각 포함 섹터 80%, 공시일·접수번호 100%
   최소선을 모두 확인한다.
5. 60개 월말 중 하나라도 최소선에 미달하면 임계값 보정은 무효다.
   월을 빼거나 보정기간 길이를 바꾸지 않는다.
6. 자기자본이 양수인 모든 유효 발행사-월 관측치를 하나의 사전 보정
   분포로 합친다.
7. 그 분포의 선형보간 P50을 절대 임계값으로 한 번 계산한다.
8. 계산 원시 정밀도를 모든 백테스트 신호일에 동일하게 적용하고,
   보고서 표시만 반올림한다.
9. 신호일의 총부채비율이 절대 임계값 이하일 때만 재무 안정 게이트를
   통과한다.

P50은 보정기간에서 약 절반의 선별 강도를 정의하지만, 고정된 절대값을
이후 모든 신호일에 적용하므로 실제 시점별 통과율이 항상 50%라는 뜻은
아니다.

최초 백테스트 신호일과 보정기간의 데이터 유효성이 확정되기 전에는
`MAX_TOTAL_LIABILITIES_TO_EQUITY`를 계산하지 않는다.

## 자기자본 0 이하 자동 미통과

연결 자기자본 `E <= 0`이면 총부채비율이 정의되지 않으므로 재무 안정
게이트 자동 미통과 규칙을 유지한다. 종목별로 다른 대체 지표를 쓰거나,
절댓값 자기자본을 분모로 사용하거나, 음수 값을 0으로 바꾸지 않는다.

다만 음수 자기자본은 재무 부실만 뜻하지 않는다. 누적 자사주 매입,
대규모 자본환원, 누적결손, 인수회계와 기타 장부상 요인도 원인이 될 수
있다. 따라서 이 규칙은 현금창출력이 좋은 기업도 재무 위험과 직접
관련되지 않은 이유로 제외할 수 있다. 이는 알려진 위음성 비용이다.

현재 SEC FSDS 2026 Q1 횡단면에서 자동 미통과인 22개 발행사는 다음과
같다.

| 종목 | 회사 | 섹터 |
|---|---|---|
| HPQ | HP Inc. | Information Technology |
| LOW | Lowe's | Consumer Discretionary |
| MCD | McDonald's | Consumer Discretionary |
| CAH | Cardinal Health | Health Care |
| MO | Altria | Consumer Staples |
| FICO | Fair Isaac | Information Technology |
| SBUX | Starbucks | Consumer Discretionary |
| HCA | HCA Healthcare | Health Care |
| AZO | AutoZone | Consumer Discretionary |
| ORLY | O’Reilly Automotive | Consumer Discretionary |
| MCK | McKesson Corporation | Health Care |
| VRSN | Verisign | Information Technology |
| MTD | Mettler Toledo | Health Care |
| YUM | Yum! Brands | Consumer Discretionary |
| BKNG | Booking Holdings | Consumer Discretionary |
| WYNN | Wynn Resorts | Consumer Discretionary |
| TDG | TransDigm Group | Industrials |
| DPZ | Domino's | Consumer Discretionary |
| PM | Philip Morris International | Consumer Staples |
| ABBV | AbbVie | Health Care |
| DELL | Dell Technologies | Information Technology |
| HLT | Hilton Worldwide | Consumer Discretionary |

이 목록은 현재 스냅샷이며 과거 전체 기간의 고정 제외 목록이 아니다.
각 신호일에는 당시 공시자료로 `E <= 0` 여부를 다시 판정하고 다음을
로그에 남긴다.

- 종목과 발행사명
- 섹터와 CIK
- 자기자본 수치
- 재무기간 말과 공시일
- 접수번호와 서식
- 제외 사유 `NONPOSITIVE_EQUITY_AUTO_FAIL`

현재 22개사의 근거는
`nonpositive_equity_auto_fail_2026q1.csv`에 보존한다. 자동으로
자사주 매입 원인이라고 분류하지 않으며, 원인 분석이 필요하면 별도
공시 근거를 사용한다.

## 변경하지 않는 규칙

- 총부채비율 정의와 SEC presentation 기반 복원 공식
- 전체 90%, 섹터별 80%, provenance 100% 커버리지 최소선
- 자기자본 0 이하 자동 미통과
- 결측 0 대입, custom 태그, 차원 합산과 종목별 수동 예외 금지
- 품질 게이트 필수 항목 결측은 미통과
- 매출총이익률 적신호의 평가 불가 상태
- CIK 승계는 공식 공시 근거가 있을 때만 등록
- 현재 횡단면 분위수는 데이터 품질 진단에만 사용
- 백테스트 성공 기준 확정 전 수익률 계산 금지

## 기록 고정

이 문서와 제외 목록, 계산 코드 및 현재 검증 결과를 다음 과거 커버리지
조회 전에 원격 저장소에 푸시하고 서명되지 않은 annotated tag라도
생성해 원격에 함께 푸시한다. 태그명과 커밋 해시는 후속 보고서에
인용한다.

태그 이후 규칙을 바꿔야 하면 이 파일을 덮어쓰지 않고 새 버전을 추가한다.
