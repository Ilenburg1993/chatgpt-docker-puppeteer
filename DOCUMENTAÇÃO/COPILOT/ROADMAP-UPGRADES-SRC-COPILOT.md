# Roadmap de Upgrades — src/copilot

**Status**: Ativo **Criado em**: 2026-04-04 **Baseado em**: Análise profunda de todos os 160
arquivos de `src/copilot` **Coordenação**: LLM-A (implementação) + LLM-B (análise e revisão)

---

## Sumário Executivo

O módulo `src/copilot` possui uma arquitetura sólida (~160 arquivos, ~18 submodules), mas acumula
débito técnico visível em 4 áreas principais: **UX do terminal**, **cleanup de shims depreciados**,
**hardening arquitetural** e **observability**. Este roadmap organiza os upgrades em fases
sequenciais por impacto e risco.

---

## Estado Atual (pré-upgrade)

### Problemas Confirmados

| ID     | Problema                                                                         | Severidade | Status       |
| ------ | -------------------------------------------------------------------------------- | ---------- | ------------ |
| BUG-01 | `LOG_LEVEL=debug` global polui o terminal LLM-B com centenas de linhas DEBUG     | Alta       | ✅ Corrigido |
| BUG-02 | `FLOW-01 WARN` em toda mensagem — hub standalone nunca inicializado              | Média      | ✅ Corrigido |
| BUG-03 | SIGHUP não tratado → terminal morria ao fechar painel VS Code                    | Alta       | ✅ Corrigido |
| BUG-04 | `broadcastToSession()` gerava WARN para comportamento esperado (socket-ns)       | Baixa      | ✅ Corrigido |
| GAP-01 | ConversationHub: `notifyTerminalTurn()` falha silenciosamente em modo standalone | Média      | Pendente     |
| GAP-02 | `agent.metrics` emitido a cada 30s sem log de nível adequado no observer         | Baixa      | Pendente     |
| GAP-03 | `tokens=?` no usage — contador real não conectado                                | Média      | Pendente     |
| GAP-04 | 8 shims `@deprecated` ainda exportados por compat (custo de manutenção)          | Baixa      | Pendente     |

### Shims Depreciados Ativos

| Arquivo                               | Redireciona Para              | Impacto                             |
| ------------------------------------- | ----------------------------- | ----------------------------------- |
| `agent/session-hooks.js`              | `hooks/session-lifecycle.js`  | 0 importadores externos confirmados |
| `lib/hooks.js`                        | `hooks/factory.js`            | Re-export de compatibilidade        |
| `lib/permissions.js`                  | `hooks/permission-handler.js` | Re-export de compatibilidade        |
| `tools/git-tools.js`                  | `tools/git/index.js`          | Wrapper deprecated                  |
| `observability/hooks-audit-preset.js` | `hooks/presets/audit.js`      | Movido em ARCH-OBS-003              |
| `hooks/audit.js`                      | `event-collector.js`          | Depreciado desde Fase AL            |

---

## Fase 1 — UX & Quick Wins (Concluída / Em Andamento)

**Objetivo**: Eliminar friction imediato que prejudica a experiência de uso do terminal LLM-B.

### F1.1 — Fix LOG_LEVEL no script terminal:llm-b ✅

- **Arquivo**: `package.json`
- **Mudança**: `COPILOT_LOG_LEVEL=INFO node --strip-types src/copilot/terminal/bootstrap.js`
- **Causa raiz**: `LOG_LEVEL=debug` definido globalmente no devcontainer era herdado
- **Impacto**: Elimina centenas de linhas DEBUG no terminal; respostas da LLM-B ficam visíveis

### F1.2 — FLOW-01 WARN → DEBUG ✅

- **Arquivo**: `src/copilot/terminal/dialog.js`
- **Mudança**: `log('WARN', ...)` → `log('DEBUG', ...)` no catch do `notifyTerminalTurn`
- **Motivo**: Comportamento esperado em modo standalone; não é um erro

### F1.3 — ConversationHub: guard isReady antes de notifyTerminalTurn

- **Arquivo**: `src/copilot/terminal/dialog.js`
- **Mudança**: Verificar `conversationHub.isReady` antes de tentar `notifyTerminalTurn()`
- **Benefício**: Remove try/catch desnecessário; código mais limpo e intencional

### F1.4 — ConversationHub: init() em modo standalone (partial)

- **Arquivo**: `src/copilot/terminal/index.js`
- **Mudança**: Chamar `conversationStore.init()` no bootstrap do terminal para que o store (SQLite)
  esteja disponível mesmo sem Socket.io
- **Nota**: O store já é inicializado pelo terminal, o hub completo (com Orchestrator) requer io. O
  fix é garantir que o store funcione de forma isolada.

---

## Fase 2 — Cleanup de Depreciados

**Objetivo**: Remover shims de compatibilidade que não são mais necessários; reduzir superfície de
manutenção.

**Pré-condição**: Verificar zero importadores externos dos shims antes de remover.

### F2.1 — Remover `agent/session-hooks.js`

- Verificar: `rg "agent/session-hooks" src/ -t js`
- Se zero resultados: remover arquivo, atualizar `agent/index.js`

### F2.2 — Remover `lib/hooks.js`

- Verificar: `rg "lib/hooks" src/ -t js`
- Se zero resultados: remover arquivo, atualizar `lib/index.js`

### F2.3 — Remover `lib/permissions.js`

- Verificar: `rg "lib/permissions" src/ -t js`
- Se zero resultados: remover arquivo, atualizar `lib/index.js`

### F2.4 — Consolidar `tools/git-tools.js`

- Verificar importadores de `tools/git-tools.js` vs `tools/git/index.js`
- Mover qualquer código único para `tools/git/index.js`
- Remover wrapper deprecated

### F2.5 — Remover `observability/hooks-audit-preset.js`

- Shim movido para `hooks/presets/audit.js` em ARCH-OBS-003
- Verificar zero importadores antes de remover

### F2.6 — Remover `hooks/audit.js`

- Depreciado desde Fase AL; `event-collector.js` feed automático
- Verificar zero importadores antes de remover

---

## Fase 3 — Architecture Hardening

