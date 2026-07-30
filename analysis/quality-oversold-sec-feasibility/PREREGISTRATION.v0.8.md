# 품질 우량주 과매도 스크리너 — 사전등록 v0.8

## 문서 상태

- 버전: 0.8
- 기록일: 2026-07-30
- 상위 문서: `PREREGISTRATION.v0.7.md`
- 상태: 평가기간 재무 커버리지 및 legacy 종목 가격 가용성 조회 전
- 사전등록 태그: `quality-oversold-prereg-v0.8`
- 수익률·초과수익·승률 계산: 없음

이 문서는 2015년 10월 이후 성과를 열기 전에 확인할 두 데이터 관문을
정의한다. v0.7까지 확정한 재무 정의, 월별 90%·80%·100% 최소선,
최초 신호월 2015-10과 총부채비율 임계값 1.268891979601298은
변경하지 않는다.

## 관문 1 — 평가기간 재무 커버리지

평가기간은 2015-10부터 SEC FSDS와 월말 S&P 500 구성 리비전이 모두
존재하는 마지막 월까지다. 월별 판정은 기존과 같다.

```python
MIN_OVERALL_COVERAGE = 0.90
MIN_SECTOR_COVERAGE = 0.80
REQUIRED_PROVENANCE_RATE = 1.00
EVALUATION_START_MONTH = "2015-10"
```

연도별 판정은 평균이나 합산 비율을 사용하지 않는다.

1. 해당 연도 평가기간에 포함되는 모든 월을 사용한다.
2. 연도별 전체 커버리지는 그해 월별 전체 커버리지의 최솟값이다.
3. 연도별 섹터 커버리지는 그해 월별 최저 섹터 커버리지의 최솟값이다.
4. 연도별 provenance는 그해 월별 provenance의 최솟값이다.
5. 해당 연도의 모든 월이 세 최소선을 통과해야 연도 통과다.
6. 2015년과 마지막 미완결 연도는 `PARTIAL_YEAR`로 명시하되 포함된
   월 중 하나라도 미달하면 똑같이 실패다.
7. 한 연도라도 실패하면 평가기간 재무 데이터 관문 전체를
   `INVALID_EVALUATION_FINANCIAL_COVERAGE`로 판정하고 수익률 계산을
   시작하지 않는다.

이 집계는 최소선을 겨우 넘는 월을 평균으로 숨기지 않기 위한 규칙이다.
재무 커버리지 프로세스는 가격에 접근하지 않는다.

## 관문 2 — 현재와 다른 과거 security episode 가격 가용성

### 감사 모집단

월말 S&P 500 리비전에서 `(symbol, CIK, 품질 유니버스 포함 여부)`가
달력월 단위로 연속해서 나타나는 구간을 `security episode`로 정의한다.

- 감사 시작: 2015-10
- 감사 종료: 가장 최근 복원 월
- 현재와 동일한 `(symbol, CIK)`가 마지막 복원 월에도 있으면
  current security
- 마지막 복원 월에 동일 쌍이 없으면 legacy security episode
- 같은 CIK가 현재 다른 symbol로 있으면
  `TICKER_OR_SHARE_CLASS_CHANGED`
- 같은 symbol이 현재 다른 CIK로 있으면
  `ENTITY_CHANGED_OR_SYMBOL_REUSED`
- 둘 다 아니면 `NO_LONGER_CURRENT_CONSTITUENT_SECURITY`

회사명 유사도나 현재 티커로 과거 심볼을 자동 치환하지 않는다. 동일
security가 탈락 후 재편입되어도 현재 Yahoo 심볼로 과거 episode가
조회되는지 원래 `(symbol, CIK)` 기준으로 감사한다.

주 판정 모집단은 당시 Financials, Real Estate, Utilities가 아닌
episode다. 전체 S&P 500 legacy episode 결과도 보조로 함께 보고한다.

### 가격 원천과 측정

가격 원천은 yfinance의 Yahoo 일별 `Close`다. `Adj Close`, 배당,
SPY 수익률, 종목 수익률과 가격 간 비율은 계산하지 않는다. SPY에서는
기대 거래일 날짜만 가져온다.

각 episode의 핵심 구간은 첫 관측 월말부터 마지막 관측 월말까지다.
이 구간은 월말 리비전상 해당 security가 존재함이 직접 확인되는 범위다.

- 기대 세션: 핵심 구간 안의 SPY 거래일
- 관측 세션: 같은 날짜에 해당 symbol의 유효 `Close`가 존재하는 날
- 세션 커버리지: 관측 세션 수 ÷ 기대 세션 수
- 말기 존재: episode 종료일 이전 마지막 10개 기대 세션 중 하나
  이상에 가격 존재
- 기대 세션이 5개 미만인 짧은 episode는 해당 관측 월에 하나 이상의
  가격이 있으면 세션 조건을 통과하되 `SHORT_EPISODE_PROBE`로 표시
- 첫 episode 월말 이전 400일의 가격은 252세션 지표 준비 가능성을
  별도 진단하지만 legacy 가격 성공 판정에는 넣지 않음

```python
MIN_EPISODE_SESSION_COVERAGE = 0.95
MIN_ANNUAL_EPISODE_PASS_RATE = 1.00
MIN_ANNUAL_SESSION_COVERAGE = 0.95
TERMINAL_SESSION_LOOKBACK = 10
INDICATOR_WARMUP_SESSIONS = 252
```

episode는 세션 커버리지 95% 이상이고 말기 가격이 있어야 통과한다.
연도별로 그해와 겹치는 legacy episode를 다시 같은 방식으로 평가한다.
해당 연도의 모든 episode가 통과하고, 전체 기대 세션의 95% 이상이
관측되어야 그 연도가 통과한다.

### 해석 한계

이 감사가 통과해도 현금합병 대가, 주식교환 비율, 파산 회수액 또는
상장폐지 후 OTC 가격이 자동 복원됐다는 뜻은 아니다. 일별 거래가격
가용성은 생존 편향을 줄이기 위한 필요조건이지 충분조건이 아니다.
기업행위 종료 처리는 수익률 계산 전에 별도 사전등록해야 한다.

한 연도라도 가격 관문에 실패하면 백테스트의 최대 판정을
`EXPLORATORY_ONLY_PRICE_COVERAGE`로 제한한다. 이 경우 수익률을
계산하거나 현재 시점 퍼널 구현으로 넘어가기 전에 계속 진행할지
사용자에게 다시 확인받는다. 가격 최소선을 낮추거나 실패 episode를
분모에서 빼지 않는다.

## 프로세스 분리와 출력 금지

재무 커버리지와 가격 가용성은 별도 명령으로 실행한다. 가격 감사
프로그램의 허용 출력은 다음뿐이다.

- episode와 연도별 기대·관측 세션 수
- 원시 가격 존재율, 최초·최종 관측일과 오류 상태
- legacy 분류와 품질 유니버스 포함 여부
- `prices_accessed = true`
- `returns_calculated = false`

가격 수준, 보유기간 종가, 종목·SPY 수익률, 초과수익, 승률, 신뢰구간,
신호 발생 수와 전략 성과는 출력하지 않는다.

두 관문 결과를 별도 커밋과 원격 태그로 고정하기 전에는 수익률
프로세스를 만들거나 실행하지 않는다.
