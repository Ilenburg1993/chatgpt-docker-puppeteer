# GitHub Actions Workflows - Documentação

**Última atualização:** 22/01/2026
**CI/CD Version:** v2.0 (Module Alias Support + Security Consolidation)

---

## 📋 Overview

Este diretório contém **3 workflows principais** do GitHub Actions para CI/CD, segurança e qualidade de código.

### Workflows Ativos (v2.0 Consolidation)

| Workflow | Trigger | Plataformas | Duração Estimada | Status |
|----------|---------|-------------|------------------|--------|
| **ci.yml** | Push/PR | Ubuntu, Windows, macOS | ~8-12 min | ✅ v2.0 (8 jobs) |
| **pre-commit.yml** | Push/PR | Ubuntu | ~2-5 min | ✅ v2.0 (module-alias) |
| **security-scan.yml** | Push/PR/Cron/Manual | Ubuntu | ~3-5 min | ✅ v2.0 (consolidated) |

**Migration Notes:**
- ✅ **Consolidated** 5 security workflows → 1 unified workflow (`security-scan.yml`)
- ✅ **Enhanced** pre-commit.yml with module-alias validation
- ✅ **Upgraded** ci.yml with 8 parallel jobs and multi-platform testing

**Deprecated workflows** (replaced by `security-scan.yml`):
- ~~secret-scan-schedule.yml~~ → Now schedule trigger in security-scan.yml
- ~~secret-scan-dispatch.yml~~ → Now workflow_dispatch in security-scan.yml
- ~~docker-security-scan.yml~~ → Now docker-security job in security-scan.yml
- ~~git-secrets-scan.yml~~ → Now git-secrets job in security-scan.yml
- ~~secret-scan.yml (old)~~ → Replaced with v2.0 consolidated version

---

## 🚀 CI/CD Pipeline (ci.yml) - v2.0

### Arquitetura

O pipeline CI/CD v2.0 foi completamente redesenhado para suportar **module-alias** e validações rigorosas.

```
┌─────────────────────────────────────────────────────────────────┐
│                    CI/CD Pipeline v2.0                          │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ┌──────────────┐   ┌──────────────┐   ┌──────────────┐       │
│  │ Dependencies │   │     Lint     │   │    Tests     │       │
│  │ Validation   │──▶│  & Format    │──▶│ (Multi-OS)   │       │
│  └──────────────┘   └──────────────┘   └──────────────┘       │
│         │                  │                   │                │
│         │                  │                   │                │
│  ┌──────▼──────────────────▼───────────────────▼──────┐        │
│  │                 Integration Tests                   │        │
│  └──────────────────────────────┬──────────────────────┘        │
│                                 │                               │
│  ┌──────────────┬───────────────▼────────────┬─────────────┐   │
│  │    Build     │      Security Scan         │    Docs     │   │
│  │  Validation  │    (main/develop only)     │ Validation  │   │
│  └──────────────┴────────────────────────────┴─────────────┘   │
│                                 │                               │
│                          ┌──────▼──────┐                        │
│                          │ CI Summary  │                        │
│                          └─────────────┘                        │
└─────────────────────────────────────────────────────────────────┘
```

### Jobs Detalhados

#### 1️⃣ **Dependencies Validation** (~2 min)

**Objetivo:** Validar dependências e configuração de module-alias

**Checks:**
- ✅ `package-lock.json` consistência
- ✅ `_moduleAliases` configurado (9 aliases)
- ✅ Zero imports relativos profundos (`../../..`)

**Falha se:**
- package-lock.json desatualizado
- Menos de 9 aliases configurados
- Encontrar imports deprecados (`require('../../../')`)

**Exemplo de saída:**
```bash
✓ Module aliases configured: @, @core, @shared, @nerv, @kernel, @driver, @infra, @server, @logic
✓ No deprecated relative imports found
```

---

#### 2️⃣ **Lint & Format Check** (~3 min)

