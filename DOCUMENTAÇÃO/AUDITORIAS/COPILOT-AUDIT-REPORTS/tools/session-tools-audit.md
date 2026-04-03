# Audit: src/copilot/tools/session-tools.js

**Módulo**: `copilot/tools` **Arquivo**: `src/copilot/tools/session-tools.js` **LOC**: 196 **Data**:
2026-06-10 **Auditor**: copilot-full-audit MF-II F07

---

## Resumo

Fornece 5 tools de sessão: `read_briefing`, `write_pending_task`, `get_workspace_info`,
`set_session_context` e `invoke_skill`. `SESSION_CONTEXT_STORE` é um Map ephemeral (perdido em
restart). `get_workspace_info` usa `execSync` três vezes. `invoke_skill` lê arquivos de skill do
filesystem.

**Score**: 7.0/10

---

## Achados

### P3 — get_workspace_info Usa execSync (3 Chamadas) — Bloqueia Event Loop

**Localização**: `getWorkspaceInfoTool`, handler.

```js
const head = execSync('git rev-parse HEAD', { cwd: ROOT_DIR, encoding: 'utf8', timeout: 3000 }).trim();
const branch = execSync('git rev-parse --abbrev-ref HEAD', { ... }).trim();
const remoteUrl = execSync('git remote get-url origin', { ... }).trim();
```

Três chamadas síncronas consecutivas bloqueiam o event loop por até 3s × 3 cada. Para um servidor
com múltiplos requests concorrentes, isso introduz latência perceptível.

**Recomendação**: Migrar para `execFileAsync` (já disponível em `shell/index.js` — poderia ser
movido para lib compartilhada).

---

### P4 — SESSION_CONTEXT_STORE: Sem Limite de Tamanho

**Localização**: Definição do Map.

```js
const SESSION_CONTEXT_STORE = new Map();
```

`set_session_context` faz `SESSION_CONTEXT_STORE.set(key, String(value))`. Sem eviction policy.
Crescimento ilimitado ao longo de uma session longa com muitas chamadas `set_session_context`.

**Impacto**: Baixo; em prática o número de chaves é pequeno.

**Recomendação**: Limitar a N=50 entradas com aviso ao ultrapassar.

---

### P4 — set_session_context: Armazena Como String Mas Map Tipado Como unknown

**Localização**: `setSessionContextTool`, handler.

```js
SESSION_CONTEXT_STORE.set(key, String(value));
```

`String(value)` converte qualquer input para string. O tipo do Map `Map<string, unknown>` sugere que
poderia armazenar não-strings, mas o handler sempre coverte. Inconsistência entre tipo declarado e
uso real.

---

## Positivos

- `invoke_skill`: valida `skillName` com regex `[^a-zA-Z0-9_-]` — previne path traversal ao montar o
  path da skill
- `read_briefing`: retorna mensagem estruturada quando `session-briefing.md` não existe (sessão
  nova)
- `write_pending_task` com `appendToFile: true` — idempotente para tasks que já foram registradas
- `SESSION_CONTEXT_STORE` documentado como ephemeral (perdido em restart) — expectativas corretas
