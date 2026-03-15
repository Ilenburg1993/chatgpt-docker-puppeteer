#!/usr/bin/env bash
# shellcheck shell=bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
HOOKS_ROOT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
SCRIPTS_DIR="${HOOKS_ROOT_DIR}/scripts"
LIB_DIR="${HOOKS_ROOT_DIR}/hooks-lib"
STRICT_LEGACY_ROOT="0"

if [[ "${1:-}" == "--strict-legacy-root" ]]; then
    STRICT_LEGACY_ROOT="1"
fi

python - "${SCRIPTS_DIR}" "${LIB_DIR}" "${STRICT_LEGACY_ROOT}" << 'PY'
from pathlib import Path
import re
import sys

scripts_dir = Path(sys.argv[1])
lib_dir = Path(sys.argv[2])
strict_legacy_root = sys.argv[3] == '1'

allowed_subfolders = {
    'runtime',
    'context',
    'policy',
    'lifecycle',
    'audit',
    'maintenance',
    'testing',
}
legacy_root_libs_allowed = {
    'agent-stop-lib.sh',
}
legacy_root_migration_targets = {
    'common.sh': 'runtime/common.sh',
    'config.sh': 'runtime/config.sh',
    'policy.sh': 'policy/policy.sh',
    'session-start-core.sh': 'lifecycle/session-start-core.sh',
    'session-start-aux.sh': 'lifecycle/session-start-aux.sh',
    'session-end-core.sh': 'lifecycle/session-end-core.sh',
    'session-end-aux.sh': 'lifecycle/session-end-aux.sh',
}

scripts = sorted(scripts_dir.glob('*.sh'))
dedicated_libs = sorted(lib_dir.rglob('*-lib.sh'))
lib_name_to_path = {p.name: p for p in dedicated_libs}
legacy_root_modules = sorted(
    [
        p.name
        for p in lib_dir.glob('*.sh')
        if p.name not in legacy_root_libs_allowed and not p.name.endswith('-lib.sh')
    ]
)
legacy_root_modules_unmapped = []
for module_name in legacy_root_modules:
    canonical_target = legacy_root_migration_targets.get(module_name)
    if canonical_target and (lib_dir / canonical_target).exists():
        continue
    legacy_root_modules_unmapped.append(module_name)

inline_ref_pattern = re.compile(r'hooks-lib/|HOOKS_LIB_DIR|source\s+"?\$\{?SCRIPT_DIR\}?/\.\./hooks-lib|load_hooks_lib')

missing_relation = []
rows = []

for script in scripts:
    expected_lib_name = f'{script.stem}-lib.sh'
    expected_lib = lib_name_to_path.get(expected_lib_name)
    content = script.read_text(encoding='utf-8', errors='ignore')
    has_inline_relation = bool(inline_ref_pattern.search(content))

    if expected_lib is None and not has_inline_relation:
        missing_relation.append(script.name)

    relation_kind = 'dedicated-lib' if expected_lib is not None else ('inline-relation' if has_inline_relation else 'none')
    rows.append((script.name, relation_kind, str(expected_lib.relative_to(lib_dir)) if expected_lib else '-'))

invalid_lib_placement = []
for lib_file in dedicated_libs:
    rel = lib_file.relative_to(lib_dir)
    if len(rel.parts) == 1:
        if rel.name not in legacy_root_libs_allowed:
            invalid_lib_placement.append(str(rel))
        continue

    if rel.parts[0] not in allowed_subfolders:
        invalid_lib_placement.append(str(rel))

print('== Script↔Lib Coverage Report ==')
print(f'scripts_total={len(scripts)}')
print(f'dedicated_libs_total={len(dedicated_libs)}')
print(f'missing_relation_count={len(missing_relation)}')
print(f'invalid_lib_placement_count={len(invalid_lib_placement)}')
print(f'legacy_root_modules_count={len(legacy_root_modules)}')
print(f'legacy_root_modules_unmapped_count={len(legacy_root_modules_unmapped)}')
print('')

if missing_relation:
    print('Scripts sem relação Script↔Lib:')
    for item in missing_relation:
        print(f'- {item}')
    print('')

if invalid_lib_placement:
    print('Libs em pasta inválida (fora da taxonomia):')
    for item in invalid_lib_placement:
        print(f'- {item}')
    print('')

if legacy_root_modules:
    print('Módulos legados ainda no root de hooks-lib (migrar em F7.x):')
    for item in legacy_root_modules:
        print(f'- {item}')
    print('')

if legacy_root_modules_unmapped:
    print('Módulos legados sem contraparte canônica mapeada:')
    for item in legacy_root_modules_unmapped:
        print(f'- {item}')
    print('')

print('Amostra de relações:')
for script_name, kind, lib_path in rows[:20]:
    print(f'- {script_name}: {kind} -> {lib_path}')

if missing_relation or invalid_lib_placement or (strict_legacy_root and legacy_root_modules_unmapped):
    sys.exit(1)

sys.exit(0)
PY