**Objetivo**: Corrigir gaps arquiteturais que causam warnings silenciosos ou comportamento
inesperado.

### F3.1 — ConversationHub: standalone init parcial

- **Problema**: Em modo standalone, `conversationStore` é init mas `HubOrchestrator` nunca é criado
- **Solução**: Criar método `conversationHub.initStandalone()` que init apenas o store, sem
  Orchestrator/Socket.io
- **Arquivo**: `src/copilot/conversation-hub/hub.js`
- **Benefício**: `dialog.js` pode condicionalmente chamar `notifyTerminalTurn` via guard `isReady`

### F3.2 — Dialog: guard condicional para FLOW-01

- **Arquivo**: `src/copilot/terminal/dialog.js`
- **Mudança**: Substituir try/catch por `if (conversationHub.isReady) { notifyTerminalTurn(...) }`
- **Benefício**: Código intencional; elimina overhead de exception path

### F3.3 — AgentMetrics: suprimir event observer no terminal standalone

- **Arquivo**: `src/copilot/observability/agent-event-observer.js`
- **Mudança**: Tornar o handler de `agent.metrics` ignorar silenciosamente quando
  metrics.recordCounter não está disponível, ou configurar via flag
  `AGENT_METRICS_OBSERVER_ENABLED=false` no bootstrap do terminal
- **Benefício**: Menos eventos desnecessários no bus quando rodando standalone

### F3.4 — UsageTracking: conectar contagem real de tokens

- **Arquivo**: `src/copilot/observability/event-collector.js`
- **Problema**: `tokens=?` em usage events — contador não extrai valor real do SDK
- **Solução**: Extrair tokens de `assistant.usage` (input + output) e registrar em metrics counter

---

## Fase 4 — Observability Upgrade

**Objetivo**: Tornar o sistema observável de verdade — métricas com valores reais, traces e health
check melhorado.

### F4.1 — Métricas: counters com valores reais

- **Arquivo**: `src/copilot/observability/metrics.js`
- **Mudança**: Implementar counters acumulativos para: tokens_in, tokens_out, turns_total,
  tasks_completed, errors_total, cache_reads
- **API**: `metrics.getCounters()` via endpoint `/health` estendido

### F4.2 — Health endpoint enriquecido

- **Arquivo**: `src/copilot/terminal/handlers-system.js`
- **Mudança**: Adicionar ao `/health`: tokens_total, tasks_completed, turns_total, model_latency_avg
- **Benefício**: Monitoramento sem precisar acessar logs

### F4.3 — Error tracker consolidado

- **Arquivo**: `src/copilot/observability/error-tracker.js`
- **Mudança**: Garantir que todos os erros de tool call são capturados e expostos via `/events` como
  `error.tool_call`
- **Benefício**: LLM-A pode monitorar saúde das tools de LLM-B em tempo real

### F4.4 — Audit log estruturado

- **Arquivo**: `src/copilot/observability/audit-log.js`
- **Mudança**: Estruturar entries com campos: `session_id`, `turn_id`, `event_type`, `tool`,
  `duration_ms`, `status`
- **Benefício**: Permite queries SQL diretas no arquivo de audit para debugging

---

## Fase 5 — System Prompt & Config Upgrade

**Objetivo**: Melhorar o contexto inicial da LLM-B para respostas mais precisas e menor overhead.

### F5.1 — Migrar para `mode: "customize"` (SDK v0.2.0)

- **Arquivo**: `src/copilot/config/system-prompt.js`
- **Status**: Código de detecção `_sdkSupportsCustomize` já existe
- **Mudança**: Quando `_sdkSupportsCustomize === true`, usar `mode: "customize"` com seções nomeadas
  para instruções mais granulares
- **Benefício**: SDK gerencia seções; menos token waste

### F5.2 — Injetar estado de sessão no system prompt

- **Arquivo**: `src/copilot/config/system-prompt.js`
- **Mudança**: Adicionar seção dinâmica com `session_id`, `uptime`, `turn_count`, `pending_todos` ao
  system prompt em cada retomada
- **Benefício**: LLM-B tem contexto de estado sem precisar perguntar

### F5.3 — Skills no system prompt

- **Arquivo**: `src/copilot/config/system-prompt.js`
- **Mudança**: Carregar skills ativas (via `/skills list`) e injetá-las como seção `active_skills`
  no system prompt append
- **Benefício**: LLM-B sabe quais skills estão disponíveis sem invocar ferramenta

---

## Fase 6 — Security & Robustez

**Objetivo**: Fechar gaps de segurança e robustez identificados em comentários de código.

### F6.1 — Rate limiting endpoint `/inject` (GAP-01)

- **Arquivo**: `src/copilot/terminal/server.js`
- **Status**: Comentário `GAP-01 (fix)` já existe no código
- **Mudança**: Implementar rate limiter: `10 req/IP/60s` com 429 e `Retry-After` header
- **Dependência**: `@express/rate-limit` ou implementação manual com Map + cleanup

### F6.2 — Autenticação token opcional (GAP-N03)

- **Arquivo**: `src/copilot/terminal/server.js`
- **Status**: Comentário `GAP-N03/UPG-N04 (fix)` já existe
- **Mudança**: Quando `TERMINAL_TOKEN` está definido, exigir `Authorization: Bearer <token>` header
- **Benefício**: Proteção mínima quando acessando o terminal em rede local não confiável

### F6.3 — Validação de URL em web-tools

- **Arquivo**: `src/copilot/tools/web-tools.js`
- **Mudança**: Usar `lib/url-validator.js` existente em todas as chamadas web-tools
- **Benefício**: Previne SSRF; valida contra lista de domínios permitidos

### F6.4 — Shell tools: escapamento e sandboxing

- **Arquivo**: `src/copilot/tools/shell/index.js`
- **Mudança**: Validar comandos contra allowlist; logar todos os comandos com `startTime/endTime`
- **Benefício**: Auditabilidade e prevenção de shell injection inadvertida

---

## Fase 7 — TODO Store & Tools Upgrade

**Objetivo**: Melhorar as tools de produtividade da LLM-B.

### F7.1 — TODO Store: TTL e cleanup automático

