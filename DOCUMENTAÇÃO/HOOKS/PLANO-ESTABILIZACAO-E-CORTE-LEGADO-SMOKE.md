# Plano de Estabilização e Corte de Legado — Smoke Hooks (F6.3)

**Data**: 2026-03-15 **Escopo**: finalizar rollout da decomposição da suíte smoke por domínio com
corte controlado do caminho legado.

## Objetivo

Executar um rollout seguro da suíte por domínios (`smoke-test-domains.sh`) preservando
rastreabilidade e rollback simples, até o ponto em que o caminho legado deixe de ser necessário como
gate primário.

## Pré-requisitos

- F5 concluída (domínios + agregador + matriz de cobertura).
- F6.1 concluída (`HOOKS_FF_SMOKE_DOMAINS=off|shadow|on`).
- F6.2 concluída (métricas em `.github/hooks/state/smoke-rollout-metrics.json`).

## Janela de estabilização proposta

### Etapa 1 — Shadow controlado

- Duração recomendada: **mínimo 7 dias corridos**.
- Modo: `HOOKS_FF_SMOKE_DOMAINS=shadow`.
- Execução recomendada: `smoke-test.sh --all` em rotina operacional.
- Objetivo: coletar divergência sem quebrar gate legado.

### Etapa 2 — Gate ativo

- Duração recomendada: **mínimo 3 dias corridos**.
- Modo: `HOOKS_FF_SMOKE_DOMAINS=on`.
- Execução recomendada: `smoke-test.sh --all`.
- Objetivo: validar estabilidade com falha de domínio impactando resultado final.

### Etapa 3 — Corte de legado

- Condição para corte: critérios de saída atendidos.
- Ação: promover suíte por domínios como gate principal e descontinuar checks legados redundantes.
- Rollback: retornar temporariamente para `shadow` (ou `off`) sem remover artefatos de domínio.

## Critérios de saída para corte

1. `divergence_detected=false` de forma consistente na janela acordada.
2. Sem regressões críticas nos domínios `policy`, `recovery` e `close`.
3. Sem ruído operacional impeditivo em `smoke-rollout-metrics.json`.
4. Operação apta a identificar causa por domínio sem depender da suíte monolítica.

## Estratégia de rollback

- Rollback imediato: setar `HOOKS_FF_SMOKE_DOMAINS=shadow`.
- Rollback conservador: setar `HOOKS_FF_SMOKE_DOMAINS=off`.
- Não remover scripts de domínio até concluir um ciclo completo pós-corte.

## Entregáveis de encerramento

- Atualização do roadmap marcando F6 concluída.
- Atualização do backlog (`pending-tasks.md`) sem pendências de rollout smoke.
- Registro de governança em documentação de hooks (este plano + matriz de cobertura).
