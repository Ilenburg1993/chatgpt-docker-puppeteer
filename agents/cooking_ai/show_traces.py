#!/usr/bin/env python3
from rich import print
from rich.table import Table
from .tracing import read_traces


def main(limit: int = 20):
    traces = read_traces(limit)
    if not traces:
        print("Nenhum trace encontrado.")
        return
    table = Table("#", "timestamp", "kind", "model", "prompt_preview")
    for i, t in enumerate(traces, 1):
        meta = t.get("metadata", {}) or {}
        model = meta.get("model", "")
        prompt = t.get("prompt", "")
        preview = (prompt[:80] + "...") if len(prompt) > 80 else prompt
        table.add_row(str(i), t.get("timestamp", ""), t.get("kind", ""), model, preview)
    print(table)


if __name__ == '__main__':
    main()
