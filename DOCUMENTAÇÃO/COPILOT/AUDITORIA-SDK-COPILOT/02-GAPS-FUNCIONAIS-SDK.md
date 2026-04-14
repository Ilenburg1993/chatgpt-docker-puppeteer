# 02 — Gaps Funcionais: SDK `@github/copilot-sdk` vs `src/copilot`

**Data**: 2026-03-21 | **Revisado**: 2026-03-21
**Status**: Versão Definitiva (pós revisão crítica)
**Referência**: 01-INVENTARIO-SDK-COMPLETO.md

---

## Classificação de Severidade e Esforço

| Severidade  | Definição                                                            |
| ----------- | -------------------------------------------------------------------- |
| **CRÍTICO** | Funcionalidade essencial ausente; impacta confiabilidade em produção |
| **ALTO**    | Feature valiosa; impacta funcionalidade ou UX significativamente     |
| **MÉDIO**   | Gap de cobertura; workaround existe mas é subétimo                   |
| **BAIXO**   | Feature de nicho ou experimental; não obrigatória agora              |

| Esforço               | Definição                                  |
| --------------------- | ------------------------------------------ |
| **P** (Pequeno)       | < 2h, 1–2 arquivos                         |
| **M** (Médio)         | 2–8h, 2–5 arquivos                         |
| **G** (Grande)        | 8–24h, 5+ arquivos, refactoring estrutural |
| **XG** (Extra Grande) | 24+h, redesign arquitetural                |

---

## FAIXA A — Client-Level Gaps

### GAP-A01: `client.getLastSessionId()` não exposto
- **Severidade**: MÉDIO | **Esforço**: P
- **Impacto**: Sem acesso ao ID da última sessão ativa para recovery/reconexão automática
- **Solução**: Adicionar wrapper em `sdk/session/client.js` + expor via REST `GET /api/copilot/client/last-session`
- **Arquivo alvo**: `sdk/session/client.js`, `server/routes/sessions.js`

### GAP-A02: `client.getForegroundSessionId()` / `setForegroundSessionId()` ausentes
- **Severidade**: MÉDIO | **Esforço**: P
- **Impacto**: Controle de TUI (foreground/background) impossível programaticamente
- **Solução**: Wrappers em `sdk/session/client.js` + endpoints REST
- **Arquivo alvo**: `sdk/session/client.js`, `server/routes/sessions.js`

### GAP-A03: Client lifecycle events não wired no agent bootstrap
- **Severidade**: ALTO | **Esforço**: M
- **Impacto**: Eventos de criação/deleção/atualização de sessões não chegam ao sistema. O `conversation-hub/` pode ter estados desincronizados quando sessões são criadas/destruídas externamente.
- **Evidência**: `sdk/session/client-events.js` fornece wrappers tipados (`subscribeLifecycleEvent()`, `subscribeAllLifecycleEvents()`) mas nenhum call site encontrado em `agent/lifecycle/`.
- **Solução**: Registrar handlers de lifecycle no bootstrap do agent (após `getClient()`)
- **Arquivo alvo**: `agent/lifecycle/agent-lifecycle.js` ou `session-setup.js`

### GAP-A04: `client.rpc.account.getQuota()` ausente
- **Severidade**: ALTO | **Esforço**: M
- **Impacto**: Sem monitoramento de quota do ACL/billing. Sem alerta proativo de exaustão de quota.
- **Solução**: Wrapper em `sdk/rpc/server.js` + endpoint REST `GET /api/copilot/quota` + integração com `token-budget.js`
- **Arquivo alvo**: `sdk/rpc/server.js`, `server/routes/`, `agent/session/event-handlers/token-budget.js`

### GAP-A05: `client.rpc.tools.list(params)` ausente
- **Severidade**: MÉDIO | **Esforço**: P
- **Impacto**: Não é possível listar tools disponíveis no escopo do servidor (antes de criar sessão)
- **Solução**: Wrapper em `sdk/rpc/server.js`
- **Arquivo alvo**: `sdk/rpc/server.js`

### GAP-A06: `clientName` não passado em SessionConfig
- **Severidade**: BAIXO | **Esforço**: P
- **Impacto**: SDK não identifica nosso client por nome nos logs/telemetria
- **Solução**: Adicionar `clientName: 'chatgpt-docker-puppeteer'` em `session-setup.js`
- **Arquivo alvo**: `agent/lifecycle/session-setup.js`

