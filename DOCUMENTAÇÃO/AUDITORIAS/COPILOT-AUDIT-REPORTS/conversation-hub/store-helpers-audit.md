# Auditoria — `store-helpers.js`

**Módulo**: `src/copilot/conversation-hub/store-helpers.js` **LOC**: 162 **Data**: 2026-06-10
**Auditor**: Copilot Full-Audit MF-II

---

## 1. Propósito

Tipedefs, helpers FTS5 e funções de inicialização usados pelo `ConversationStore`. Extraído de
`store.js` para manter responsabilidades claras. Exporta: `initTurnsFts`, `migrateFts5Tokenizer`,
`sanitizeFtsQuery`, e as typedefs canônicas do módulo.

---

## 2. Destaques

| Função                     | Responsabilidade                                                                |
| -------------------------- | ------------------------------------------------------------------------------- |
| `initTurnsFts(db)`         | Popula `copilot_turns_fts` a partir de dados existentes (migration UPG-PROP-06) |
| `migrateFts5Tokenizer(db)` | Migra `copilot_memories_fts` para tokenizer `porter unicode61` (PERF-03)        |
| `sanitizeFtsQuery(raw)`    | Sanitiza query FTS5 removendo metacaracteres e operadores reservados            |

---

## 3. Achados

### FINDING-P5-1 — `sanitizeFtsQuery` usa phrase-search (`"..."`) — reduz o recall em buscas multi-palavra

**Severidade**: P5 — Baixo **Localização**: `sanitizeFtsQuery()` linhas ~150-160

```js
return `"${sanitized}"`; // → FTS5 phrase match
```

`sanitizeFtsQuery('auth error 500')` → `'"auth error 500"'` — busca phrase exata. O usuário que
digita `auth error` esperaria resultados que contêm ambas as palavras (OR implícito de tokens), não
necessariamente a frase exata. A abordagem atual reduz recall.

**Proposta alternativa** (busca tokenizada, ainda sanitizada):

```js
const tokens = sanitized
  .split(/\s+/)
  .filter(Boolean)
  .map((t) => `"${t}"`);
return tokens.join(' '); // → FTS5: "auth" "error" "500" (AND implícito)
```

---

### FINDING-P5-2 — `migrateFts5Tokenizer` retorna silenciosamente se config não existe

**Severidade**: P5 — Cosmético **Localização**: `migrateFts5Tokenizer()` linhas ~115-125

```js
const row = db.prepare("SELECT v FROM copilot_memories_fts_config WHERE k='tokenize'").get();
if (!row || row.v === TARGET_TOKENIZER) return; // silently returns on missing config too
```

Se a table `copilot_memories_fts_config` não existir (ex: banco recém-criado sem FTS), a query lança
erro e o `try-catch` externo silencia). Se existir mas `k='tokenize'` não tiver linha, `!row`
retorna sem migrar — o tokenizer padrão permanece. Correto mas opaco.

---

## 4. Pontos Positivos

- `sanitizeFtsQuery` previne FTS5 injection — remove `*`, `^`, `"`, `()`, `:|&!,-`, e operadores
  reservados AND/OR/NOT/NEAR.
- `initTurnsFts` é idempotente: só popula se FTS vazio mas turns existem
  (`count == 0 && turns > 0`).
- `migrateFts5Tokenizer`: recria a tabela completa com dados migrados — correto para FTS5 que não
  suporta ALTER TABLE.
- Typedefs bem documentadas com JSDoc — `TurnRole`, `HubSession`, `ConversationTurn`,
  `WriteTurnOpts`, `ReadTurnsOpts`, `SearchTurnsOpts`.

---

## 5. Score

| Dimensão        | Nota       |
| --------------- | ---------- |
| Segurança FTS   | 9/10       |
| Recall de busca | 7.5/10     |
| **Global**      | **8.5/10** |

---

_Arquivo gerado automaticamente pelo COPILOT-FULL-AUDIT MF-II._
