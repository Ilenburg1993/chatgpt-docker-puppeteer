# Audit: src/copilot/tools/todo/crud-tools.js

**Módulo**: `copilot/tools/todo` **Arquivo**: `src/copilot/tools/todo/crud-tools.js` **LOC**: 459
**Data**: 2026-06-10 **Auditor**: copilot-full-audit MF-II F07

---

## Resumo

Implementa as 6 operações CRUD do sistema de tarefas: `todo_create`, `todo_get`, `todo_update`,
`todo_set_status`, `todo_delete` e `todo_add_subtask`. Todas usam o padrão `withStore()` (mutex
serial via `store.js`). `todoGetTool` é marcado com `withSkipPermission()`. O estado geral é sólido.

**Score**: 8.0/10

---

## Achados

### P4 — todoGetTool: Subtarefas Apenas 1 Nível Profundo

**Localização**: `todoGetTool`, bloco de coleta de subtarefas.

```js
const subtasks = (task.subtaskIds ?? []).map((sid) => store.tasks[sid]).filter(Boolean);
```

Expande subtarefas a exatamente 1 nível (filhos diretos). Árvores de 3+ níveis são invisíveis ao
chamador.

**Impacto**: Baixo; documentado no manual. Mas pode confundir callers que esperam árvore completa.

**Recomendação**: Adicionar parâmetro `depth` ou documentar claramente o limite de 1 nível no
description.

---

### P4 — todo_update: Semântica de due_date = null

**Localização**: `todoUpdateTool`, bloco de `due_date`.

```js
if ('due_date' in args) task.dueDate = args.due_date;
```

Quando `args.due_date === null`, `task.dueDate` é definido como `null`. Com
`exactOptionalPropertyTypes: true` no tsconfig, `null` e `undefined` têm semântica diferente no tipo
`TodoItem`. O typedef define `dueDate: string | null` — null é intencional; mas a verificação
`'due_date' in args` permite passar explicitamente `null` para limpar a data.

**Impacto**: Muito baixo (comportamento aceitável, mas declarar intenção ajuda).

**Recomendação**: Comentar que `due_date: null` é intencionalmente suportado para limpar a data.

---

### P5 — todo_delete BFS: Tipo de retorno de queue.shift()

**Localização**: `todoDeleteTool`, bloco BFS cascade.

```js
const childId = queue.shift(); // string | undefined
if (!childId) continue;
```

TypeScript inferirá `string | undefined` para `queue.shift()`. A guarda `if (!childId) continue`
funciona corretamente, mas introduz caminho de string vazia que seria acidentalmente ignorado. A
correção mais robusta seria `if (childId == null) continue`.

**Impacto**: Negligível; funciona corretamente na prática.

---

## Positivos

- `withStore()` usado em todas as operações de escrita — serialização correta
- `VALID_TRANSITIONS` state machine com suporte a `force` override bem documentado
- `todo_delete` com `cascade: true` usa BFS — correto para árvores arbitrárias
- Tags em `todo_update` suportam `replace`, `add` e `remove` explicitamente
- `completedAt` e `completedBy` corretamente zerados quando status sai de `done`
