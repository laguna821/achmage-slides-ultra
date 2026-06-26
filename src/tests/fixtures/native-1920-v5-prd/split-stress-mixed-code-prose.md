## 권한 모델 마이그레이션: ABAC 도입 전후

기존 RBAC 모델은 사용자에게 역할(role)을 부여하고, 역할에 권한(permission)을 매핑하는 방식이었습니다. 단순하고 빠르지만, 컨텍스트(요청 시각, IP, 리소스 소유자 등)를 고려할 수 없다는 한계가 있었습니다.

ABAC는 attribute 기반입니다. 사용자, 리소스, 환경의 속성들을 정책 표현식으로 결합하여 그때그때 평가합니다. 표현력은 훨씬 높지만 잘못 쓰면 정책 관리가 빠르게 복잡해집니다.

핵심 마이그레이션 단계:

```typescript
// before: RBAC
function canEdit(user: User, doc: Document): boolean {
  return user.roles.some((r) => r === "editor" || r === "admin");
}

// after: ABAC
type Attributes = {
  user: { id: string; roles: string[]; tier: "free" | "pro" };
  resource: { ownerId: string; visibility: "private" | "team" | "public" };
  env: { now: Date; ip: string };
};

function canEdit(attrs: Attributes): boolean {
  if (attrs.user.roles.includes("admin")) return true;
  if (attrs.resource.ownerId === attrs.user.id) return true;
  if (
    attrs.resource.visibility === "team" &&
    attrs.user.tier === "pro" &&
    attrs.user.roles.includes("editor")
  ) {
    return true;
  }
  return false;
}
```

도입 후 우리가 가장 신경 쓴 것은 *정책 표현식의 가독성* 입니다. 코드로 직접 쓰면 빠르지만 정책 검토자(보안팀)가 읽기 어렵습니다.

그래서 정책 DSL을 별도 레이어로 두고, 코드에서는 DSL 평가 함수만 호출합니다. DSL은 YAML로 정의되며 보안팀이 직접 수정 가능합니다.

이 분리 덕분에, 보안팀이 새로운 규제(예: GDPR, SOC2)에 대응하는 정책을 PR로 직접 추가할 수 있습니다. 엔지니어링 팀은 평가 엔진의 정확성과 성능에만 집중합니다.

성능 측면에서는 DSL 파싱을 매 요청마다 하지 않도록 캐싱했습니다. 정책 변경 시 invalidate를 명시적으로 발행합니다. 이것 덕분에 평균 평가 시간은 RBAC 대비 1.4배에 그쳤습니다.

마지막으로 옵저버빌리티: 모든 정책 평가 결과를 구조화 로그로 남깁니다. 거부된 케이스는 Slack으로 알림이 가서, 사용자 컴플레인이 들어오기 전에 우리가 먼저 인지합니다.