### GAP-A07: `isChildProcess` mode não explorado
- **Severidade**: BAIXO | **Esforço**: G
- **Impacto**: Opportunity — quando nosso processo Node.js é filho de outro, podemos evitar spawning de CLI separado
- **Solução**: Ver documento 06 (TSServer/SDK integração)

### GAP-A08: `telemetry.captureContent` / `telemetry.filePath` não configurados
- **Severidade**: BAIXO | **Esforço**: P
- **Impacto**: Telemetria de content não capturada para debugging
- **Solução**: Tornar configuráveis via env: `COPILOT_TELEMETRY_CAPTURE_CONTENT`, `COPILOT_TELEMETRY_FILE_PATH`
- **Arquivo alvo**: `sdk/session/client.js:buildClientOptions()`

### GAP-A09: `onGetTraceContext` callback não wired
- **Severidade**: BAIXO | **Esforço**: P
- **Impacto**: OpenTelemetry trace context not propagated from our tracing to SDK
- **Solução**: Wire em `buildClientOptions()` usando nosso OTEL context propagator
- **Arquivo alvo**: `sdk/session/client.js`

---

## FAIXA B — Session-Level Gaps

### GAP-B01: `session.setModel(model, options?)` não exposto
- **Severidade**: ALTO | **Esforço**: M
- **Impacto**: Impossível trocar modelo em runtime sem reconectar sessão. Workaround atual usa `rpc.model.switchTo()` directly.
- **Solução**: Expor como tool SDK + endpoint REST `PUT /api/copilot/session/:id/model`
- **Arquivo alvo**: `tools/session-rpc-tools.js`, `server/routes/sessions.js`
- **Nota**: `session.setModel()` é método nativo do SDK que pode ter lógica adicional vs `rpc.model.switchTo()`

### GAP-B02: `availableTools` / `excludedTools` não passados em SessionConfig
- **Severidade**: MÉDIO | **Esforço**: M
- **Impacto**: Não é possível filtrar tools no nível de sessão via SDK (temos nosso próprio filtering via hooks, o que duplica funcionalidade)
- **Solução**: Passar `availableTools`/`excludedTools` do AgentContext/config para SessionConfig
- **Arquivo alvo**: `agent/lifecycle/session-setup.js`, `agent/agent-context.js`

### GAP-B03: `skillDirectories` / `disabledSkills` não passados
- **Severidade**: MÉDIO | **Esforço**: P
- **Impacto**: Skills directories e disable list não configuráveis via nossa implementação
- **Solução**: Tornar configuráveis via AgentContext + env `COPILOT_SKILL_DIRECTORIES`, `COPILOT_DISABLED_SKILLS`
- **Arquivo alvo**: `agent/lifecycle/session-setup.js`

### GAP-B04: `configDir` não passado
- **Severidade**: BAIXO | **Esforço**: P
- **Impacto**: SDK usa default config dir; não podemos customizar
- **Solução**: Tornar configurável via env `COPILOT_CONFIG_DIR`
- **Arquivo alvo**: `agent/lifecycle/session-setup.js`

### GAP-B05: `agent` (initial agent name) não passado em SessionConfig
- **Severidade**: MÉDIO | **Esforço**: P
- **Impacto**: Sessões não iniciam com agente pré-selecionado; requer seleção posterior via RPC
- **Solução**: Passar `agent` do config quando disponível
- **Arquivo alvo**: `agent/lifecycle/session-setup.js`

### GAP-B06: `onEvent` (early event handler) não wired
- **Severidade**: MÉDIO | **Esforço**: M
- **Impacto**: Sem acesso a eventos antes dos handlers padrão do SDK serem executados. Útil para telemetria/auditoria precoce.
- **Solução**: Registrar `onEvent` callback no SessionConfig apontando para nosso EventBus
- **Arquivo alvo**: `agent/lifecycle/session-setup.js`, `hooks/bus.js`

---

## FAIXA C — RPC Experimental (Wrappers existem, sem exposição)

### GAP-C01: Nenhum namespace experimental exposto via tools ou REST
- **Severidade**: ALTO | **Esforço**: G
- **Impacto**: `experimental.js` implementa 19 funções (fleet, agent, skills, mcp, plugins, extensions) mas nenhuma está acessível ao usuário final.
- **Solução**: Criar tools e/ou routes para cada subsistema experimental relevante
- **Decomposição**: ver subfaixas C01a–C01f

#### GAP-C01a: Skills RPC — tools e routes
- **Esforço**: M
- Criar tool `sdk_skills_list`, `sdk_skills_enable`, `sdk_skills_disable`
- Route `GET/PUT /api/copilot/session/:id/skills`
- **Prioridade**: ALTA (controle granular de Skills é core para nosso uso)

