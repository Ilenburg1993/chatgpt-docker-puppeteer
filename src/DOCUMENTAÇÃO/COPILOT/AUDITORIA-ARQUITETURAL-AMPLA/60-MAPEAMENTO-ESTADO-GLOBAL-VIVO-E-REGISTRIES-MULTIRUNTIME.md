# 60 — Mapeamento de estado global vivo e registries multi-runtime

**Data:** 2026-04-30 **Escopo:** `src/copilot/**` com foco em `Map`/`Set` module-level e Gate 2.0-D.

---

## 1. Objetivo

Este documento existe para transformar a preocupação difusa com “estado global implícito” em
inventário explícito.

A regra-alvo da Arquitetura 2.0 é:

> estado vivo de runtime não pode permanecer espalhado, anônimo e process-wide quando já houver
> papel claro de registry, estado SSE, terminal-local ou cache técnico.

---

## 2. Situação desta rodada

Foi aplicada uma convergência concreta no eixo de rotas multi-runtime:

- `server/routes/copilot-api/dialog.js`
- `server/routes/copilot-api/stream.js`
- `server/routes/sdk/agent.js`
- `server/routes/sdk/hooks.js`
- `server/routes/sdk/session-messaging.js`

Essas rotas deixaram de declarar `Map` local de estado vivo e passaram a consumir registries
explícitos em:

- `src/copilot/server/runtime-state/copilot-api-dialog.js`
- `src/copilot/server/runtime-state/copilot-api-stream.js`
- `src/copilot/server/runtime-state/sdk-agent-stream.js`
- `src/copilot/server/runtime-state/sdk-hooks-stream.js`
- `src/copilot/server/runtime-state/sdk-session-stream.js`

Leitura arquitetural:

- a rota continua owner da **política**;
- o registry passa a ser owner do **estado vivo** process-wide associado àquela política.

---

## 3. Classificação canônica dos `Map`/`Set` module-level

A varredura factual desta rodada encontrou quatro grandes famílias.

### 3.1 Constantes/índices semânticos estáticos

Esses `Set`/`Map` não representam estado vivo mutável de runtime; funcionam como tabelas de decisão
ou catálogos.

- `boot/surface-validation.js` — `DOCUMENTAL_PHASES_WITHOUT_HANDLER`
- `core/error-handlers.js` — `FATAL_CODES`, `TRANSIENT_CODES`, `TRANSIENT_HTTP_CODES`
- `core/security/url-validator.js` — `BLOCKED_SCHEMES`
- `config/custom-agents.js` — `BUILTIN_AGENTS`, `DISABLED_AGENTS`
- `terminal/terminal-agent-wiring.js` — `AUTO_RESTART_DIALOG_STOP_REASONS`
- `terminal/repl.js` — `_cmdRouteMap`
- `sdk/session/events.js` — `EVENT_TYPE_SET`
- `sdk/session/client-events.js` — `LIFECYCLE_TYPE_SET`
- `conversation-hub/access.js` — `ADMIN_ROLE_NAMES`, `ADMIN_SCOPE_NAMES`, `SYSTEM_MANAGED_SOURCES`
- `hooks/presets/production.js` — `SENSITIVE_TOOL_NAMES`
- `tools/introspection-tools.js` — `PROTECTED_TOOLS`
- `presentation/runtime-ui-state-store.js` — `VALID_TRANSITIONS`
- `presentation/agent-control.js` — `ALLOWED_FROM`

**Classificação:** permitidos como catálogos/tabelas estáticas.

---

### 3.2 Registries explícitos de runtime/infra legítimos

Esses mapas/setes mantêm estado mutável, mas com papel claro, nomeado e previsível.

- `agent/runtime-registry.js` — `_runtimeRegistry`
- `boot/lifecycle-runner.js` — `bootPhaseMetrics`
- `core/shutdown.js` — `shutdownHandlerMetrics`
- `core/timer-registry.js` — `timers`
- `events/schemas/registry.js` — `_schemas`
- `server/runtime-state/*` — registries explícitos de SSE/concorrência por runtime
- `infra/sse/state.js` — `_serverSseClients`, `_serverSseCriticalClients`
- `server/routes/sdk/session-middleware.js` — `_rlWindowMap`
- `server/routes/sdk/middleware.js` — `ERROR_STATUS_MAP`

