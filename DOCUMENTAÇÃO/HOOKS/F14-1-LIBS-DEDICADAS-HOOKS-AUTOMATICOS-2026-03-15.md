# F14.1 — Criação de libs dedicadas para hooks automáticos (2026-03-15)

**Fase**: F14.1 **Fonte de verdade do escopo**: `.github/hooks/copilot-hooks.json` **Artefato
machine-readable desta fase**: `.github/hooks/state/f14-auto-hook-entry-lib-status.json`

## Objetivo

Garantir que todos os hooks automáticos tenham uma **entry-lib dedicada** definida e criada no
repositório, preparando migração de lógica para F14.2 e padronização de dispatch em F14.3.

## Entregas executadas

### Libs criadas nesta fase

- `hooks-lib/lifecycle/log-prompt-lib.sh`
- `hooks-lib/policy/pre-tool-use-lib.sh`
- `hooks-lib/policy/post-tool-use-lib.sh`
- `hooks-lib/lifecycle/subagent-start-lib.sh`
- `hooks-lib/lifecycle/subagent-stop-lib.sh`
- `hooks-lib/lifecycle/pre-compact-lib.sh`
- `hooks-lib/lifecycle/session-start-lib.sh`
- `hooks-lib/lifecycle/session-end-lib.sh`

### Referência pré-existente mantida

- `hooks-lib/agent-stop-lib.sh` (referência de integração; decomposição interna segue para F15.2)

## Leitura de status pós-F14.1

- Hooks automáticos totais: **9**
- Hooks com entry-lib dedicada existente/criada: **9**
- Hooks prontos para migração de lógica em F14.2: **8**
- Hook de referência já existente: **1** (`agentStop`)

## Contrato dos novos entrypoints (F14.1)

Cada nova lib expõe função pública canônica (`run_*_hook`) com comportamento **placeholder
fail-fast**, explicitando que a migração de lógica ainda ocorrerá em F14.2. Isso evita ambiguidade
entre:

1. artefato estrutural criado (F14.1), e
2. migração funcional completa (F14.2/F14.3).

## Próximo passo obrigatório

- **F14.2**: mover regras de negócio dos scripts automáticos para as entry-libs dedicadas,
  preservando contratos e comportamento operacional.

## Critério de aceite de F14.1

1. 8 libs dedicadas faltantes criadas nos caminhos canônicos.
2. Todos os 9 hooks automáticos com entry-lib dedicada existente/criada.
3. Artefato machine-readable de status publicado.
4. ROADMAP/PLANO sincronizados para refletir F14.1 concluída.
