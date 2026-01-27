import os
import json
from datetime import datetime
from typing import Any, Dict, Optional

TRACE_DIR = os.path.join(os.path.dirname(__file__), "..", "logs")
TRACE_FILE = os.path.join(TRACE_DIR, "cooking_traces.jsonl")


def _ensure_trace_dir():
    try:
        os.makedirs(TRACE_DIR, exist_ok=True)
    except Exception:
        pass


def trace_event(kind: str, prompt: str, response: str, metadata: Optional[Dict[str, Any]] = None) -> None:
    """Append a trace event as a JSON line.

    Fields: timestamp (ISO), kind, prompt, response, metadata
    """
    _ensure_trace_dir()
    ev = {
        "timestamp": datetime.utcnow().isoformat() + "Z",
        "kind": kind,
        "prompt": prompt,
        "response": response,
        "metadata": metadata or {},
    }
    try:
        with open(TRACE_FILE, "a", encoding="utf8") as f:
            f.write(json.dumps(ev, ensure_ascii=False) + "\n")
    except Exception:
        # Tracing should never break main flow
        pass


def read_traces(limit: int = 100):
    """Read last `limit` traces (most recent first)."""
    if not os.path.exists(TRACE_FILE):
        return []
    out = []
    try:
        with open(TRACE_FILE, "r", encoding="utf8") as f:
            for line in f:
                try:
                    out.append(json.loads(line))
                except Exception:
                    continue
    except Exception:
        return []
    return out[-limit:][::-1]
