# 10-ISSUES-CONSOLIDATED — Inventário Consolidado de Todos os Achados

**Auditoria Profunda de `src/copilot`** · Abril 2026 **Scope**: todos os módulos auditados (01 a 09)
**Documentado em**: 2026-04-18

---

## Sumário Executivo

| Severidade    | Total  | Novos (vs CAT-001–CAT-025)        |
| ------------- | ------ | --------------------------------- |
| P0 (CRITICAL) | 2      | 1 novo (BUG-INFRA-01)             |
| P1 (HIGH)     | 5      | 2 novos (BUG-CORS-02, BUG-SSE-01) |
| P2 (MEDIUM)   | 14     | 8 novos                           |
| P3 (LOW)      | 12     | 7 novos                           |
| **Total**     | **33** | **18 novos**                      |

### Status de execução em `2026-04-17`

- **Corrigidos no código atual**: `BUG-CORE-01`, `BUG-INFRA-01`, `BUG-CORS-01`, `BUG-CORS-02`,
  `BUG-KEEP-01`, `BUG-SSE-01`.
- **P2 já parcialmente tratados nesta execução**: `GAP-BOOT-05`, `GAP-BOOT-03`, `GAP-CHAN-03`,
  `GAP-LOOP-01`, `GAP-HOOKS-01`, `GAP-HOOKS-02`.
- **Hardening arquitetural do agent**: `AgentContext` ganhou mutation helpers semânticos,
  `withAgentErrorPolicy(...)` passou a existir e já foi adotado em `messaging` + `reconnect-policy`,
  e consumidores operacionais começaram a migrar de `alwaysAliveAgent` para `getAgent()`.
- **Hardening arquitetural do agent (onda 2)**: mutation API do `AgentContext` foi ampliada,
  `session-setup.js` perdeu parte da dívida artificial de tipos, e o boot do agent passou a expor
  `bootReport` por step no health.
- **Hardening arquitetural do agent (onda 3)**: `runtime-contracts.js` concentrou guards/compat
  shims, `turn-executor.js` passou a limpar listeners de `AbortSignal`, o health ganhou
  `riskFlags` + `recommendedAction`, e o token canônico `ALWAYS_ALIVE_AGENT` passou a resolver
  `getAgent()` no DI.
- **Hardening arquitetural do agent (onda 4)**: `sdk/types.js`/`hooks/types.js` alinharam a shape
  real do SDK 0.2.0, `session-setup.js` deixou de exigir cast para hooks, e o agent ganhou
  superfície SDK explícita (`getSdkHandles()`/`getSdkResourceSnapshot()` +
  status/auth/foreground/custom agents).
- **Hardening arquitetural do agent (onda 5)**: `withAgentErrorPolicy(...)` passou a cobrir também
  `dialog-controller`, `session/ownership` e a persistência auxiliar do runtime via
  `persistStateWithPolicy(...)`; além disso, `user-input-handler.js` deixou de persistir perguntas
  interativas duas vezes, `agent-messaging.js` passou a limpar `pendingQuestion` pela policy
  canônica, `boot-steps.js` deixou de usar persistência nua no boot recovery do diálogo e
  `initializer.js` passou a usar a mesma rota canônica de persistência.
- **Hardening arquitetural do agent (onda 6)**: `runBootPipeline()` passou a aplicar policy por step
  com criticidade explícita (`required`, `degraded`, `skipped`), `health-check.js` passou a
  diferenciar boot degradado de boot falho, e a projeção HTTP passou a expor também
  `bootDegradedSteps`.
- **Hardening arquitetural do agent (onda 7)**: `AgentContext` passou a oferecer também helpers
  semânticos de leitura (`hasClient`, `hasActiveSession`, `hasPendingQuestion`,
  `getBackgroundPendingCount`, `getBootReportSnapshot`), adotados em `health`, `state`, facades e
  getters públicos do agent, reduzindo dependência direta do shape cru dos subestados.
- **Hardening arquitetural do agent/hooks (onda 8)**: `hooks/error-handler.js` deixou de
  compartilhar `retryCounts` e `circuits` entre sessões; o estado de recuperação agora é escopado
  por `sessionId + errorContext`.
- **Hardening arquitetural do agent/hooks (onda 9)**: `hooks/factory.js`, `hooks/session-hooks.js` e
  os presets `minimal/safe/interactive/deny-all/audit` passaram a usar handlers canônicos de erro;
  além disso, `presets/production.js` passou a registrar auditoria padrão em `defaultAuditLog`,
  mitigando `GAP-HOOKS-03`.
- **Hardening ask_user / dialog loop (onda 10)**: `ask_user` ganhou classificação semântica
  persistível (`ready/reply/stopped/question`), a recuperação zero-PR passou a exigir `ready` vivo,
  e o runtime agora distingue pergunta viva do SDK de sombra persistida (`pendingQuestionShadow`)
  restaurada do disco.
