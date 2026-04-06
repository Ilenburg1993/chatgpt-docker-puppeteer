# Auditoria Arquitetural — src/copilot · Parte 5: Roadmap Avançado F29-F50

**Data**: 2026-04-04 **Continuação de**: `DOCUMENTAÇÃO/COPILOT/ROADMAP-UPGRADES-SRC-COPILOT.md`
(F1–F28) **Referência**: [PARTE-4-GAPS-BUGS.md](PARTE-4-GAPS-BUGS.md)

> Este roadmap prioriza correções de gaps encontrados na auditoria, seguidos de features de
> maturidade operacional, depois features avançadas de extensibilidade.

---

## ═══ BLOCO I — Correções de Gaps da Auditoria (F29–F33) ═══ ✅ IMPLEMENTADO

### F29 — Observer Attachment Eagerness [GAP-01] ✅

**Objetivo**: Garantir que `agent-event-observer` está ativo para TODAS as tasks, não apenas dialog
loop.

| Sub   | Tarefa                                                                        | Prioridade | Status                                             |
| ----- | ----------------------------------------------------------------------------- | ---------- | -------------------------------------------------- |
| F29.1 | Mover `createAgentEventObserver()` para `start()`, após `wireSessionEvents()` | ALTA       | ✅                                                 |
| F29.2 | Remover criação redundante em `#ensureDialogLoopAttached()`                   | ALTA       | ✅                                                 |
| F29.3 | Adicionar testes: task via sendMessage com métricas verificadas               | ALTA       | ✅ (test_agent_event_observer.spec.js — 21 testes) |
| F29.4 | Validar OTEL spans para tasks não-dialog                                      | MÉDIA      | ⬜                                                 |

### F30 — Usage Source-of-Truth Unificação [GAP-02] ✅

**Objetivo**: Eliminar divergência entre event-collector e agent-event-observer no tracking de
usage/tokens.

| Sub   | Tarefa                                                      | Prioridade | Status                                     |
| ----- | ----------------------------------------------------------- | ---------- | ------------------------------------------ |
| F30.1 | Definir event-collector como SoT para persistência          | ALTA       | ✅                                         |
| F30.2 | Definir agent-event-observer como SoT para runtime metrics  | ALTA       | ✅                                         |
| F30.3 | Adicionar dedup guard em `MetricsStore.recordUsage()`       | ALTA       | ✅ (resolvido removendo chamada duplicada) |
| F30.4 | Verificar contagem dupla com teste de integração            | MÉDIA      | ⬜                                         |
| F30.5 | Unificar display de usage no terminal (eliminar `tokens=?`) | MÉDIA      | ✅ (display unificado em dialog.js F20.2)  |

### F31 — DLM Watchdog Fix [BUG-02, GAP-10] ✅

**Objetivo**: Corrigir watchdog falso-positivo em pause e implementar compaction proativa.

| Sub   | Tarefa                                                     | Prioridade | Status                                              |
| ----- | ---------------------------------------------------------- | ---------- | --------------------------------------------------- |
| F31.1 | Pausar watchdog interval quando `state === 'paused'`       | ALTA       | ✅                                                  |
| F31.2 | Reativar watchdog no resume                                | ALTA       | ✅                                                  |
| F31.3 | Implementar compaction proativa ao atingir 90% context     | MÉDIA      | ✅ (DLM handleTokenBudget + always-alive wiring)    |
| F31.4 | Forçar compaction síncrona ao atingir 95% (antes de block) | MÉDIA      | ✅ (DLM force_request event)                        |
| F31.5 | Adicionar testes para watchdog durante pause/resume        | MÉDIA      | ✅ (test_dialog_watchdog.spec.js — 11 testes F31.5) |

### F32 — Dialog Boot Coalescing Fix [BUG-01] ✅ (já implementado)

**Objetivo**: Substituir boolean flag por Promise coalescing para evitar boot duplo.

| Sub   | Tarefa                                                     | Prioridade | Status                                          |
| ----- | ---------------------------------------------------------- | ---------- | ----------------------------------------------- |
| F32.1 | Refatorar `_ensureDialogLoopInFlight` de boolean → Promise | MÉDIA      | ✅ (já era Promise)                             |
| F32.2 | Boot subsequentes aguardam Promise existente               | MÉDIA      | ✅ (já implementado)                            |
| F32.3 | Testar concorrência com múltiplos inject simultaneamente   | MÉDIA      | ✅ (test_inject_concurrency.spec.js — 6 testes) |

### F33 — Cleanup e Deprecation [GAP-04, GAP-08] ✅

**Objetivo**: Limpar shims deprecated e reduzir ruído de métricas.

