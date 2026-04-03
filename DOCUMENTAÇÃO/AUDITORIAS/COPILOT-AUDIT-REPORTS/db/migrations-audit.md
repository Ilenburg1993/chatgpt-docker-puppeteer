# db/migrations.js — Auditoria

**Módulo**: `src/copilot/db/` **Arquivo**: `migrations.js` **LOC**: 181 | **Score**: 9.2/10

## Responsabilidade

Migrations formais para `copilot.sqlite`. Define `COPILOT_MIGRATIONS` — array append-only de 6
migrations. Padrão idêntico ao `src/infra/db/migrations.js` mas de escopo exclusivo do copilot. Não
há dependências diretas de tabelas do domínio principal.

## Versões de Migration

| Version | Nome                        | Tipo | Descrição                                                           |
| ------- | --------------------------- | ---- | ------------------------------------------------------------------- |
| 1       | `create_hub_sessions`       | SQL  | Tabela `copilot_hub_sessions` + 2 índices                           |
| 2       | `create_conversation_turns` | SQL  | Tabela `copilot_conversation_turns` + 4 índices + constraint UNIQUE |
| 3       | `create_turns_fts5`         | SQL  | Virtual table FTS5 + 3 triggers (insert/update/delete)              |
| 4       | `create_memories`           | SQL  | Tabela `copilot_memories` + FTS5 + triggers                         |
| 5       | `create_todo_tasks`         | SQL  | Tabela `copilot_todo_tasks` (STRICT mode) + 4 colunas geradas       |
| 6       | `fix_llm_b_role_hyphen`     | SQL  | Bug fix: `llm-b` → `llm_b` em turns existentes                      |

## Achados

### P4 — Migration 3 (FTS5): trigger `turns_au` usa INSERT `'delete'` sem verificar existência prévia

**Localização**: `migrations.js:100-107`

**Descrição**: O trigger `turns_au` (AFTER UPDATE) executa:

```sql
INSERT INTO copilot_turns_fts(...) VALUES('delete', old.id, ...)   ← deleta o antigo
INSERT INTO copilot_turns_fts(...) VALUES (new.id, ...)             ← insere o novo
```

Este é o padrão FTS5 documentado para triggers de sincronização com `content=`. Está correto. No
entanto, se uma linha for inserida via `getCopilotDb()` com `:memory:` e depois o
`copilot_turns_fts` for populado manualmente fora dos triggers (ex: bulk reindex), pode haver
dessincronia. P4 porque o padrão FTS5 `content=` não tem mecanismo de reindex automático caso os
triggers falhem (ex: ROLLBACK de uma migration).

---

### P4 — Migration 5 (`create_todo_tasks`): colunas geradas `created_at`/`updated_at` como TEXT (não INTEGER)

**Localização**: `migrations.js:152-160`

**Descrição**: A tabela usa `STRICT` mode, e as colunas geradas extraem
`json_extract(data, '$.createdAt')` que são strings ISO 8601 (não timestamps Unix). Comparações de
intervalo (range queries) em TEXT com ISO 8601 funcionam corretamente se o formato for consistente
(`YYYY-MM-DDTHH:mm:ss.sssZ`). P4 porque qualquer drift no formato de `createdAt` (ex: `2026-1-5` vs
`2026-01-05`) silenciosamente quebra ordenação de índices. O campo do JSON que alimenta
`$.createdAt` (em `tools/todo/store.js`) deve gerar formato ISO canônico — sem validação na
migration.

---

### P4 — `fix_llm_b_role_hyphen` (v6): é uma mutation migration sem `DOWN` / reversibilidade

**Localização**: `migrations.js:171-176`

**Descrição**: A migration v6 executa `UPDATE ... SET role = 'llm_b' WHERE role = 'llm-b'` —
mutation de dados, não schema. Migrations de dados sem `down` criam problema se precisar fazer
rollback de schema: o dado não pode ser desfeito automaticamente. P4 (não P3) pois o padrão adotado
no projeto não usa `down` em nenhuma migration — é consistente com o padrão do codebase.

---

## Destaques Positivos

- Migration 2: constraint `UNIQUE (hub_session_id, turn_number)` previne duplicatas de turns mesmo
  em concorrência
- Migration 2: FK `REFERENCES copilot_hub_sessions(id) ON DELETE CASCADE` — limpeza automática ao
  deletar sessão
- Migration 3: FTS5 com `porter unicode61 remove_diacritics 1` — suporte a busca full-text em
  português sem acentos
- Migration 5: `STRICT` mode no SQLite — rejeita tipos incompatíveis em runtime
- Migration 5: colunas geradas como `STORED` — evita recomputação em cada query
- Migration 6: `BUG-CRIT-03` documentado inline — rastreabilidade do fix

---

_Gerado automaticamente pelo COPILOT-FULL-AUDIT MF-II._

---

## Status de Correção (2026-04-03)

### [FIXED] BUG: memories_ad trigger usava DELETE direto em vez de INSERT 'delete' FTS5

O trigger memories_ad foi corrigido de: DELETE FROM copilot_memories_fts WHERE id=old.id para o
padrão FTS5 content= correto: INSERT INTO copilot_memories_fts(copilot_memories_fts, rowid, id, tag,
content) VALUES('delete', old.rowid, old.id, old.tag, old.content) DELETE direto em tabela FTS5 com
content= não executa deleção do índice invertido — apenas o comando especial 'delete' via INSERT
garante sincronização correta.

**Pontuação atualizada: 9.5/10**

---

## Status de Correção adicional (2026-04-03)

### [ADDED] Migration v7 — sdk_turn_id column

Adicionado COPILOT_MIGRATIONS versão 7 'add_sdk_turn_id_column': ALTER TABLE ... ADD COLUMN
sdk_turn_id TEXT + UNIQUE INDEX (hub_session_id, sdk_turn_id) WHERE sdk_turn_id IS NOT NULL. Suporte
estrutural para dedup O(1) em syncFromSdkHistory (C11-03).
