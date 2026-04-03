# Audit: src/copilot/tools/todo/query-tools.js

**Módulo**: `copilot/tools/todo` **Arquivo**: `src/copilot/tools/todo/query-tools.js` **LOC**: 323
**Data**: 2026-06-10 **Auditor**: copilot-full-audit MF-II F07

---

## Resumo

Fornece 3 tools de consulta: `todo_list`, `todo_search` e `todo_stats`. Todas são read-only e
marcadas com `withSkipPermission()`. Usa `readStore()` (sem mutex — correto para leitura). Ordenação
por overdue → priority → data. `todo_search` implementa AND implícito entre termos.

**Score**: 8.5/10

---

## Achados

### P4 — todo_list: Ordenação Completa Antes de Paginação

**Localização**: `todoListTool`, handler, bloco de sort + slice.

```js
filtered.sort(…);  // sort completo
const total = filtered.length;
filtered = filtered.slice(0, limit);
```

O sort é aplicado ao conjunto completo de tarefas filtradas antes de aplicar o `limit`. Para stores
com centenas de tarefas, isso é desnecessariamente caro se apenas os primeiros 10 resultados são
necessários.

**Impacto**: Baixo; `MAX_LIST = 200` é o teto natural.

---

### P5 — todo_search: Semântica de AND Implícito Não Documentada no Description

**Localização**: `todoSearchTool`, description.

A description diz: "Múltiplos termos separados por espaço (AND implícito)" — está documentado
corretamente. Não há achado aqui.

---

### P4 — todo_stats: check `args.include_recent !== false` Redundante com Default

**Localização**: `todoStatsTool`, handler.

```js
if (args.include_recent !== false) { ... }
```

O schema Zod define `.default(true)`. Com `exactOptionalPropertyTypes`, o valor nunca será
`undefined` ou `false` a menos que explicitamente passado. A verificação `!== false` é correta mas
levemente inconsistente com a verificação natural `if (args.include_recent)`.

**Impacto**: Zero.

---

## Positivos

- `readStore()` sem mutex é semanticamente correto para operações read-only
- `isOverdue()` importado e aplicado uniformemente
- `todo_stats` inclui `completion_rate`, `top_tags` e `by_status`/`by_priority` — útil para
  dashboards
- Ordenação consistente em todas as 3 tools
- `todoStatsTool` retorna early com estrutura zerada quando `total === 0`
- `todo_search` pondera por número de campos com match (`score`) — relevância real
