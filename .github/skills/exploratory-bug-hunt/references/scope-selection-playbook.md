# Scope Selection Playbook

## Critérios de Priorização

1. **Criticidade sistêmica**: módulos no caminho crítico de execução (`kernel`, `driver`, `agent`).
2. **Alto churn**: arquivos modificados frequentemente (consultar `git log --stat`).
3. **Cobertura histórica baixa**: módulos não cobertos em rodadas anteriores.
4. **Padrões de risco**: módulos com muitos timers, event listeners, ou I/O assíncrono.
5. **Integrações externas**: módulos que interagem com sistemas externos (PM2, browser, DB, LLM).

## Mapa de Cobertura por Rodada

| Módulo | Rodada 1 | Rodada 2 | Rodada 3+ |
|--------|----------|----------|-----------|
| `src/kernel/` | ✅ | - | revisitar suspeitos |
| `src/agent/` | ✅ | - | revisitar suspeitos |
| `src/infra/` | ✅ | - | revisitar suspeitos |
| `src/orchestrator/` | ✅ | - | revisitar suspeitos |
| `src/nerv/` | ✅ | - | revisitar suspeitos |
| `src/driver/` | ✅ | ✅ | revisitar targets/ e extractors/ |
| `src/server/` | - | ✅ | revisitar handlers/ e domain/ |
| `src/missions/` | - | ✅ | - |
| `src/shared/` | - | ✅ | - |
| `src/integration/` | - | - | ⏳ Prioridade Rodada 3 |
| `src/audit_agent/` | - | - | ⏳ Prioridade Rodada 3 |
| `src/inference_gateway/` | - | - | ⏳ Prioridade Rodada 3 |
| `src/logic/` | - | - | ⏳ Prioridade Rodada 3 |
| `src/validation/` | - | - | ⏳ Prioridade Rodada 3 |
| `src/state/` | - | - | ⏳ Prioridade Rodada 3 |
| `src/core/` | parcial | - | ⏳ completo Rodada 3 |
| `src/types/` | - | - | ⏳ Prioridade Rodada 3 |

## Heurística de Exclusão

- Excluir `node_modules/`, `dist/`, `artifacts/`.
- Excluir arquivos de configuração estática (`.json`, `.yaml`) salvo suspeita específica.
- Excluir `tests/` da varredura de bugs (mas inspecionar para gaps de cobertura).

## Rotação Recomendada

- **Rodada N+1**: cobrir módulos ⏳ da tabela acima.
- **Revisitar**: qualquer módulo com achado ALTO/CRÍTICO aberto no backlog.
- **Sempre**: verificar PRs recentes que tocaram os módulos em escopo.
