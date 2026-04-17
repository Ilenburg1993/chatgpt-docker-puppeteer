# Pré-Auditoria Profunda — `src/copilot`

**Data**: 2026-04-17
**Auditor**: GitHub Copilot (Claude Sonnet 4.6) — LLM-A
**Escopo**: `src/copilot/` completo + avaliação do entry point `terminal:llm-b`
**Diretório de saída**: `DOCUMENTAÇÃO/COPILOT/AUDITORIA-PROFUNDA-ABRIL-2026/`
**Status**: Pré-auditoria concluída — Auditoria profunda em andamento

---

## 1. Objetivo desta Auditoria

Esta auditoria tem três objetivos simultâneos:

1. **Varredura completa de bugs e gaps** em todo `src/copilot` (421 arquivos JS, ~21 módulos)
2. **Conformidade com o SDK** `@github/copilot-sdk` — verificar se os contratos do SDK são respeitados em toda a base de código
3. **Avaliação do entry point `terminal:llm-b`** — o ponto de início da execução da LLM-B, sua sequência de boot, robustez e gaps

Ao final, esta auditoria alimentará diretamente a **fase de uso da LLM-B**, com o sistema em estado mais confiável e corrigido.

---

## 2. Contexto e Auditorias Anteriores

Existe documentação de auditoria prévia em `DOCUMENTAÇÃO/COPILOT/AUDITORIA-SRC-COPILOT/`, produzida por outra LLM (sessão anterior). Os achados confirmados nessa auditoria são **incorporados como baseline** desta auditoria, não são refeitos do zero.

### Achados já confirmados pelo catálogo anterior (`02-CATALOGO-DE-ACHADOS-E-GAPS-SRC-COPILOT-2026-04-17.md`)

| ID      | Severidade | Módulo                               | Resumo                                                                           |
| ------- | ---------- | ------------------------------------ | -------------------------------------------------------------------------------- |
| CAT-001 | Alta       | `server/routes/control.js`           | `/steer` sem proteção admin                                                      |
| CAT-002 | Crítica    | `server/socket/hub-ns.js`            | Autenticação sem autorização por sessão                                          |
| CAT-003 | Alta       | `channel/client.js`                  | Cross-talk possível em `chat()` concorrente                                      |
| CAT-004 | Alta       | `conv-hub/orchestrator.js`           | Sessão fechada ainda recebe turnos tardios                                       |
| CAT-005 | Alta       | `server/app.js`, `cors.js`           | CORS default inválido (CAT foi baseado em versão antiga — **REAVALIADO** abaixo) |
| CAT-006 | Alta       | `server/app.js`, `router.js`         | `skipAuth` prometido mas não efetivado                                           |
| CAT-007 | Alta       | `core/event-bus.js`                  | Handlers async podem rejeitar sem tratamento                                     |
| CAT-008 | Alta       | `agent/session/keepalive.js`         | Keepalive reentrante/overlap                                                     |
| CAT-009 | Alta       | `routes/session-messaging.js`        | Timeouts por `Promise.race` sem cleanup                                          |
| CAT-010 | Alta       | `infra/storage.js`                   | Escrita JSON não-atômica (CAT baseado em versão antiga — **REAVALIADO** abaixo)  |
| CAT-011 | Alta       | `infra/storage.js`                   | Leitura JSON mascara corrupção                                                   |
| CAT-012 | Alta       | `observability/logger.js`            | Logging síncrono em hot path                                                     |
| CAT-013 | Alta       | `observability/event-bus-runtime.js` | Singleton retém bus/metrics antigos                                              |
| CAT-024 | Alta       | `package.json`, testes               | Runner incompatível (`node --test` vs vitest)                                    |
| CAT-025 | Alta       | `tests/unit/copilot`                 | 39 testes skipped/pending                                                        |

### Reavaliações desta auditoria (achados do catálogo anterior que mudaram)

