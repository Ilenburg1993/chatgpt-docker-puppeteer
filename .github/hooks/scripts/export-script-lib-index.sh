#!/usr/bin/env bash
# shellcheck shell=bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
HOOKS_ROOT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
OUTPUT_FILE="${HOOKS_ROOT_DIR}/state/f7-script-lib-index.json"

python - "${HOOKS_ROOT_DIR}" "${OUTPUT_FILE}" << 'PY'
from pathlib import Path
import json
import re
import sys
from datetime import datetime, timezone

hooks_root = Path(sys.argv[1])
output_file = Path(sys.argv[2])
scripts_dir = hooks_root / 'scripts'
lib_dir = hooks_root / 'hooks-lib'

auto_hook_scripts = {
    'session-start.sh',
    'log-prompt.sh',
    'pre-tool-use.sh',
    'post-tool-use.sh',
    'agent-stop.sh',
    'subagent-start.sh',
    'subagent-stop.sh',
    'pre-compact.sh',
    'session-end.sh',
}
manual_runtime_scripts = {
    'watchdog.sh',
    'rotate-audit.sh',
    'session-close.sh',
    'session-checkpoint.sh',
    'sync-tasks-to-docs.sh',
    'generate-session-summary.sh',
}
owner_by_domain = {
    'runtime': 'hooks-runtime',
    'context': 'hooks-runtime',
    'policy': 'hooks-policy',
    'lifecycle': 'hooks-runtime',
    'audit': 'hooks-ops',
    'maintenance': 'hooks-ops',
    'testing': 'hooks-quality',
    'legacy-root': 'hooks-runtime',
    'unknown': 'hooks-quality',
}

scripts = sorted(scripts_dir.glob('*.sh'))
dedicated_libs = {p.name: p for p in lib_dir.rglob('*-lib.sh')}
inline_ref_pattern = re.compile(r'hooks-lib/[A-Za-z0-9_./-]+\.sh')

index_items = []
for script in scripts:
    expected = f'{script.stem}-lib.sh'
    dedicated_lib = dedicated_libs.get(expected)
    text = script.read_text(encoding='utf-8', errors='ignore')
    inline_refs = sorted(set(inline_ref_pattern.findall(text)))

    if script.name in auto_hook_scripts:
        trigger_type = 'automatic'
    elif script.name in manual_runtime_scripts:
        trigger_type = 'manual-runtime'
    else:
        trigger_type = 'manual-user'

    if dedicated_lib is not None:
        related_lib = str(dedicated_lib.relative_to(hooks_root))
        relation_type = 'dedicated-lib'
        rel_parts = dedicated_lib.relative_to(lib_dir).parts
        domain = rel_parts[0] if len(rel_parts) > 1 else 'legacy-root'
    elif inline_refs:
        related_lib = inline_refs[0]
        relation_type = 'inline-relation'
        rel_path = Path(related_lib.replace('hooks-lib/', ''))
        domain = rel_path.parts[0] if len(rel_path.parts) > 1 else 'legacy-root'
    else:
        related_lib = None
        relation_type = 'none'
        domain = 'unknown'

    index_items.append(
        {
            'script': script.name,
            'trigger_type': trigger_type,
            'relation_type': relation_type,
            'related_lib': related_lib,
            'domain': domain,
            'owner': owner_by_domain.get(domain, 'hooks-quality'),
        }
    )

payload = {
    'generated_at': datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ'),
    'scripts_total': len(index_items),
    'coverage': {
        'dedicated_lib': sum(1 for item in index_items if item['relation_type'] == 'dedicated-lib'),
        'inline_relation': sum(1 for item in index_items if item['relation_type'] == 'inline-relation'),
        'none': sum(1 for item in index_items if item['relation_type'] == 'none'),
    },
    'index': index_items,
}

output_file.parent.mkdir(parents=True, exist_ok=True)
output_file.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
print(str(output_file))
PY