- **Arquivo**: `src/copilot/tools/todo/store.js`
- **Mudança**: Adicionar coluna `expires_at` e job de cleanup de TODOs `completed` com mais de 7
  dias
- **Benefício**: Banco não cresce indefinidamente; histórico de tarefas mantido razoável

### F7.2 — TODO bulk: operações atômicas

- **Arquivo**: `src/copilot/tools/todo/bulk-tools.js`
- **Mudança**: Garantir que bulk update/delete usa transação SQLite para atomicidade
- **Benefício**: Sem estado corrompido em caso de erro no meio de bulk operations

### F7.3 — Introspection tools: status de health por tool

- **Arquivo**: `src/copilot/tools/introspection-tools.js`
- **Mudança**: Adicionar `get_tool_health()` que retorna: último uso, taxa de erro, latência média
  por tool
- **Benefício**: LLM-B pode identificar automaticamente tools problemáticas

### F7.4 — Git tools: branch awareness

- **Arquivo**: `src/copilot/tools/git/index.js`
- **Mudança**: Adicionar `get_current_branch()` e `is_dirty()` ao toolkit
- **Benefício**: LLM-B não precisa parsear output de `git status` para saber sobre uncommitted
  changes

---

## Fase 8 — Reconnect & Session Resilience

**Objetivo**: Tornar o agente mais resiliente a desconexões e interrupções.

### F8.1 — Reconnect policy: backoff exponencial com jitter

- **Arquivo**: `src/copilot/agent/reconnect-policy.js`
- **Mudança**: Verificar se o backoff atual é linear; migrar para exponencial com jitter:
  `min(base * 2^n + random(0,1000), maxDelay)`
- **Benefício**: Evita thundering herd em reconexões simultâneas

### F8.2 — Session: validação de saúde antes de retomada

- **Arquivo**: `src/copilot/agent/session-initializer.js`
- **Mudança**: Antes de retomar sessão, validar que `session.id` existe no banco e que o contexto é
  coerente
- **Benefício**: Evita tentativas de retomada de sessão corrompida

### F8.3 — Watchdog: timeout configurável por tipo de tarefa

- **Arquivo**: `src/copilot/agent/dialog-watchdog.js`
- **Mudança**: Suportar config por tipo: tarefas de análise têm timeout maior que tarefas de
  resposta simples
- **Benefício**: Menos watchdog kills em tarefas legítimas de longa duração

---

## Fase 9 — MCP Integration Upgrade

**Objetivo**: Melhorar integração com servidores MCP.

### F9.1 — MCP health check periódico

- **Arquivo**: `src/copilot/bridges/mcp-tool-bridge.js`
- **Mudança**: Verificar saúde do MCP server a cada 5min; expor status em `/health`
- **Benefício**: Auto-detecção de quando MCP volta online após `fetch failed`

### F9.2 — MCP tool reconnect automático

- **Arquivo**: `src/copilot/bridges/mcp-tool-bridge.js`
- **Mudança**: Quando MCP reconnecta, reregistrar tools automaticamente sem precisar reiniciar o
  terminal
- **Benefício**: Zero-interruption quando MCP server reinicia

---

## Fase 10 — Graceful Degradation (Standalone Mode)

**Contexto**: Investigação profunda revelou que o terminal pode iniciar sem o server principal
(3008). A maioria das funcionalidades funciona normalmente, mas a inicialização era lenta (~24s) por
causa das tentativas HTTP ao MCP.

**Objetivo**: Tornar o modo standalone completamente sem ruído, sem delay de boot e com UX clara.

### F10.1 — MCP port probe rápido no boot

- **Arquivo**: `src/copilot/bridges/mcp-tool-bridge.js`
- **Mudança**: Antes de qualquer chamada HTTP ao MCP, fazer um TCP probe (1.5s timeout). Se a porta
  não confirmar resposta, fechar o circuit imediatamente sem esperar 3×8s.
- **Benefício**: Boot do terminal em standalone reduz de ~24s para ~1.5s.

### F10.2 — Auto-reconnect MCP com backoff crescente

- **Arquivo**: `src/copilot/bridges/mcp-tool-bridge.js`
- **Mudança**: Converter `setInterval` fixo de 5min para `setTimeout` com backoff multiplicativo:
  5min → 10min → 15min → 30min (cap).
- **Benefício**: Em standalone permanente, ruído de tentativas diminui com o tempo.

### F10.3 — Banner de diagnóstico de modo de operação

- **Arquivo**: `src/copilot/terminal/index.js`
- **Mudança**: No evento `ready` do agente (primeiro boot), imprimir banner ASCII com modo
  "STANDALONE" ou "CONECTADO (N tools MCP)".
- **Benefício**: Usuário do terminal sabe imediatamente quais recursos estão disponíveis.

### F10.4 — Campo `operationMode` no `/health`

- **Arquivo**: `src/copilot/terminal/handlers-system.js`
- **Mudança**: Adicionar `operationMode: 'standalone' | 'connected'` e `mcpToolCount` ao response.
- **Benefício**: Dashboard e integrações adaptam comportamento baseado no modo.

### F10.5 — PinnedFilesLoader: resiliente a falhas de filesystem

- **Arquivo**: `src/copilot/config/pinned-files-loader.js`
- **Mudança**: Garantir que falhas de permissão/path não bloqueiam o boot; log de WARN em vez de
  throw.
- **Benefício**: Resiliência em ambientes com permissões restritas.

---

## Fase 11 — Channel Reliability (LLM-A ↔ LLM-B)

**Contexto**: Investigação do `src/copilot/channel/` revelou gaps em resiliência de comunicação: sem
retry para condições de boot, sem métricas por canal, backoff linear.

**Objetivo**: Canal de comunicação LLM-A ↔ LLM-B robusto, observável.

### F11.1 — inject.js: retry para 503 (dialog loop iniciando)

- **Arquivo**: `src/copilot/channel/inject.js`
- **Mudança**: Opção `retryOn503: boolean` ao `InjectOpts`. Faz retry em 503 quando `true`.
- **Benefício**: Chamadores no boot do terminal não precisam implementar retry próprio.

### F11.2 — inject.js: backoff exponencial

