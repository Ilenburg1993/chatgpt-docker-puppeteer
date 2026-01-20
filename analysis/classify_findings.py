#!/usr/bin/env python3
"""
Classify aggregated findings into whitelisted, suspicious, and severity buckets.

Usage: python3 analysis/classify_findings.py analysis/findings-summary.json analysis/findings-classified.json
"""
import sys
import json
import math
import re
from pathlib import Path


def shannon_entropy(s: str) -> float:
    if not s:
        return 0.0
    freq = {}
    for ch in s:
        freq[ch] = freq.get(ch, 0) + 1
    ent = 0.0
    ln = len(s)
    for v in freq.values():
        p = v / ln
        ent -= p * math.log2(p)
    return ent


WHITELIST_INTEGRITY = re.compile(r'(^|\W)(sha256-|sha512-|integrity|npm:|yarn:)', re.I)
AWS_KEY = re.compile(r'AKIA[0-9A-Z]{16}')
GITHUB_TOKEN = re.compile(r'ghp_[A-Za-z0-9_\-]{36,255}')
SLACK_TOKEN = re.compile(r'xox[baprs]-[A-Za-z0-9\-]+')
JWT_RE = re.compile(r'eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+')
PRIVATE_KEY = re.compile(r'-----BEGIN (?:RSA |)?PRIVATE KEY-----')


def extract_strings(obj):
    out = []
    if isinstance(obj, str):
        out.append(obj)
        return out
    if isinstance(obj, dict):
        for k, v in obj.items():
            out.extend(extract_strings(k))
            out.extend(extract_strings(v))
        return out
    if isinstance(obj, list):
        for item in obj:
            out.extend(extract_strings(item))
        return out
    return out


def classify_entry(entry):
    src = entry.get('source')
    t = entry.get('type')
    data = entry.get('data')

    # If source or entry contains lockfile integrity, whitelist
    if src and 'package-lock.json' in src:
        return {'classification': 'whitelisted', 'reason': 'lockfile path'}

    # Scan all strings
    strings = extract_strings(data)
    candidates = []
    for s in strings:
        if not isinstance(s, str):
            continue
        sstrip = s.strip()
        if not sstrip:
            continue
        # whitelist common integrity markers
        if WHITELIST_INTEGRITY.search(sstrip):
            return {'classification': 'whitelisted', 'reason': 'integrity/lockfile marker', 'sample': sstrip[:200]}
        # token patterns
        if AWS_KEY.search(sstrip) or GITHUB_TOKEN.search(sstrip) or SLACK_TOKEN.search(sstrip) or PRIVATE_KEY.search(sstrip):
            ent = shannon_entropy(sstrip)
            return {'classification': 'suspicious', 'severity': 'P0', 'reason': 'token pattern', 'sample': sstrip[:200], 'entropy': ent, 'length': len(sstrip)}
        if JWT_RE.search(sstrip):
            ent = shannon_entropy(sstrip)
            return {'classification': 'suspicious', 'severity': 'P0', 'reason': 'jwt-like', 'sample': sstrip[:200], 'entropy': ent, 'length': len(sstrip)}
        # entropy heuristic
        ent = shannon_entropy(sstrip)
        if ent >= 4.5 and len(sstrip) >= 20:
            candidates.append({'sample': sstrip[:200], 'entropy': ent, 'length': len(sstrip)})

    if candidates:
        # choose highest entropy candidate
        best = max(candidates, key=lambda x: x['entropy'])
        severity = 'P1' if best['length'] >= 40 else 'informational'
        return {'classification': 'suspicious', 'severity': severity, 'reason': 'high-entropy string', 'sample': best['sample'], 'entropy': best['entropy'], 'length': best['length']}

    return {'classification': 'ok', 'reason': 'no indicators found'}


def main(inpath, outpath):
    s = Path(inpath).read_text()
    j = json.loads(s)
    findings = j.get('findings', [])
    classified = {'generated_at': __import__('datetime').datetime.utcnow().isoformat() + 'Z', 'total_findings': len(findings), 'results': []}
    counts = {'whitelisted': 0, 'suspicious': 0, 'ok': 0}
    sev_counts = {'P0': 0, 'P1': 0, 'informational': 0}

    for ent in findings:
        cl = classify_entry(ent)
        if cl['classification'] == 'whitelisted':
            counts['whitelisted'] += 1
        elif cl['classification'] == 'suspicious':
            counts['suspicious'] += 1
            sev = cl.get('severity') or 'informational'
            sev_counts[sev] = sev_counts.get(sev, 0) + 1
        else:
            counts['ok'] += 1
        classified['results'].append({'source': ent.get('source'), 'classification': cl})

    classified['counts'] = counts
    classified['severity_counts'] = sev_counts
    Path(outpath).write_text(json.dumps(classified, indent=2))
    print(f"Wrote classified findings to {outpath}")


if __name__ == '__main__':
    if len(sys.argv) < 3:
        print('Usage: classify_findings.py input.json output.json')
        sys.exit(2)
    main(sys.argv[1], sys.argv[2])
