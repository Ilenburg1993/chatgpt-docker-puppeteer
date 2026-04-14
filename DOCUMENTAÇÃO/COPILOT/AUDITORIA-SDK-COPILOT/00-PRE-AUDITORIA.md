# 00 — Pré-Auditoria: SDK `@github/copilot-sdk` vs `src/copilot`

**Data de início**: 2026-03-21 | **Revisado**: 2026-03-21
**Versão SDK auditada**: `@github/copilot-sdk` ≥ 0.2.0 (technical preview)
**Revisão por**: GitHub Copilot Agent (Claude Opus 4.6)
**Status**: Versão Definitiva (pós revisão crítica com investigação de código)

---

## Notas da Revisão Crítica

> As seguintes correções foram aplicadas em todos os 8 documentos (00-07) após investigação
> aprofundada do código-fonte:

1. **conversation-hub ≠ duplicação SDK**: Investigação de `store.js`, `hub.js` e `store-sync.js`
   revelou que o hub é uma camada de persistência SQLite para o ambiente LLM-A ↔ LLM-B ↔ Usuário,
   **não** uma duplicação de `client.listSessions()`. Ele sincroniza **de** sessões SDK via
   `syncFromSdkHistory()`. Corrigido em docs 00, 02, 04, 05, 07.

2. **system-message.js está correto**: Investigação completa (200 linhas) confirmou que o builder
   `customizeSystemMessage(sections, content)` está bem implementado. O bug real é em
   `lifecycle.js:buildSystemMessageConfig()` que constrói o objeto manualmente em vez de usar o
   builder. Refinado em docs 00, 03.

3. **HookBus bridge validada**: Leitura completa de `hooks/bus.js` (200 linhas) confirmou que a
   bridge EventBus funciona corretamente: `attachBus()` wrappeia os 6 hooks, `emitHook()` propaga
   para EventEmitter local + EventBus global. Sem overhead ou inconsistências. Q2 resolvida.

4. **Estimativas ajustadas**: Faixa G2 reduzida de 12h para 8h (não é substituição de registry,
   apenas wiring de lifecycle events). Total geral ajustado de ~198h para ~208h (com Faixa I).

5. **Nova Faixa I — System Prompt Modular** (14h): Adicionado doc
   [08-SYSTEM-PROMPT-MODULAR.md](./08-SYSTEM-PROMPT-MODULAR.md) com design completo para controle
   total do system prompt via modo `replace` como padrão, modularização em 10 arquivos (1/seção),
   conteúdo base SDK + customizações nossas, e troca fácil para `customize` via flag.

---

## 1. Propósito e Escopo

Esta auditoria investiga a implementação do `@github/copilot-sdk` em `src/copilot`, com objetivo de:

1. **Mapear completamente** a superfície do SDK vs nossa implementação (cobertura de features)
2. **Identificar gaps funcionais**: features do SDK ainda não aproveitadas
3. **Detectar misalignments**: onde nosso código faz o que deveria fazer o SDK (duplicação)
4. **Analisar arquitetura atual**: fluxo de dados, camadas, acoplamentos
5. **Propor arquitetura ideal**: estado alvo com 100% de cobertura SDK + design limpo
6. **Investigar TSServer ↔ SDK**: oportunidades de integração mais profunda
7. **Gerar roadmap master**: com faixas, fases e subfases acionáveis

### Escopo inclui
- `src/copilot/sdk/` — camada L1 de wrapper
- `src/copilot/hooks/` — pipeline de hooks L3
- `src/copilot/agent/` — loop de agente e wiring
- `src/copilot/bridges/` — MCP e GH bridges
- `src/copilot/conversation-hub/` — multi-sessão
- `src/copilot/server/` — API REST e SSE
- `node_modules/@github/copilot-sdk/dist/*.d.ts` — API oficial

### Escopo não inclui
- `src/missions/`, `src/nerv/`, `src/kernel/` — módulos de domínio fora do SDK
- Testes — auditoria de cobertura de testes é tarefa separada
- CI/CD — configurações de deploy separadas

---

## 2. Metodologia