**CAT-005 (CORS)**: A versão atual de `server/middleware/cors.js` usa `http://localhost:*` como default — mais restrito que `*`. O problema original de "CORS wildcard" foi **parcialmente corrigido**. Porém, o pattern `http://localhost:*` não é um valor válido para `Access-Control-Allow-Origin` (globs não são suportados pelo protocolo CORS). Portanto, o achado persiste com forma diferente.

**CAT-010 (storage não-atômico)**: A versão atual de `infra/storage.js` usa `writeFile` direto, **sem** write-to-temp + rename. O comentário JSDoc diz "usa escrita em arquivo temporário + rename para atomicidade (quando possível)" — mas a implementação NÃO faz isso. É uma **mentira documental ativa** que pode enganar desenvolvedores.

---

## 3. Escopo Quantitativo

### 3.1 Métricas de código

| Métrica                         | Valor    |
| ------------------------------- | -------- |
| Arquivos `.js` em `src/copilot` | **421**  |
| Módulos de primeiro nível       | **21**   |
| Arquivos com >300 linhas        | ~69      |
| Arquivos com >500 linhas        | ~7       |
| LOC total estimado              | ~66.000+ |

### 3.2 Distribuição por módulo (arquivos .js)

| Módulo              | Arquivos | Risco preliminar                 |
| ------------------- | -------- | -------------------------------- |
| `terminal/`         | 50       | 🔴 Crítico — entry point LLM-B    |
| `agent/`            | 50       | 🔴 Crítico — lifecycle core       |
| `server/`           | 41       | 🟠 Alto — superfície HTTP/WS      |
| `sdk/`              | 38       | 🟠 Alto — conformidade SDK        |
| `observability/`    | 34       | 🟡 Médio — infraestrutura de log  |
| `tools/`            | 33       | 🟠 Alto — execução de ferramentas |
| `hooks/`            | 25       | 🟠 Alto — pipeline de events      |
| `config/`           | 24       | 🟡 Médio — configuração           |
| `events/`           | 20       | 🟡 Médio — catalogo de eventos    |
| `core/`             | 20       | 🟠 Alto — contratos centrais      |
| `event-handlers/`   | 13       | 🟡 Médio                          |
| `bridges/`          | 13       | 🟠 Alto — MCP, GH bridges         |
| `infra/`            | 12       | 🟠 Alto — I/O, webhooks           |
| `conversation-hub/` | 12       | 🔴 Crítico — hub LLM-A↔LLM-B      |
| `audit/`            | 9        | 🟡 Médio                          |
| `channel/`          | 8        | 🔴 Crítico — canal de comunicação |
| `presentation/`     | 7        | 🟡 Médio                          |
| `types/`            | 4        | 🟢 Baixo                          |
| `plugins/`          | 3        | 🟢 Baixo                          |
| `db/`               | 3        | 🟡 Médio                          |

### 3.3 Sinais de risco quantitativos (varredura grep)

| Padrão                        | Ocorrências | Interpretação                                              |
| ----------------------------- | ----------- | ---------------------------------------------------------- |
| `logSwallowed(...)`           | 62          | Erros engolidos com log — verificar se contexto é adequado |
| `catch (_)` ou `catch (_err)` | 19          | Swallow explícito sem log                                  |
| `setInterval(...)`            | 11          | Timers periódicos — verificar cleanup no shutdown          |
| `setTimeout(...)`             | 53          | Timers pontuais — verificar cleanup em cancelamento        |
| `JSON.parse(...)`             | 20          | Parses sem try/catch em pelo menos parte dos casos         |
| `process.exit(...)`           | 3           | Saídas abruptas — verificar se cleanup é feito             |
| `TODO/FIXME/HACK/XXX`         | 21          | Dívida técnica marcada                                     |
| `readFileSync/writeFileSync`  | ~15         | I/O síncrono em processo async                             |

---

## 4. Entry Point `terminal:llm-b` — Análise Inicial

### 4.1 Sequência de boot

