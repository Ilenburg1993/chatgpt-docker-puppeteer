# Plano de Separação e Consolidação dos Workflows de CI/CD

**Status**: Em execução — 2026-03-03  
**Branch**: `copilot/separate-workflows-and-upgrade`  
**Responsável**: Copilot SWE Agent

---

## 1. Diagnóstico — Problemas no CI Atual

### 1.1 Bug crítico em `ci.yml`

O job `validate` em `ci.yml` tem um step com `uses:` e `run:` no **mesmo bloco** — YAML inválido
para GitHub Actions:

```yaml
# ERRADO — GitHub Actions não permite uses + run no mesmo step
- name: Lint shell scripts with shellcheck
  uses: reviewdog/action-shellcheck@v1.32.0
  with: ...
  id: lint # ← pertencia ao próximo step
  continue-on-error: true # ← pertencia ao próximo step
  run: npm run lint # ← pertencia ao próximo step
```

Causa: dois steps (shellcheck e eslint) foram acidentalmente mesclados em um único bloco.

### 1.2 Responsabilidades misturadas

O job `validate` de `ci.yml` acumula tarefas heterogêneas:

| Tarefa                          | Deve estar em    |
| ------------------------------- | ---------------- |
| ShellCheck em scripts           | `shellcheck.yml` |
| actionlint em workflows         | `shellcheck.yml` |
| ESLint no código                | `lint.yml`       |
| Prettier (format check)         | `lint.yml`       |
| Unit tests                      | `ci.yml`         |
| Validação do Node runtime       | `ci.yml`         |
| Validação dos YAMLs de workflow | `ci.yml`         |

### 1.3 PR comments pouco informativos

Comentários existentes mostram apenas ✅/❌ por categoria, sem:

- Saída real dos erros (ESLint, ShellCheck, Prettier)
- Link direto para o workflow run
- Sugestões de correção por tipo de erro
- Contagem de problemas por arquivo

---

## 2. Novos Workflows a Criar

### 2.1 `lint.yml` — Lint & Format

- **Gatilhos**: push → main, PR → main, workflow_dispatch
- **Jobs**:
  - `lint-and-format`: ESLint + Prettier com saída capturada
- **PR Comment**: upsert com marcador `<!-- lint-format-summary -->`, inclui:
  - Tabela de resultados ESLint / Prettier
  - `<details>` com primeiras linhas dos erros
  - Link para o workflow run
  - Sugestões de correção (`npm run lint:fix`, `npm run format`)
- **Bloqueante**: sim — falha bloqueia o merge via `exit 1`

### 2.2 `shellcheck.yml` — Shell & Workflow Lint

- **Gatilhos**: push → main, PR → main, workflow_dispatch
- **Jobs**:
  - `shellcheck`: reviewdog/action-shellcheck + raven-actions/actionlint
- **PR Comment**: upsert com marcador `<!-- shellcheck-summary -->`, inclui:
  - Tabela de resultados ShellCheck / actionlint
  - Link para as annotations na aba "Files changed"
  - Link para o workflow run
  - Instruções de correção local
- **Bloqueante**: não — `continue-on-error: true` (informativo)

---

## 3. Modificações no `ci.yml`

- **Remover** steps: shellcheck, actionlint, ESLint, Prettier (migrados)
- **Manter**: validação do Node, validação de YAMLs, unit tests, audit-lite, integration, regression
- **Melhorar** CI Summary: mostrar saída do test runner, link para o run
- **Job `validate`** renomeado para "Tests & Validation (Node 24)" refletindo foco em testes

---

## 4. Atualização do Validator

`scripts/ci/validate-workflows.mjs` deve incluir os novos workflows em
`workflowsRequiringConcurrency`:

```js
const workflowsRequiringConcurrency = new Set([
  // ... existentes ...
  'lint.yml',
  'shellcheck.yml',
]);
```

---

## 5. Inventário de Workflows Após a Execução

| Arquivo                    | Foco                                      | Bloqueante           | PR Comment |
| -------------------------- | ----------------------------------------- | -------------------- | ---------- |
| `ci.yml`                   | Tests + workflow validation               | ✅ sim               | ✅         |
| `lint.yml`                 | ESLint + Prettier                         | ✅ sim               | ✅         |
| `shellcheck.yml`           | ShellCheck + actionlint                   | ❌ não (informativo) | ✅         |
| `code-quality.yml`         | Análise estática (circular deps, orphans) | ❌ não               | ✅         |
| `jsdoc-typing.yml`         | TypeScript + JSDoc coverage               | ❌ não               | ✅         |
| `coverage.yml`             | Cobertura de testes                       | ❌ não               | ✅         |
| `dashboard-build.yml`      | Build Vite do dashboard                   | ❌ não               | ✅         |
| `security.yml`             | npm audit + CodeQL                        | ❌ não               | ✅         |
| `docker-security-scan.yml` | Trivy filesystem + container              | ❌ não               | ✅         |
| `docker-rebuild.yml`       | Build + lint do DevContainer              | ❌ não               | ❌         |
| `dependency-review.yml`    | Revisão de dependências em PRs            | ✅ sim               | ✅         |
| `dependency-hygiene.yml`   | Saúde do grafo de deps                    | ❌ não               | ❌         |
| `audit-nightly.yml`        | Auditoria profunda noturna                | ❌ não               | ❌         |
| `semantic-analysis.yml`    | Análise semântica profunda                | ❌ não               | ❌         |
| `scorecard.yml`            | OSSF Scorecard                            | ❌ não               | ❌         |
| `stale.yml`                | Gestão de issues/PRs parados              | ❌ não               | ❌         |
| `release.yml`              | Release automático via tag                | ✅ sim               | ❌         |
| `copilot-setup-steps.yml`  | Bootstrap do Copilot Agent                | N/A                  | ❌         |

---

## 6. Convenção de PR Comments

Todos os PR comments seguem o padrão upsert com marcador HTML:

```js
// Detectar comentário existente do Bot
const existing = comments.find(c =>
  c.user?.type === 'Bot' && c.body?.includes(marker)
);
// Update se existir, create se não
if (existing) {
  await github.rest.issues.updateComment({ ..., body });
} else {
  await github.rest.issues.createComment({ ..., body });
}
// Fallback em caso de erro de permissão
try { ... } catch (err) {
  core.warning(`PR comment failed: ${err.message}`);
  await core.summary.addRaw(body, true).write();
}
```

Token padrão: `${{ secrets.GH_PAT || secrets.GITHUB_TOKEN }}`  
Permissões mínimas obrigatórias em jobs que postam comentários:

- `issues: write`
- `pull-requests: write`

---

## 7. Checklist de Execução

- [x] Documento de plano criado
- [ ] `lint.yml` criado
- [ ] `shellcheck.yml` criado
- [ ] `ci.yml` corrigido e simplificado
- [ ] `validate-workflows.mjs` atualizado
- [ ] `node scripts/ci/validate-workflows.mjs` passa sem erros
- [ ] `actionlint` passa sem erros nos novos arquivos
