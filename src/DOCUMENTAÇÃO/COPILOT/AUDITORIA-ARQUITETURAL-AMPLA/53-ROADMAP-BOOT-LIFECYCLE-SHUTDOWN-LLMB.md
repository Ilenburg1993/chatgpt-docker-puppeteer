# 53 — Roadmap: boot/lifecycle/shutdown `terminal:llm-b`

**Data:** 2026-04-29  
**Base:** auditoria `52-AUDITORIA-BOOT-LIFECYCLE-SHUTDOWN-LLMB.md`.

---

## Objetivo

Transformar o ciclo `terminal:llm-b` em um runtime lifecycle explícito, auditável, testável e
resistente a falhas parciais, preservando o modo canônico único da LLM-B.

---

## Faixa A — Shutdown single-flight e falha fatal de boot

**Status em 2026-04-29:** implementada nesta rodada.

### A1 — `runShutdown()` single-flight

- [x] Guardar a promise do shutdown em andamento.
- [x] Chamadas concorrentes devem retornar a mesma promise.
- [x] Segundo sinal deve aguardar o cleanup já iniciado.
- [x] Preservar idempotência após conclusão.

### A2 — Cleanup em boot failure

- [x] `terminal/bootstrap.js` chama `runShutdown('boot_failure')` antes de `process.exit(1)`.
- [x] Erro de shutdown no catch fatal é logado sem mascarar a falha original.

### A3 — Testes

- [x] concorrência de `runShutdown()`;
- [x] segundo sinal não encerra prematuramente;
- [x] boot failure chama shutdown central.

---

## Faixa B — Contrato explícito de prioridades de shutdown

**Status em 2026-04-29:** implementação parcial iniciada.

### B1 — Constantes de fase

Criar um módulo canônico com fases:

- [x] `runtime-critical` — agent/session/client;
- [x] `timers` — timers globais que não devem disparar durante cleanup;
- [x] `terminal-resources` — REPL, pinned loader, activity emitter;
- [x] `network` — HTTP/Socket.IO;
- [x] `observability` — bus, trackers, collectors;
- [x] `audit-finalizers` — flush de logs e auditoria.

### B2 — Migração de handlers

- [x] substituir números mágicos por constantes nos handlers principais de `src/copilot`;
- [ ] revisar `timers.cancelAll` versus `agent.stop`;
- [x] declarar a ordem em README local.

### B3 — Testes

- snapshot da ordem de handlers por nome/fase;
- regressão contra prioridade duplicada acidental em recursos críticos.

---

## Faixa C — Ownership único de recursos

**Status em 2026-04-29:** implementação parcial aplicada para HTTP server.

### C1 — HTTP server

- [x] decidir se o owner é `server/index.js` ou `terminal/index.js`;
- [x] remover duplicidade de shutdown entre `server/index.js` e `terminal/index.js`;
- [x] manter `close()` com semântica idempotente;
- [x] tolerar `ERR_SERVER_NOT_RUNNING` no close do server.

### C2 — Timers

- garantir que reflection/todo cleanup/metrics/keepalive/quota tenham owner e registro únicos;
- criar snapshot de timers ativos para diagnóstico.

### C3 — Event listeners

- centralizar listener registration/removal de `SIGHUP`, terminal activity e pinned files.

---

## Faixa D — Boot pipeline executável

**Status em 2026-04-29:** runner executável inicial aplicado e integrado ao `bootCopilot()`.

### D1 — Boot phase runner

- [x] `createCopilotBootPlan()` declara `timeoutMs` e owner por fase;
- [x] `runCopilotBootPlan()` executa handlers por fase;
- [x] resultado: `BootLifecycleReport`;
- [x] decompor `terminal-host` em fases reais: init, aliases, runtime config, pinned context, hub,
      HTTP server, listeners e REPL.

### D2 — Rollback parcial

- [x] fases que alocam recurso podem registrar rollback;
- [x] falha em fase N executa rollbacks N..0;
- [x] recursos do terminal permanecem registrados no shutdown central após as subfases;
- [ ] adicionar rollback direto de subfase para falhas antes do shutdown central.

### D3 — Exposição

- [x] último boot report disponível via `presentation/runtime-lifecycle.js`;
- [x] `/health` inclui snapshot de lifecycle;
- [x] `/diagnose` renderiza boot/shutdown report de modo amigável;
- [ ] `/status` deve renderizar o boot report de modo amigável.

---

## Faixa E — Agent start rollback

**Status em 2026-04-29:** primeira implementação aplicada.

### E1 — Escopo transacional do start

- [x] se `agentStart()` cria client e falha antes do `ready`, executar cleanup best-effort;
- [x] se cria session e falha no wiring, desconectar session e parar client;
- [x] instalar handles parciais de `performBootWiring()` antes de propagar erro, permitindo
      rollback.

### E2 — Relatório de start parcial

- [x] preservar erro original;
- [x] registrar erros de cleanup sem mascarar erro original;
- [x] registrar fase exata em que falhou como `AgentStartReport`;
- [x] expor `startReport` no health snapshot do agent.

### E3 — Testes

- falha em `initSession`;
- falha em `performBootWiring`;
- falha em cleanup não mascara erro original.

---

## Faixa F — Observabilidade de lifecycle

**Status em 2026-04-29:** primeira implementação aplicada no shutdown core.

### F1 — Shutdown report

- [x] cada handler gera `{ name, priority, status, durationMs, error? }`;
- [x] expor último shutdown report em memória via `getLastShutdownReport()`;
- [x] expor handlers registrados via `listShutdownHandlers()`.

### F2 — Eventos e métricas

- [x] emitir `runtime.shutdown.started/completed/handler_failed`;
- [x] emitir `runtime.boot.started/completed/failed`;
- [x] emitir `runtime.boot.phase_started/phase_completed/phase_failed`;
- [ ] conectar métricas agregadas por fase/handler em dashboard.

### F3 — Diagnóstico UX

- [x] `/diagnose` deve listar último boot e shutdown;
- [x] `/health` deve indicar shutdown em andamento.

---

## Faixa G — Signal matrix e modos TTY/headless/PM2

### G1 — TTY

- documentar que Ctrl+C no REPL não encerra o runtime;
- `/quit` é shutdown explícito.

### G2 — Headless

- `SIGINT` e `SIGTERM` executam shutdown central.

### G3 — PM2

- alinhar `kill_timeout` com timeouts de handlers;
- considerar suporte a mensagem PM2 `shutdown` se necessário.

---

## Faixa H — Consolidação documental e governança

### H1 — README local de lifecycle

- [x] criar ou atualizar `src/copilot/boot/README.md`, `src/copilot/terminal/README.md` e
      `src/copilot/core/README.md`.

### H2 — Índice da auditoria

- referenciar documentos 52/53 no README da pasta de auditoria.

### H3 — Checklist permanente

- checklist de novos handlers de shutdown;
- checklist de novas fases de boot;
- checklist de novos timers/listeners.

---

## Ordem recomendada de ataque

1. A1 + A2 + A3.
2. B1 + B2 parcial.
3. C1 HTTP server ownership.
4. E1 rollback parcial do agent start.
5. F1 shutdown report.
6. D1 boot phase runner.
7. G signal matrix.
8. H governança documental.

---

## Critério de conclusão do roadmap

- `typecheck:strict:src.copilot` verde.
- `eslint src/copilot --max-warnings=0` verde.
- `analyze:arch:global:strict` com `hard=0 soft=0`.
- testes unitários de Copilot verdes.
- testes novos cobrindo shutdown concorrente e boot failure cleanup.
- documentação 52/53 atualizada com status final.
