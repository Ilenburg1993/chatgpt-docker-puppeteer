# Audit: src/copilot/tools/todo/store.js

**Módulo**: `copilot/tools/todo` **Arquivo**: `src/copilot/tools/todo/store.js` **LOC**: 352
**Data**: 2026-06-10 **Auditor**: copilot-full-audit MF-II F07

---

## Resumo

Camada de persistência + helpers do sistema de tarefas. Usa SQLite via `getCopilotDb()`. Implementa
mutex serial via Promise chain (`_storeMutex`) para serializar operações read-modify-write. Inclui
migração one-shot de JSON legado → SQLite. Schemas Zod reutilizáveis e helpers puros bem
documentados.

**Score**: 8.5/10

---

## Achados

### P4 — \_migrateJsonLegacy() Executa Síncrono no Load do Módulo

**Localização**: Bloco de inicialização após definição da função.

```js
// Executa migração legada na carga do módulo (síncrono, one-time).
try { _migrateJsonLegacy(); } catch (e) { ... }
```

`_migrateJsonLegacy()` é síncrona e executa no parse/import do módulo. Se o arquivo `todos.json`
legado for grande (muitas tarefas), bloqueia o event loop durante o startup.

**Impacto**: Baixo em operação normal (arquivo já migrado = `count > 0`, sai imediatamente). Apenas
no primeiro boot com dados legados existentes.

**Recomendação**: Considerar tornar a migração assíncrona e chamar em `bootstrapTools()` ou similar.

---

### P4 — \_writeStoreRaw: DELETE com JSON.stringify pode Falhar Silenciosamente

**Localização**: `_writeStoreRaw()`, preparação do DELETE.

```js
del.run(JSON.stringify(ids));
```

Se `Object.keys(store.tasks)` retornar array vazio (store vazio), `JSON.stringify([])` = `'[]'`. A
query `WHERE id NOT IN (SELECT value FROM json_each('[]'))` deveria deletar TODOS os registros —
comportamento correto para um store vazio, mas destrutivo se houve bug upstream que zeroul
`store.tasks`.

**Impacto**: Baixo se o mutex funcionar corretamente. Mas um bug em um callback `withStore()` que
retorne sem modificar tasks poderia apagar todos os dados.

---

### P4 — generateId() Usa Math.random() (Não Criptográfico)

**Localização**: `generateId()`.

```js
return Math.random().toString(36).slice(2, 10).padEnd(8, '0');
```

`Math.random()` não é CSPRNG. Para IDs de tarefas, a segurança não é crítica, mas o espaço de 8
chars base-36 (~1.7 trilhões de combinações) pode ter colisão em stores grandes (> milhares de
tasks).

**Impacto**: Negligível. `generateUniqueId()` re-tenta em colisão.

---

## Positivos

- Mutex serial com Promise chain — implementação correta sem depender de bibliotecas externas
- `_readStoreRaw()` trata linhas corrompidas individualmente (try/catch por row)
- `withStore()` tem documentação JSDoc clara sobre responsabilidades do callback
- `VALID_TRANSITIONS` exportado e compartilhado com crud-tools — fonte única de verdade
- `isOverdue()` verifica status antes de calcular — não marca tarefas concluídas como overdue
- Migração JSON→SQLite com `INSERT OR IGNORE` — idempotente