### 2.1 Fontes consultadas (leitura integral)
| Arquivo                                        | Linhas | Conteúdo                                                 |
| ---------------------------------------------- | ------ | -------------------------------------------------------- |
| `node_modules/@github/copilot-sdk/README.md`   | 893    | Documentação completa + exemplos de uso                  |
| `dist/types.d.ts`                              | 1027   | Todos os tipos TypeScript exportados                     |
| `dist/client.d.ts`                             | 439    | Interface completa do `CopilotClient`                    |
| `dist/session.d.ts`                            | 392    | Interface completa do `CopilotSession`                   |
| `dist/generated/rpc.d.ts`                      | 1061   | `createServerRpc` + `createSessionRpc` full return types |
| `dist/generated/session-events.d.ts`           | ~200   | 50+ tipos de eventos tipados                             |
| `src/copilot/sdk/session/lifecycle.js`         | 305    | Wrapper de ciclo de vida de sessões                      |
| `src/copilot/hooks/factory.js`                 | 422    | Factory principal de SessionHooks                        |
| `src/copilot/agent/lifecycle/session-setup.js` | 120    | Wiring de criação de sessão                              |
| `src/copilot/sdk/constants.js`                 | ~300   | 100+ constantes mapeadas do SDK                          |

### 2.2 Mapeamento automático
- `find src/copilot -name "*.js"` → 180+ arquivos identificados
- `grep -rn "copilot-sdk"` → 65+ arquivos que importam do SDK
- `grep -rn "session\.on\|SESSION_EVENTS"` → cobertura de event handlers auditada

### 2.3 Critérios de severidade de gap
| Nível       | Definição                                                                |
| ----------- | ------------------------------------------------------------------------ |
| **CRÍTICO** | Feature essencial não implementada; impacta confiabilidade ou segurança  |
| **ALTO**    | Feature valiosa ausente; impacta funcionalidade ou UX significativamente |
| **MÉDIO**   | Gap de cobertura; funcionalidade incompleta mas workaround existe        |
| **BAIXO**   | Feature experimental ou de nicho; não obrigatória agora                  |

---

## 3. Inventário Inicial de Gaps (descobertos na leitura do SDK)

### 3.1 Gaps no `CopilotClient` (client-level)
| Feature SDK       | Método                                  | Status                                   | Severidade |
| ----------------- | --------------------------------------- | ---------------------------------------- | ---------- |
| Last session ID   | `client.getLastSessionId()`             | ❌ não exposto                            | MÉDIO      |
| TUI foreground    | `client.getForegroundSessionId()`       | ❌ não exposto                            | MÉDIO      |
| TUI background    | `client.setForegroundSessionId(id)`     | ❌ não exposto                            | MÉDIO      |
| Lifecycle events  | `client.on('session.created', handler)` | ⚠️ módulo criado, não wired no agent loop | ALTO       |
| Account quota     | `client.rpc.account.getQuota()`         | ❌ missing                                | ALTO       |
| Server tools list | `client.rpc.tools.list(params)`         | ❌ missing                                | MÉDIO      |

### 3.2 Gaps no `CopilotSession` (session-level)
| Feature SDK              | Método                          | Status                  | Severidade |
| ------------------------ | ------------------------------- | ----------------------- | ---------- |
| Trocar modelo em runtime | `session.setModel(model, opts)` | ❌ não exposto via tools | ALTO       |
| Log direto na sessão     | `session.log(msg, opts)`        | ✅ via `rpc.log()`       | OK         |

### 3.3 Gaps nos Namespaces RPC de Sessão
| Namespace    | Métodos                               | Status                     | Severidade |
| ------------ | ------------------------------------- | -------------------------- | ---------- |
| `skills`     | `list`, `enable`, `disable`, `reload` | ❌ todo namespace ausente   | ALTO       |
| `mcp`        | `list`, `enable`, `disable`, `reload` | ❌ todo namespace ausente   | ALTO       |
| `plugins`    | `list`                                | ❌ ausente                  | MÉDIO      |
| `extensions` | `list`, `enable`, `disable`, `reload` | ❌ todo namespace ausente   | MÉDIO      |
| `agent`      | `getCurrent`, `reload`                | ❌ parcial (list/select ok) | MÉDIO      |
| `fleet`      | `start` (experimental)                | ❌ ausente                  | BAIXO      |