```
npm run terminal:llm-b
  └─► node --strip-types src/copilot/terminal/bootstrap.js
        └─► bootCopilot() [src/copilot/bootstrap.js]
              ├─ Phase 1: bootstrapObservability()
              ├─ Phase 2: bootstrapLateDeps({ buildTool })
              │   ├─ registra AUDIT_BUS (defaultBus de hooks/bus.js)
              │   ├─ setAuditBus()
              │   └─ container.validateRequired([...8 tokens DI])
              └─ Phase 3: startTerminalServer() [terminal/index.js]
                    ├─ loadAliasesAsync()
                    ├─ wireTerminalDI()
                    ├─ PinnedFilesLoader.start() (best-effort)
                    ├─ bridgeEmitter(pinnedLoader → EventBus)
                    ├─ initTerminalConversationHub() (best-effort)
                    │   └─ createTerminalHubSession()
                    ├─ startCopilotServer({orchestrator?, store?})
                    ├─ registerAgentEventListeners()
                    ├─ startReflectionLoop()
                    ├─ startTodoCleanupJob()
                    └─ startRepl() [terminal/repl.js]
```

### 4.2 Gaps identificados no boot sequence

| ID          | Severidade | Descrição                                                                                                                                                                                                                                                              |
| ----------- | ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GAP-BOOT-01 | Alta       | `bootCopilot()` chama `container.validateRequired()` antes de `startTerminalServer()` — mas tokens registrados em `wireTerminalDI()` (Phase 3) são validados na Phase 2. Se `wireTerminalDI()` registrar tokens críticos, a validação pode passar com tokens ausentes. |
| GAP-BOOT-02 | Média      | `startCopilotServer()` retorna uma Promise (`copilotServerPromise`) que não é aguardada. Se o servidor falhar ao iniciar (porta em uso, etc.), o erro é silenciado.                                                                                                    |
| GAP-BOOT-03 | Média      | `pinnedLoader.on('changed')` cria um listener que não é removido no shutdown. Há bridging para EventBus, mas o listener direto `on('changed')` não é cancelado.                                                                                                        |
| GAP-BOOT-04 | Baixa      | `bootCopilot()` usa uma variável de módulo `_booted` para idempotência, mas não há mecanismo de reset para testes. Pode causar problemas em testes de integração.                                                                                                      |
| GAP-BOOT-05 | Alta       | O `bootstrap.js` captura o erro com `process.exitCode = 1` mas não chama `process.exit()`. Em alguns ambientes Node.js, o processo pode continuar rodando em estado indeterminado com código de saída 1.                                                               |

### 4.3 Avaliação da `startTerminalServer()`

**Pontos positivos**:
- Sequência bem estruturada e comentada
- `PinnedFilesLoader` e ConversationHub são best-effort (falhas não travam o boot)
- `registerTimer()` centraliza cleanup de timers
- Graceful shutdown via `registerShutdownHandler()` (verificar se está completo)

**Pontos de atenção**:
- `copilotServerPromise` não é aguardada — **GAP-BOOT-02**
- PinnedFilesLoader listener direto sem cleanup — **GAP-BOOT-03**

---

## 5. Análise Inicial por Módulo Crítico

### 5.1 `core/event-bus.js` — CAT-007 confirmado

O método `#deliver()` executa handlers com `void handler(event)` dentro de try/catch que engolha tudo silenciosamente:

```js
try {
    void handler(event);
} catch (_) {
    /* handler errors are swallowed */
}
```

Problema: handlers **assíncronos** (que retornam Promise) não têm seu `void` capturado pelo catch. A promise rejeitada se torna uma **unhandled rejection** que pode derrubar o processo no Node.js 24+.

**Severidade**: Alta (CAT-007 confirmado e reavaliado como mais grave que o original)

### 5.2 `infra/storage.js` — CAT-010 MENTIRA DOCUMENTAL

O JSDoc afirma atomicidade via `tmp + rename`, mas a implementação usa `writeFile` direto:

```js
// JSDoc diz: "Usa escrita em arquivo temporário + rename para atomicidade (quando possível)"
// Implementação real:
await writeFile(filePath, content, 'utf-8'); // SEM atomicidade
```

Isso é um bug documental ativo que pode enganar consumidores do módulo.

**Severidade**: Alta — corrupção silenciosa de dados em crash durante escrita

