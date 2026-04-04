# Auditoria Arquitetural — src/copilot · Parte 6: Roadmap Avançado F46-F55 + Índice

**Data**: 2026-04-04
**Continuação de**: [PARTE-5-ROADMAP.md](PARTE-5-ROADMAP.md)

---

## ═══ BLOCO IV — Autonomia e Inteligência (F46–F50) ═══

### F46 — Autonomous Goal Pursuit

**Objetivo**: Agente capaz de perseguir objetivos de longo prazo com sub-goals e checkpoints.

| Sub   | Tarefa                                                          | Prioridade |
| ----- | --------------------------------------------------------------- | ---------- |
| F46.1 | GoalEngine: definir goal com acceptance criteria                | ALTA       |
| F46.2 | SubGoal decomposition: quebrar goal em steps verificáveis       | ALTA       |
| F46.3 | Checkpoint system: salvar progresso a cada sub-goal completo    | ALTA       |
| F46.4 | Abort conditions: condições que cancelam pursuit (tempo, custo) | MÉDIA      |
| F46.5 | Progress reporting: emitir eventos de progresso para terminal   | MÉDIA      |
| F46.6 | Comando `/goal set`, `/goal status`, `/goal abort`              | MÉDIA      |

### F47 — Contextual Memory System

**Objetivo**: Memória de longo prazo que sobrevive entre sessões e informa decisões.

| Sub   | Tarefa                                                        | Prioridade |
| ----- | ------------------------------------------------------------- | ---------- |
| F47.1 | MemoryStore (SQLite): fatos, preferências, padrões aprendidos | ALTA       |
| F47.2 | Memory injection no system prompt (top-K relevante por query) | ALTA       |
| F47.3 | Auto-extraction: extrair memórias de turnos completados       | MÉDIA      |
| F47.4 | Decay/relevance: score de relevância decai com tempo          | MÉDIA      |
| F47.5 | Comando `/memory list`, `/memory add`, `/memory forget`       | MÉDIA      |
| F47.6 | Integration com ConversationHub (memórias por sessão)         | BAIXA      |

### F48 — Proactive Agent Behaviors

**Objetivo**: Agente que age proativamente (não apenas reativo a input).

| Sub   | Tarefa                                                        | Prioridade |
| ----- | ------------------------------------------------------------- | ---------- |
| F48.1 | File watcher: detectar mudanças em arquivos e sugerir ações   | MÉDIA      |
| F48.2 | Scheduled tasks: executar ações em horários configurados      | MÉDIA      |
| F48.3 | Health probes: verificar saúde do projeto periodicamente      | MÉDIA      |
| F48.4 | Auto-commit suggestion: sugerir commit quando detect mudanças | BAIXA      |
| F48.5 | Test runner: rodar testes automaticamente após mudanças       | BAIXA      |
| F48.6 | Report generation: relatório diário da atividade              | BAIXA      |

### F49 — Multi-Agent Coordination

**Objetivo**: Coordenação entre múltiplas instâncias do agente (LLM-A, LLM-B, etc.).

| Sub   | Tarefa                                                   | Prioridade |
| ----- | -------------------------------------------------------- | ---------- |
| F49.1 | Agent registry: descoberta de agentes ativos via NERV    | ALTA       |
| F49.2 | Message passing: enviar mensagens entre agentes via NERV | ALTA       |
| F49.3 | Task delegation: LLM-A delega sub-tasks para LLM-B       | MÉDIA      |
| F49.4 | Conflict resolution: lock de recursos compartilhados     | MÉDIA      |
| F49.5 | Shared context: compartilhar fatos entre agentes         | BAIXA      |
| F49.6 | Visualização de multi-agent no dashboard                 | BAIXA      |

### F50 — Adaptive Performance

**Objetivo**: Auto-tuning baseado em métricas e padrões observados.

| Sub   | Tarefa                                                          | Prioridade |
| ----- | --------------------------------------------------------------- | ---------- |
| F50.1 | Auto-tune: ajustar watchdog interval baseado em latência média  | MÉDIA      |
| F50.2 | Auto-tune: ajustar MAX_QUEUE_SIZE baseado em throughput         | MÉDIA      |
| F50.3 | Auto-tune: ajustar periodic snapshot interval baseado em volume | BAIXA      |
| F50.4 | Performance report: emitir relatório de performance semanal     | BAIXA      |
| F50.5 | Anomaly detection: detectar desvios de latência/throughput      | BAIXA      |

---

## ═══ BLOCO V — Segurança e Compliance (F51–F55) ═══

### F51 — Security Hardening

**Objetivo**: Reforçar segurança em todas as interfaces.

| Sub   | Tarefa                                               | Prioridade |
| ----- | ---------------------------------------------------- | ---------- |
| F51.1 | Audit de todas as tool permissions (review presets)  | ALTA       |
| F51.2 | Rate limiting granular por endpoint e por tool       | ALTA       |
| F51.3 | Token rotation para auth do terminal HTTP            | MÉDIA      |
| F51.4 | PII scrubbing automático em logs e métricas (opt-in) | MÉDIA      |
| F51.5 | Input validation reforçada em /inject e API routes   | MÉDIA      |

