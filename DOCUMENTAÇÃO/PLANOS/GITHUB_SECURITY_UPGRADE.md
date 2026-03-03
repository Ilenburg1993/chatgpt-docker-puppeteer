# Plano de Upgrade — Ferramentas Nativas do GitHub

**Status**: Implementado  
**Data**: 2026-03-02  
**Autor**: Agente de automação (Copilot)

---

## 1. Diagnóstico Inicial

### 1.1 Problemas identificados

| #   | Componente                 | Problema                                                                | Impacto                                                                                                  |
| --- | -------------------------- | ----------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| 1   | `SECURITY.md` (raiz)       | Aponta para `DOCUMENTAÇÃO/SECURITY.md` que **não existe**               | GitHub não exibe política de segurança; botão "Report a vulnerability" não funciona                      |
| 2   | `Dockerfile` (raiz)        | Não existe — Dockerfile está em `.devcontainer/`                        | Dependabot docker (já configurado para `/`) não monitora; Trivy não consegue escanear imagem de produção |
| 3   | `docker-security-scan.yml` | Workflow referenciado por Trivy/histórico não existe                    | Erro no GitHub Actions; container scan ausente                                                           |
| 4   | Code scanning              | Apenas CodeQL configurado; sem Trivy filesystem/IaC; sem OSSF Scorecard | Cobertura de segurança incompleta                                                                        |

### 1.2 Análise do `dependabot.yml`

O `dependabot.yml` já declara o ecossistema `docker` apontando para `"/"` (raiz). Isso significa que
o Dependabot espera um `Dockerfile` na raiz do repositório. Sem ele, o monitoramento de imagens base
não funciona.

### 1.3 Análise do `SECURITY.md`

O GitHub usa o arquivo `SECURITY.md` (raiz ou `.github/`) para:

- Exibir a política de segurança no aba "Security" do repositório
- Habilitar o botão "Report a vulnerability" (private vulnerability reporting)
- Integrar com o programa GitHub Security Advisories

O arquivo atual contém apenas uma linha apontando para `DOCUMENTAÇÃO/SECURITY.md`, que não existe.

### 1.4 Ferramentas de code scanning disponíveis (gratuitas)

| Ferramenta               | Tipo                         | Gratuita para OSS | Status atual                  |
| ------------------------ | ---------------------------- | ----------------- | ----------------------------- |
| **CodeQL**               | SAST JavaScript/TypeScript   | ✅ Sim            | ✅ Configurado (security.yml) |
| **Trivy** (aquasecurity) | Container + Filesystem + IaC | ✅ Sim            | ❌ Ausente                    |
| **OSSF Scorecard**       | Security practices score     | ✅ Sim            | ❌ Ausente                    |
| **Semgrep**              | SAST patterns                | ✅ OSS patterns   | ⚠️ Opcional                   |
| **TruffleHog**           | Secret detection             | ✅ Sim            | ❌ Ausente                    |

---

## 2. Solução Implementada

### 2.1 `SECURITY.md` (raiz) — Política de segurança completa

**Ação**: Substituído o stub por uma política de segurança completa no formato esperado pelo GitHub.

**Conteúdo**:

- Versões suportadas
- Como reportar uma vulnerabilidade (private disclosure)
- Tempo de resposta esperado
- Escopo (o que é e não é vulnerabilidade)
- Link para política técnica detalhada

### 2.2 `Dockerfile` (raiz) — Dockerfile de produção

**Ação**: Criado um Dockerfile multi-estágio de produção para a aplicação Node.js.

**Características**:

- Base: `node:24-bookworm-slim`
- Multi-estágio: `deps` → `builder` → `production`
- `PUPPETEER_SKIP_DOWNLOAD=true` (usa Chrome externo via CDP)
- `npm ci --omit=dev` (apenas dependências de produção)
- Usuário não-root `nodejs` (UID 1001)
- EXPOSE 3008 (porta do dashboard/API)
- `dumb-init` para gestão de processos

**Diferença do `.devcontainer/Dockerfile`**:

- DevContainer: ambiente de desenvolvimento completo com VS Code Server, Puppeteer local,
  ferramentas de dev
- Root Dockerfile: imagem de produção mínima e segura para execução do runtime