- **Arquivo**: `src/copilot/channel/inject.js`
- **Mudança**: Substituir delay linear (`base × attempt`) por exponencial (`base × 2^attempt`).
- **Benefício**: Menor pressão no terminal em alta carga.

### F11.3 — Métricas de latência por canal (`channel.inject`)

- **Arquivo**: `src/copilot/channel/inject.js`
- **Mudança**: `recordToolCall('channel.inject', durationMs, success)` em `_doInjectToLlmB()`.
- **Benefício**: `get_tool_health` mostra latência e taxa de erro do canal de injeção.

### F11.4 — LlmBridgeClient: retry com backoff em `chat()`

- **Arquivo**: `src/copilot/channel/client.js`
- **Mudança**: Opções `retries` e `retryDelayMs` no `ChatOptions` com backoff exponencial.
- **Benefício**: Robustez em sessões longas onde o agente ocasionalmente demora.

### F11.5 — `chatStructured()`: nova tentativa com instrução explícita de formato

- **Arquivo**: `src/copilot/channel/client.js`
- **Mudança**: Quando `parseStructuredResponse()` retorna null, fazer segunda tentativa com
  instrução JSON explícita.
- **Benefício**: Reduz taxa de `structured: null` no início de sessões novas.

### F11.6 — SSE reconexão com Last-Event-ID ✅ (já implementado)

---

## Fase 12 — Conversation Context Improvements

**Objetivo**: Melhorar gestão de contexto e memória nas conversas.

### F12.1 — Aviso antes do auto-trim de histórico

- **Arquivo**: `src/copilot/channel/client.js`
- **Mudança**: Emitir evento `history.compaction.needed` quando
  `history.length > 0.8 * maxHistorySize`.
- **Benefício**: Zero loss de contexto crítico sem notificação.

### F12.2 — `seedHistory()` com validação de alternância

- **Arquivo**: `src/copilot/channel/client.js`
- **Mudança**: Validar que não cria sequências inválidas (ex: dois `user` seguidos).
- **Benefício**: Previne corrupção silenciosa de contexto.

### F12.3 — Persistir métricas de conversa no `ConversationStore`

- **Arquivo**: `src/copilot/conversation-hub/store.js`
- **Mudança**: Ao fechar sessão, persistir: total turnos, duração média, taxa de structured
  responses.
- **Benefício**: Análise retroativa de qualidade das sessões.

### F12.4 — `getLastNPairs()` com modo compacto

- **Arquivo**: `src/copilot/channel/client.js`
- **Mudança**: Opção `summarize: true` que retorna versão compacta (título + 200 chars) para prompts
  de contexto.
- **Benefício**: Reduz tokens ao incluir histórico em novos prompts.

---

## Fase 13 — Developer Experience (DX) & Tooling

**Objetivo**: Tornar o desenvolvimento e operação mais ergonômico.

### F13.1 — Comando `/diagnose` no REPL

- **Arquivo**: `src/copilot/terminal/commands/`
- **Mudança**: `/diagnose` executa health check: MCP, dialog loop, hub session, pending todos, tool
  stats top-5.
- **Benefício**: Diagnóstico em uma linha sem sair do terminal.

### F13.2 — Evento `terminal.started` estruturado

- **Arquivo**: `src/copilot/terminal/index.js`
- **Mudança**: Emitir evento com snapshot completo: modo, MCP count, hub session ID, dialog active.
- **Benefício**: Logs de boot parseable para monitoramento.

### F13.3 — Métricas Prometheus de canal no `/metrics`

- **Arquivo**: `src/copilot/terminal/handlers-system.js`
- **Mudança**: `llm_b_inject_total` (labels: status) e `llm_b_inject_duration_ms`.
- **Benefício**: Integração com stack de monitoring.

### F13.4 — Teste de integração: boot sem server

- **Arquivo**: `tests/integration/terminal-standalone.test.js`
- **Mudança**: Suite que verifica boot standalone: rápido, circuit breaker ativo, banner correto,
  tools locais funcionais.
- **Benefício**: Previne regressão no fluxo standalone.

### F13.5 — Hot-reload de skills sem reiniciar o agente

- **Arquivo**: `src/copilot/config/pinned-files-loader.js` +
  `src/copilot/agent/session-initializer.js`
- **Mudança**: Quando `PinnedFilesLoader` detectar mudança em skills, re-executar
  `buildHookSystemContext()` sem encerrar dialog loop.
- **Benefício**: Ciclo de desenvolvimento de skills sem restart do terminal.

---

## Cronograma de Execução

| Fase                      | Complexidade | Risco                        | Prioridade   |
| ------------------------- | ------------ | ---------------------------- | ------------ |
| F1: UX & Quick Wins       | Baixa        | Mínimo                       | **IMEDIATO** |
| F2: Cleanup Depreciados   | Baixa        | Baixo (validar importadores) | Alta         |
| F3: Arch Hardening        | Média        | Baixo                        | Alta         |
| F4: Observability         | Média        | Mínimo                       | Média        |
| F5: System Prompt         | Média        | Mínimo                       | Média        |
| F6: Security              | Média        | Médio                        | Média        |
| F7: TODO & Tools          | Baixa        | Mínimo                       | Média        |
| F8: Reconnect             | Alta         | Médio                        | Baixa        |
| F9: MCP                   | Média        | Médio                        | Baixa        |
| F10: Graceful Degradation | Média        | Baixo                        | **ATIVO**    |
| F11: Channel Reliability  | Média        | Baixo                        | **ATIVO**    |
| F12: Context Improvements | Média        | Baixo                        | Próxima      |
| F13: DX & Tooling         | Média        | Mínimo                       | Próxima      |
| F14: Obs HTTP API         | Baixa        | Mínimo                       | **ATIVO**    |
| F15: Security Pro Mode    | Média        | Médio                        | Próxima      |
| F16: Developer Comms      | Baixa        | Mínimo                       | Futura       |
| F17: Internals Opt        | Média        | Baixo                        | Futura       |

---

## Fase 14 — Observability HTTP API

