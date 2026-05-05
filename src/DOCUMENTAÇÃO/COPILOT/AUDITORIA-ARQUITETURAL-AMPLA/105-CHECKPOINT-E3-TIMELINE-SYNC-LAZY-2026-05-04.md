# 105 — Checkpoint E3: timeline sync lazy 2026-05-04

**Data:** 2026-05-04  
**Escopo:** `src/copilot/terminal/frontend`, comandos do terminal e contratos unitários da timeline.

---

## 1) Decisão

A política final da E3 para a cauda viva da timeline é **lazy sync**.

O terminal continua exibindo imediatamente os turnos vivos do `llmBridgeClient.history`, mas quando
a projection canônica identifica `bridge_only` ou `bridge_tail`, ela agenda persistência no
Conversation Hub sem bloquear a UX. Isso fecha a decisão pendente entre persistência eager, lazy ou
sync lifecycle.

---

## 2) Implementação

- `terminal/frontend/projections/timeline.js` ganhou `TerminalTimelineSyncState`;
- `bridge_only` sincroniza a janela visível do bridge para o Hub;
- `bridge_tail` sincroniza apenas a cauda não persistida;
- o sync usa dedupe por assinatura de turno e cache de `scheduled/inflight/synced/failed`;
- o cache possui TTL de 10 minutos e limite de 500 entradas por classe, com expiração/eviction
  metrificadas;
- falhas transitórias são retentadas por turno e falhas de lote entram em backoff lifecycle antes de
  nova tentativa pela projection;
- turnos `user` vindos da bridge são gravados como `llm_a`, evitando criar falsa pendência de
  usuário no `conversationStore`;
- metadata persistida usa `source=terminal.timeline_sync`, `syncPolicy=lazy`, `originalOrigin`,
  `originalRole`, `originalTimestamp` e `signature`.

---

## 3) UX atualizada

As superfícies abaixo passaram a expor o estado do sync:

- `/status`;
- `/now`;
- `/history`;
- `/context`;
- `/export`;
- `/metrics`.

O operador agora vê se a timeline está `scheduled`, `inflight`, `synced`, `failed`, `not_needed`,
`unavailable` ou `disabled`.

---

## 4) Fechamento de resíduos

Resíduos associados à E3 foram fechados nesta sequência:

- métrica dedicada de volume/falha/retry/cache;
- retentativa para falhas transitórias do Hub;
- TTL e limite explícito para caches de dedupe em processo longo;
- projeção operacional do estado de sync em comandos humanos.

O passthrough SSE residual permanece fora do escopo da E3 e segue classificado na W125/W129.

---

## 5) Validação executada

```bash
npx vitest run tests/unit/copilot/test_terminal_runtime_frontend.spec.js tests/unit/copilot/terminal/test_commands_context.spec.js tests/unit/copilot/terminal/test_commands_session.spec.js tests/unit/copilot/terminal/test_commands_export.spec.js
npx eslint src/copilot/terminal/frontend/projections/timeline.js src/copilot/terminal/frontend/projections/status.js src/copilot/terminal/frontend/gateways/hub.js src/copilot/terminal/frontend/index.js src/copilot/terminal/commands/session.js src/copilot/terminal/commands/context.js src/copilot/terminal/commands/export.js tests/unit/copilot/test_terminal_runtime_frontend.spec.js tests/unit/copilot/terminal/test_commands_context.spec.js tests/unit/copilot/terminal/test_commands_export.spec.js
npm run typecheck:strict
```

Resultado: testes focais verdes, lint verde e typecheck estrito verde.