**Objetivo:** Validar qualidade do código

**Checks:**
- ✅ ESLint (--max-warnings 0)
- ✅ Prettier format check

**Falha se:**
- ESLint encontrar erros ou warnings
- Código não formatado (use `make format-code`)

---

#### 3️⃣ **Tests (Multi-platform)** (~5-8 min)

**Objetivo:** Executar testes em Ubuntu, Windows, macOS

**Checks:**
- ✅ Module-alias activation
- ✅ Test suite (76+ assertions)
- ✅ Fast tests (P1-P5 fixes)
- ✅ Coverage validation (70+ assertions)

**Plataformas:**
- **ubuntu-latest** (Linux)
- **windows-latest** (Windows Server 2022)
- **macos-latest** (macOS 12+)

**Falha se:**
- Module-alias resolution falhar
- Testes críticos falharem
- Coverage < 70 assertions (warning)

---

#### 4️⃣ **Integration Tests** (~3 min)

**Objetivo:** Testes de integração (Linux only)

**Checks:**
- ✅ Config validation
- ✅ NERV integration
- ✅ Boot sequence

**Falha se:**
- Qualquer teste de integração falhar

---

#### 5️⃣ **Build Validation** (~2 min)

**Objetivo:** Validar sintaxe e module resolution

**Checks:**
- ✅ Sintaxe JavaScript (135 arquivos)
- ✅ Module resolution (test-aliases.js)
- ✅ PM2 config (ecosystem.config.js)

**Falha se:**
- Erro de sintaxe em qualquer arquivo
- Alias resolution falhar
- PM2 config inválido

---

#### 6️⃣ **Security Scan** (~2 min) - APENAS main/develop

**Objetivo:** Scan de segurança

**Checks:**
- ✅ npm audit (high/critical)
- ✅ git-secrets scan

**Falha se:**
- Vulnerabilidades críticas encontradas
- Secrets detectados em código

---

#### 7️⃣ **Documentation Validation** (~1 min)

**Objetivo:** Validar presença de documentação

**Checks:**
- ✅ README.md
- ✅ CONTRIBUTING.md
- ✅ DEVELOPER_WORKFLOW.md
- ✅ MODULE_ALIASES.md
- ✅ ALIAS_VALIDATION_REPORT.md

**Falha se:**
- Documentação obrigatória ausente

---

#### 8️⃣ **CI Summary** (~10s)

**Objetivo:** Sumário final de todos os jobs

**Output:**
```
═══════════════════════════════════════════════════════
  CI/CD Pipeline Summary (Module Alias v1.0)
═══════════════════════════════════════════════════════

✅ Dependencies: success
✅ Lint: success
✅ Tests: success
✅ Integration: success
✅ Build: success
✅ Docs: success

✅ CI PASSED - All checks successful!
```

---

## 🔧 Configuração Local vs CI

### Diferenças

| Aspecto | Local (make) | CI (GitHub Actions) |
|---------|--------------|---------------------|
| **Strict mode** | `STRICT=false` (padrão) | `STRICT=true` (sempre) |
| **ESLint warnings** | Permitidos | Bloqueiam (--max-warnings 0) |
| **Plataformas** | Sua OS | Ubuntu + Windows + macOS |
| **continue-on-error** | Sim (desenvolvimento) | Não (CI) |

### Replicar CI Localmente

Para replicar o comportamento do CI localmente:

```bash
# Simular job Dependencies
make deps-consistency

# Simular job Lint
make lint  # ESLint com --max-warnings 0
npm run format:check

# Simular job Tests
make test-all

# Simular job Integration
node tests/test_config_validation.js
node tests/test_driver_nerv_integration.js
node tests/test_boot_sequence.js

# Simular job Build
find src -name "*.js" -type f | xargs -I {} node -c {}
node scripts/test-aliases.js

# Full CI simulation
make STRICT=true test-all
```

---

## 📊 Status Badges