### 5.3 `server/middleware/cors.js` — CAT-005 PERSISTENTE

O origin padrão `http://localhost:*` não é um valor válido para o header `Access-Control-Allow-Origin`. O protocolo HTTP/CORS não suporta globs em valores de origin. Navegadores vão rejeitar esse header.

**Severidade**: Alta — funcionalidade CORS quebrada para clientes browser

### 5.4 `channel/inject.js` — Rate Limiter com Memoria Infinita

O array `_injectTimestamps` usa sliding window de 1s, mas a limpeza de entradas expiradas usa `shift()` (O(n)) em loop, e não há cap máximo para crescimento do array. Em rate limite elevado, o array pode crescer indefinidamente.

**Severidade**: Baixa (rate limiter é 30 req/s, array tiny; mas é leak técnico)

### 5.5 `agent/session/keepalive.js` — CAT-008 Análise

A implementação tem proteção básica (`if (this.#running) return` no `start()`), mas o método `#tick()` é `async` e pode ainda estar em execução quando o próximo `setInterval` dispara. Não há guard para overlap de `#tick()` assíncrono.

**Severidade**: Alta — múltiplos heartbeats simultâneos podem travar a sessão

---

## 6. Conformidade com o SDK

### 6.1 Contratos esperados do SDK

Com base no repositório de memória e análise do código:

| Contrato          | Descrição                                                                                              |
| ----------------- | ------------------------------------------------------------------------------------------------------ |
| `onErrorOccurred` | Recebe `{error: string, errorContext: string, recoverable: boolean}`, retorna `{errorHandling: 'retry' | 'skip' | 'abort'}` |
| `client.stop()`   | Retorna `Promise<Error[]>`                                                                             |
| Erros do SDK      | NÃO são typed — sempre `Error` genérico com `message: string`                                          |
| Sessão            | Tem `send()`, pode expirar por idle (keepalive necessário)                                             |

### 6.2 Gaps de conformidade identificados

| ID     | Módulo                               | Descrição                                                                             |
| ------ | ------------------------------------ | ------------------------------------------------------------------------------------- |
| SDK-01 | `hooks/error-handler.js`             | Verificar se retorno de `onErrorOccurred` sempre retorna um dos 3 valores válidos     |
| SDK-02 | `sdk/session/client.js`              | Verificar se `client.stop()` é chamado e seu resultado (array de erros) é tratado     |
| SDK-03 | Múltiplos                            | SDK importado diretamente em 22 arquivos (violação arquitetural) em vez de via barrel |
| SDK-04 | `agent/lifecycle/agent-lifecycle.js` | Verificar tratamento de erros do SDK durante stop/reconnect                           |

---

## 7. Metodologia de Auditoria

### 7.1 Abordagem

Esta auditoria segue a metodologia da skill `copilot-full-audit` v2.0 **adaptada**:

- **Leitura integral** de cada arquivo crítico antes de gerar achados
- **Verificação direta** de código (não grep apenas)
- **Correlação com catálogo anterior** para confirmar, revogar ou escalar achados
- **Geração de MDs individuais por módulo** (não por arquivo — escopo adaptado para produtividade)
- **Correções aplicadas imediatamente** após confirmação do achado

### 7.2 Tipologia de IDs

Formato: `{TIPO}-{MOD}-{SEQ}`

**Tipos**: `BUG` | `RACE` | `LEAK` | `SEC` | `PERF` | `GAP` | `INC` | `DEAD` | `ARCH`
**Módulos**: `BOOT` | `AGENT` | `API` | `BRDG` | `CHAN` | `CONF` | `CONV` | `CORE` | `DB` | `HOOK` | `OBS` | `ROUTE` | `TERM` | `TOOLS` | `INFRA` | `SDK`
**Severidades**: `P0` (crítica) | `P1` (alta) | `P2` (média) | `P3` (baixa)

### 7.3 Ordem de prioridade de análise

