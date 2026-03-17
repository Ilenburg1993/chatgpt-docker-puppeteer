# F13.2 — Matriz Hook -> Script -> Lib(s) -> Owner (2026-03-15)

**Fase**: F13.2 (pacote lib-first para hooks automáticos)
**Fonte de verdade de entrada**: `.github/hooks/copilot-hooks.json`
**Artefato machine-readable correlato**: `.github/hooks/state/f13-hook-script-lib-owner.json`

## Resumo executivo

- Hooks automáticos mapeados: **9/9**
- Hooks já com lib de entrada dedicada consolidada: **1/9** (`agentStop`, com modularização interna posterior)
- Hooks que ainda exigem criação de entry-lib dedicada: **8/9**

## Matriz canônica

| Hook Copilot | Script | Lib(s) carregadas atualmente | Lib de entrada alvo | Função pública alvo | Domínio | Owner | Status |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `sessionStart` | `scripts/session-start.sh` | `hooks-lib/common.sh`, `hooks-lib/session-start-core.sh`, `hooks-lib/session-start-aux.sh` | `hooks-lib/lifecycle/session-start-lib.sh` | `run_session_start_hook` | `lifecycle` | `hooks-runtime` | `needs-entry-lib` |
| `userPromptSubmitted` | `scripts/log-prompt.sh` | `hooks-lib/common.sh` | `hooks-lib/lifecycle/log-prompt-lib.sh` | `run_log_prompt_hook` | `lifecycle` | `hooks-runtime` | `needs-entry-lib` |
| `preToolUse` | `scripts/pre-tool-use.sh` | `hooks-lib/common.sh`, `hooks-lib/policy.sh` | `hooks-lib/policy/pre-tool-use-lib.sh` | `run_pre_tool_use_hook` | `policy` | `hooks-policy` | `needs-entry-lib` |
| `postToolUse` | `scripts/post-tool-use.sh` | `hooks-lib/common.sh`, `hooks-lib/policy.sh` | `hooks-lib/policy/post-tool-use-lib.sh` | `run_post_tool_use_hook` | `policy` | `hooks-policy` | `needs-entry-lib` |
| `agentStop` | `scripts/agent-stop.sh` | `hooks-lib/common.sh`, `hooks-lib/agent-stop-lib.sh` | `hooks-lib/agent-stop-lib.sh` | `run_agent_stop_hook` | `policy` | `hooks-policy` | `entry-lib-exists-modularize-later` |
| `subagentStart` | `scripts/subagent-start.sh` | `hooks-lib/common.sh` | `hooks-lib/lifecycle/subagent-start-lib.sh` | `run_subagent_start_hook` | `lifecycle` | `hooks-runtime` | `needs-entry-lib` |
| `subagentStop` | `scripts/subagent-stop.sh` | `hooks-lib/common.sh` | `hooks-lib/lifecycle/subagent-stop-lib.sh` | `run_subagent_stop_hook` | `lifecycle` | `hooks-runtime` | `needs-entry-lib` |
| `preCompact` | `scripts/pre-compact.sh` | `hooks-lib/common.sh` | `hooks-lib/lifecycle/pre-compact-lib.sh` | `run_pre_compact_hook` | `lifecycle` | `hooks-runtime` | `needs-entry-lib` |
| `sessionEnd` | `scripts/session-end.sh` | `hooks-lib/common.sh`, `hooks-lib/session-end-core.sh`, `hooks-lib/session-end-aux.sh` | `hooks-lib/lifecycle/session-end-lib.sh` | `run_session_end_hook` | `lifecycle` | `hooks-runtime` | `needs-entry-lib` |

## Leituras de arquitetura para execução das próximas fases

1. `agentStop` é a referência de integração script + lib dedicada nesta trilha.
2. `sessionStart` e `sessionEnd` já possuem fatiamento core/aux, mas ainda sem entry-lib única canônica.
3. `log-prompt`, `subagent-start`, `subagent-stop` e `pre-compact` são os candidatos mais diretos para convergência rápida no padrão de script fino.
4. `pre-tool-use` e `post-tool-use` exigem cuidado por acoplamento de policy, mas já possuem base compartilhada (`policy.sh`).

## Critério de aceite de F13.2

- Matriz completa dos 9 hooks automáticos publicada em Markdown.
- Artefato JSON correlato publicado para consumo automatizado.
- Domain/owner definidos para cada hook sem lacunas.
- Status operacional por hook (`needs-entry-lib` vs `entry-lib-exists-modularize-later`) explícito.
