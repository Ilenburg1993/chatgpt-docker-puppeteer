# 96 — Bloco N / W114.5: decomposição inicial de `sdk/session-messaging`

**Data:** 2026-05-01 **Escopo:** `src/copilot/server/routes/sdk/session-messaging.js` **Status:**
checkpoint executável inicial

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

---

## 3) Contratos atualizados

- `server/routes/module-map.js` declara os novos seams com papéis `sdk-session-helper` e
  `sdk-session-stream`;
- `test_server_route_inventory.spec.js` cobre os novos arquivos no inventário histórico;
- `test_module_layout_governance.spec.js` valida os novos papéis e mantém a marcação de
  `session-messaging.js` como hotspot até que as rotas sejam separadas por família.

---

## 4) Próxima etapa

Extrair registro de rotas por família, preservando o router público:

1. `session-messaging/send-routes.js`;
2. `session-messaging/stream-routes.js`;
3. `session-messaging/workspace-routes.js`;
4. `session-messaging/ui-routes.js`;
5. `session-messaging/permission-tool-routes.js`;
6. `session-messaging/compaction-shell-routes.js`.

Critério: nenhum endpoint público deve mudar; `session-messaging.js` deve virar composition router
de famílias.
