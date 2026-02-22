# 🤝 Guia de Contribuição

**Versão**: 1.0 **Última Atualização**: 21/01/2026 **Público-Alvo**: Contribuidores externos e
internos **Tempo de Leitura**: ~15 min

---

## 📖 Visão Geral

Este documento detalha **como contribuir** para o projeto `chatgpt-docker-puppeteer`: Git workflow,
conventional commits, code standards, PR process.

---

## 🎯 Como Contribuir

### Tipos de Contribuições

✅ **Bem-vindos**:

- 🐛 **Bug fixes**: Correções de bugs reportados em issues
- ✨ **Features**: Novos drivers (LLMs), endpoints, melhorias
- 📝 **Documentação**: Typos, clarificação, exemplos
- 🧪 **Testes**: Aumentar cobertura, fix flaky tests
- ⚡ **Performance**: Otimizações (P-level fixes)
- 🔒 **Security**: Fixes de vulnerabilidades

⚠️ **Discutir antes**:

- 🏗️ **Arquitetura**: Mudanças estruturais (criar RFC issue)
- 💥 **Breaking changes**: Incompatibilidades com versões anteriores
- 📦 **Dependências**: Adicionar/remover libs (justificar)

---

## 🔀 Git Workflow

### 1. Fork & Clone

```bash
# Fork no GitHub (botão "Fork")

# Clone seu fork
git clone https://github.com/YOUR_USERNAME/chatgpt-docker-puppeteer.git
cd chatgpt-docker-puppeteer

# Add upstream remote
git remote add upstream https://github.com/ORIGINAL_ORG/chatgpt-docker-puppeteer.git

# Verify remotes
git remote -v
# origin    https://github.com/YOUR_USERNAME/...  (seu fork)
# upstream  https://github.com/ORIGINAL_ORG/...   (repo original)
```

---

### 2. Criar Branch

```bash
# Atualizar main
git checkout main
git pull upstream main

# Criar feature branch (naming convention)
git checkout -b feature/add-claude-driver    # Nova feature
git checkout -b fix/p10-memory-leak          # Bug fix
git checkout -b docs/improve-readme          # Documentação
git checkout -b refactor/extract-logger      # Refactoring
git checkout -b perf/optimize-queue-scan     # Performance

# ❌ Evitar nomes genéricos
git checkout -b fix  # Muito vago
git checkout -b test # Não descritivo
```

**Convenção de nomes**:

- `feature/description` - Nova funcionalidade
- `fix/description` - Correção de bug
- `docs/description` - Documentação
- `refactor/description` - Refactoring (sem mudar comportamento)
- `perf/description` - Otimização de performance
- `test/description` - Adicionar/melhorar testes
- `chore/description` - Manutenção (deps, config)

---

### 3. Desenvolver

```bash
# Fazer mudanças
vim src/driver/targets/claude.js

# Testar localmente
make test-fast
make lint

# Commit frequente (commits pequenos são melhores)
git add src/driver/targets/claude.js
git commit -m "feat(driver): add Claude driver skeleton"

# Continuar desenvolvendo
vim tests/test_claude_driver.js
git add tests/test_claude_driver.js
git commit -m "test(driver): add Claude driver tests"
```

---

### 4. Conventional Commits

**Formato**: `type(scope): subject`

**Types**:

- `feat`: Nova feature
- `fix`: Bug fix
- `docs`: Documentação
- `style`: Formatação (sem mudança de lógica)
- `refactor`: Refactoring
- `perf`: Performance
- `test`: Testes
- `chore`: Manutenção (deps, build, config)
- `ci`: CI/CD (GitHub Actions)
- `revert`: Reverter commit anterior

**Scopes** (opcionais):

- `kernel`, `driver`, `nerv`, `infra`, `server`, `logic`, `core`, `docs`, `tests`

**Exemplos**:

```bash
# ✅ Corretos
git commit -m "feat(driver): add Claude support"
git commit -m "fix(kernel): P5.1 race condition in task allocation"
git commit -m "docs(canonical): add TESTING.md"
git commit -m "perf(infra): P9.4 queue cache with 5s TTL"
git commit -m "test(kernel): increase coverage to 75%"
git commit -m "chore(deps): update puppeteer to 22.0.0"

# ❌ Incorretos
git commit -m "fixed bug"  # Sem type/scope, vago
git commit -m "WIP"  # Não descritivo
git commit -m "Update"  # Muito genérico
```

**Breaking Changes**:

```bash
# Format: BREAKING CHANGE: description in footer
git commit -m "feat(kernel)!: change task state enum

BREAKING CHANGE: Task states now use uppercase (PENDING → pending)
Migration: Update all task.state checks to lowercase"
```

---

### 5. Push & PR

```bash
# Push to your fork
git push origin feature/add-claude-driver

# Se branch não existe no remote:
git push --set-upstream origin feature/add-claude-driver

# Abrir PR no GitHub
# https://github.com/YOUR_USERNAME/chatgpt-docker-puppeteer/compare
```

---

### 6. Atualizar Branch (Sync with Upstream)

```bash
# Fetch upstream
git fetch upstream

# Merge upstream/main into your branch
git checkout feature/add-claude-driver
git merge upstream/main

# Se houver conflitos:
# 1. Resolver conflitos manualmente
# 2. git add <arquivos-resolvidos>
# 3. git commit

# Push update
git push origin feature/add-claude-driver
```

---

### 7. Após Merge

```bash
# Deletar branch local
git branch -d feature/add-claude-driver

# Deletar branch remote
git push origin --delete feature/add-claude-driver

# Atualizar main
git checkout main
git pull upstream main
```

---

## 📝 Code Standards

### ESLint v9 (Flat Config)

**Config**: `eslint.config.mjs`

```javascript
export default [
  {
    files: ['src/**/*.js', 'tests/**/*.js'],
    languageOptions: {
      ecmaVersion: 2024,
      sourceType: 'module',
      globals: {
        require: 'readonly',
        module: 'readonly',
        process: 'readonly',
        __dirname: 'readonly',
      },
    },
    rules: {
      // Errors
      'no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
        },
      ],
      'no-undef': 'error',
      'no-redeclare': 'error',

      // Warnings
      'no-console': 'warn', // Use logger instead

      // Style
      'prefer-const': 'error',
      quotes: ['error', 'single', { avoidEscape: true }],
      semi: ['error', 'always'],
      indent: ['error', 4],
    },
  },
];
```

**Run**:

```bash
# Check
make lint  # ou npm run lint

# Fix auto-fixable issues
make format-code  # ou npx eslint . --fix
```

---

### Prettier

**Config**: `.prettierrc`

```json
{
  "singleQuote": true,
  "trailingComma": "es5",
  "tabWidth": 4,
  "printWidth": 120,
  "semi": true,
  "arrowParens": "always"
}
```

**VS Code** (auto-format on save):

```json
// .vscode/settings.json
{
  "editor.formatOnSave": true,
  "editor.defaultFormatter": "esbenp.prettier-vscode",
  "eslint.run": "onType",
  "eslint.format.enable": true
}
```

---

### Code Style Guidelines

**1. Use logger, not console**:

```javascript
// ❌ Não fazer
console.log('Task completed');

// ✅ Fazer
const logger = require('./core/logger');
logger.log('INFO', '[TASK] Task completed', taskId);
```

---

**2. Use constants, not magic strings**:

```javascript
// ❌ Magic strings
if (task.state === 'PENDING') { ... }

// ✅ Use constants
const { STATUS_VALUES } = require('./core/constants/tasks');
if (task.state === STATUS_VALUES.PENDING) { ... }
```

---

**3. Async/await over callbacks**:

```javascript
// ❌ Callbacks
fs.readFile('file.txt', (err, data) => {
  if (err) return callback(err);
  callback(null, data);
});

// ✅ Async/await
const fs = require('fs-extra');
try {
  const data = await fs.readFile('file.txt', 'utf8');
  return data;
} catch (err) {
  logger.log('ERROR', 'Failed to read file', null, err);
  throw err;
}
```

---

**4. Error handling**:

```javascript
// ❌ Silent failures
try {
  await riskyOperation();
} catch (err) {
  // Silently ignored
}

// ✅ Log + propagate
try {
  await riskyOperation();
} catch (err) {
  logger.log('ERROR', '[COMPONENT] Operation failed', taskId, err);
  throw err; // Propagate to caller
}
```

---

**5. Structured logging**:

```javascript
// ❌ Unstructured
logger.log('INFO', 'Task abc123 completed in 45s');

// ✅ Structured (easier to parse)
logger.log('INFO', '[TASK] Completed', taskId, {
  duration: 45000,
  responseLength: 1234,
  retries: 2,
});
```

---

## 🔍 PR Process

### PR Template

Ao abrir PR, use este template (`.github/PULL_REQUEST_TEMPLATE.md`):