1. `terminal/` — entry point LLM-B (escopo do pedido explícito)
2. `agent/` — lifecycle core, loop-manager, always-alive
3. `sdk/` — conformidade com SDK
4. `channel/` — comunicação LLM-A↔LLM-B
5. `conversation-hub/` — orquestração de conversas
6. `core/` — event-bus, shutdown, DI
7. `server/` — HTTP server, auth, CORS
8. `infra/` — storage, webhooks
9. `observability/` — logger, metrics, alerting
10. `hooks/` — pipeline de hooks
11. Demais módulos

---

## 8. Documentos a Serem Gerados

| Arquivo                       | Conteúdo                                                                   |
| ----------------------------- | -------------------------------------------------------------------------- |
| `00-PRE-AUDITORIA.md`         | **Este documento**                                                         |
| `01-TERMINAL-LLM-B.md`        | Auditoria detalhada do terminal (bootstrap, index, repl, wiring, frontend) |
| `02-AGENT.md`                 | Auditoria do módulo agent/ (always-alive, loop-manager, lifecycle, boot)   |
| `03-SDK-CONFORMIDADE.md`      | Auditoria do módulo sdk/ e conformidade com @github/copilot-sdk            |
| `04-CHANNEL-COMMUNICATION.md` | Auditoria do channel/ (inject, client, sse-client)                         |
| `05-CONVERSATION-HUB.md`      | Auditoria do conversation-hub/ (orchestrator, hub, store, send-pipeline)   |
| `06-CORE.md`                  | Auditoria do core/ (event-bus, shutdown, DI, retry, schemas)               |
| `07-SERVER.md`                | Auditoria do server/ (app, auth, CORS, routes, socket)                     |
| `08-INFRA-OBSERVABILITY.md`   | Auditoria do infra/ e observability/                                       |
| `09-HOOKS.md`                 | Auditoria do hooks/                                                        |
| `10-ISSUES-CONSOLIDATED.md`   | Todos os achados, ordenados por severidade                                 |
| `11-ROADMAP-FIXES.md`         | Plano de correções com prioridade P0→P3                                    |

---

## 9. Estado Atual dos Sistemas Operacionais

Com base em `npm run audit:preflight` (informado pela auditoria anterior):

| Sistema | Estado       | Impacto                            |
| ------- | ------------ | ---------------------------------- |
| PM2     | ✅ OK         | Terminal LLM-B pode ser gerenciado |
| MCP     | ❌ Não pronto | Tools externas indisponíveis       |
| RAG     | ❌ Não pronto | Contexto semântico indisponível    |
| LSP     | ❌ Não pronto | Diagnósticos de tipo indisponíveis |

---

## 10. Resumo Executivo dos Riscos

### Riscos P0 (Críticos — corrigir antes de usar LLM-B)

| ID           | Descrição                                                                   |
| ------------ | --------------------------------------------------------------------------- |
| CAT-002      | Socket hub-ns sem autorização por sessão                                    |
| BUG-CORE-01  | Event-bus: handlers async silenciosamente descartados (unhandled rejection) |
| BUG-INFRA-01 | `writeJson()` não é atômico apesar do contrato documentado                  |

### Riscos P1 (Altos — corrigir nesta sessão)

| ID          | Descrição                                               |
| ----------- | ------------------------------------------------------- |
| GAP-BOOT-02 | `startCopilotServer()` Promise não aguardada            |
| BUG-CORS-01 | Glob em `Access-Control-Allow-Origin` não é padrão HTTP |
| CAT-003     | Cross-talk em `channel/client.js`                       |
| CAT-004     | Sessões fechadas ainda recebem turnos tardios           |
| CAT-008     | Keepalive reentrante                                    |
| CAT-009     | Promise.race sem cleanup                                |

### Riscos P2 (Médios — backlog de alta)

| ID          | Descrição                                |
| ----------- | ---------------------------------------- |
| GAP-BOOT-03 | Listener PinnedFilesLoader sem cleanup   |
| CAT-011     | Corrupção silenciosa em storage          |
| CAT-013     | Singleton event-bus-runtime retém estado |
| CAT-024     | Runner de testes incompatível            |

---

*Próximos documentos: `01-TERMINAL-LLM-B.md` → auditoria detalhada do entry point.*
