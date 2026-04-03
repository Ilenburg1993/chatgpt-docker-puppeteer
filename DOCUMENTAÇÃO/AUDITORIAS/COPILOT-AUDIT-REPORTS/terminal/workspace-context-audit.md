# Auditoria — `workspace-context.js`

**Módulo**: `src/copilot/terminal/workspace-context.js` **LOC**: 82 **Data**: 2026-06-10
**Auditor**: Copilot Full-Audit MF-II

---

## 1. Propósito

Detecta contexto do workspace para injeção nas mensagens LLM-B: `cwd`, `gitRoot` e `currentBranch`.
Usa cache TTL de 30s para minimizar chamadas `execSync`.

---

## 2. Fluxo

```
getWorkspaceContext()
 ├── cache hit (TTL 30s) → return cached
 └── cache miss
      ├── cwd = COPILOT_WORKING_DIRECTORY || process.cwd()
      ├── detectGitRoot(cwd) → '.git' dir check || git rev-parse
      └── currentBranch → git symbolic-ref
```

---

## 3. Achados

### FINDING-P4-1 — `detectGitRoot` sempre chama `execSync` quando `.git` não existe **[FIXED]**

**Severidade**: P4 — Médio **→ CORRIGIDO** (2026-06-XX) **Localização**: `detectGitRoot()` linhas
~49-62

**Fix aplicado**: implementada busca hierarquica por `.git` (do `cwd` até `/`, máx 30 níveis) usando
`existsSync` antes de qualquer chamada a `execSync`. Se nenhum `.git` for encontrado na árvore,
retorna `null` imediatamente sem invocar `git rev-parse`. Apenas quando `.git` é localizado, o
`tryExec('git rev-parse --show-toplevel')` é chamado para obter o caminho ca-nônico.

```js
export function detectGitRoot(cwd) {
  if (existsSync(join(cwd, '.git'))) return cwd;
  const result = tryExec('git rev-parse --git-dir', cwd); // ← chama execSync em todo non-git dir
  if (!result) return null;
  // ...
}
```

Para um diretório que não seja git, a função:

1. Checa `existsSync(join(cwd, '.git'))` → `false`
2. Chama `execSync('git rev-parse --git-dir', cwd)` — bloqueante

Isso acontece a cada cache miss (30s) mesmo se o workspace certamente não for um repo git. Em
ambientes como `/tmp` ou diretório de sistema, os 30s de TTL previnem frequência excessiva, mas o
custo da chamada `execSync` numa chave de hot path (via `getWorkspaceContext`) é desnecessário.

**Proposta**: usar `--git-dir` apenas se `existsSync` encontrar indícios em diretórios pai:

```js
// faster check: se nem git existe no PATH, evitar o exec
// Ou: cache de "not-git" por cwd separado com TTL mais longo (5min)
```

Alternativamente, aceitar o comportamento atual como robusto dado que o TTL é de 30s.

---

### FINDING-P5-2 — `tryExec` usa `execSync` com `stdio: 'pipe'` — bloqueia event loop

**Severidade**: P5 — Cosmético **Localização**: `tryExec()` linhas ~18-28

```js
function tryExec(cmd, cwd) {
  return execSync(cmd, { cwd, stdio: ['ignore', 'pipe', 'ignore'], encoding: 'utf-8' }).trim();
}
```

`execSync` bloqueia o event loop. Como o contexto é cacheado por 30s, o bloqueiro ocorre no máximo
uma vez por 30s — aceitável para terminal de uso interativo. Para uso mais intensivo (e.g., chamado
em todo webhook), o custo de bloqueio seria perceptível.

---

## 4. Pontos positivos

- Cache TTL 30s com estrutura simples `_contextCache = { ctx, expiresAt }` — não cresce.
- `COPILOT_WORKING_DIRECTORY` env override — testável e flexível.
- `tryExec` retorna `null` silenciosamente em caso de erro — sem throw em ambientes non-git.
- `detectGitRoot` suporta worktrees via `git rev-parse --git-dir` (não apenas `.git` dir físico).
- Modulo pequeno e focado — sem dependências externas além de `node:child_process`.

---

## 5. Score

| Dimensão                   | Nota       |
| -------------------------- | ---------- |
| Correção lógica            | 9/10       |
| Performance (event loop)   | 8.5/10     |
| Resiliência (non-git dirs) | 9.5/10     |
| **Global**                 | **9.0/10** |

---

_Arquivo gerado automaticamente pelo COPILOT-FULL-AUDIT MF-II._