- **Hardening UX terminal (onda 11)**: o terminal ganhou camada canônica de atividade
  (`activity-state.js`), comando `/activity`, integração da atividade em
  `/status`/`/diagnose`/`/metrics`, toggles adicionais (`tools`, `intent`), correção do toggle
  `streaming` e broadcast SSE `terminal.activity`.
- **Clareza arquitetural terminal/SDK (onda 12)**: o terminal separou sinais vanilla da sessão SDK
  em `terminal/sdk-session-events.js`, projeções vanilla de `mode/plan` em
  `terminal/frontend/sdk-session-projection.js`, sinais normalizados do runtime em
  `terminal/agent-runtime-events.js` e streaming de tasks em `terminal/task-stream-events.js`; além
  disso, a documentação viva passou a ter mapa canônico do fluxo em
  `14-FLUXO-AGENT-TERMINAL-SDK.md`.
- **Higiene da malha do terminal (onda 13)**: contratos simples do terminal foram padronizados em
  Vitest para reduzir falsos vermelhos de runner misto (`node:test` executado por `vitest`).
- **P2 adicionais mitigados**: `GAP-BOOT-01`, `GAP-BOOT-02`, `GAP-CORE-01`, `GAP-AGENT-01`,
  `GAP-HUB-02`, `GAP-CHAN-01`.
- **P2 adicionais mitigados**: `GAP-HUB-03` agora conta com serialização de writes por
  `hubSessionId` no `ConversationStore`.
- **Segurança de sessão mitigada**: `CAT-002` agora possui ACL por `hub_session` no Socket.IO,
  grants via claims JWT e filtro de emits passivos.
- **Segurança operacional mitigada**: `GAP-HOOKS-04` recebeu `ask` por padrão para shell sensível e
  deny permanente para padrões destrutivos no preset de produção.
- **P3 adicionais mitigados**: `GAP-INFRA-01`.
- **Smoke test**: `terminal:llm-b` iniciou com sucesso e entrou em `READY`.
- **Boot log revalidado**: `custom-tools.json` opcional não gera mais erro engolido,
  `SessionKeepalive` agora informa o motivo da parada, F53 não emite mais warning falso em retomada
  saudável e `session.custom_agents_updated` foi absorvido como evento conhecido do SDK.
- **Re-triado**: `ARCH-SDK-01` não se confirmou como import runtime fora de `sdk/`; os matches
  atuais fora da camada SDK são JSDoc/comentários.
- **Re-triado**: `GAP-SDK-01` atual é risco de versionamento em `waitForEvent`, não falha de logging
  em `stopClient()`.
- **Ainda em aberto**: backlog P2/P3 restante, com destaque para `GAP-CHAN-02`, `GAP-TERM-03`,
  heurísticas temporais mais ricas para `ask_user`/shadow e evolução adicional da UX do terminal
  para estados intermediários de atividade.

---

## P0 — CRITICAL (bloqueadores de produção)

| ID                         | Módulo | Arquivo                     | Descrição                                                                                                                                                          | Documento                                                |
| -------------------------- | ------ | --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------- |
| **BUG-CORE-01** / CAT-007  | core   | `core/event-bus.js:259-290` | `void handler(event)` em `#deliver()` — rejeições de handlers async tornam-se `UnhandledPromiseRejection` → crash em Node.js 24 com `--unhandled-rejections=throw` | [06-CORE.md](./06-CORE.md)                               |
| **BUG-INFRA-01** / CAT-010 | infra  | `infra/storage.js:42-46`    | `writeJson()` não atômica: JSDoc promete `temp+rename` mas implementação usa `writeFile()` direto — crash durante escrita corrompre estado persistido              | [08-INFRA-OBSERVABILITY.md](./08-INFRA-OBSERVABILITY.md) |

---

## P1 — HIGH