**Contexto**: `defaultErrorTracker` e `defaultAuditLog` já existem e são usados internamente, mas
não há endpoints HTTP para que LLM-A ou dashboards consultem o estado de erros/audit. F4.1 (Métricas
reais) tem tokens conectados via `event-collector.js`, mas dialog/session counts não aparecem no
`/metrics` Prometheus.

**Objetivo**: Expor todos os instrumentos de observabilidade via REST e enriquecer o `/metrics`
Prometheus com contadores de sessão e dialog.

### F14.1 — GET `/errors` — error stats e últimos erros

- **Arquivo**: `src/copilot/terminal/handlers-system.js` + `route-table.js`
- **Mudança**: Handler `handleGetErrors()` que retorna `defaultErrorTracker.getStats()` +
  `getErrors(20)`.
- **Benefício**: LLM-A e dashboards podem monitorar taxa de erro em tempo real.

### F14.2 — GET `/audit` — ring buffer de auditoria

- **Arquivo**: `src/copilot/terminal/handlers-system.js` + `route-table.js`
- **Mudança**: Handler `handleGetAudit()` que retorna `defaultAuditLog.getEntries()` +
  `getAuditSummary()` (async).
- **Benefício**: Rastreabilidade de todas as ações sensíveis do agente.

### F14.3 — GET `/tool-stats` — stats detalhados por tool

- **Arquivo**: `src/copilot/terminal/handlers-system.js` + `route-table.js`
- **Mudança**: Handler `handleGetToolStats()` usando `getToolStats()` do `tool-stats.js`.
- **Benefício**: Identificação imediata de tools problemáticas sem parsear logs.

### F14.4 — `/metrics` Prometheus: adicionar dialog/session counts e tool-stats

- **Arquivo**: `src/copilot/terminal/handlers-system.js`
- **Mudança**: Adicionar `llmb_dialog_turns_total`, `llmb_sessions_started`, `llmb_errors_total` ao
  payload Prometheus.
- **Benefício**: Integração completa com stack de monitoring.

### F14.5 — Shell tools → `defaultAuditLog.recordToolStart/Complete`

- **Arquivo**: `src/copilot/tools/shell/index.js`
- **Mudança**: Antes de cada execução: `recordToolStart({toolName, ...})`. Após:
  `recordToolComplete({...durationMs, exitCode})`.
- **Benefício**: Rastro completo de execuções de shell no audit JSONL.

---

## Fase 15 — Security Pro Mode

**Objetivo**: Hardening de segurança além do baseline atual: allowlist de executáveis configurável,
rate limit em endpoints sensíveis, e auditoria de falhas de autenticação.

### F15.1 — `COPILOT_ALLOWED_EXECUTABLES` para `exec_command`

- **Arquivo**: `src/copilot/tools/shell/index.js`
- **Mudança**: Se `COPILOT_ALLOWED_EXECUTABLES` definido, only executables in the allowlist pass;
  blocklist becomes secondary.
- **Benefício**: Permite restrição granular além do blocklist.

### F15.2 — Rate limiting nos endpoints de observabilidade

- **Arquivo**: `src/copilot/terminal/route-table.js`
- **Mudança**: Aplicar `rateLimiter: 'write'` nos GETs de `/errors` e `/audit` (evitar data mining).
- **Benefício**: Previne abuso via crawling de histórico de erros/audit em produção.

### F15.3 — Audit de falhas de autenticação

- **Arquivo**: `src/copilot/terminal/server.js`
- **Mudança**: Quando autenticação falha (401), registrar
  `defaultAuditLog.record({ type: 'auth.failure', ip, path })`.
- **Benefício**: Detectar tentativas de varredura/brute-force via audit log.

---

## Fase 16 — Developer Comms

**Objetivo**: Melhorar a ergonomia de desenvolvimento e comunicação com o ambiente externo.

### F16.1 — Ready webhook (`COPILOT_READY_WEBHOOK`)

- **Arquivo**: `src/copilot/terminal/index.js`
- **Mudança**: Após boot completo, se `COPILOT_READY_WEBHOOK` definido, POST com health snapshot.
- **Benefício**: Integração com sistemas externos (CI/CD, dashboards) sem polling.

### F16.2 — Comando `/emergency-reset` no REPL

- **Arquivo**: `src/copilot/terminal/commands/`
- **Mudança**: `/emergency-reset` limpa estado do dialog loop sem reiniciar o processo.
- **Benefício**: Recuperação de estado corrompido sem downtime.

### F16.3 — GET `/history` — histórico de injeções

- **Arquivo**: `src/copilot/terminal/handlers-system.js` + `route-table.js`
- **Mudança**: Retorna últimas 20 injeções via `defaultAuditLog.getAuditSummary()` filtrado por
  `type: 'tool.complete'`.
- **Benefício**: Rastreabilidade de ações sem precisar ler logs brutos.

---

## Fase 17 — Internals Optimization

**Objetivo**: Otimizações internas para reduzir ruído e melhorar performance dos sistemas de
observabilidade.

### F17.1 — Dedup de eventos no audit log (janela 1s)

- **Arquivo**: `src/copilot/observability/audit-log.js`
- **Mudança**: Verificar antes de `record()` se a última entrada tem mesmo `type` + `toolName` em
  <1s.
- **Benefício**: Previne duplicação em loop tight de retry.

### F17.2 — `getToolStats()` com categorias

- **Arquivo**: `src/copilot/observability/tool-stats.js`
- **Mudança**: Agrupar tools por prefixo (shell._, channel._, git.\*, etc.) em
  `getStatsByCategory()`.
- **Benefício**: Visão agregada de uso por categoria de ferramenta.

### F17.3 — Histogramas no `/metrics` Prometheus

- **Arquivo**: `src/copilot/terminal/handlers-system.js`
- **Mudança**: Adicionar `llmb_dialog_turn_duration_p50_ms` e `_p95_ms` ao endpoint Prometheus.
- **Benefício**: Alertas de SLA via Grafana/Prometheus sem precisar de OTEL.

---

### Fase 1 — UX & Quick Wins