| Sub   | Tarefa                                                       | Prioridade | Status                       |
| ----- | ------------------------------------------------------------ | ---------- | ---------------------------- |
| F33.1 | Marcar 8 shims deprecated com `@deprecated` JSDoc            | BAIXA      | ✅ (8 arquivos marcados)     |
| F33.2 | Condicionar emissão de `agent.metrics` a delta significativo | BAIXA      | ✅ (delta dedup no observer) |
| F33.3 | Aumentar tool TTL para 10min (event-collector `_pending`)    | BAIXA      | ✅                           |
| F33.4 | Adicionar `log.debug()` no catch de `notifyTerminalTurn`     | BAIXA      | ✅                           |

---

## ═══ BLOCO II — Maturidade Operacional (F34–F39) ═══ ✅ IMPLEMENTADO

### F34 — NERV Bridge Bidirecional [GAP-06] ✅

**Objetivo**: Permitir que NERV envie comandos para o agente copilot (não apenas receber).

| Sub   | Tarefa                                                           | Prioridade | Status                                   |
| ----- | ---------------------------------------------------------------- | ---------- | ---------------------------------------- |
| F34.1 | Definir NERV → agent command schema (message, config, restart)   | ALTA       | ✅                                       |
| F34.2 | Implementar listener no agente para NERV commands                | ALTA       | ✅                                       |
| F34.3 | Comandos suportados: sendMessage, pause, resume, restart, config | ALTA       | ✅ (sendMessage, pause, resume, restart) |
| F34.4 | Validação automática de EVENT_MAP coverage vs agent events       | MÉDIA      | ✅ (validate-event-map-coverage.mjs)     |
| F34.5 | Script CI para detectar eventos não-mapeados                     | MÉDIA      | ✅ (mesmo script, exit code 1 se gaps)   |
| F34.6 | Testes de integração NERV ↔ agent (round-trip)                   | MÉDIA      | ⬜                                       |

### F35 — ConversationHub Resilience [GAP-05] ✅

**Objetivo**: Tornar o ConversationHub resiliente em modo standalone e multi-sessão.

| Sub   | Tarefa                                            | Prioridade | Status                                                  |
| ----- | ------------------------------------------------- | ---------- | ------------------------------------------------------- |
| F35.1 | Queue local para notifyTerminalTurn em standalone | MÉDIA      | ✅ (\_pendingNotifications + drainPendingNotifications) |
| F35.2 | Replay de turnos ao reconectar com hub servidor   | MÉDIA      | ✅ (drainPendingNotifications no dialog.js)             |
| F35.3 | Log.debug() no catch de standalone failures       | BAIXA      | ✅ (F33: try-catch em notifyTerminalTurn)               |
| F35.4 | Métricas de falha de persistência (counter)       | BAIXA      | ✅ (\_persistenceFailureCount + getter)                 |
| F35.5 | Testes: standalone → hub available → replay       | MÉDIA      | ✅ (test_conversation_hub_replay.spec.js — 13 testes)   |

### F36 — Task Streaming Channel [GAP-07]

**Objetivo**: Permitir streaming visible para tasks (não apenas dialog turns).

| Sub   | Tarefa                                                         | Prioridade | Status                                |
| ----- | -------------------------------------------------------------- | ---------- | ------------------------------------- |
| F36.1 | Novo canal `task.delta` separado de `response.delta`           | MÉDIA      | ✅ (já existe em session-event-wirer) |
| F36.2 | Refatorar filtro em session-event-wirer para rotear vs filtrar | MÉDIA      | ✅ (dialog.delta routing separado)    |
| F36.3 | Terminal buffer para exibição de task streaming                | BAIXA      | ✅ (task.delta/reasoning display)     |
| F36.4 | SSE channel para task streaming (endpoint separado)            | BAIXA      | ✅ (/stream/tasks endpoint)           |

### F37 — Terminal REPL Enhancements ✅

**Objetivo**: Melhorar UX do REPL com features de terminal moderno.

| Sub   | Tarefa                                                           | Prioridade | Status                        |
| ----- | ---------------------------------------------------------------- | ---------- | ----------------------------- |
| F37.1 | Tab completion para comandos (readline completer)                | MÉDIA      | ✅                            |
| F37.2 | `/help` inline com descrição detalhada de cada comando           | MÉDIA      | ✅ (já existente e completo)  |
| F37.3 | Syntax highlighting para code blocks na resposta                 | BAIXA      | ✅ (ANSI code block styling)  |
| F37.4 | Comando `/history` — listar turnos da sessão atual               | BAIXA      | ✅ (já existente)             |
| F37.5 | Comando `/search <query>` — buscar em turnos anteriores (SQLite) | BAIXA      | ✅ (FTS5 via ConversationHub) |
| F37.6 | Multiline input (heredoc ou backslash continuation)              | BAIXA      | ✅ (backslash continuation)   |