```markdown
## Description

<!-- Brief description of changes (what and why) -->

Closes #123 <!-- Link related issues -->

## Type of Change

<!-- Mark with [x] -->

- [ ] 🐛 Bug fix (non-breaking)
- [ ] ✨ New feature (non-breaking)
- [ ] 💥 Breaking change (fix or feature that breaks existing functionality)
- [ ] 📝 Documentation
- [ ] 🧪 Tests
- [ ] ⚡ Performance improvement

## Testing

**How was this tested?**

<!-- Describe tests performed -->

- [ ] Unit tests added/updated
- [ ] Integration tests added/updated
- [ ] Manual testing performed
- [ ] Tested on Windows
- [ ] Tested on Linux
- [ ] Tested on macOS

## Checklist

- [ ] Tests pass locally (`make test-fast`)
- [ ] Lint passes (`make lint`)
- [ ] No console.logs (using logger)
- [ ] Documentation updated (if applicable)
- [ ] No decrease in coverage
- [ ] Conventional commits used
- [ ] Breaking changes documented (if applicable)
- [ ] Related issues linked

## Screenshots (if applicable)

<!-- Add screenshots for UI changes -->

## Additional Notes

<!-- Any extra context, concerns, or questions -->
```

---

### Review Process

**Reviewers verificam**:

1. **Funcionalidade**:
   - [ ] Código faz o que diz fazer?
   - [ ] Edge cases cobertos?
   - [ ] Testes suficientes?

2. **Qualidade**:
   - [ ] Segue code standards (ESLint, Prettier)?
   - [ ] Sem console.logs?
   - [ ] Error handling adequado?
   - [ ] Logging estruturado?

3. **Arquitetura**:
   - [ ] NERV-first communication?
   - [ ] Sem acoplamento direto (Layer 1 não acessa Layer 4)?
   - [ ] Segue patterns estabelecidos (Factory, Adapter, etc)?
   - [ ] Usa constants ao invés de magic strings?

4. **Documentação**:
   - [ ] README atualizado (se aplicável)?
   - [ ] API_REFERENCE.md atualizado (novos endpoints)?
   - [ ] Comentários em lógica complexa?
   - [ ] JSDoc para funções públicas?

5. **Tests**:
   - [ ] Coverage não caiu?
   - [ ] Tests passam em CI?
   - [ ] No flaky tests introduzidos?

6. **Security**:
   - [ ] Sem credenciais hardcoded?
   - [ ] Input validation (Zod)?
   - [ ] Path traversal protection (P8.7)?
   - [ ] Symlink attack protection (P8.8)?

---

### Review Guidelines

**Como revisar**:

✅ **Ser construtivo**:

```
❌ "This code is bad"
✅ "Consider using async/await here for better error handling"
```

✅ **Sugerir alternativas**:

```
❌ "Wrong pattern"
✅ "Instead of direct access, consider using the NERV event bus for decoupling"
```

✅ **Aprovar quando satisfeito**:

- Se mudanças menores: "LGTM, minor suggestions" + Approve
- Se críticas: "Request changes" + explicar blockers

✅ **Use GitHub suggestions** para fixes pequenos:

```diff
- console.log('Debug');
+ logger.log('DEBUG', 'Debug message');
```

❌ **Evitar**:

- Criticar estilo (Prettier auto-formata)
- Exigir perfeição (prefer progress over perfection)
- Bloquear por gostos pessoais (use team standards)

---

### Merge Strategy

**Preferência**: **Squash merge**

**Por quê?**:

- Limpa histórico (1 commit por PR)
- Preserva conventional commits
- Facilita `git revert` se necessário

**Exceção**: PRs grandes (>10 commits bem estruturados) → Merge commit

---

## 📋 Checklist de Contribuição

### Antes de Abrir PR

- [ ] Branch atualizada com upstream/main
- [ ] Conventional commits usados
- [ ] Tests passam (`make test-fast`)
- [ ] Lint passa (`make lint`)
- [ ] No console.logs
- [ ] Documentação atualizada
- [ ] Coverage não caiu

### Durante Review

- [ ] Responder comentários em até 48h
- [ ] Aplicar sugestões ou justificar decisão
- [ ] Atualizar branch se upstream mudou (`git merge upstream/main`)
- [ ] Re-executar tests após mudanças (`make test-all`)

### Após Aprovação