- [x] F1.1 — Fix LOG_LEVEL no script terminal:llm-b
- [x] F1.2 — FLOW-01 WARN → DEBUG
- [x] F1.3 — SIGHUP handler adicionado ao terminal
- [x] F1.4 — broadcastToSession WARN → DEBUG (socket-ns standalone)
- [x] F1.5 — ConversationHub guard `isReady` em dialog.js
- [x] F1.6 — ConversationHub `initStandalone()` no hub.js

### Fase 2 — Cleanup Depreciados

- [x] F2.1 — Remover `agent/session-hooks.js`
- [x] F2.2 — Remover `lib/hooks.js`
- [x] F2.3 — Remover `lib/permissions.js`
- [x] F2.4 — Consolidar `tools/git-tools.js`
- [x] F2.5 — Remover `observability/hooks-audit-preset.js`
- [ ] F2.6 — `hooks/audit.js` mantido (funcionalidade real, não shim)

### Fase 3 — Hardening Arquitetural

- [x] F3.1 — ConversationHub `initStandalone()` no hub.js
- [x] F3.2 — Dialog: guard condicional para FLOW-01
- [x] F3.3 — AgentMetrics: suprimido no terminal standalone
- [x] F3.4 — UsageTracking: token counting conectado via `event-collector.js` → `recordUsage` →
      `defaultMetrics.tokens` ✅

### Fase 4 — Observability

- [x] F4.1 — Métricas: `getSummary()` exposto no `/metrics` Prometheus com turns, sessions, tokens
      ✅
- [x] F4.2 — Health endpoint enriquecido (getSummary + MCP status)
- [x] F4.3 — Error tracker: `GET /errors` expõe `defaultErrorTracker.getStats()` + `getErrors(20)`
      ✅
- [x] F4.4 — Audit log: `GET /audit` expõe entradas + `defaultAuditLog.recordToolStart/Complete` em
      shell ✅

### Fase 5 — System Prompt & Skills

- [x] F5.1 — Migrar para `mode: "customize"` (SDK v0.2.0) — já existia
- [x] F5.2 — Injetar estado de sessão no system prompt
- [x] F5.3 — Skills no system prompt (`readdir` scan de `.github/skills/`)

### Fase 6 — Segurança

- [x] F6.1 — Rate limiting endpoint `/inject`
- [x] F6.2 — Autenticação token opcional
- [x] F6.3 — Validação de URL em web-tools
- [x] F6.4 — Shell tools: audit log via `recordToolCall` + sandbox hardening

### Fase 7 — TODO Store

- [x] F7.1 — TODO Store: TTL e cleanup automático
- [x] F7.2 — TODO bulk: operações atômicas (já existia)
- [x] F7.3 — Introspection tools: status de health por tool (`get_tool_health`)
- [x] F7.4 — Git tools: branch awareness (`git_current_branch`, `git_is_dirty`)

### Fase 8 — Resiliência

- [x] F8.1 — Reconnect policy: backoff exponencial com jitter (já existia)
- [x] F8.2 — Session: validação de saúde antes de retomada (`_validateSessionForResume`)
- [x] F8.3 — Watchdog: timeout configurável por tipo de tarefa (`setTaskType`)

### Fase 9 — MCP Bridge

- [x] F9.1 — MCP health check periódico (`getMcpStatus` no /health)
- [x] F9.2 — MCP tool reconnect automático (`startMcpAutoReconnect`)

### Fase 10 — Graceful Degradation

- [x] F10.1 — Port probe TCP rápido antes de HTTP ao MCP (`_isMcpPortOpen`)
- [x] F10.2 — Auto-reconnect MCP com backoff crescente (1×→2×→3×→6×)
- [x] F10.3 — Banner de diagnóstico standalone/conectado no boot
- [x] F10.4 — Campo `operationMode` no endpoint `/health`
- [x] F10.5 — PinnedFilesLoader: resiliente a falhas de filesystem

### Fase 11 — Channel Reliability

- [x] F11.1 — inject.js: opção `retryOn503` para retry em 503
- [x] F11.2 — inject.js: backoff exponencial (2^attempt) em vez de linear
- [x] F11.3 — Métricas de latência `channel.inject` via `recordToolCall`
- [x] F11.4 — LlmBridgeClient: retry com backoff em `chat()`
- [x] F11.5 — `chatStructured()`: segunda tentativa com instrução explícita de formato
- [x] F11.6 — SSE reconexão com Last-Event-ID (já implementado)

### Fase 12 — Context Improvements

- [x] F12.1 — Aviso antes do auto-trim de histórico
- [x] F12.2 — `seedHistory()` com validação de alternância
- [x] F12.3 — Persistir métricas de conversa no `ConversationStore`
- [x] F12.4 — `getLastNPairs()` modo compacto

### Fase 13 — DX & Tooling

- [x] F13.1 — Comando `/diagnose` no REPL
- [x] F13.2 — Evento `terminal.started` estruturado
- [x] F13.3 — Métricas Prometheus de canal no `/metrics`
- [x] F13.4 — Teste de integração: boot sem server
- [x] F13.5 — Hot-reload de skills sem reiniciar o agente

### Fase 14 — Observability HTTP API

- [x] F14.1 — `GET /errors`: expõe `defaultErrorTracker.getStats()` + últimos 20 erros ✅
- [x] F14.2 — `GET /audit`: ring buffer + `getAuditSummary()` async via query param `summary=1` ✅
- [x] F14.3 — `GET /tool-stats`: mapa completo de `getToolStats()` como JSON estruturado ✅
- [x] F14.4 — `/metrics` Prometheus: dialog turns, sessions, tokens, percentis p50/p95 ✅
- [x] F14.5 — Shell tools → `defaultAuditLog.recordToolStart/Complete` para JSONL completo ✅

### Fase 15 — Security Pro Mode

- [x] F15.1 — `COPILOT_ALLOWED_EXECUTABLES` para `exec_command` (allowlist via env var) ✅
- [x] F15.2 — Rate limiting nos endpoints `/errors`, `/audit` e `/tool-stats` ✅
- [x] F15.3 — Audit de falhas de autenticação no `server.js` →
      `defaultAuditLog.record('auth.failure')` ✅

### Fase 16 — Developer Comms

