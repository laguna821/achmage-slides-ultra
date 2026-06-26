## Managed Settings Code

![Vault graph](assets/vault-graph.svg)

```ts
const strictKnownMarketplaces = [
  { source: "github", repo: "acme-corp/approved-plugins" },
  { source: "npm", package: "@acme-corp/compliance-plugins" },
  { source: "internal", registry: "skills" },
  { source: "audit", policy: "required" },
  { source: "export", telemetry: false }
];
```