#### GAP-C01b: MCP RPC — tools e routes
- **Esforço**: M
- Criar tool `sdk_mcp_list`, `sdk_mcp_enable`, `sdk_mcp_disable`
- Route `GET/PUT /api/copilot/session/:id/mcp`
- **Prioridade**: ALTA (controle de MCP servers per-session)

#### GAP-C01c: Agent RPC — tools e routes
- **Esforço**: M
- Criar tools `sdk_agent_list`, `sdk_agent_select`, `sdk_agent_deselect`, `sdk_agent_status`
- Route `GET/PUT /api/copilot/session/:id/agents`
- **Prioridade**: ALTA (multi-agent é central para nossa arquitetura)

#### GAP-C01d: Extensions RPC — tools e routes
- **Esforço**: M
- Criar tools `sdk_extensions_list`, `sdk_extensions_enable`, `sdk_extensions_disable`
- Route `GET/PUT /api/copilot/session/:id/extensions`
- **Prioridade**: MÉDIA

#### GAP-C01e: Plugins RPC — tools e routes
- **Esforço**: P
- Criar tool `sdk_plugins_list`
- Route `GET /api/copilot/session/:id/plugins`
- **Prioridade**: BAIXA

#### GAP-C01f: Fleet RPC — tools e routes
- **Esforço**: P
- Criar tool `sdk_fleet_start`
- Route `POST /api/copilot/session/:id/fleet`
- **Prioridade**: BAIXA (experimental)

### GAP-C02: `agent.getCurrent()` wrapper ausente
- **Severidade**: MÉDIO | **Esforço**: P
- **Impacto**: Não é possível consultar qual agente está ativo na sessão
- **Solução**: Adicionar `agentGetCurrent()` em `experimental.js`
- **Arquivo alvo**: `sdk/rpc/experimental.js`

### GAP-C03: `agent.reload()` wrapper ausente
- **Severidade**: MÉDIO | **Esforço**: P
- **Impacto**: Não é possível recarregar agentes sem reiniciar sessão
- **Solução**: Adicionar `agentReload()` em `experimental.js`
- **Arquivo alvo**: `sdk/rpc/experimental.js`

### GAP-C04: `skills.reload()` wrapper ausente
- **Severidade**: MÉDIO | **Esforço**: P
- **Arquivo alvo**: `sdk/rpc/experimental.js`

### GAP-C05: `mcp.reload()` wrapper ausente
- **Severidade**: MÉDIO | **Esforço**: P
- **Arquivo alvo**: `sdk/rpc/experimental.js`

---

## FAIXA D — Events sem Handler Dedicado (alto impacto)

### GAP-D01: `session.mcp_server_status_changed` sem handler
- **Severidade**: ALTO | **Esforço**: M
- **Impacto**: Mudanças de status de servidores MCP (offline, reconnect, error) não detectadas. Potencial silent failure.
- **Solução**: Criar handler dedicado em `event-handlers/mcp-status.js`

### GAP-D02: `mcp.oauth_required` / `mcp.oauth_completed` sem handler
- **Severidade**: ALTO | **Esforço**: M
- **Impacto**: MCP servers que requerem OAuth não recebem tratamento; conexões ficam pendentes
- **Solução**: Handler em `event-handlers/mcp-oauth.js` + integração com auth flow

### GAP-D03: `session.model_change` sem handler dedicado
- **Severidade**: MÉDIO | **Esforço**: P
- **Impacto**: Mudanças de modelo em runtime não rastreadas (catch-all loga mas não atualiza ctx.model)
- **Solução**: Handler que atualiza `AgentContext.model`

### GAP-D04: `session.tools_updated` sem handler dedicado
- **Severidade**: MÉDIO | **Esforço**: P
- **Impacto**: Quando SDK atualiza tools disponíveis, não atualizamos nosso registry
- **Solução**: Handler que sincroniza `toolsRegistry`

### GAP-D05: `tool.execution_progress` sem handler dedicado
- **Severidade**: MÉDIO | **Esforço**: M
- **Impacto**: Progress updates de tools longas (ex: terminal commands) não propagados via SSE/WebSocket
- **Solução**: Handler que emite progress para o frontend

### GAP-D06: `session.warning` sem handler dedicado
- **Severidade**: MÉDIO | **Esforço**: P
- **Impacto**: Warnings do SDK não são distintos de logs normais
- **Solução**: Handler que loga em nível WARN + emite para frontend