- [ ] Aguardar CI green (GitHub Actions)
- [ ] Squash commits se necessário
- [ ] Merge via GitHub UI (ou maintainer faz merge)
- [ ] Deletar branch (`git branch -d feature/xyz`)

---

## 🛠️ Requisitos de Documentação

### Features Novas

**Devem atualizar**:

- [ ] `README.md` - Quick Start (se aplicável)
- [ ] `API_REFERENCE.md` - Novos endpoints/eventos
- [ ] `CONFIGURATION.md` - Novos parâmetros
- [ ] `PATTERNS.md` - Novos padrões arquiteturais
- [ ] `GLOSSARY.md` - Novos termos técnicos

**Exemplo**: Adicionar Claude driver

1. `dynamic_rules.json` - Adicionar target `claude`
2. `API_REFERENCE.md` - Atualizar enum `target` em schemas
3. `GLOSSARY.md` - Adicionar "Claude" na lista de targets
4. `DEVELOPMENT.md` - Exemplo "Como adicionar novo LLM target"

---

### Breaking Changes

**Devem incluir**:

- [ ] `CHANGELOG.md` - Entrada na seção `## [Unreleased]`
- [ ] **Migration guide** no corpo do PR
- [ ] Atualizar `package.json` version (major bump)

**Exemplo**: Mudar task state enum (uppercase → lowercase)

````markdown
## Migration Guide: Task State Enum

**Breaking Change**: Task states agora usam lowercase.

**Before** (v1.x):

```javascript
if (task.state === 'PENDING') { ... }
```
````

**After** (v2.0):

```javascript
if (task.state === 'pending') { ... }
```

**Action Required**:

1. Update all `task.state` checks to lowercase
2. Update schemas in `src/core/schemas.js`
3. Re-run tests: `make test-all`

````

---

## 💬 Obter Ajuda

### Canais de Suporte

1. **GitHub Discussions**: Perguntas gerais, ideias
   - https://github.com/ORG/chatgpt-docker-puppeteer/discussions

2. **GitHub Issues**: Bugs, feature requests
   - Template: `.github/ISSUE_TEMPLATE/bug_report.md`
   - Template: `.github/ISSUE_TEMPLATE/feature_request.md`

3. **PR Comments**: Dúvidas sobre código específico
   - Reviewers respondem em até 48h

4. **Documentation**: Docs canônicos (16 documentos)
   - Start: [PHILOSOPHY.md](PHILOSOPHY.md)
   - FAQ: [FAQ.md](FAQ.md)

---

### Perguntas Frequentes

**Q**: Como rodar testes localmente?
**A**: `make test-fast` (5min) ou `make test-all` (15min). Ver [TESTING.md](TESTING.md).

**Q**: ESLint está falhando, como corrigir?
**A**: `make format-code` auto-corrige 90% dos erros.

**Q**: Meu PR foi rejeitado por coverage baixa, o que fazer?
**A**: Adicione testes para o código novo. Coverage mínima é 50%. Ver [TESTING.md](TESTING.md).

**Q**: Como adicionar novo LLM target?
**A**: Ver [DEVELOPMENT.md](DEVELOPMENT.md) seção "Adicionar Novo LLM Target".

**Q**: Posso usar TypeScript?
**A**: Futuro (roadmap Q2 2026). Por ora, apenas JavaScript + JSDoc.

**Q**: Como reportar security vulnerability?
**A**: Não abra issue pública. Email: security@project.com. Ver [SECURITY.md](SECURITY.md).

---

## 🎖️ Reconhecimento

Contribuidores são reconhecidos em:

1. **CHANGELOG.md** - Menciona autores em releases
2. **README.md** - Seção "Contributors" (auto-gerada)
3. **Commit history** - Preservado via conventional commits

**Top Contributors** (atualizado mensalmente):
```markdown
## 🏆 Top Contributors (Janeiro 2026)

1. @johndoe (25 commits, 10 PRs)
2. @janedoe (18 commits, 8 PRs)
3. @aiarchitect (50 commits, canonical docs)
````

---

## 📚 Referências

- [DEVELOPMENT.md](DEVELOPMENT.md) - Setup local, debugging
- [TESTING.md](TESTING.md) - Estratégia de testes
- [ARCHITECTURE_v2.md](ARCHITECTURE_v2.md) - Arquitetura NERV
- [PATTERNS.md](PATTERNS.md) - Padrões arquiteturais
- [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md) - Código de conduta

---

_Última revisão: 21/01/2026 | Contribuidores: AI Architect, Community Team_
