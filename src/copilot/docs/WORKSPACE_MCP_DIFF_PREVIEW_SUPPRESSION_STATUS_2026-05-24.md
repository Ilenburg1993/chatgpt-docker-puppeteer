# Status — diffPreview desligado por padrão e redução de payloads

**Data:** 2026-05-24 **Objetivo:** reduzir interrupções de streaming do ChatGPT web e payloads
grandes retornados por tools MCP, principalmente `diffPreview`/diff textual. **Validação:** nenhum
validador foi rodado nesta etapa, conforme solicitado. A validação deve ser feita localmente depois
do restart.

---

## 1. Contexto

Foi observado que chamadas de escrita/plano retornavam `diffPreview` textual por padrão. Mesmo com
`maxDiffLines` reduzido nas chamadas feitas pelo ChatGPT, o runtime atual ainda inclui `diffPreview`
no retorno das tools porque o servidor MCP em execução ainda não foi reiniciado depois das
alterações de código.

A mudança implementada nesta etapa torna o diff textual **opt-in** por meio de
`includeDiffPreview: true`. O default esperado, após restart, passa a ser:

```text
includeDiffPreview=false
```

Assim, as tools retornam metadados, hashes, contagem de linhas/bytes e indicação de que o diff está
disponível, mas não enviam o texto completo do diff salvo quando solicitado explicitamente.

---

## 2. Arquivos alterados

```text
src/copilot/mcp/tools/repo-write.js
src/copilot/mcp/tools/repo-plan.js
src/copilot/mcp/tools/repo-read.js
src/copilot/mcp/tools/session-profile.js
src/copilot/mcp/tools/meta.js
src/copilot/mcp/tools/jobs.js
src/copilot/mcp/tools/tools-status.js
```

---

## 3. Implementado

### 3.1 `repo-write.js`

Adicionado helper:

```js
function maybeDiffPreview(include, diff) {
  return include === true
    ? { diffPreview: diff.diff, ... }
    : { diffPreviewSuppressed: true, diffPreviewAvailable: diff.lines > 0, ... };
}
```

Tools atualizadas:

```text
repo_apply_patch
repo_write_file
repo_create_file
```

Novo input:

```js
includeDiffPreview: z.boolean().optional().describe('Include textual diffPreview in the tool result. Default: false.')
```

Comportamento novo:

- `structuredContent.diffPreview` só aparece se `includeDiffPreview === true`.
- O texto da resposta não carrega mais o diff por padrão.
- O retorno default contém metadados como:
  - `diffPreviewSuppressed`
  - `diffPreviewAvailable`
  - `diffPreviewLines`
  - `diffPreviewBytes` quando disponível
  - `diffContextLines`
  - hashes e contagens de bytes/linhas.

### 3.2 `repo-plan.js`

Adicionado helper:

```js
function maybePlanDiffPreview(include, diff) { ... }
```

Tools atualizadas:

```text
repo_create_file_plan
repo_patch_plan
```

Novo input:

```js
includeDiffPreview: z.boolean().optional().describe('Include textual diffPreview in the tool result. Default: false.')
```

Comportamento novo:

- Plans continuam read-only.
- Plans retornam `nextCall`, contagens e hashes.
- Diff textual só é retornado com `includeDiffPreview=true`.

### 3.3 `repo-read.js`

Tool atualizada:

```text
repo_diff_files
```

Novo input:

```js
includeDiffPreview: z.boolean().optional().describe('Include textual diff in the tool result. Default: false.')
```

Comportamento novo:

- `diff` textual só aparece se `includeDiffPreview === true`.
- Default retorna:
  - `identical`
  - `diffPreviewSuppressed`
  - `diffPreviewAvailable`
  - engine
  - contextLines.

### 3.4 `session-profile.js`

Atualizado fluxo recomendado para patch:

```text
repo_patch_plan includeDiffPreview=false
repo_apply_patch expectedHash=<sha256 from plan> includeDiffPreview=false
```

O motivo agora explicita que diffs textuais são suprimidos por padrão para evitar interrupções de
streaming no ChatGPT web.

### 3.5 `meta.js`

Atualizado `IO_GUIDANCE` com regra geral:

```text
Keep includeDiffPreview=false by default for repo_patch_plan, repo_create_file_plan, repo_apply_patch, repo_write_file, repo_create_file and repo_diff_files; request textual diffs only when explicitly needed.
```

### 3.6 `tools-status.js`

Corrigido conflito em `approvalFrictionProfile`:

- `job_cancel` não deve aparecer simultaneamente em `rememberApprovalCandidates` e
  `neverRememberApproval`.
- Foi adicionado `manualSet` para excluir ferramentas manuais/destrutivas do conjunto de remember
  approval.

### 3.7 `jobs.js`

Entrou melhoria parcial:

- `mcp_last_validation_summary` agora retorna:
  - `recommendedNextAction`
  - `streamSafety.preferredFlow`
  - `streamSafety.avoid`

Isso implementa o padrão summary-first sem criar nova tool.

---

## 4. Bloqueado ou não concluído

### 4.1 `mcp_validation_dashboard`

A criação/inserção da nova tool `mcp_validation_dashboard` foi bloqueada pelo host ChatGPT quando
enviada como patch maior.

Mitigação já aplicada:

- `mcp_last_validation_summary` foi expandida para cobrir a maior parte do comportamento desejado.

Ainda desejável:

```text
mcp_validation_dashboard
job_get_summary
```

Ambas devem ser implementadas futuramente em patches menores ou localmente.

### 4.2 Tool dedicada para diff textual

Ainda não foi criada uma tool exclusiva do tipo:

```text
repo_diff_preview
```

Por enquanto, o comportamento opt-in via `includeDiffPreview=true` cobre a necessidade. Uma tool
dedicada pode ser melhor no futuro para evitar que tools de escrita carreguem diffs por acidente.

---

## 5. Restart obrigatório

Essas mudanças só entram no runtime do MCP após restart do servidor.

Antes do restart, chamadas como `repo_apply_patch` ainda podem retornar `diffPreview` porque o
processo atual carregou a implementação antiga.

Depois do restart, o uso recomendado é:

```json
{
  "includeDiffPreview": false
}
```

ou simplesmente omitir o campo.

Para obter diff textual explicitamente:

```json
{
  "includeDiffPreview": true,
  "maxDiffLines": 80
}
```

---

## 6. Validação recomendada local pós-restart

Não rodei validadores aqui. Depois do restart, recomenda-se validar localmente:

```bash
npm run typecheck:strict:src.copilot
npx vitest --config vitest.copilot.config.js run tests/unit/copilot/mcp
```

Smoke manual recomendado no ChatGPT depois do restart:

1. Chamar `mcp_tools_status` e confirmar que schemas expõem `includeDiffPreview` nas tools
   relevantes.
2. Chamar `repo_patch_plan` sem `includeDiffPreview` e confirmar que não há `diffPreview` textual.
3. Chamar `repo_patch_plan includeDiffPreview=true` e confirmar que o diff textual aparece.
4. Chamar `repo_apply_patch` com `includeDiffPreview=false` em um patch pequeno controlado.

---

## 7. Risco residual

Sem validação ainda, os principais riscos são:

- erro de typecheck por JSDoc/types de helper;
- algum teste existente esperando `diffPreview` textual sempre presente;
- alguma tool consumidora esperando `diffPreview` em plan/apply por padrão.

A intenção da mudança é compatível com o objetivo operacional: reduzir payloads por padrão e tornar
diffs textuais explícitos.