- [x] F16.1 — Ready webhook (`COPILOT_READY_WEBHOOK`) — POST fire-and-forget após server.listen ✅
- [x] F16.2 — Comando `/emergency-reset` (alias `/ereset`) no REPL + `POST /system/reset` HTTP ✅
- [x] F16.3 — `GET /history` + ring buffer de injeções em `state.js` ✅

### Fase 17 — Internals Optimization

- [x] F17.1 — Dedup de eventos no audit log (janela 1s, ignora tool.start/complete) ✅
- [x] F17.2 — `getStatsByCategory()` em `tool-stats.js` + exposto em `GET /tool-stats` ✅
- [ ] F17.3 — Histogramas p50/p95 no `/metrics` Prometheus ✅ (implementado junto com F14.4)

---

## Fase 18 — Terminal: Streaming Thinking Display (LLM-B Reasoning)

**Objetivo**: Exibir o raciocínio (extended thinking / reasoning) da LLM-B em tempo real no terminal
e via SSE/Socket.io, proporcionando transparência total do processo de pensamento do modelo.

**Contexto**: A SDK emite eventos `assistant.reasoning_delta` (chunks incrementais) e
`assistant.reasoning` (bloco completo). O `session-event-wirer.js` já captura esses eventos e emite
`task.reasoning` no AlwaysAlive. Porém o terminal (`dialog.js`) **não consome** esses eventos —
exibe apenas a resposta final. Esta fase conecta o pipeline de reasoning ao terminal.

### F18.1 — Propagação de reasoning via `dialogTurn()` callback ✅

- **Arquivos**: `channel/client.js`, `agent/always-alive.js`
- **Mudança**: Adicionar callback `onReasoning` em `dialogTurn()` (análogo ao `onDelta` existente)
  que recebe chunks de `task.reasoning` em tempo real
- **Detalhes**: O `dialogTurn()` já recebe `onDelta` para message deltas; adicionar `onReasoning`
  para reasoning deltas. Registrar listener temporário em `task.reasoning` e remover no finally.

### F18.2 — Rendering de thinking no stdout do terminal ✅

- **Arquivo**: `terminal/dialog.js`
- **Mudança**: Em `_executeTurn()`, passar callback `onReasoning` que renderiza chunks de raciocínio
  com prefixo visual distinto (ex: `💭` com cor dim/italic)
- **Formato visual**:
  ```
  ── [14:22:10] 💭 pensando… ──────────────────────────────────────────
    │  <chunk1><chunk2><chunk3>...
  ── [14:22:12] pensamento completo (2.1s) ─────────────────────────────
  ```
- **Toggle**: Controlado pela flag `showThinking` no state.js (default: `true`)
- **Env var**: `TERMINAL_SHOW_THINKING=true|false`

### F18.3 — Evento SSE `reasoning` para clientes externos ✅

- **Arquivo**: `terminal/dialog.js`
- **Mudança**: Em `onReasoning` callback, emitir `broadcastSse('reasoning', { chunk, reasoningId })`
  para que clientes SSE/Socket.io recebam o reasoning em real time
- **Evento persisted**: Emitir `broadcastSse('reasoning.complete', { content, durationMs })` ao
  final do bloco de reasoning

### F18.4 — Armazenamento de reasoning no ConversationStore

- **Arquivo**: `conversation-hub/store.js`
- **Mudança**: Campo `reasoning` no schema de turn (string nullable). Ao concluir o turno, persistir
  o bloco de reasoning completo junto com a resposta
- **Exposição**: `GET /history` inclui campo `reasoning` quando presente

### F18.5 — Comando `/thinking` no REPL ✅

- **Arquivo**: `terminal/commands/thinking.js` (novo)
- **Mudança**: Toggle `/thinking [on|off|toggle]` que controla `showThinking` no state.js
- **Registro**: Adicionar em `terminal/commands/index.js`

---

## Fase 19 — Terminal: Streaming Response (Real-time Message Delta)

**Objetivo**: Substituir a exibição batch (resposta completa ao final) por streaming real token a
token no stdout, semelhante ao comportamento de um chat com LLM.

### F19.1 — Streaming stdout em `_executeTurn()` ✅

- **Arquivo**: `terminal/dialog.js`
- **Mudança**: Usar callback `onDelta` do `dialogTurn()` para escrever chunks diretamente no stdout
  à medida que chegam, em vez de esperar o `reply` completo
- **Detalhes**:
  - O header do turno (timestamp, modelo, etc.) é impresso ao receber o primeiro chunk
  - Cada chunk é `process.stdout.write()` sem `\n` (inline)
  - Ao final (`reply` retornado), imprimir newline final + separador
  - Medir `durationMs` do primeiro chunk ao último (time-to-first-token + total)

### F19.2 — Métricas de streaming (TTFT + throughput) ✅

- **Arquivo**: `terminal/dialog.js` + `observability/tool-stats.js`
- **Mudança**: Registrar `timeToFirstTokenMs` e `tokensPerSecond` no audit/metrics
- **Exposição**: Campo adicional no evento `copilot:turn:complete` do NERV

### F19.3 — SSE delta events para clientes do terminal

- **Arquivo**: `terminal/dialog.js`
- **Mudança**: Emitir `broadcastSse('delta', { chunk, messageId })` a cada chunk de resposta,
  permitindo que o dashboard Vue renderize streaming em tempo real
- **Rate limit**: Agrupar chunks menores que 50ms em batch para evitar flood SSE

---

## Fase 20 — Terminal: Usage & Intent Display

**Objetivo**: Exibir informações de intent (o que o modelo está fazendo) e usage (tokens/custo) em
tempo real no terminal.

### F20.1 — Intent display inline

- **Arquivo**: `terminal/dialog.js`
- **Mudança**: Registrar listener em `assistant.intent` (via AlwaysAlive events) e exibir status
  efêmero no stdout durante processamento
- **Formato**: `  ⏳ aguardando gpt-4.1 · high… [Exploring codebase]`
- **Cleanup**: Sobrescrever a linha com `\r` quando a resposta começa a chegar

### F20.2 — Usage summary pós-turno ✅

- **Arquivo**: `terminal/dialog.js`
- **Mudança**: Após cada turno, mostrar resumo de tokens usado (via evento `session.usage_info` que
  já é capturado pelo session-event-wirer)