### F38 — SSE Enhancements ✅ (já implementados)

**Objetivo**: SSE mais robusto para UIs externas.

| Sub   | Tarefa                                              | Prioridade | Status                            |
| ----- | --------------------------------------------------- | ---------- | --------------------------------- |
| F38.1 | Filtros por tipo de evento no endpoint SSE          | MÉDIA      | ✅ (level=critical)               |
| F38.2 | Buffer de reconexão (replay últimos N eventos)      | MÉDIA      | ✅ (Last-Event-ID + replayBuffer) |
| F38.3 | Heartbeat SSE (ping a cada 30s para manter conexão) | MÉDIA      | ✅ (PHASE-9)                      |
| F38.4 | Compressão de payload SSE para deltas grandes       | BAIXA      | ✅ (gzip via node:zlib)           |

### F39 — Error Alerting Proativo ✅

**Objetivo**: Alertas automáticos baseados em thresholds (não apenas logging).

| Sub   | Tarefa                                                   | Prioridade | Status                                    |
| ----- | -------------------------------------------------------- | ---------- | ----------------------------------------- |
| F39.1 | Threshold engine no ErrorTracker (e.g., 5 erros em 1min) | MÉDIA      | ✅ (error-alerting.js createErrorAlerter) |
| F39.2 | Ação: emitir evento NERV de alerta                       | MÉDIA      | ✅ (nervEmit copilot:error:alert)         |
| F39.3 | Ação: notificação no terminal (banner persistente)       | MÉDIA      | ✅ (terminalPrint ANSI banner)            |
| F39.4 | Ação: webhook configurável para alertas externos         | BAIXA      | ✅ (fetch POST com SSRF protection)       |
| F39.5 | Cool-down period para evitar flood de alertas (30min)    | MÉDIA      | ✅ (cooldownMs 120s + interval 30s)       |

---

## ═══ BLOCO III — Capacidades Avançadas (F40–F45) ═══

### F40 — Multi-Model Selection Pool [F23 expandido] ✅

**Objetivo**: Pool de modelos com seleção dinâmica baseada em custo, velocidade e capacidade.

| Sub   | Tarefa                                                           | Prioridade | Status                                             |
| ----- | ---------------------------------------------------------------- | ---------- | -------------------------------------------------- |
| F40.1 | ModelRegistry: catalog de modelos disponíveis com capabilities   | ALTA       | ✅ (model-registry.js — KNOWN_MODELS + tiers)      |
| F40.2 | ModelSelector: heurística de seleção (cost, speed, context size) | ALTA       | ✅ (ModelSelector + score composto + histórico)    |
| F40.3 | Integrar com DLM fallback (substituir lógica hardcoded)          | MÉDIA      | ✅ (session-lifecycle.js — ModelSelector fallback) |
| F40.4 | Métricas por modelo: latency, success rate, cost tracking        | MÉDIA      | ✅ (ModelStatsTracker + agent-event-observer)      |
| F40.5 | Comando `/model list` e `/model switch <name>`                   | MÉDIA      | ✅ (/model list + stats + <id>)                    |
| F40.6 | Auto-downgrade: detectar slow model → switch automático          | BAIXA      | ✅ (AutoDowngradeDetector — latency + success)     |

### F41 — Session Restore & Handoff [F24 expandido]

**Objetivo**: Persistir e restaurar sessões completas (incluindo context window).

| Sub   | Tarefa                                                    | Prioridade | Status |
| ----- | --------------------------------------------------------- | ---------- | ------ |
| F41.1 | SessionSnapshot: serializar estado completo para disco    | ALTA       | ✅     |
| F41.2 | SessionRestore: re-hidratar sessão a partir de snapshot   | ALTA       | ✅     |
| F41.3 | Handoff API: transferir sessão entre instâncias do agente | MÉDIA      | ⬜     |
| F41.4 | Integrar com PM2 restart cycle (auto-restore)             | MÉDIA      | ✅     |
| F41.5 | Comando `/session save` e `/session restore`              | MÉDIA      | ✅     |
| F41.6 | Pruning de snapshots antigos (keep last N)                | BAIXA      | ✅     |

### F41-B — Dialog Loop Hardening [Auditoria completa]

**Objetivo**: Correções de bugs e melhorias identificados na auditoria integral do dialog loop (7
arquivos, 3059 linhas). Garantir que o loop NUNCA desperdice premium requests e permaneça sempre
ativo com máxima confiabilidade.

**Auditoria realizada em**: dialog-loop-manager.js (526 LOC), dialog-turn-executor.js (324 LOC),
dialog-protocol.js (115 LOC), dialog-watchdog.js (171 LOC), dialog-loop-wirer.js (55 LOC),
always-alive.js (1323 LOC), session-event-wirer.js (545 LOC).