| ID                        | Módulo  | Arquivo                                         | Descrição                                                                                                                                  | Documento                                                    |
| ------------------------- | ------- | ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------ |
| **BUG-CORS-01** / CAT-005 | server  | `server/middleware/cors.js:44`                  | `http://localhost:*` é wildcard inválido para `allowedOrigins` — nenhuma request de browser localhost passa                                | [07-SERVER.md](./07-SERVER.md)                               |
| **BUG-CORS-02**           | server  | `server/middleware/cors.js`                     | Array de origens joined com `, ` no header `Access-Control-Allow-Origin` — browsers rejeitam (esperado: apenas 1 valor)                    | [07-SERVER.md](./07-SERVER.md)                               |
| **BUG-KEEP-01** / CAT-008 | agent   | `agent/session/keepalive.js:67-70`              | `setInterval` com `async #tick()` sem guard de overlap — múltiplos ticks concorrentes se SDK ficar lento                                   | [02-AGENT.md](./02-AGENT.md)                                 |
| **BUG-SSE-01** ⭐         | channel | `channel/sse-client.js`                         | Buffer SSE ≥ 256KB silenciosamente descartado (`buf = ''`) sem notificação — respostas longas com código/raciocínio truncadas sem aviso    | [04-CHANNEL-COMMUNICATION.md](./04-CHANNEL-COMMUNICATION.md) |
| **ARCH-SDK-01** / CAT-001 | sdk     | `tools/*, hooks/registry.js, agent/lifecycle/*` | 7 arquivos importam `@github/copilot-sdk` diretamente, fora do barrel `sdk/session/client.js` — violação do contrato de encapsulamento SDK | [03-SDK-CONFORMIDADE.md](./03-SDK-CONFORMIDADE.md)           |

---

## P2 — MEDIUM

| ID                    | Módulo   | Arquivo                                                          | Descrição                                                                                                                            | Documento                                                    |
| --------------------- | -------- | ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------ |
| GAP-BOOT-01           | terminal | `bootstrap.js`                                                   | Validação DI do terminal antes ficava implícita/tardia — **mitigado em 2026-04-17 com `wireTerminalDI()` idempotente antes do boot** | [01-TERMINAL-LLM-B.md](./01-TERMINAL-LLM-B.md)               |
| GAP-BOOT-02           | terminal | `terminal/index.js`                                              | `copilotServerPromise` armazenada mas não aguardada — erros de bootstrap silenciados                                                 | [01-TERMINAL-LLM-B.md](./01-TERMINAL-LLM-B.md)               |
| GAP-BOOT-03           | terminal | `terminal/index.js`                                              | `pinnedLoader.on('changed')` listener não removido no shutdown — memory leak                                                         | [01-TERMINAL-LLM-B.md](./01-TERMINAL-LLM-B.md)               |
| GAP-BOOT-05           | terminal | `terminal/bootstrap.js:13`                                       | `process.exitCode = 1` sem `process.exit()` — processo permanece ativo em estado inválido após erro fatal                            | [01-TERMINAL-LLM-B.md](./01-TERMINAL-LLM-B.md)               |
| GAP-AGENT-01          | agent    | `agent/always-alive.js`                                          | `__processQueue` é evento interno exposto publicamente — qualquer módulo pode simular triggers da fila interna                       | [02-AGENT.md](./02-AGENT.md)                                 |
| GAP-LC-01             | agent    | `agent/lifecycle/agent-lifecycle.js`                             | `agentStart()` já não falha silenciosamente: hoje faz `log + emit(EMITTER_ERROR)`; ainda resta debate se deve lançar explicitamente  | [02-AGENT.md](./02-AGENT.md)                                 |
| GAP-LOOP-01           | agent    | `agent/dialog/loop-manager.js`                                   | `bootSendFn()` podia lançar sincronamente — **mitigado em 2026-04-17 com `Promise.resolve(...).catch(...)`**                         | [02-AGENT.md](./02-AGENT.md)                                 |
| CAT-003 / GAP-CHAN-03 | channel  | `channel/client.js`                                              | `setBridgeAgent()` sem guard de double-set — segunda chamada silenciosamente substitui o agente                                      | [04-CHANNEL-COMMUNICATION.md](./04-CHANNEL-COMMUNICATION.md) |
| GAP-CHAN-01           | channel  | `channel/inject.js`                                              | purge O(n) no rate limiter client-side — **mitigado em 2026-04-17 com índice lógico + compactação ocasional**                        | [04-CHANNEL-COMMUNICATION.md](./04-CHANNEL-COMMUNICATION.md) |
| GAP-HUB-02            | hub      | `conversation-hub/orchestrator.js`                               | `destroy()` nulifica bridge enquanto promises inflight ainda a referenciam — use-after-free potencial                                | [05-CONVERSATION-HUB.md](./05-CONVERSATION-HUB.md)           |
| GAP-HUB-03            | hub      | `conversation-hub/orchestrator.js` + `conversation-hub/store.js` | `injectUserMessage` fora do mutex — **mitigado em 2026-04-17 com serialização de writes por sessão no store**                        | [05-CONVERSATION-HUB.md](./05-CONVERSATION-HUB.md)           |
| GAP-CORE-01           | core     | `core/event-bus.js`                                              | Middleware chain não suporta middlewares async — await silenciosamente ausente                                                       | [06-CORE.md](./06-CORE.md)                                   |
| GAP-HOOKS-01          | hooks    | `presets/production.js`                                          | `toolAllowList=[]` default = allow all sem aviso — proteção efetivamente desativada                                                  | [09-HOOKS.md](./09-HOOKS.md)                                 |
| GAP-HOOKS-04          | hooks    | `permission-handler.js` + `presets/production.js`                | Modo `approve_all` sem lista de tools sempre-bloqueadas — **mitigado em 2026-04-17 com guard `ask` + deny por padrões destrutivos**  | [09-HOOKS.md](./09-HOOKS.md)                                 |