- **Formato**:
  ```
    📊 tokens: 1,234 in / 567 out · cache: 890 · custo: 0.003 · ctx: 45%
  ```
- **Toggle**: Controlado por `showUsage` no state.js (default: `false`, ativável via `/usage`)

### F20.3 — Comando `/usage` no REPL ✅

- **Novo arquivo**: `terminal/commands/usage.js`
- **Funcionalidade**: Toggle `/usage [on|off]` para mostrar/ocultar usage pós-turno
- **Bônus**: `/usage now` mostra snapshot instantâneo do context window

---

## Fase 21 — Terminal: Context & Tools Integration

**Objetivo**: Integrar o terminal com os subsistemas existentes de tools, observabilidade e contexto
do src/copilot.

### F21.1 — Comando `/tools` no REPL ✅

- **Novo arquivo**: `terminal/commands/tools.js`
- **Funcionalidade**: Lista todas as tools registradas (git, shell, todo, etc.) com stats de uso
- **Dados**: Puxa de `getToolStats()` do observability module

### F21.2 — Comando `/errors` no REPL ✅

- **Novo arquivo**: `terminal/commands/errors.js`
- **Funcionalidade**: Mostra últimos N erros do `defaultErrorTracker`, formatados com cor
- **Integração**: Reutiliza o endpoint lógica do `GET /errors` HTTP

### F21.3 — Comando `/audit` no REPL ✅

- **Novo arquivo**: `terminal/commands/audit.js`
- **Funcionalidade**: Mostra resumo do audit log (últimas entradas + summary)
- **Integração**: Reutiliza `defaultAuditLog.getAuditSummary()`

### F21.4 — Comando `/compact` no REPL

- **Novo arquivo**: `terminal/commands/compact.js`
- **Funcionalidade**: Dispara compaction da context window da sessão ativa
- **Integração**: Chama `alwaysAliveAgent.requestCompaction()` ou equivalente

### F21.5 — Auto-display de tool executions em background

- **Arquivo**: `terminal/dialog.js` ou novo `terminal/tool-display.js`
- **Mudança**: Registrar listeners nos eventos `tool.execution_start` e `tool.execution_complete` do
  AlwaysAlive para exibir notificações inline quando tools são executadas durante o diálogo
- **Formato**:
  ```
    🔧 bash: npm run test:unit (executando…)
    ✅ bash: npm run test:unit (ok, 3.2s)
  ```

---

## Fase 22 — Terminal: Session Lifecycle Awareness

**Objetivo**: Tornar o terminal ciente e reativo ao ciclo de vida da sessão SDK, incluindo
compaction, erros, idle e shutdown.

### F22.1 — Display de compaction events

- **Arquivo**: `terminal/dialog.js`
- **Mudança**: Listener em `session.compaction_start` / `session.compaction_complete` para mostrar
  progresso visual
- **Formato**:
  ```
    🔄 Compactando contexto… (45,000 → ?)
    ✅ Compaction completa: 45,000 → 22,000 tokens (-51%)
  ```

### F22.2 — Display de session errors

- **Arquivo**: `terminal/dialog.js`
- **Mudança**: Listener em `session.error` para alertar o usuário de erros de sessão (quota, rate
  limit, auth) com ações sugeridas
- **Formato**:
  ```
    ❌ Erro de sessão: rate_limit — aguarde 30s antes de tentar novamente
  ```

### F22.3 — Context window gauge

- **Arquivo**: `terminal/dialog.js`
- **Mudança**: Mostra barra de progresso da context window no prompt do REPL quando uso > 50%
- **Formato**: `[████████░░░░] 67% ctx` exibido sutilmente após o prompt

### F22.4 — Graceful shutdown display

- **Arquivo**: `terminal/dialog.js`
- **Mudança**: Listener em `session.shutdown` para exibir resumo final da sessão antes de encerrar
  (total de requests, duração, code changes)

---

## Fase 23 — Terminal: Rich Markdown & Syntax Rendering

**Objetivo**: Melhorar a renderização de respostas da LLM-B no terminal com formatação Markdown e
syntax highlighting para blocos de código.

### F23.1 — Parser Markdown básico para terminal

- **Novo arquivo**: `terminal/markdown-renderer.js`
- **Funcionalidade**: Converte Markdown básico (headings, bold, italic, lists, inline code) em ANSI
  escape codes para renderização no terminal
- **Dependências**: Implementação zero-dependency usando regex patterns

### F23.2 — Syntax highlighting para code blocks

- **Arquivo**: `terminal/markdown-renderer.js`
- **Mudança**: Detectar blocos ` ```lang ` e aplicar highlighting básico (keywords, strings,
  comments) para JS/TS/Python/Bash
- **Abordagem**: Patterns regex por linguagem — sem dependência de tree-sitter ou prism

### F23.3 — Integração com `printExchange()`

- **Arquivo**: `terminal/dialog.js`
- **Mudança**: Filtrar output da LLM-B pelo markdown renderer antes de exibir, respeitando o toggle
  `/markdown [on|off]` (novo comando REPL)

### F23.4 — Comando `/markdown` no REPL

- **Novo arquivo**: `terminal/commands/markdown.js`
- **Funcionalidade**: Toggle `/markdown [on|off]` para ativar/desativar renderização rich
- **Default**: `on` (ativado por padrão)

---

## Sumário de Novas Fases (F18-F23)

| Fase | Nome                        | SubFases | Prioridade | Dependências |
| ---- | --------------------------- | -------- | ---------- | ------------ |
| F18  | Streaming Thinking Display  | 5        | **Alta**   | Nenhuma      |
| F19  | Streaming Response          | 3        | **Alta**   | F18          |
| F20  | Usage & Intent Display      | 3        | Média      | F18, F19     |
| F21  | Context & Tools Integration | 5        | Média      | Nenhuma      |
| F22  | Session Lifecycle Awareness | 4        | Média      | F18          |
| F23  | Rich Markdown & Syntax      | 4        | Baixa      | F19          |

**Estimativa de escopo total**: 24 subfases · ~6 novos arquivos · ~15 arquivos modificados

---

_Atualizado automaticamente conforme upgrades são aplicados._