### F52 — Compliance & Governance

**Objetivo**: Rastreabilidade completa de decisões e ações do agente.

| Sub   | Tarefa                                                         | Prioridade |
| ----- | -------------------------------------------------------------- | ---------- |
| F52.1 | Decision audit trail: registrar toda aprovação/negação de tool | ALTA       |
| F52.2 | Policy engine: regras declarativas para tool access            | MÉDIA      |
| F52.3 | Export de compliance report (PDF/MD)                           | BAIXA      |
| F52.4 | Retention policy: auto-cleanup de dados antigos                | BAIXA      |

### F53 — Testing Infrastructure

**Objetivo**: Cobertura de testes para todo o copilot module.

| Sub   | Tarefa                                                           | Prioridade |
| ----- | ---------------------------------------------------------------- | ---------- |
| F53.1 | Unit tests para dialog-loop-manager (boot, pause, resume, stall) | ALTA       |
| F53.2 | Unit tests para event-collector (attach, persist, rotate)        | ALTA       |
| F53.3 | Unit tests para agent-event-observer (40+ handlers)              | MÉDIA      |
| F53.4 | Integration tests para terminal ↔ agent round-trip               | MÉDIA      |
| F53.5 | Integration tests para NERV bridge event flow                    | MÉDIA      |
| F53.6 | E2E test: boot → send turn → receive response → metrics check    | BAIXA      |
| F53.7 | Coverage gate: 80% para files em src/copilot/                    | BAIXA      |

### F54 — Documentation & Developer Experience

**Objetivo**: Documentação atualizada e DX para contribuidores.

| Sub   | Tarefa                                                        | Prioridade |
| ----- | ------------------------------------------------------------- | ---------- |
| F54.1 | Event catalog: lista canônica de eventos com schema e payload | ALTA       |
| F54.2 | Architecture diagram (C4 L2) atualizado                       | MÉDIA      |
| F54.3 | Getting started guide para contribuidores                     | MÉDIA      |
| F54.4 | REPL command reference com exemplos                           | BAIXA      |
| F54.5 | Troubleshooting guide para problemas comuns                   | BAIXA      |

### F55 — Observability Dashboard

**Objetivo**: Dashboard unificado de observabilidade.

| Sub   | Tarefa                                                       | Prioridade |
| ----- | ------------------------------------------------------------ | ---------- |
| F55.1 | Grafana dashboard templates (JSON models)                    | MÉDIA      |
| F55.2 | OTEL exporter configurável (Jaeger, Grafana Tempo)           | MÉDIA      |
| F55.3 | Prometheus metrics endpoint (/metrics em formato Prometheus) | MÉDIA      |
| F55.4 | Custom Vue dashboard integrado ao projeto                    | BAIXA      |

---

## Resumo do Roadmap Expandido

| Bloco | Fases   | Tema                           | Status       |
| ----- | ------- | ------------------------------ | ------------ |
| —     | F1–F17  | Fundação (roadmap original)    | ✅ COMPLETO   |
| —     | F18–F22 | Terminal features              | ✅ COMPLETO   |
| —     | F23–F28 | Features avançadas (original)  | ⬜ PENDENTE   |
| I     | F29–F33 | Correções de Gaps da Auditoria | ⬜ PRIORIDADE |
| II    | F34–F39 | Maturidade Operacional         | ⬜ PENDENTE   |
| III   | F40–F45 | Capacidades Avançadas          | ⬜ PENDENTE   |
| IV    | F46–F50 | Autonomia e Inteligência       | ⬜ FUTURO     |
| V     | F51–F55 | Segurança e Compliance         | ⬜ FUTURO     |

### Priorização Recomendada

**Sprint 1 (imediato):** F29, F30, F31 — correções de gaps críticos
**Sprint 2:** F32, F33, F34 — fixes menores + NERV bidirecional
**Sprint 3:** F35, F36, F37 — resilience + UX terminal
**Sprint 4:** F38, F39, F40 — SSE + alertas + multi-model
**Long-term:** F41–F55 — features avançadas e infraestrutura

---

## Índice Geral da Auditoria

| Parte | Arquivo                     | Conteúdo                                       |
| ----- | --------------------------- | ---------------------------------------------- |
| 1     | PARTE-1-ARQUITETURA.md      | Visão geral, inventário de módulos, singletons |
| 2     | PARTE-2-INTEGRACOES.md      | Subscrição dual, propagação, fluxos            |
| 3     | PARTE-3-DIALOG-LOOP.md      | Dialog loop zero-PR, DLM, eventos completos    |
| 4     | PARTE-4-GAPS-BUGS.md        | 10 gaps + 2 bugs + estado atual vs desejado    |
| 5     | PARTE-5-ROADMAP.md          | Roadmap F29–F45 (Blocos I–III)                 |
| 6     | PARTE-6-ROADMAP-AVANCADO.md | Roadmap F46–F55 (Blocos IV–V) + Índice         |

---

**Total de fases**: F1–F55 (55 fases)
**Total de sub-itens**: ~160 sub-tarefas
**Fases completas**: F1–F22 (22)
**Fases pendentes**: F23–F55 (33)
