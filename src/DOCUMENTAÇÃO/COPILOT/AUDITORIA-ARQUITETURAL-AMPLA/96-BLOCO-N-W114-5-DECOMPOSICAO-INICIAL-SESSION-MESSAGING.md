# 96 — Bloco N / W114.5: decomposição inicial de `sdk/session-messaging`

**Data:** 2026-05-01 **Escopo:** `src/copilot/server/routes/sdk/session-messaging.js` **Status:**
checkpoint executável consolidado

---

## 1) Problema validado

`server/routes/sdk/session-messaging.js` era o maior hotspot da SDK API: 834 linhas combinando
registro de rotas, payload metadata, lookup de sessão ativa, envio sem timeout, SSE stream state,
workspace validation, UI, permissions/tools, compaction e shell.

O arquivo ainda é o router público das rotas de sessão, mas já concentrava detalhes auxiliares que
podem ser isolados sem alterar endpoints.

---

## 2) Transformação aplicada

Foram extraídos quatro seams locais:

1. `session-route-helpers.js` — `withRuntimeMeta`, `withSessionRuntimeMeta` e
   `getActiveSessionEntryOrReply`.
2. `session-send-helpers.js` — `MAX_PROMPT_BYTES` e `sendAndWaitWithoutTimeout`.
3. `session-stream-state.js` — tracker SSE, pool/replay state e disposal de stream.
4. `session-workspace-helpers.js` — validação do caminho virtual de workspace SDK.

Com isso, `session-messaging.js` caiu de 834 para cerca de 635 linhas e passou a ser mais claramente
um router/coordenador.

Em seguida, o corte de famílias foi aplicado:

5. `session-core-routes.js` — send, stream, model, log, abort e messages.
6. `session-workspace-routes.js` — list/read/write do workspace virtual.
7. `session-ui-routes.js` — capabilities, elicitation, confirm, select e input.
8. `session-rpc-routes.js` — permissions, tools, commands, compaction e shell.

Após esse corte, `session-messaging.js` ficou com cerca de 23 linhas e passou a ser apenas o
composition router público da superfície histórica.

---

## 3) Contratos atualizados

- `server/routes/module-map.js` declara os novos seams com papéis `sdk-session-helper`,
  `sdk-session-stream` e `sdk-session-route-family`;
- `test_server_route_inventory.spec.js` cobre os novos arquivos no inventário histórico;
- `test_module_layout_governance.spec.js` valida os novos papéis e mantém a marcação de
  `session-core-routes.js` como `watch` e retira `session-messaging.js` do conjunto de hotspots.

---

## 4) Próxima etapa

Próximo alvo recomendado:

1. separar `session-crud.js` por inventory/foreground, create/resume e destructive operations;
2. manter `session-core-routes.js` sob watch para eventual corte `send-routes` e `stream-routes`;
3. aplicar a mesma regra física nos hotspots `sdk/observability.js`, `sdk/client.js` e
   `sdk/agent.js`.