### GAP-D07: `skill.invoked` sem handler dedicado
- **Severidade**: MÉDIO | **Esforço**: P
- **Impacto**: Invocações de skills não rastreadas para analytics/auditoria
- **Solução**: Handler que loga + emite métrica

### GAP-D08: `pending_messages.modified` sem handler dedicado
- **Severidade**: MÉDIO | **Esforço**: M
- **Impacto**: Mensagens pendentes (ex: tool calls em fila) não sincronizadas com frontend
- **Solução**: Handler que atualiza cache + emite SSE event

### GAP-D09: `command.*` events sem handlers dedicados
- **Severidade**: MÉDIO | **Esforço**: M
- **Impacto**: Commands queued/executed/completed não rastreados
- **Solução**: Handler package para command lifecycle

### GAP-D10: `shell_completed` / `shell_detached_completed` sem handler dedicado
- **Severidade**: MÉDIO | **Esforço**: P
- **Impacto**: Shell executions tracked apenas pelo catch-all
- **Solução**: Handler dedicado com logging estruturado

### GAP-D11: `subagent.selected` / `subagent.deselected` sem handler
- **Severidade**: MÉDIO | **Esforço**: P
- **Impacto**: Seleção/deseleção de subagentes não rastreada

### GAP-D12: `tool.user_requested` sem handler
- **Severidade**: MÉDIO | **Esforço**: P
- **Impacto**: Tool requests originados pelo usuário não distinguidos de requests do assistente

---

## FAIXA E — Funcionalidade Duplicada (nosso código faz o que o SDK deveria fazer)

### GAP-E01: Tool filtering duplicado (hooks vs SDK `availableTools`/`excludedTools`)
- **Severidade**: MÉDIO | **Esforço**: M
- **Impacto**: Nosso `hooks/factory.js:resolveToolDecision()` reimplementa filtering que o SDK oferece nativamente via `availableTools` e `excludedTools` no `SessionConfig`.
- **Solução**: Usar `availableTools`/`excludedTools` do SDK para filtering estático; manter hooks apenas para lógica dinâmica (ask, runtime deny)
- **Benefício**: Reduz overhead de hooks (SDK faz filtering antes de invocar hook)

### GAP-E02: System message — controle total via modularização
- **Severidade**: ALTO | **Esforço**: G (14h)
- **Impacto**: `lifecycle.js` constrói `{ mode: 'customize', content }` manualmente em vez de usar o builder centralizado `system-message.js`. Além disso, apenas 7 de 10 seções SDK estão cobertas. Faltam `safety`, `tool_instructions`, `custom_instructions`.
- **Solução completa**: Modularizar system prompt em pasta dedicada `config/system-prompt/` com:
  - 1 arquivo por seção (10 no total)
  - Modo `replace` como padrão (controle total)
  - Conteúdo base SDK preservado + customizações nossas
  - Troca fácil para `customize` via flag sem refatoração
  - Assembler dual-mode centralizado
- **Referência**: [08-SYSTEM-PROMPT-MODULAR.md](./08-SYSTEM-PROMPT-MODULAR.md)

### GAP-E03: Conversation-hub sem sync via lifecycle events do SDK
- **Severidade**: MÉDIO | **Esforço**: M
- **Impacto**: `conversation-hub/` é uma **camada de persistência SQLite** (LLM-A ↔ LLM-B ↔ Usuário) que sincroniza **de** sessões SDK via `syncFromSdkHistory()`. Não reimplementa gestão de sessões (não é duplicação). Porém, não está conectado aos **lifecycle events** do client (`session.created/deleted/updated`), o que significa que sessões criadas ou destruídas externamente não são refletidas no hub em tempo real.
- **Solução**: Wiring de lifecycle events do client (GAP-A03) com bridge para o hub, mantendo o hub como consumer informado

---

## Sumário de Prioridades

| Prioridade            | Gaps                                           | Esforço Total |
| --------------------- | ---------------------------------------------- | ------------- |
| **P0 (Crítico/Alto)** | A03, A04, B01, C01a–c, D01, D02                | ~60h          |
| **P1 (Médio-Alto)**   | A01, A02, B02, B05, B06, C02–C05, D03–D08, E01 | ~40h          |
| **P2 (Médio)**        | A05, B03, B04, C01d–f, D09–D12, E02, E03       | ~30h          |
| **P3 (Baixo)**        | A06–A09                                        | ~8h           |

**Total estimado**: ~138h de desenvolvimento para cobertura 100%.
