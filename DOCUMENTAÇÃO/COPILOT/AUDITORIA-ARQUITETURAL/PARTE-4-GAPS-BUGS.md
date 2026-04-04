# Auditoria Arquitetural — src/copilot · Parte 4: Gaps, Bugs e Estado Atual vs Desejado

**Data**: 2026-04-04
**Referência**: [PARTE-3-DIALOG-LOOP.md](PARTE-3-DIALOG-LOOP.md)

---

## 1. Gaps Identificados

### GAP-01 — agent-event-observer desconectado de tasks não-dialog

**Severidade**: MÉDIA
**Módulo**: `agent/always-alive.js` → `#ensureDialogLoopAttached()`
**Descrição**: O `createAgentEventObserver()` só é chamado dentro de `#ensureDialogLoopAttached()`,
que é invocado na primeira chamada de `startDialogLoop()`. Se o agente processar tarefas via
`sendMessage()` (fila de tasks) **antes** de qualquer dialog boot, o `agent-event-observer` **não
estará ativo**, e todas as métricas de turn/tool/task serão perdidas.

**Impacto**: Tasks executadas antes do primeiro dialog loop não geram métricas no MetricsStore.
OTEL spans para essas tasks não são criados.

**Correção proposta**: Mover a criação do `agent-event-observer` para o `start()`, logo após
`wireSessionEvents()`, independente do dialog loop.

---

### GAP-02 — Divergência de usage tracking entre event-collector e session-event-wirer

**Severidade**: BAIXA
**Módulos**: `observability/event-collector.js` + `agent/session-event-wirer.js`
**Descrição**: Ambos rastreiam `usage` events do SDK, mas de formas diferentes:
- `event-collector`: persiste em events.jsonl, alimenta MetricsStore.recordUsage()
- `session-event-wirer._wireUsageEvent`: rastreia PR counters, persiste billing state
- `agent-event-observer`: também alimenta MetricsStore via agent events

Resultado: o MetricsStore pode receber dados duplicados se tanto event-collector quanto
agent-event-observer estiverem ativos nos mesmos eventos.

**Impacto**: Métricas de token usage potencialmente infladas (dupla contagem).

**Correção proposta**: Definir claramente qual camada é source-of-truth para usage. Recomendação:
event-collector como SoT para persistência, agent-event-observer como SoT para runtime metrics.
Adicionar dedup guard em `MetricsStore.recordUsage()`.

---

### GAP-03 — `tokens=?` no display de usage do terminal

**Severidade**: BAIXA
**Módulo**: `terminal/dialog.js`
**Descrição**: O display de usage após cada turno mostra `tokens=?` para alguns campos porque o
dado de usage chega assincronamente via evento `usage` e o display é renderizado antes do evento
chegar.

**Impacto**: UX informacional — o usuário vê `?` em vez do valor real.

**Correção proposta**: Aguardar o evento `usage` com timeout curto (500ms) antes de renderizar o
summary, ou re-renderizar a linha quando o dado chegar.

---

### GAP-04 — Shims deprecated ainda exportados

**Severidade**: BAIXA
**Módulo**: `hooks/presets/audit.js` e outros
**Descrição**: 8 shims deprecated (F2.6 do roadmap original) ainda exportados para
backward-compatibility. Não causam bugs, mas poluem a API pública.

**Impacto**: Confusão para novos desenvolvedores.

**Correção proposta**: Marcar com `@deprecated` explícito e planejar remoção em F35 (breaking
change controlado).

---

### GAP-05 — notifyTerminalTurn falha silenciosa em modo standalone

**Severidade**: BAIXA
**Módulo**: `conversation-hub/hub.js`
**Descrição**: Quando o ConversationHub está em modo standalone (sem servidor principal), a chamada
`notifyTerminalTurn()` falha silenciosamente dentro de um try/catch. Nenhum log é emitido.

**Impacto**: Turnos não são notificados para o hub; histórico pode ficar incompleto em standalone.

**Correção proposta**: Adicionar log.debug() no catch com indicação de modo standalone. Considerar
queue local para retry quando hub ficar disponível.

---

### GAP-06 — NERV bridge EVENT_MAP hard-coded

