# 90 — W87.2: Checkpoint — session snapshot-store seam

**Data:** 2026-04-30 **Status:** concluído e validado **Escopo:**
`src/copilot/agent/session/snapshot.js`

## Síntese

A W87.2 reduziu o acoplamento direto de `agent/session/snapshot.js` com filesystem, parsing JSON e
schemas de core.

O arquivo público `snapshot.js` agora fica focado em:

- criar o objeto semântico de snapshot a partir do estado vivo do agent;
- manter a API pública (`saveSnapshotAsync`, `loadSnapshotAsync`, `snapshotStore`);
- adaptar registros genéricos do `IStateStore`.

O novo `snapshot-store.js` assume:

- resolução do diretório físico de snapshots;
- leitura/escrita/prune em filesystem;
- parsing defensivo com `safeJsonParse`;
- validação com `SessionSnapshotDataSchema` e `SnapshotListItemSchema`.

## Métrica objetiva

- `snapshot.js`: 294 LOC antes da W87.2.
- `snapshot.js`: 180 LOC após a W87.2.
- `snapshot-store.js`: 187 LOC dedicadas ao IO/schema.

## Efeito no hotspot map

Antes da W87.2, `agent/session/snapshot.js` aparecia entre os hotspots com score 27, fanOut 6 e
cross 3.

Após a W87.2, o acoplamento operacional fica isolado em `snapshot-store.js` com score 23 e o arquivo
público deixa de aparecer entre os principais hotspots da lista.

## Contrato

`tests/unit/copilot/contracts/test_arch_contracts.spec.js` agora valida que:

- `snapshot.js` delega para `snapshot-store.js`;
- `snapshot.js` não importa `node:fs/promises`;
- `snapshot.js` não usa `safeJsonParse` nem schemas de snapshot inline.

## Validação

- `npm run typecheck:strict:src.copilot`
- `npx vitest run tests/unit/copilot/test_session_snapshot.spec.js tests/unit/copilot/test_snapshot.spec.js tests/unit/copilot/test_observability_f68_f70.spec.js tests/unit/copilot/test_agent_runtime_state.spec.js`
