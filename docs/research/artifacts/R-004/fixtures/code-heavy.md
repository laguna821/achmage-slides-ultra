---
marp: true
theme: hallym-light
---

# Code fixture

## TypeScript

```typescript
type Frame = { group: number; frame: number };

export function next(frames: Frame[], current: Frame): Frame {
  const index = frames.findIndex(
    (entry) => entry.group === current.group && entry.frame === current.frame,
  );
  return frames[Math.min(frames.length - 1, index + 1)];
}
```

## Python

```python
def median(values):
    ordered = sorted(values)
    middle = len(ordered) // 2
    if len(ordered) % 2:
        return ordered[middle]
    return (ordered[middle - 1] + ordered[middle]) / 2
```

## JSON

```json
{
  "scenario": "code-heavy",
  "deterministic": true,
  "iterations": 20
}
```