### 3.4 Gaps em `SessionConfig`
| Opção                                 | Status                            | Severidade |
| ------------------------------------- | --------------------------------- | ---------- |
| `clientName`                          | ❓ a verificar no session-setup    | BAIXO      |
| `configDir`                           | ❓ a verificar                     | BAIXO      |
| `availableTools` / `excludedTools`    | ❓ a verificar                     | MÉDIO      |
| `skillDirectories` / `disabledSkills` | ❓ a verificar                     | MÉDIO      |
| `agent` (initial agent name)          | ❓ a verificar                     | MÉDIO      |
| `onEvent` (early event handler)       | ❓ a verificar em lifecycle wiring | MÉDIO      |

### 3.5 Gaps na Cobertura de Session Events
A auditoria da leitura de `session-events.d.ts` revelou ~100 tipos de eventos no SDK. Nossa cobertura em `src/copilot/agent/session/event-handlers/`:

**✅ Confirmados com handler**:
`session.start/idle/error/resume/shutdown/mode_changed/plan_changed/title_changed/context_changed/compaction_start/compaction_complete/truncation/usage_info/task_complete/snapshot_rewind/handoff`, `assistant.turn_start/turn_end/message/message_delta/streaming_delta/intent/reasoning/reasoning_delta/usage`, `tool.execution_start/complete`, `user.message`, `subagent.started/completed/failed`, `elicitation.requested`, `abort`, `system.notification`

**❓ Sem handler confirmado** (a investigar):
`session.tools_updated`, `session.skills_loaded`, `session.mcp_servers_loaded`, `session.mcp_server_status_changed`, `session.extensions_loaded`, `session.background_tasks_changed`, `session.workspace_file_changed`, `hook.start/end`, `skill.invoked`, `subagent.selected/deselected`, `tool.execution_progress/partial_result`, `permission.requested/completed`, `user_input.requested/completed`, `command.queued/execute/completed/changed`, `exit_plan_mode.requested/completed`, `shell_completed`, `external_tool.requested/completed`, `mcp.oauth_required/oauth_completed`, `pending_messages.modified`, `custom`

---

## 4. Questões Arquiteturais a Investigar

### Q1: Camada de hooks duplicada?
Temos `src/copilot/hooks/` (L3) que reimplementa lógica de `SessionHooks` do SDK.
Questão: deveria ser um thin adapter sobre os 6 slots do SDK em vez de pipeline próprio?

### Q2: Sistema de eventos duplo? ✅ RESOLVIDO
Temos:
1. `session.on(event, handler)` — SDK nativo
2. `EventBus` (`src/nerv/`) — bus próprio

Os dois coexistem. O `hooks/bus.js` faz bridge via `HookBus.emitHook()` que propaga para
ambos os bus (local EventEmitter + EventBus global). **Investigação confirmou que a bridge funciona
corretamente**: os 6 slots de hook são wrappeados via `attachBus()`, com wildcard listener e
mapeamento tipado via `HOOK_NAME_TO_EVENTBUS`. Não há overhead significativo nem inconsistências
identificadas. A ponte é elegante e bem implementada.

### Q3: TSServer ↔ SDK integration?
O SDK suporta `isChildProcess: true` quando executado como sub-processo de outro processo Node.js.
Questão: nosso `lsp-ops/` poderia usar `CopilotClient` diretamente, ou a arquitetura atual é mais robusta?

### Q4: Multi-sessão e conversation-hub? ✅ RESOLVIDO
O SDK tem `listSessions()`, `getForegroundSessionId()`, `setForegroundSessionId()`.

**Investigação revelou que não há duplicação real**: o `conversation-hub/` é uma **camada de
persistência SQLite** para o ambiente permanente LLM-A ↔ LLM-B ↔ Usuário, com `ConversationStore`,
`HubOrchestrator` e broadcast Socket.IO. Ele **sincroniza de** sessões SDK (via `syncFromSdkHistory()`)
mas não reimplementa gestão de sessões — é um consumidor, não um concorrente.

O que falta é wiring de **lifecycle events do client** (`session.created/deleted/updated`) para manter
o hub informado quando sessões são criadas/destruídas externamente. Isso é GAP-A03, não duplicação.

### Q5: `injectHookContext: true` (buggy field)?
Em `session-setup.js:buildSessionOptions()`, linha `injectHookContext: true` — este campo **não existe** no tipo `SessionConfig` do SDK. Possível propriedade extra ignorada silenciosamente ou bug.