**Classificação:** legítimos, desde que continuem documentados e protegidos por contrato.

---

### 3.3 Estado local de UX/edge/cache defensivo

Aqui o estado é mutável e process-wide, mas sua missão é restrita a UX local, replay buffer lógico,
cache ou rastreamento operacional de borda.

- `terminal/sdk-interactions.js` — `_elicitations` (terminal-local)
- `sdk/tools/custom.js` — `_registry` (registry técnico de custom tools)
- `tools/session-tools.js` — `SESSION_CONTEXT_STORE` (store técnico por sessão/tool)
- `tools/introspection-tools.js` — `_disabledTools` (admin/runtime-local)
- `tools/web-tools.js` — `RATE_WINDOW` (rate limit local)
- `tools/hook-tools.js` — `_pendingInputResolvers` (coordenação temporária)
- `observability/event-catalog.js` — `_deadLetters` (fila técnica de DLQ)
- `observability/event-collector.js` — `_compactionHistory` (histórico operacional)
- `observability/tool-stats.js` — `_stats` (registry técnico de métricas)
- `presentation/files/context.js` — `_fileCache` (cache defensivo)

**Classificação:** aceitáveis por ora, mas precisam continuar claramente marcados como
terminal-local / cache / registry técnico e não como domínio implícito.

---

### 3.4 Pontos que exigem monitoramento contínuo

Estes não são necessariamente bugs, mas merecem revisão recorrente para evitar drift de ownership.

- `server/routes/sdk/session-middleware.js` — `_rlWindowMap`
  - legítimo como rate limiting, mas precisa permanecer infra de borda.
- `tools/session-tools.js` — `SESSION_CONTEXT_STORE`
  - precisa seguir técnico; não pode virar owner semântico de sessão viva.
- `presentation/files/context.js` — `_fileCache`
  - precisa continuar cache defensivo e não store canônica de contexto.
- `sdk/tools/custom.js` — `_registry`
  - legítimo como registry técnico; não deve crescer para composition root informal.

---

## 4. Transformação aplicada nesta onda

### Antes

As rotas mais críticas de multi-runtime carregavam `Map` local próprio dentro do módulo da rota:

- concorrência HTTP de dialog turn;
- pools/subscriptions SSE de `copilot-api/stream`;
- SSE de `sdk/agent`;
- SSE de `sdk/hooks`;
- SSE de `sdk/session`.

### Agora

Esse estado vivo foi promovido para `server/runtime-state/` como registries explícitos e nomeados.

### Efeito

- o Gate 2.0-D fica mais auditável;
- a política continua perto da rota;
- o estado process-wide fica rastreável por categoria e arquivo dono.

---

## 5. Contratos executáveis adicionados/fortalecidos

Esta rodada passa a contar com:

- `tests/unit/copilot/contracts/test_runtime_state_governance.spec.js`
- `tests/unit/copilot/contracts/test_runtime_state_registry_inventory.spec.js`
- `tests/unit/copilot/contracts/test_server_route_inventory.spec.js`

Cobertura nova:

- rotas críticas não podem voltar a declarar `Map` local para estado multi-runtime;
- cada rota crítica deve importar seu registry explícito correspondente;
- `server/runtime-state/` deve permanecer inventariado e finito;
- rotas `presentationBridge` devem continuar bridges finas, sem reabrir domínio/runtime local.

---

## 6. Leitura arquitetural consolidada

A evolução correta não é “eliminar todo `Map` module-level`”, e sim:

1. classificar cada um;
2. mover os sensíveis para registries explícitos quando forem estado vivo de runtime;
3. manter caches/índices estáticos/UX local sob ownership claro;
4. impedir que rotas e bordas virem pseudo-stores implícitos.

Em uma frase:

> a Arquitetura 2.0 não exige ausência total de estado module-level; exige que todo estado
> module-level tenha owner, categoria e contrato explícitos.

---

## 7. Próximo passo recomendado

Com esta rodada, o próximo alvo de maior valor é:

1. reduzir imports cruzados remanescentes entre facades (Faixa E);
2. fechar metadata/runtime handling residual em adapters SDK específicos (Faixa F/G);
3. manter o inventário de globals vivo conforme novas ondas alterem bordas, caches e registries.
