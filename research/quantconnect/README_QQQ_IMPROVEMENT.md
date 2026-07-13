# QQQ 개선 연구 재실행 안내

이 폴더의 QQQ 개선 연구는 반드시 아래 순서로 실행한다.

1. `qqq_improvement_stage1.py`: 종목 수, 기존·신규 주도주, 비중, 상관 제한
2. `qqq_improvement_stage2.py`: 월 교체, MA200 매도, 재진입
3. `qqq_improvement_stage3.py`: 시장 위험, VIX, 방어 전환
4. `qqq_improvement_quality_test.py`: 최소 품질 필터
5. `qqq_improvement_stage4_stress.py`: 체결 시점과 거래비용, 워크포워드, 재현성

각 단계는 앞 단계의 통과 후보만 받는다. 목표를 통과하지 못한 단계 뒤에서 조합을 더 늘리지 않는다.

## 고정 계약

- QQQ 구성 종목의 원본 QuantConnect `Symbol`을 매수·평가·매도까지 유지
- 티커 문자열로 종목을 다시 `add_equity` 하지 않음
- 신호일 기준 QQQ 구성 정보 5거래일 지연
- 월 마지막 금요일 신호, 다음 거래일 시가 기본 체결
- 매수·매도 각각 0.25%, 0.50% 스트레스
- 개발 2010-08~2021-12, 검증 2022-01~2024-12
- 2025년 이후는 후보가 목표를 통과한 뒤 한 번만 확인
- 초기자금 1억원, 소수점 거래, 추가 입출금 없음

## 완료 조건

QuantConnect 실행 결과를 `research/quantconnect/logs`의 같은 형식으로 저장한 뒤 다음 명령을 실행한다.

```powershell
& '<bundled-node-path>\node.exe' scripts\verify-qqq-improvement-research.mjs
```

검증기가 통과해도 Public API와 Android 전략은 자동 변경하지 않는다. 별도 승격 승인과 공유 문서 갱신이 필요하다.