---

## 5. Achados Preliminares de Bugs/Misalignments

### BUG-PRE-01: Campo `injectHookContext` inexistente
**Localização**: `src/copilot/agent/lifecycle/session-setup.js:109`
**Severidade**: BAIXO (campo extra é ignorado pelo SDK)
**Descrição**: `buildSessionOptions` retorna `{ ..., injectHookContext: true }` mas `SessionConfig` não tem esse campo.

### BUG-PRE-02: `reasoningEffort` não passa pelo `SessionConfig` tipado
**Localização**: `lifecycle.js:134 + session-setup.js:107`
**Severidade**: MÉDIO
**Descrição**: `reasoningEffort` é passado via `Record<string,unknown>` cast para contornar `exactOptionalPropertyTypes` mas não há validação dos valores permitidos (`'low'|'medium'|'high'|'xhigh'`).

### BUG-PRE-03: `mode: 'customize'` via `buildSystemMessageConfig` ignora `sections`
**Localização**: `sdk/session/lifecycle.js:104-109`
**Severidade**: MÉDIO
**Descrição**: A função `buildSystemMessageConfig()` em `lifecycle.js` constrói `{ mode: 'customize', content }` manualmente, em vez de usar o builder `customizeSystemMessage()` de `system-message.js`.

**Investigação posterior revelou**: o módulo `system-message.js` está **correto e completo** — oferece `customizeSystemMessage(sections, content)` com fallback para append em SDKs antigos. O bug é que `lifecycle.js` constrói o objeto manualmente em vez de reusar o builder, resultando em semântica ambígua: `content` em mode `customize` pode funcionar como suffix, mas se a intenção é append simples deveria usar `mode: 'append'`.

### BUG-PRE-04: Client lifecycle events (`client.on()`) implementados mas não wired
**Localização**: `sdk/session/client-events.js` (módulo existe) + `agent/lifecycle/` (não chama subscribeLifecycle)
**Severidade**: ALTO
**Descrição**: O módulo `client-events.js` fornece wrappers tipados para `client.on(lifecycle)` mas não há chamada no bootstrap do agente para registrar esses handlers. Eventos de criação/deleção/atualização de sessões não chegam ao sistema.

---

## 6. Entregáveis da Auditoria

| Documento                           | Conteúdo                                                             |
| ----------------------------------- | -------------------------------------------------------------------- |
| `01-INVENTARIO-SDK-COMPLETO.md`     | Matriz completa SDK surface vs nossa implementação                   |
| `02-GAPS-FUNCIONAIS-SDK.md`         | Todos os gaps com prioridade, impacto e esforço                      |
| `03-BUGS-MISALIGNMENTS.md`          | Bugs e misalignments com evidências e patches                        |
| `04-ARQUITETURA-ATUAL.md`           | Análise profunda da arquitetura atual (camadas, fluxo, acoplamentos) |
| `05-ARQUITETURA-IDEAL.md`           | Proposta de arquitetura target com 100% de cobertura SDK             |
| `06-TSSERVER-SDK-INTERNALIZACAO.md` | Investigação TSServer ↔ SDK integration                              |
| `07-ROADMAP-MASTER.md`              | Roadmap multi-faixa com fases e subfases acionáveis                  |

---

## 7. Sumário Executivo Preliminar

Com base na leitura completa do SDK e mapeamento inicial do codebase:

**Estado atual**: Nossa implementação cobre ~70% da API do SDK. As camadas principais (`CopilotClient`, `CopilotSession`, session RPC comum, hooks, events) estão bem implementadas. Os gaps principais são nos namespaces RPC experimentais (`skills`, `mcp`, `plugins`, `extensions`) e na integração de lifecycle events do client.

**Maior risco**: O módulo `client-events.js` existe mas não está wired — eventos de ciclo de vida de sessões (criação, deleção, atualização) não chegam ao sistema internamente, o que pode causar estados desincronizados em cenários multi-sessão.

**Oportunidade mais valiosa**: Implementar os namespaces `skills.*` e `mcp.*` da RPC de sessão habilitaria controle programático granular de Skills e MCP servers por sessão — funcionalidade de alto valor para nosso caso de uso.