---

## P3 — LOW

| ID           | Módulo        | Arquivo                            | Descrição                                                                                                                         | Documento                                                |
| ------------ | ------------- | ---------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------- |
| GAP-TERM-01  | terminal      | `terminal/index.js`                | Graceful shutdown não aguarda sessões SDK ativas — sessões dangling na reinicialização                                            | [01-TERMINAL-LLM-B.md](./01-TERMINAL-LLM-B.md)           |
| GAP-TERM-02  | terminal      | `terminal/bootstrap.js`            | Signal handlers (SIGINT/SIGTERM) não registrados — Ctrl+C mata processo sem cleanup                                               | [01-TERMINAL-LLM-B.md](./01-TERMINAL-LLM-B.md)           |
| GAP-TERM-03  | terminal      | `terminal/index.js`                | Healthcheck endpoint `/health` sempre retorna 200 mesmo com SDK desconectado                                                      | [01-TERMINAL-LLM-B.md](./01-TERMINAL-LLM-B.md)           |
| GAP-INFRA-01 | infra         | `infra/sdk-session-registry.js`    | Registry limpo antes de `client.stop()` completar — out-of-sync após stop com falha                                               | [08-INFRA-OBSERVABILITY.md](./08-INFRA-OBSERVABILITY.md) |
| GAP-OBS-01   | observability | `observability/metrics.js`         | `defaultMetrics` singleton global sem reset — contadores acumulam entre test cases                                                | [08-INFRA-OBSERVABILITY.md](./08-INFRA-OBSERVABILITY.md) |
| GAP-HOOK-01  | hooks         | `hooks/error-handler.js`           | Shared state retry/circuit em closures cross-session — state leak entre sessões distintas                                         | [09-HOOKS.md](./09-HOOKS.md)                             |
| GAP-HOOKS-02 | hooks         | `presets/production.js`            | `piiPatterns=[]` default — sem redação de PII, prompts com tokens/passwords logados inteiros                                      | [09-HOOKS.md](./09-HOOKS.md)                             |
| GAP-HOOKS-03 | hooks         | `presets/production.js`            | Audit log misturado com operational log — **mitigado em 2026-04-17 com fallback estruturado em `defaultAuditLog`**                | [09-HOOKS.md](./09-HOOKS.md)                             |
| GAP-HOOKS-05 | hooks         | `prompt-transformer.js`            | Sem configuração PII, prompts passam inteiros — risco em ambientes multiusuário                                                   | [09-HOOKS.md](./09-HOOKS.md)                             |
| CAT-002      | server        | `server/socket/hub-ns.js`          | Socket hub-ns antes aceitava autenticação global sem ACL por sessão — **mitigado em 2026-04-17 com autorização por `hubSession`** | [07-SERVER.md](./07-SERVER.md)                           |
| GAP-HUB-01   | hub           | `conversation-hub/orchestrator.js` | `sessionCount` não decrementado em paths de erro — counter leaks lentamente                                                       | [05-CONVERSATION-HUB.md](./05-CONVERSATION-HUB.md)       |
| GAP-SDK-01   | sdk           | `sdk/session/lifecycle.js`         | `waitForEvent` é re-exportado sem wrapper local — risco de versionamento em upgrades do SDK                                       | [03-SDK-CONFORMIDADE.md](./03-SDK-CONFORMIDADE.md)       |

---

## Distribuição por Módulo

| Módulo    | P0    | P1    | P2     | P3     | Total  |
| --------- | ----- | ----- | ------ | ------ | ------ |
| core      | 1     | 0     | 1      | 0      | 2      |
| infra     | 1     | 0     | 0      | 2      | 3      |
| server    | 0     | 2     | 0      | 1      | 3      |
| channel   | 0     | 1+1   | 2      | 0      | 4      |
| agent     | 0     | 1     | 3      | 0      | 4      |
| hooks     | 0     | 0     | 2      | 4      | 6      |
| terminal  | 0     | 0     | 3      | 3      | 6      |
| hub       | 0     | 0     | 2      | 1      | 3      |
| sdk       | 0     | 1     | 0      | 1      | 2      |
| **Total** | **2** | **5** | **13** | **12** | **32** |

---

_Próximo: [11-ROADMAP-FIXES.md](./11-ROADMAP-FIXES.md)_
