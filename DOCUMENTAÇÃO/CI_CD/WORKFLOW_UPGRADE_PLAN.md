# Plano de Upgrade de GitHub Actions & Workflows

**Status**: Executado — 2026-03-03  
**Branch**: `copilot/upgrade-actions-and-workflows`  
**Responsável**: Copilot SWE Agent

---

## 1. Análise da Situação Atual

### 1.1 Inventário de Workflows (16 arquivos)

| Arquivo                    | Gatilhos                     | Jobs                                                            |
| -------------------------- | ---------------------------- | --------------------------------------------------------------- |
| `ci.yml`                   | push/PR → main               | validate, audit-lite, integration, regression                   |
| `security.yml`             | push/PR/schedule/dispatch    | npm-audit, codeql                                               |
| `scorecard.yml`            | push/schedule/dispatch       | scorecard                                                       |
| `dependency-review.yml`    | PR → main / dispatch         | dependency-review, dependabot-installability, dependabot-triage |
| `dependency-hygiene.yml`   | schedule/dispatch            | dependency-hygiene                                              |
| `docker-security-scan.yml` | push/PR/schedule/dispatch    | trivy-filesystem, trivy-container, summary                      |
| `docker-rebuild.yml`       | push paths → main / dispatch | lint-dockerfile, build                                          |
| `audit-nightly.yml`        | schedule/dispatch            | audit-nightly                                                   |
| `code-quality.yml`         | push/PR → main               | code-quality                                                    |
| `coverage.yml`             | push/PR → main               | coverage                                                        |
| `dashboard-build.yml`      | push/PR → main / dispatch    | build-dashboard                                                 |
| `jsdoc-typing.yml`         | push/PR → main               | typecheck, jsdoc-coverage                                       |
| `semantic-analysis.yml`    | push/PR → main / dispatch    | semantic-analysis                                               |
| `copilot-setup-steps.yml`  | push/PR/dispatch             | setup                                                           |
| `stale.yml`                | schedule/dispatch            | stale                                                           |
| `release.yml`              | push tags / dispatch         | release                                                         |

### 1.2 Versões de Actions — Estado Antes do Upgrade

| Action                             | Versão Anterior | Versão Após Upgrade  | Workflows Afetados                                    |
| ---------------------------------- | --------------- | -------------------- | ----------------------------------------------------- |
| `actions/checkout`                 | `@v6` ✅        | `@v6` (já na última) | todos                                                 |
| `actions/setup-node`               | `@v6` ✅        | `@v6` (já na última) | todos                                                 |
| `actions/upload-artifact`          | `@v7` ✅        | `@v7` (já na última) | múltiplos                                             |
| `actions/cache`                    | `@v5` ✅        | `@v5` (já na última) | copilot-setup-steps                                   |
| `actions/github-script`            | `@v8` ✅        | `@v8` (já na última) | múltiplos                                             |
| `actions/stale`                    | `@v9` ❌        | `@v10`               | stale.yml                                             |
| `actions/download-artifact`        | `@v4.1.3` ❌    | `@v8`                | docker-security-scan.yml                              |
| `raven-actions/actionlint`         | `@v2.1.1` ❌    | `@v2.1.2`            | ci.yml                                                |
| `github/codeql-action/*`           | `@v4` ✅        | `@v4` (já na última) | security.yml, scorecard.yml, docker-security-scan.yml |
| `ossf/scorecard-action`            | `@v2.4.3` ✅    | `@v2.4.3`            | scorecard.yml                                         |
| `reviewdog/action-shellcheck`      | `@v1.32.0` ✅   | `@v1.32.0`           | ci.yml, docker-rebuild.yml                            |
| `hadolint/hadolint-action`         | `@v3.3.0` ✅    | `@v3.3.0`            | docker-rebuild.yml                                    |
| `dependabot/fetch-metadata`        | `@v2.5.0` ✅    | `@v2.5.0`            | dependency-review.yml                                 |
| `actions/dependency-review-action` | `@v4.8.3` ✅    | `@v4.8.3`            | dependency-review.yml                                 |
| `docker/setup-qemu-action`         | `@v3` ✅        | `@v3`                | docker-rebuild.yml, docker-security-scan.yml          |
| `docker/setup-buildx-action`       | `@v3` ✅        | `@v3`                | docker-rebuild.yml, docker-security-scan.yml          |
| `docker/build-push-action`         | `@v6` ✅        | `@v6`                | docker-security-scan.yml                              |
| `aquasecurity/trivy-action`        | `@0.34.2` ✅    | `@0.34.2`            | docker-security-scan.yml                              |

### 1.3 Padrão de Token REST API — Antes

- Maioria dos `actions/github-script` sem `github-token` explícito (usa implicitamente
  `GITHUB_TOKEN`)
- `reviewdog/action-shellcheck`: `github_token: ${{ secrets.GITHUB_TOKEN }}`
- `dependabot/fetch-metadata`: `github-token: ${{ secrets.GITHUB_TOKEN }}`

---

## 2. Mudanças Executadas

### 2.1 Upgrades de Versão

1. **`actions/stale@v9` → `@v10`** — `stale.yml`
2. **`actions/download-artifact@v4.1.3` → `@v8`** — `docker-security-scan.yml`
3. **`raven-actions/actionlint@v2.1.1` → `@v2.1.2`** — `ci.yml` +
   `scripts/ci/validate-workflows.mjs`

### 2.2 Padronização de Token REST API

Todos os workflows que chamam a API REST do GitHub agora usam o padrão:

```yaml
github-token: ${{ secrets.GH_PAT || secrets.GITHUB_TOKEN }}
```

Isso garante que, quando o secret `GH_PAT` estiver configurado, ele será utilizado (maior rate
limit, mais escopos); caso contrário, usa o `GITHUB_TOKEN` padrão.

**Workflows atualizados**:

- `ci.yml` — steps `CI Summary` e `Comment PR` (audit-lite)
- `security.yml` — step `Comment PR with security audit results`
- `coverage.yml` — step `Comment PR with coverage results`
- `jsdoc-typing.yml` — steps `Comment PR` (typecheck e jsdoc)
- `code-quality.yml` — step `Comment PR with code quality results`
- `dashboard-build.yml` — step `Comment PR with dashboard build results`
- `dependency-review.yml` — steps `dependabot-triage` e `dependabot-installability`
- `reviewdog/action-shellcheck` — parâmetro `github_token`
- `dependabot/fetch-metadata` — parâmetro `github-token`

### 2.3 Validator Atualizado

`scripts/ci/validate-workflows.mjs` atualizado para exigir `raven-actions/actionlint@v2.1.2`.

---

## 3. Como Configurar o Secret GH_PAT

> ⚠️ **NUNCA** coloque tokens diretamente no código ou em arquivos do repositório.

1. Acesse: **GitHub → Repositório → Settings → Secrets and variables → Actions**
2. Clique em **"New repository secret"**
3. Nome: `GH_PAT`
4. Valor: seu Personal Access Token com escopos `repo`, `read:org`, `workflow`
5. Clique em **"Add secret"**

Os workflows usarão automaticamente o PAT quando disponível, voltando ao `GITHUB_TOKEN` se não
estiver configurado.

---

## 4. Resultado Esperado

- ✅ Nenhum downgrade de versão — apenas upgrades
- ✅ Token padronizado com fallback seguro (`GH_PAT || GITHUB_TOKEN`)
- ✅ Validator local atualizado para exigir versões corretas
- ✅ Todos os workflows passam na validação local (`node scripts/ci/validate-workflows.mjs`)
