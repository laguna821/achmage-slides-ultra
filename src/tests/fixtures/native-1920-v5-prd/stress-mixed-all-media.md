## Launch Day Snapshot

![Vault graph](assets/vault-graph.svg)

> [!NOTE]
> Region rollout completed for NA + EU. APAC scheduled for tomorrow's window.

| Region | Status | Latency p95 |
|---|---|---:|
| NA | green | 142ms |
| EU | green | 168ms |
| APAC | scheduled | — |

```sh
deploy --region apac --window 2026-05-09T03:00Z --canary 5%
```

The dashboard at the top tracks live error budget consumption. If the canary exceeds 0.5% errors within 30 minutes, the rollout halts automatically.
