#!/usr/bin/env python3
"""
Aggregate scanner outputs found in /tmp into a single findings-summary JSON.

Usage: python3 analysis/aggregate_findings.py /tmp /path/to/output.json
"""
import sys
import json
import os
from pathlib import Path


def try_parse_json(s):
    try:
        return json.loads(s)
    except Exception:
        return None


def process_file(p: Path):
    recs = []
    name = p.name
    try:
        text = p.read_text(errors='ignore')
    except Exception as e:
        return [{"source": str(p), "error": str(e)}]

    # Try NDJSON: parse line by line
    lines = [l for l in text.splitlines() if l.strip()]
    if not lines:
        return [{"source": str(p), "note": "empty"}]

    parsed_any = False
    for ln in lines:
        j = try_parse_json(ln)
        if j is not None:
            parsed_any = True
            recs.append({"source": str(p), "type": "json-line", "data": j})
        else:
            # continue, may be plain text lines
            pass

    if parsed_any:
        return recs

    # Otherwise try parse whole as JSON
    j = try_parse_json(text)
    if j is not None:
        return [{"source": str(p), "type": "json", "data": j}]

    # Fallback: return as raw text (truncate long blobs)
    sample = text[:10000]
    return [{"source": str(p), "type": "text", "data": sample}]


def main(tmpdir, outpath):
    tmp = Path(tmpdir)
    candidates = []
    patterns = ["trufflehog*.json", "*trufflehog*.json", "*detect-secrets*.baseline", "*detect-secrets*.baseline.json", "*gitleaks*.json", "*git-secrets*.json", "*gitleaks*.json", "*/artifact-*.zip", "*/artifact-*/*", "*trufflehog-combined*.json"]
    for pat in patterns:
        for p in tmp.glob(pat):
            if p.is_file():
                candidates.append(p)

    # also include any files in /tmp/actions-check and /tmp/vscode-term-logs
    extra_dirs = [tmp / 'actions-check', tmp / 'vscode-term-logs']
    for d in extra_dirs:
        if d.exists():
            for p in d.rglob('*'):
                if p.is_file():
                    candidates.append(p)

    # dedupe by path
    seen = set()
    final = []
    for p in candidates:
        sp = str(p)
        if sp in seen:
            continue
        seen.add(sp)
        final.append(p)

    results = {"generated_at": None, "files_scanned": [], "findings": []}
    results["generated_at"] = __import__('datetime').datetime.utcnow().isoformat() + 'Z'

    for p in sorted(final):
        results["files_scanned"].append(str(p))
        recs = process_file(p)
        for r in recs:
            results["findings"].append(r)

    # write pretty JSON
    outp = Path(outpath)
    outp.parent.mkdir(parents=True, exist_ok=True)
    outp.write_text(json.dumps(results, indent=2))
    print(f"Wrote summary to {outp}")


if __name__ == '__main__':
    if len(sys.argv) < 3:
        print("Usage: aggregate_findings.py /tmp output.json")
        sys.exit(2)
    main(sys.argv[1], sys.argv[2])