### 2.3 `.github/workflows/docker-security-scan.yml` — Trivy scanning

**Ação**: Criado workflow completo de segurança Docker/container.

**Jobs**:

1. `trivy-filesystem` — Escaneia o código-fonte (dependências, configurações, segredos, IaC)
2. `trivy-container` — Constrói a imagem do Dockerfile de produção e escaneia
3. `summary` — Consolida resultados no PR comment

**Triggers**:

- Push para `main`
- Pull Request para `main`
- Semanal (segunda-feira, 06:37 UTC)
- `workflow_dispatch`

**Outputs**:

- SARIF upload para GitHub Security tab
- Artifacts com relatórios JSON e SARIF
- PR comment com resumo dos findings

### 2.4 `.github/workflows/scorecard.yml` — OSSF Scorecard

**Ação**: Criado workflow para avaliação contínua de práticas de segurança.

**O que avalia**:

- Branch protection
- Code review
- Dependency pinning
- CI presence
- Vulnerabilities
- License
- Maintained status
- Token permissions
- Dangerous workflow patterns
- Binary artifacts
- SAST tools

**Triggers**:

- Push para `main`
- Semanal (quarta-feira, 02:17 UTC)
- `workflow_dispatch`

**Output**: SARIF no GitHub Security tab, badge disponível

### 2.5 `scripts/ci/validate-workflows.mjs` — Atualizado

**Ação**: Adicionados `docker-security-scan.yml` e `scorecard.yml` ao set
`workflowsRequiringConcurrency`.

---

## 3. Checklist de Implementação

- [x] Criar `DOCUMENTAÇÃO/PLANOS/GITHUB_SECURITY_UPGRADE.md` (este arquivo)
- [x] Corrigir `SECURITY.md` na raiz
- [x] Criar `Dockerfile` na raiz (produção)
- [x] Criar `.github/workflows/docker-security-scan.yml`
- [x] Criar `.github/workflows/scorecard.yml`
- [x] Atualizar `scripts/ci/validate-workflows.mjs`
- [x] Validar com lint e testes

---

## 4. Verificação de Conformidade

### 4.1 validate-workflows.mjs — requisitos

Todos os novos workflows seguem os requisitos do validador:

| Requisito                     | docker-security-scan.yml     | scorecard.yml             |
| ----------------------------- | ---------------------------- | ------------------------- |
| `name`                        | ✅ Docker Security Scan      | ✅ OSSF Scorecard         |
| `on`                          | ✅ push/pr/schedule/dispatch | ✅ push/schedule/dispatch |
| `jobs`                        | ✅ 3 jobs                    | ✅ 1 job                  |
| `permissions` (objeto)        | ✅                           | ✅                        |
| `concurrency`                 | ✅                           | ✅                        |
| `timeout-minutes` por job     | ✅                           | ✅                        |
| `retention-days` em artifacts | ✅                           | ✅                        |

### 4.2 GitHub Native Features

| Feature                         | Estado após upgrade                   |
| ------------------------------- | ------------------------------------- |
| Security Policy                 | ✅ Funcional com conteúdo completo    |
| Private Vulnerability Reporting | ✅ Habilitado via SECURITY.md correto |
| Dependabot Docker               | ✅ Dockerfile na raiz                 |
| Container Scanning (Trivy)      | ✅ Novo workflow                      |
| Filesystem Scanning (Trivy)     | ✅ Novo workflow                      |
| OSSF Scorecard                  | ✅ Novo workflow                      |
| GitHub Security Tab             | ✅ SARIF upload em todos os scans     |
| CodeQL                          | ✅ Já existente (security.yml)        |

---

## 5. Próximos Passos (Opcionais)

1. **Habilitar Private Vulnerability Reporting** nas configurações do repositório GitHub
2. **Adicionar Semgrep** para SAST patterns específicos de Node.js/Puppeteer
3. **Adicionar TruffleHog** para detecção de segredos históricos em commits
4. **Configurar proteção de branches** no GitHub (melhora score do OSSF Scorecard)
5. **Revisar CodeQL queries** para adicionar queries customizadas do projeto
6. **Publicar imagem** no GitHub Container Registry (ghcr.io) via workflow de release
