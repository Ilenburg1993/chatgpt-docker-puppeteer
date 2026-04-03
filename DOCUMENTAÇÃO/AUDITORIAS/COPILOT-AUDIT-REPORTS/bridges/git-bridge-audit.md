# Auditoria — `git-bridge.js`

**Módulo**: `src/copilot/bridges/git-bridge.js` **LOC**: 402 **Data**: 2026-06-10 **Auditor**:
Copilot Full-Audit MF-II

---

## 1. Propósito

Encapsulamento de chamadas ao CLI `git` via `execFile` com retorno de objetos JS estruturados. Usado
pelos handlers HTTP do terminal e pelo REPL. Cobre: status, log, diff, branch, commit, push, pull,
add, stash.

---

## 2. Arquitetura

```
runGit(args, opts)
 └── execFileAsync('git', args, { cwd: PROJECT_ROOT, timeout: 10s, maxBuffer: 4MB })

gitStatus()     → StatusEntry[]  + formatStatus()
gitLog()        → LogEntry[]     + formatLog()
gitDiff()       → string (diff raw)
gitBranch()     → BranchEntry[]  + formatBranch()
gitCommit(msg)  → string (hash abreviado)
gitPush()       → string (output do push)
gitPull()       → string (output do pull)
gitAdd(paths)   → boolean
gitStash()      → string
```

---

## 3. Achados

### FINDING-P5-1 — `gitCommit`: extração de hash via regex pode falhar com locale diferente

**Severidade**: P5 — Baixo **Localização**: `gitCommit()` linhas ~285-300

```js
const match = out.match(/\b([0-9a-f]{7,})\b/);
return match?.[1] ?? out.split('\n')[0] ?? out;
```

O output do `git commit` varia com o locale (e.g., `[main 3b2a1c0] "feat: ..."` em inglês vs.
variantes localizadas). O regex `[0-9a-f]{7,}` pode capturar hashes no subject da mensagem de commit
se ela contiver hexadecimais. Retorna o fallback `out.split('\n')[0]` se o regex não encontrar —
razoável mas impreciso.

**Proposta**: usar `--format=%H` em um `git log -1` pós-commit para obter o hash definitivo:

```js
await runGit(['commit', '-m', message]);
return await runGit(['log', '-1', '--format=%h']);
```

---

### FINDING-P5-2 — `gitPush`/`gitPull` não sanitizam `remote` e `branch`

**Severidade**: P5 — Baixo **Localização**: `gitPush()` linhas ~320-335

```js
async function gitPush(opts = {}) {
  const { remote = 'origin', branch } = opts;
  const args = ['push', remote];
  if (branch) args.push(branch);
  return await runGit(args, { timeoutMs: 30000 });
}
```

`execFile` previne shell injection (args passados como array, sem interpolação shell). No entanto,
valores como `remote = '--force'` seriam aceitos como flag válida pelo git, potencialmente
executando `git push --force`. Para uso via REPL do terminal, o caller controla os args — risco
baixo mas vale sanitiar:

```js
if (remote && !/^[\w.\-/]+$/.test(remote)) throw new Error(`Remote inválido: ${remote}`);
```

---

### FINDING-P5-3 — `formatLog` trunca subject sem indicador de truncamento

**Severidade**: P5 — Cosmético **Localização**: `formatLog()` linhas ~175-185

```js
return `  \x1b[33m${e.abbrevHash}\x1b[0m  ${e.subject.substring(0, 70)}  ...`;
```

`substring(0, 70)` trunca silenciosamente sem adicionar `...`. O usuário vê um subject que parece
completo mas está cortado — confuso para commits com títulos longos.

---

## 4. Pontos positivos

- **Segurança**: `execFile` em todos os comandos — não há shell injection possível.
- `PROJECT_ROOT` estático via `import.meta.url` — independente de variação de cwd em tests.
- `timeout: 10_000` + `maxBuffer: 4MB` em `runGit` — limita tanto tempo quanto output.
- `timeout: 30_000` em push/pull — operações de rede têm timeout apropriado.
- Todos os comandos fallback para `[]` / `''` / `false` em caso de erro — sem throws no REPL.
- `STATUS_MAP` com cores ANSI e labels legíveis — ótima experiência no terminal.
- Parsing com `\x1f` como separador em `gitLog` e `gitBranch` — imune a espaços no subject.

---

## 5. Score

| Dimensão             | Nota       |
| -------------------- | ---------- |
| Segurança (execFile) | 10/10      |
| Correção lógica      | 8.5/10     |
| UX (formatação)      | 8.5/10     |
| **Global**           | **9.0/10** |

---

_Arquivo gerado automaticamente pelo COPILOT-FULL-AUDIT MF-II._