**Severidade**: BAIXA
**Módulo**: `bridges/nerv-bridge.js`
**Descrição**: Os 49 mapeamentos de eventos são definidos como literal object. Quando novos eventos
são adicionados ao agent, o EVENT_MAP precisa ser atualizado manualmente. Não há validação de
cobertura.

**Impacto**: Risco de eventos novos não serem propagados para NERV.

**Correção proposta**: Gerar validação automática comparando eventos emitidos pelo agent
(extraídos via grep/análise estática) com EVENT_MAP, como parte do lint ou CI.

---

### GAP-07 — session-event-wirer filtra task.delta durante dialog loop

**Severidade**: MÉDIA
**Módulo**: `agent/session-event-wirer.js`
**Descrição**: A função `_wireStreamingEvents` verifica se o dialog loop está ativo e filtra
`response.delta` durante processsamento de task (não-dialog). Isso é intencional para evitar
que deltas de tasks interfiram no display do terminal, mas impede que tasks tenham streaming visível.

**Impacto**: Tasks executadas via fila não têm streaming no terminal. Tudo chega como bloco.

**Correção proposta**: Em vez de filtrar, rotear para um canal separado (`task.delta`) que pode
ser exibido em outra view ou buffer.

---

### GAP-08 — Metrics periodic snapshot sem log level proper

**Severidade**: INFORMACIONAL
**Módulo**: `agent/always-alive.js`
**Descrição**: O evento `agent.metrics` é emitido a cada 30s sem considerar log level. Em
ambientes de debug, isso gera muito ruído.

**Impacto**: Poluição de logs em modo debug.

**Correção proposta**: Condicionar emissão ao log level, ou emitir apenas se há delta significativo
desde o último snapshot.

---

### GAP-09 — Tool TTL cleanup pode eliminar tools legítimas em execução lenta

**Severidade**: BAIXA
**Módulo**: `observability/event-collector.js`
**Descrição**: A `_pending` Map usa TTL de 5 minutos para limpar execuções de tools que não
receberam `execution_complete`. Ferramentas que demoram mais que 5 minutos (e.g., builds longos,
deploys) terão sua métrica de duração perdida.

**Impacto**: Métricas incorretas para tools de longa duração.

**Correção proposta**: Aumentar TTL para 10-15min, ou implementar tombstone com flag `expired`
em vez de delete.

---

### GAP-10 — Context window block at 95% sem recovery automático

**Severidade**: MÉDIA
**Módulo**: `terminal/dialog.js`
**Descrição**: Quando o context window atinge 95%, `_executeTurn()` bloqueia o turno e emite um
warning, mas não inicia compaction automática. O usuário precisa manualmente digitar `/compact`
ou a compaction precisa ser triggerada por outra via.

**Impacto**: Agente pode ficar travado se context enche e nenhuma ação manual ocorre.

**Correção proposta**: Ao atingir 90%, iniciar compaction proativa automática. Ao atingir 95%,
forçar compaction síncrona antes de bloquear.

---

## 2. Bugs Confirmados

### BUG-01 — Race condition na coalescing de ensureDialogLoop

**Severidade**: BAIXA
**Módulo**: `terminal/dialog.js`
**Descrição**: A flag `_ensureDialogLoopInFlight` é usada para coalescir boots simultâneos,
mas é resetada de forma assíncrona. Em cenário de alta concorrência (múltiplos inject HTTP
simultâneos), é teoricamente possível que dois boots sejam iniciados.

**Impacto**: Boot duplo → estado inconsistente do DLM. Não reproduzido em produção mas
teoricamente possível.

**Correção proposta**: Usar um Promise como guard em vez de boolean flag (Promise coalescing).

---

### BUG-02 — DLM watchdog não reseta timer em pause

**Severidade**: BAIXA
**Módulo**: `agent/dialog-loop-manager.js`
**Descrição**: O watchdog (setInterval a cada 5min) continua verificando stall mesmo quando o
dialog loop está pausado. Se o pause durar > 15min, o watchdog reporta stall falso-positivo.

**Impacto**: Alertas falsos de stall durante pausa prolongada.

**Correção proposta**: Pausar o watchdog quando `state === 'paused'`.

---

## 3. Estado Atual vs Estado Desejado

### 3.1 Observabilidade

