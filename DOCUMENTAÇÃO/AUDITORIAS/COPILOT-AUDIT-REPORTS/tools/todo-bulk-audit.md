# Audit: src/copilot/tools/todo/bulk-tools.js

**Módulo**: `copilot/tools/todo` **Arquivo**: `src/copilot/tools/todo/bulk-tools.js` **LOC**: 267
**Data**: 2026-06-10 **Auditor**: copilot-full-audit MF-II F07

---

## Resumo

Fornece 3 tools de operação bulk: `todo_bulk_update` (até 100 IDs), `todo_clear_completed`
(dry_run + real) e `todo_import` (até 50 tasks). `todo_bulk_update` ignora explicitamente o state
machine de transições. `todo_clear_completed` usa `readStore()` no dry_run e `withStore()` na
operação real — padrão correto.

**Score**: 8.2/10

---

## Achados

### P4 — todo_bulk_update: Bypassa VALID_TRANSITIONS por Design

**Localização**: `todoBulkUpdateTool`, handler.

```js
// Nota: máquina de estados ignorada em bulk para permitir operações em lote eficientes.
// Use todo_set_status para operações individuais com validação de estado.
```

O bypass é intencional e documentado, mas permite transições inválidas (ex: `done → in_progress`) em
lote. Callers devem entender que bulk ignora o state machine.

**Impacto**: Baixo; riscos de inconsistência de estado são responsabilidade do chamador.

**Recomendação**: Considerar adicionar parâmetro `force: boolean` para ser explícito sobre o bypass,
ao invés de ser o comportamento padrão.

---

### P4 — todo_bulk_update: add_tags Não Remove Tags Existentes Sem `remove_tags`

**Localização**: `todoBulkUpdateTool`, bloco `add_tags`.

```js
const newTags = new Set([...(task.tags || []), ...updates.add_tags]);
task.tags = [...newTags];
```

A deduplicação via Set é correta. Mas se o caller quiser substituir tags completamente, precisa
combinar `remove_tags` + `add_tags`. Não há campo `set_tags` para substituição atômica.

**Impacto**: Baixo; o design é intencional (additive).

---

### P5 — todo_import: Sem Suporte a parentId

**Localização**: `todoImportTool`, handler.

```js
const task = createTask({
  title,
  description,
  status,
  priority,
  dueDate,
  tags,
  notes,
});
```

`parentId` não está no schema de import nem no `createTask()` call. Hierarquias (subtasks) não podem
ser importadas.

**Impacto**: Baixo; `todoImportTool` é para importação flat. Feature gap documentável.

---

## Positivos

- `todo_clear_completed` tem `dry_run` com contagem exata antes de executar
- Limite de 100 IDs em `todo_bulk_update` previne abuso
- Limite de 50 tasks em `todo_import` previne imports excessivos
- `generateUniqueId()` usado no import — sem colisão de IDs
- `withStore()` em todas as operações destrutivas — mutex garantido
