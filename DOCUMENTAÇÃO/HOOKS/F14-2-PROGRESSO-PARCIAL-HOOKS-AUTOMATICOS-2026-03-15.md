# F14.2 — Progresso consolidado (migração de lógica para entry-libs) — 2026-03-15

**Fase**: F14.2 (**concluída**)
**Snapshot machine-readable**: `.github/hooks/state/f14-auto-hook-entry-lib-status.json`

## Escopo consolidado da F14.2

Migração concluída de lógica de domínio (script -> entry-lib) para os 8 hooks automáticos aplicáveis:

1. `sessionStart`
2. `userPromptSubmitted` (`log-prompt`)
3. `preToolUse`
4. `postToolUse`
5. `subagentStart`
6. `subagentStop`
7. `preCompact`
8. `sessionEnd`

`agentStop` permaneceu como hook de referência com entry-lib já existente (`hooks-lib/agent-stop-lib.sh`), conforme estratégia da trilha F15.2.

## Alterações estruturais aplicadas

- Scripts automáticos no padrão **entrypoint fino** (bootstrap + source common + source entry-lib + dispatch único).
- Lógica de domínio movida para entry-libs dedicadas:
  - `hooks-lib/lifecycle/session-start-lib.sh`
  - `hooks-lib/lifecycle/log-prompt-lib.sh`
  - `hooks-lib/policy/pre-tool-use-lib.sh`
  - `hooks-lib/policy/post-tool-use-lib.sh`
  - `hooks-lib/lifecycle/subagent-start-lib.sh`
  - `hooks-lib/lifecycle/subagent-stop-lib.sh`
  - `hooks-lib/lifecycle/pre-compact-lib.sh`
  - `hooks-lib/lifecycle/session-end-lib.sh`

## Estado consolidado do pacote F14

- Hooks automáticos totais: **9**
- Hooks com entry-lib criada: **9**
- Hooks migrados na F14.2: **8**
- Hooks pendentes de migração na F14.2: **0**
- Hook referência (`agentStop`) preservado para trilha F15.2.

## Fechamento da fase

A F14.2 atende o critério de saída de migração de lógica para libs dedicadas sem mudança de contrato externo dos hooks automáticos.