| Sub    | Tarefa                                                                  | Prioridade | Status |
| ------ | ----------------------------------------------------------------------- | ---------- | ------ |
| F41B.1 | BUG: `stop()` shutdown timer dead code — reordenar flags                | ALTA       | ✅     |
| F41B.2 | BUG: `model.fallback` nunca aplica modelo — add `setModel` ao AgentHost | ALTA       | ✅     |
| F41B.3 | BUG: listener leak em `dispatchTurnToHost` — cleanup outer listeners    | MÉDIA      | ✅     |
| F41B.4 | BUG: `notifyReconnect()` não para watchdog                              | BAIXA      | ✅     |
| F41B.5 | MELHORIA: AbortSignal no `waitForRestartAndReply`                       | MÉDIA      | ✅     |
| F41B.6 | MELHORIA: wirer — propagar `compaction.requested` + `question`          | BAIXA      | ✅     |
| F41B.7 | MELHORIA: watchdog pre-stall warning a 80% do threshold                 | MÉDIA      | ✅     |
| F41B.8 | MELHORIA: métricas de PR consumidos por boot/resume                     | MÉDIA      | ✅     |

### F42 — Dashboard Copilot (Vue) [F25 expandido]

**Objetivo**: Interface visual web para monitorar e interagir com o agente.

| Sub   | Tarefa                                                         | Prioridade |
| ----- | -------------------------------------------------------------- | ---------- |
| F42.1 | Vue component: métricas em tempo real (via SSE/Socket.io)      | ALTA       |
| F42.2 | Vue component: terminal web (enviar/receber mensagens)         | ALTA       |
| F42.3 | Vue component: histórico de conversas (ConversationHub)        | MÉDIA      |
| F42.4 | Vue component: tools analytics (por ferramenta)                | MÉDIA      |
| F42.5 | Vue component: session status e controles (pause/resume/stop)  | MÉDIA      |
| F42.6 | Integrar com dashboard existente do projeto (src/dashboard-ui) | MÉDIA      |
| F42.7 | Auth: reuso do auth do servidor principal                      | MÉDIA      |

### F43 — Tools Analytics [F26 expandido]

**Objetivo**: Análise profunda de uso de tools com trends e recomendações.

| Sub   | Tarefa                                                      | Prioridade |
| ----- | ----------------------------------------------------------- | ---------- |
| F43.1 | Top-N tools por frequência, latência média, taxa de sucesso | MÉDIA      |
| F43.2 | Trends: comparação de períodos (última hora vs últimas 24h) | MÉDIA      |
| F43.3 | Detecção de tools problemáticas (alta latência, alta falha) | MÉDIA      |
| F43.4 | Comando `/tools stats` com tabela formatada                 | BAIXA      |
| F43.5 | Persistência em SQLite (histórico de tool stats)            | BAIXA      |

### F44 — Rate Limit Intelligence [F27 expandido]

**Objetivo**: Estratégias inteligentes para lidar com rate limits e quotas.

| Sub   | Tarefa                                                          | Prioridade |
| ----- | --------------------------------------------------------------- | ---------- |
| F44.1 | Quota predictor: estimativa de consumo futuro baseada em trends | MÉDIA      |
| F44.2 | Throttle proativo: auto-slowdown ao aproximar de limite         | MÉDIA      |
| F44.3 | Model downgrade automático ao atingir threshold                 | MÉDIA      |
| F44.4 | Billing alertas no terminal (remaining PRs / estimated time)    | MÉDIA      |
| F44.5 | Batch mode: agrupar operações para reduzir PR usage             | BAIXA      |

### F45 — Plugin Architecture [F28 expandido]

**Objetivo**: Sistema de plugins para estender o agente sem modificar core.

| Sub   | Tarefa                                                              | Prioridade |
| ----- | ------------------------------------------------------------------- | ---------- |
| F45.1 | Plugin manifest schema (capabilities, hooks, tools, commands)       | ALTA       |
| F45.2 | Plugin loader: discovery, validation, lifecycle                     | ALTA       |
| F45.3 | Plugin API: acesso a agent, metrics, hub, tools via interface       | ALTA       |
| F45.4 | Plugin sandboxing: isolamento de erros (plugin crash ≠ agent crash) | MÉDIA      |
| F45.5 | Built-in plugins: git-tools, code-review, documentation             | MÉDIA      |
| F45.6 | Comando `/plugin list`, `/plugin enable`, `/plugin disable`         | MÉDIA      |
| F45.7 | Hot reload: recarregar plugins sem restart                          | BAIXA      |

---

_Continua em [PARTE-6-ROADMAP-AVANCADO.md](PARTE-6-ROADMAP-AVANCADO.md)_
