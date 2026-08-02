# Update Plans

계획은 완료된 연구를 구현 가능한 작업과 검증 항목으로 변환한다. 단순히 R-ID를 나열하는 문서가 아니라 어떤 Finding이 어떤 결정을 만들었는지를 보여 주는 추적 문서다.

## 생성과 상태 전이

```bash
npm run plan:new -- --title "내보내기 실패 처리 개선" --research R-002,R-003
```

상태는 다음 순서로 사용한다.

- `draft`: 범위와 결정 정리 중. 미완료 연구를 참고할 수 있지만 승인할 수 없다.
- `approved`: 사용자가 실행을 요청했고 모든 연구가 `complete`이며 최신성 검토를 통과했다.
- `in-progress`: 계획 자체가 실행 중임을 표시할 필요가 있을 때 사용한다.
- `complete`: 연결된 실행이 끝나고 검증 결과가 기록되었다.
- `superseded`: 다른 P-ID가 대체했다. 삭제하지 않는다.

## 승인 전 확인

- `research`에 관련된 모든 R-ID가 들어 있는가?
- 각 보고서의 `baseline_commit`, `updated`, `review_by`, 미해결 질문을 계획 시점에 다시 확인했는가?
- Research traceability 표의 모든 결정이 Finding ID와 검증 방법을 갖는가?
- Verification strategy의 모든 검증·인수 조건에 중복·누락 없는 `AC-NNN`이 있는가?
- 비범위와 롤백 조건이 명확한가?
- 코드, 생성 산출물, 문서, 설정, 버전, 배포 영향을 빠뜨리지 않았는가?

새 근거가 계획을 바꾸면 먼저 R-ID를 개정한 뒤 계획 Revision log를 갱신한다. 실행 중 범위가 바뀌어도 같은 순서를 따른다.

`approved`, `in-progress`, `complete` 계획에는 미체크 승인 항목이 없어야 한다. 실행을 완료할 때는 이 계획의 AC-ID 전체를 실행 기록에서 정확히 한 번씩 PASS로 증명한다.

P-ID는 삭제하거나 다른 계획에 재사용하지 않는다. 더 이상 유효하지 않은 계획은 `superseded`로 남기고 대체 계획을 새 P-ID로 만든다.
