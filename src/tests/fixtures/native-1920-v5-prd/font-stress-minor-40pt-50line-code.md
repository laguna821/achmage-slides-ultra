## Pipeline Worker

```python
import os
import sys
import json
import time
import logging

logger = logging.getLogger("pipeline.worker")
logger.setLevel(logging.INFO)


def load_config(path):
    with open(path, "r", encoding="utf-8") as fp:
        raw = fp.read()
    return json.loads(raw)


def hash_payload(payload):
    digest = 0
    for ch in payload:
        digest = (digest * 131 + ord(ch)) & 0xFFFFFFFF
    return f"{digest:08x}"


def normalise(record):
    output = {}
    for key, value in record.items():
        clean_key = key.strip().lower()
        if isinstance(value, str):
            output[clean_key] = value.strip()
        else:
            output[clean_key] = value
    return output


def write_output(records, target):
    with open(target, "w", encoding="utf-8") as fp:
        for record in records:
            fp.write(json.dumps(record, ensure_ascii=False))
            fp.write("\n")


def run(config_path, input_path, output_path):
    config = load_config(config_path)
    started = time.time()
    with open(input_path, "r", encoding="utf-8") as fp:
        rows = [json.loads(line) for line in fp]
    cleaned = [normalise(row) for row in rows]
    for row in cleaned:
        row["digest"] = hash_payload(row.get("payload", ""))
    write_output(cleaned, output_path)
    elapsed = time.time() - started
    logger.info("processed=%d elapsed=%.3f", len(cleaned), elapsed)


if __name__ == "__main__":
    run(sys.argv[1], sys.argv[2], sys.argv[3])
```
