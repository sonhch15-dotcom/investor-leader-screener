# Monthly Selection Test Plan

## Goal

현재 스크리너의 목적은 먼저 `종목 선정력`을 검증하는 것이다.

핵심 질문:

```text
과거 여러 기준일에서 현재 점수 모델로 Top 5 / Top 10 / Top 20을 골랐다면,
그 종목들은 이후 1개월 / 3개월 / 6개월 / 12개월 동안
현금, SPY, QQQ보다 좋은 성과를 냈는가?
```

## Confirmed Test Design

| 항목 | 결정 |
|---|---|
| 테스트 목적 | 종목 선정력 검증 |
| 기간 | 최근 3년 |
| 기준일 | 매월 마지막 금요일 |
| 진입 | 기준일 다음 거래일 종가 |
| 평가 | 1M / 3M / 6M / 12M 후 종가 |
| 선정 범위 | Top 5 / Top 10 / Top 20 |
| 중복 | 월별 중복 허용 |
| 비중 | 동일 비중 |
| 비교 기준 | 현금 0%, SPY, QQQ |
| 기본 분석 | 전체 점수 상위 Top N |
| 보조 분석 | 셋업 필터, 80점 이상 후보 |

## Metrics

각 조합마다 계산할 지표:

- 평균 수익률
- 중앙값 수익률
- 플러스 수익 비율
- SPY 초과수익 비율
- QQQ 초과수익 비율

조합:

```text
Top 5 / Top 10 / Top 20
×
1M / 3M / 6M / 12M
```

## Report Layout

GitHub Pages에서 볼 리포트 구조:

1. 전체 요약표
2. 벤치마크 비교
3. 시장 국면별 성과
4. 최악의 구간 분석
5. 최고/최악 기여 종목
6. 기준일별 상세 결과

## GitHub Pages Development Steps

### Step 1. 월간 기준일 생성

파일:

```text
src/monthly-selection-test.mjs
```

구현:

- 최근 3년 날짜 범위 계산
- 각 월의 마지막 금요일 계산
- 데이터가 부족한 기준일 제외

산출:

```json
[
  "2023-07-28",
  "2023-08-25",
  "2023-09-29"
]
```

### Step 2. 기준일별 점수 계산

각 기준일마다:

- 기준일까지의 가격 데이터만 사용
- `scoreUniverse()` 실행
- 전체 점수순으로 정렬
- Top 5 / Top 10 / Top 20 저장

주의:

- 기준일 이후 데이터가 점수 계산에 들어가면 안 됨
- 이것이 가장 중요한 미래 정보 차단 조건

### Step 3. 미래 수익률 계산

각 선정 종목마다:

- 기준일 다음 거래일 종가를 진입가로 사용
- 1M / 3M / 6M / 12M 후 종가를 평가가로 사용
- 같은 기간 SPY / QQQ 수익률 계산

산출:

```json
{
  "symbol": "GEV",
  "asOf": "2025-07-06",
  "entryDate": "2025-07-07",
  "entryPrice": 528.85,
  "returns": {
    "1m": 0.254,
    "3m": 0.138,
    "6m": 0.296,
    "12m": 1.178
  }
}
```

### Step 4. Top N별 포트폴리오 집계

Top 5 / Top 10 / Top 20별 동일 비중 성과 계산.

각 기준일 + 기간별로:

- 평균 수익률
- 중앙값 수익률
- 플러스 수익 비율
- SPY 초과수익 비율
- QQQ 초과수익 비율

### Step 5. 전체 요약 집계

모든 기준일을 합산해서 요약표 생성.

예시:

| Group | Horizon | Avg | Median | Positive | Beat SPY | Beat QQQ |
|---|---|---:|---:|---:|---:|---:|
| Top 5 | 1M | 2.1% | 1.4% | 58% | 53% | 48% |
| Top 10 | 3M | 7.8% | 5.2% | 63% | 56% | 51% |

### Step 6. 시장 국면별 성과

각 기준일의 시장 상태를 저장한다.

시장 상태:

- 강함
- 보통
- 약함
- 매우 약함

국면별로 Top N 성과를 다시 집계한다.

질문:

```text
이 스크리너는 강한 장에서만 잘 작동하는가?
약한 장에서도 방어력이 있는가?
```

### Step 7. 최악의 구간 분석

각 기준일별 Top N 포트폴리오 수익률을 정렬해서 최악의 구간을 찾는다.

보고할 내용:

- 최악의 기준일
- 해당 월 시장 상태
- Top N 수익률
- 손실 기여 종목
- SPY/QQQ 대비 여부

### Step 8. 최고/최악 기여 종목 분석

전체 테스트에서 종목별 기여도를 계산한다.

확인할 내용:

- 최고 기여 종목
- 최악 기여 종목
- 가장 자주 선정된 종목
- 성과가 특정 종목에 과도하게 의존했는지

### Step 9. 결과 JSON 생성

산출 파일:

```text
data/monthly-selection-test.json
monthly_selection_report.md
```

`monthly-selection-test.json`에는 대시보드가 읽을 구조화 데이터를 저장한다.

### Step 10. GitHub Pages 대시보드 연결

대시보드에 새 섹션 또는 탭을 추가한다.

추천 구조:

```text
현재 스크리너
월간 선정력 검증
백테스트 리포트
차트 리뷰
```

첫 구현에서는 복잡한 라우팅 없이 한 페이지 안에 섹션을 추가한다.

### Step 11. Pages 빌드에 포함

`scripts/build-pages.mjs`에 다음 파일 복사를 추가한다.

```text
data/monthly-selection-test.json
monthly_selection_report.md
```

GitHub Actions workflow에서:

```text
node src/monthly-selection-test.mjs
node scripts/build-pages.mjs
```

순서로 실행한다.

### Step 12. 검증

로컬 검증:

```powershell
node src/monthly-selection-test.mjs --sample
node src/monthly-selection-test.mjs
node scripts/build-pages.mjs
```

확인:

- JSON 생성 여부
- 리포트 생성 여부
- Pages 대시보드에서 표가 보이는지
- GitHub Actions 성공 여부

## Implementation Priority

1. `src/monthly-selection-test.mjs` 생성
2. `data/monthly-selection-test.json` 생성
3. `monthly_selection_report.md` 생성
4. GitHub Pages 대시보드에 요약표 추가
5. workflow에 월간 테스트 실행 단계 추가

## First Version Scope

첫 버전에서는 다음만 구현한다.

- 최근 3년
- 매월 마지막 금요일
- Top 5 / Top 10 / Top 20
- 1M / 3M / 6M / 12M
- 평균, 중앙값, 플러스 비율, SPY/QQQ 초과 비율

다음은 2차로 미룬다.

- 점수 비례 비중
- 다음날 시가 진입 비교
- 손절/익절 포함 매매 백테스트
- 과거 지수 편입/편출 반영
- 5년 이상 장기 테스트
