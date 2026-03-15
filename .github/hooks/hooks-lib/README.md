# hooks-lib — taxonomia canônica (F7)

Estrutura por domínio:

- `runtime/` — parsing de input, paths, lock e utilitários de shell.
- `context/` — helpers de contexto transacional e reconciliação.
- `policy/` — autorização, reason-codes e regras de fechamento.
- `lifecycle/` — start/end/section/subturn/session helpers.
- `audit/` — eventos, relatórios e sincronização de trilhas.
- `maintenance/` — backlog, housekeeping e utilitários operacionais.
- `testing/` — verificadores estruturais e suporte de smoke.

## Convenções canônicas de naming (F7.9)

- **Wrappers dedicados de script**: `<nome-script>-lib.sh` (ex.: `add-task-lib.sh`).
- **Função pública de wrapper**: `run_<nome_script>_script` (snake_case com `_script` no sufixo).
- **Módulos canônicos de domínio (não-wrapper)**: nome curto sem `-lib` (ex.: `runtime/common.sh`, `policy/policy.sh`).
- **Shims de compatibilidade root→domínio**: permitidos temporariamente e controlados por `HOOKS_LIB_BYPASS_*_SHIM`.

## Governança de diretórios

- Cada subpasta de domínio deve manter um `README.md` com escopo e convenções locais.
- Novos arquivos devem respeitar a taxonomia por domínio e passar no gate `scripts/verify-script-lib-coverage.sh`.

Compatibilidade:

- `agent-stop-lib.sh` permanece no root como legado permitido durante migração.
- O verificador `scripts/verify-script-lib-coverage.sh` monitora cobertura Script↔Lib e placement.