Use estes badges no README.md:

```markdown
[![CI](https://github.com/Ilenburg1993/chatgpt-docker-puppeteer/actions/workflows/ci.yml/badge.svg)](https://github.com/Ilenburg1993/chatgpt-docker-puppeteer/actions/workflows/ci.yml)
[![Security Scan](https://github.com/Ilenburg1993/chatgpt-docker-puppeteer/actions/workflows/secret-scan.yml/badge.svg)](https://github.com/Ilenburg1993/chatgpt-docker-puppeteer/actions/workflows/secret-scan.yml)
[![Pre-commit](https://github.com/Ilenburg1993/chatgpt-docker-puppeteer/actions/workflows/pre-commit.yml/badge.svg)](https://github.com/Ilenburg1993/chatgpt-docker-puppeteer/actions/workflows/pre-commit.yml)
```

---

## 🚨 Troubleshooting

### CI falhando em "Check for deprecated relative imports"

**Causa:** Encontrou imports com `../../..` no código.

**Solução:**
```bash
# Encontrar imports deprecados
grep -r "require(['\"]\.\..*\.\./\.\." src --include="*.js"

# Converter automaticamente
node scripts/refactor-to-aliases.js

# Verificar
make lint
```

---

### CI falhando em "Validate module-alias configuration"

**Causa:** `_moduleAliases` não configurado ou incompleto.

**Solução:**
```bash
# Verificar package.json
node -e "console.log(Object.keys(require('./package.json')._moduleAliases))"

# Deve retornar 9 aliases:
# [ '@', '@core', '@shared', '@nerv', '@kernel', '@driver', '@infra', '@server', '@logic' ]
```

---

### CI falhando em "Module alias resolution failed"

**Causa:** `module-alias/register` não ativado ou caminho errado.

**Solução:**
```bash
# Verificar index.js tem como primeira linha:
# require('module-alias/register');

# Testar localmente
node scripts/test-aliases.js
```

---

### CI falhando em "ESLint check (strict)"

**Causa:** ESLint encontrou warnings (bloqueados no CI).

**Solução:**
```bash
# Rodar localmente e ver warnings
make lint

# Auto-fix
make lint-fix

# Verificar novamente
npx eslint . --max-warnings 0 --quiet
```

---

## 📈 Métricas de CI

### Duração Total Esperada

| Cenário | Duração | Jobs Paralelos |
|---------|---------|----------------|
| **PR (sem security)** | ~8-10 min | Dependencies, Lint, Tests (3 OS), Integration, Build, Docs |
| **Push main/develop** | ~10-12 min | + Security scan |
| **Falha rápida** | ~2-3 min | Fail-fast em dependencies ou lint |

### Cache Hit Rate

- **npm ci**: ~90% cache hit (actions/setup-node cache)
- **Speedup**: ~40% redução de tempo com cache

---

## 🔒 Security Workflows

### secret-scan.yml

**Trigger:** Push para qualquer branch

**Ferramentas:**
- detect-secrets
- gitleaks

**Output:** Cria issue se segredos detectados

---

### git-secrets-scan.yml

**Trigger:** Push

**Ferramentas:**
- git-secrets
- truffleHog

**Output:** Falha CI se segredos encontrados

---

### docker-security-scan.yml

**Trigger:** Mudanças em Dockerfile, docker-compose*.yml

**Ferramentas:**
- Trivy (image scanning)
- hadolint (Dockerfile linting)

---

## 📚 Referências

- **GitHub Actions Docs:** https://docs.github.com/en/actions
- **actions/setup-node:** https://github.com/actions/setup-node
- **ESLint CI:** https://eslint.org/docs/latest/use/continuous-integration
- **npm ci vs install:** https://docs.npmjs.com/cli/v10/commands/npm-ci

---

**Última atualização:** 22/01/2026
**Versão:** CI/CD v2.0 (Module Alias Support)
**Manutenção:** Revisar a cada major release