| Aspecto          | Estado Atual                       | Estado Desejado                        |
| ---------------- | ---------------------------------- | -------------------------------------- |
| Persistência     | ✅ events.jsonl com rotação         | ✅ OK                                   |
| Métricas runtime | ✅ MetricsStore com histogramas     | ⬜ Dashboard visual (Grafana/Vue)       |
| OTEL spans       | ✅ Implementado (opcional)          | ⬜ Exportação para Jaeger/Grafana Tempo |
| Error tracking   | ✅ ErrorTracker com dedup           | ⬜ Alertas proativos (threshold-based)  |
| Audit log        | ✅ Ring buffer + JSONL              | ⬜ Query interface (SQLite ou API)      |
| Usage/billing    | ⚠️ Dual path (divergência possível) | ⬜ Single SoT + billing dashboard       |
| Tool stats       | ✅ Per-tool latency                 | ⬜ Top-N tools, success rate trends     |
| Terminal display | ⚠️ tokens=? em alguns campos        | ⬜ Display completo e consistente       |

### 3.2 Dialog Loop

| Aspecto       | Estado Atual                    | Estado Desejado                        |
| ------------- | ------------------------------- | -------------------------------------- |
| Zero-PR turns | ✅ Implementado e funcional      | ✅ OK                                   |
| Pause/Resume  | ✅ Strategy A (0 PR) e B (1 PR)  | ✅ OK                                   |
| Watchdog      | ⚠️ Falso-positivo em pause longo | ⬜ Pausar watchdog durante pause        |
| Compaction    | ✅ Automática via SDK            | ⬜ Proativa ao atingir 90% context      |
| Multi-model   | ⚠️ Fallback model básico         | ⬜ Pool de modelos com seleção dinâmica |
| Breakpoints   | ❌ Não implementado              | ⬜ Pause em condições programáticas     |

### 3.3 Integração Terminal

| Aspecto           | Estado Atual                     | Estado Desejado                         |
| ----------------- | -------------------------------- | --------------------------------------- |
| REPL commands     | ✅ 15+ comandos                   | ⬜ Tab completion, help inline           |
| Streaming display | ✅ Thinking + response            | ⬜ Syntax highlighting em code blocks    |
| SSE broadcast     | ✅ Funcional                      | ⬜ Filtros por tipo, buffer de reconexão |
| ConversationHub   | ⚠️ Falha silenciosa em standalone | ⬜ Queue + retry + log                   |
| Context window    | ⚠️ Block at 95% sem auto-recovery | ⬜ Compaction proativa at 90%            |

### 3.4 Integração com NERV / Projeto Principal

| Aspecto       | Estado Atual                | Estado Desejado                      |
| ------------- | --------------------------- | ------------------------------------ |
| Event mapping | ✅ 49 eventos mapeados       | ⬜ Validação automática de cobertura  |
| Mount/unmount | ✅ Lifecycle com before-stop | ✅ OK                                 |
| Bidirecional  | ❌ Apenas agent → NERV       | ⬜ NERV → agent (comandos remotos)    |
| Dashboards    | ❌ Não integrado             | ⬜ Dashboard Vue com métricas copilot |

---

## 4. Comparação com Auditoria Anterior (2026-03-30)

A auditoria anterior (`DOCUMENTAÇÃO/AUDITORIA-COPILOT-NOVA.md`, 2096 linhas) focou em bugs
operacionais (F6.1–F6.17). Todos os itens foram resolvidos.

**Avanços desde a última auditoria:**
- ✅ F18–F22 implementados (thinking, streaming, usage, tools, errors)
- ✅ SDK event wiring completo (session-event-wirer)
- ✅ Comandos /display, /export, /metrics
- ✅ Streaming toggle (/thinking on/off)
- ✅ SSE broadcast para UIs externas
- ✅ agent-event-observer com 40+ handlers
- ✅ OTEL spans opcionais

**Itens do roadmap anterior pendentes (F23–F28):**
- ⬜ F23: Multi-model selection
- ⬜ F24: Session restore e handoff
- ⬜ F25: Dashboard copilot (Vue)
- ⬜ F26: Tools analytics
- ⬜ F27: Rate limit intelligence
- ⬜ F28: Plugin architecture

---

_Continua em [PARTE-5-ROADMAP.md](PARTE-5-ROADMAP.md)_
