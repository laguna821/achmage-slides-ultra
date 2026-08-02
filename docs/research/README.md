# Research Register 운영 안내

Research Register는 업데이트 결정을 내리기 전에 무엇을 확인했고, 어떤 근거로 어떤 결론에 도달했는지를 누적하는 저장소 내 장부다. `REGISTER.md`는 빠른 탐색용 인덱스이고, `reports/R-NNN.md`가 정식 기록이다.

## 기본 흐름

1. `REGISTER.md`에서 같은 의사결정 질문을 다룬 보고서가 있는지 찾는다.
2. 같은 질문이면 기존 보고서를 최신화하고 Revision log에 변경 내역을 남긴다.
3. 다른 질문이면 새 ID를 원자적으로 발급한다.
4. 조사 중에는 상태를 `draft` 또는 `in-progress`로 둔다.
5. 근거, 반대 근거, Finding, Recommendation, Planning handoff가 완성되면 `complete`로 바꾼다.
6. `npm run research:sync`와 `npm run governance:check`를 실행한다.

새 보고서는 다음 명령으로 만든다.

```bash
npm run research:new -- --title "설정 마이그레이션 전략" --topic "settings-migration-strategy"
```

`topic`은 하위 시스템 이름이 아니라 **핵심 의사결정 질문을 식별하는 고유 키**로 쓴다. 예를 들어 `export`처럼 넓은 키보다 `export-remote-image-failure-policy`처럼 범위를 드러내는 키가 좋다.

## 같은 보고서를 갱신할 때

아래 항목이 모두 같으면 같은 R-ID를 유지한다.

- 결정 대상: 조사 결과가 답해야 할 제품 결정
- 핵심 질문: 검증 또는 반증하려는 가설
- 영향 범위: 독립적으로 배포·검증할 수 있는 제품 표면
- 성공 기준: 결론을 채택할 수 있는 조건

새 출처 추가, 같은 테스트의 재실행, 라이브러리 버전 변화 재확인, 미해결 질문 보강은 기존 보고서의 개정이다. `updated`, `baseline_commit`, `review_by`, Source register, Revision log를 함께 갱신한다.

## 새 R-ID가 필요할 때

다음 중 하나라도 해당하면 새 보고서를 만든다.

- 다른 제품 결정을 내려야 한다.
- 별도의 계획과 배포로 진행할 수 있는 기능 또는 하위 시스템이다.
- 성공 기준이나 사용자가 체감하는 결과가 달라졌다.
- 기존 보고서는 배경 자료일 뿐 새 질문을 직접 답하지 않는다.
- 기존 결론의 전제가 무너져 과거 기록을 보존한 채 새 기준선에서 다시 조사해야 한다.

관련 보고서는 `related`에, 새 보고서가 대체하는 문서는 `supersedes`에 적는다. 대체된 보고서는 삭제하지 않고 `superseded` 상태로 남긴다. 교체할 때는 기존 보고서를 먼저 `superseded`로 바꾸고 같은 변경 세트에서 다음처럼 새 문서를 만든다.

```bash
npm run research:new -- --title "새 기준선 조사" --topic "new-decision-key" --supersedes R-002
```

## 상태

| 상태 | 의미 | 계획에서 사용 가능 |
|---|---|---|
| `draft` | 골격만 만들었거나 조사 전 | 아니요 |
| `in-progress` | 근거 수집·검증 중 | 초안 참고만 가능 |
| `complete` | Finding과 권고가 검토 가능한 상태 | 예 |
| `needs-refresh` | 결론에 영향을 줄 정보가 오래되거나 전제가 바뀜 | 아니요 |
| `superseded` | 다른 R-ID가 공식 대체 | 아니요. 새 보고서를 사용 |

`review_by`가 지난 `complete` 보고서는 자동으로 삭제되거나 실패 처리되지 않지만 경고가 난다. 승인 또는 진행 중인 계획이 오래된 보고서를 사용하면 검증이 실패한다.

## 보고서 작성 규칙

- 템플릿의 모든 섹션을 유지한다. 해당 없음은 이유와 함께 `해당 없음`이라고 쓴다.
- Source ID는 `SRC-001`, Finding ID는 `F-001`, Recommendation ID는 `REC-001`부터 보고서 안에서 순차 부여한다.
- 로컬 파일은 기준 커밋과 `path:line`을 함께 남긴다. 줄 번호가 크게 변할 수 있으면 심볼명도 적는다.
- 웹 정보는 검색 결과가 아니라 가능한 한 원문을 인용한다. 변동 정보는 접근일을 반드시 적는다.
- 외부 문구를 길게 복사하지 않고 결론에 필요한 만큼 요약한다.
- 관찰과 해석이 섞이면 해석임을 표시한다.
- 실패한 실험과 반례도 기록한다. 결론과 맞지 않는 근거를 누락하지 않는다.
- 계획에 넘길 때는 파일 후보만 나열하지 말고 인수 조건과 필요한 검증 수준을 함께 적는다.

## 자동화

```bash
npm run research:new -- --title "..." --topic "..."       # 다음 R-ID 발급 및 초안 생성
npm run research:sync                                      # frontmatter로 Register 재생성
npm run governance:check                                  # ID, 메타데이터, 링크, 교차참조 검증
npm run governance:smoke                                  # 생성·삭제·재사용·diff 실패 게이트 점검
```

생성 명령은 잠금 파일을 사용하므로 두 프로세스가 같은 ID를 동시에 발급하지 않는다. 보고서 파일명과 ID는 한 번 생성한 뒤 변경하지 않는다.

Windows PowerShell의 실행 정책이 `npm.ps1`을 막는 환경에서는 같은 명령의 `npm` 대신 `npm.cmd`를 사용한다.
