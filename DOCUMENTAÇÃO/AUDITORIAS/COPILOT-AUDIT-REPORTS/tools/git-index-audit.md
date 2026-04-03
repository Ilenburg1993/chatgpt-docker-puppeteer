# Audit: src/copilot/tools/git/index.js

**Módulo**: `copilot/tools/git` **Arquivo**: `src/copilot/tools/git/index.js` **LOC**: 239 **Data**:
2026-06-10 **Auditor**: copilot-full-audit MF-II F07

---

## Resumo

Fornece 7 git tools: `git_status`, `git_diff`, `git_commit`, `git_changed_files`, `git_push`,
`git_create_branch` e `git_log`. Usa `execFileAsync` via `safeGitArgs()` — sem interpolação shell.
Git push e create_branch sanitizam nomes via regex. `git_commit` verifica staged files antes de
commitar (fix GAP-Q09).

**Score**: 9.0/10

---

## Achados

### P4 — git_push: Sanitização Remove Chars Sem Log de Aviso

**Localização**: `gitPushTool`, sanitização do nome do remote.

```js
const safeRemote = remote.replace(/[^a-zA-Z0-9/_.-]/g, '');
```

A substituição silenciosamente remove caracteres inválidos. Se o nome original era `origin!@#`,
`safeRemote` vira `origin`. O push acontece contra `origin` sem o caller saber que houve
transformação.

**Impacto**: Baixo em prática (remotos normalmente têm nomes válidos). Mas poderia causar push
inesperado contra remote errado.

**Recomendação**: Retornar erro se `safeRemote !== remote` ao invés de transformar silenciosamente.

---

### P4 — git_status: Combina Output de status + log no Mesmo Campo

**Localização**: `gitStatusTool`, handler.

```js
const { stdout: statusOut } = await safeGitArgs(['status', '--short', '--branch']);
const { stdout: logOut } = await safeGitArgs(['log', '--oneline', '-5']);
return { output: `${statusOut}\n\nRecent commits:\n${logOut}` };
```

O campo `output` mistura saída de `status` e `log` em string plana. Callers não podem distinguir
programaticamente qual parte é status e qual é log.

**Impacto**: Baixo; ferramenta de conveniência para LLM, que lida bem com texto misto.

**Recomendação**: Retornar `{ status: statusOut, recentCommits: logOut }` para estrutura mais
processável.

---

### P5 — git_diff: Truncamento por Linhas Hardcoded a 200

**Localização**: `gitDiffTool`, handler.

```js
const lines = stdout.split('\n').slice(0, 200);
return { diff: lines.join('\n'), truncated: lines.length === 200 };
```

200 linhas é hardcoded. Para projetos com muitas mudanças, trunca rapidamente. Não é configurável
pelo caller.

**Impacto**: Baixo; `truncated: true` é retornado para indicar ao caller.

---

## Positivos

- `safeGitArgs()`: array de args, sem shell=true — sem command injection (OWASP A3)
- `git_commit`: verifica staged files com `diff --cached` antes de commitar — GAP-Q09 fix
- `git_create_branch`: valida tanto o nome do branch quanto o base com mesmo regex
- Output truncado a 4000/2000 chars — sem buffers explosivos
- Todas as tools com bom JSDoc e descriptions claras
- `git_push` NÃO usa `withSkipPermission` — correto (push é ação destrutiva)
