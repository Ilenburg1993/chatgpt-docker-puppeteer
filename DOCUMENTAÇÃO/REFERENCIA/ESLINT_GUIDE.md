# ESLint Guide - Chatgpt Docker Puppeteer

## 📋 Configuração

Sistema configurado com **ESLint v9** (Flat Config) + plugins oficiais.

### Arquivos de Configuração

```
eslint.config.mjs         → Config principal (ESLint v9 Flat Config)
.vscode/settings.json     → Integração VS Code
jsconfig.json             → Type checking JavaScript
package.json              → Scripts npm
```

---

## 🚀 Comandos Disponíveis

### Lint Básico

```bash
npm run lint       # Verifica todo o projeto
npm run lint:src   # Verifica apenas src/
npm run lint:tests # Verifica apenas tests/
```

### Auto-Fix

```bash
npm run lint:fix # Corrige problemas automaticamente
```

### Relatórios

```bash
npm run lint:report # Gera relatório em logs/eslint-report.txt
```

### VS Code (Auto-fix ao salvar)

- ESLint roda automaticamente ao digitar
- Auto-fix ao salvar arquivo (Ctrl+S / Cmd+S)
- Indicadores inline de erros/warnings

---

## 📐 Regras Configuradas

### 🔴 Erros Críticos (Bloqueiam PR)

**Segurança**:

- `no-eval`: Proíbe eval()
- `no-implied-eval`: Proíbe setTimeout/setInterval com strings
- `no-new-func`: Proíbe new Function()

**Qualidade de Código**:

- `eqeqeq`: Força === ao invés de ==
- `no-undef`: Variáveis não definidas
- `curly`: Força chaves em if/else/for/while

**Async/Await**:

- `no-async-promise-executor`: Evita async em Promise constructor
- `prefer-promise-reject-errors`: Reject com Error objects

### ⚠️ Warnings (Recomendações)

**Variáveis**:

- `no-unused-vars`: Variáveis não usadas (exceto prefixo `_`)
- `no-shadow`: Redeclaração de variáveis
- `prefer-const`: Usa const quando possível

**Complexidade**:

- `complexity`: Máx 15 caminhos por função
- `max-depth`: Máx 4 níveis de aninhamento
- `max-params`: Máx 5 parâmetros
- `max-lines-per-function`: Máx 150 linhas

**Estilo**:

- `semi`: Força ponto-e-vírgula
- `quotes`: Aspas simples (exceto em templates)
- `indent`: 4 espaços
- `no-trailing-spaces`: Remove espaços no final

---

## 🎯 Arquitetura Específica

### Domain-Driven Design

**Complexidade Controlada**:

```javascript
// ✅ BOM: Função focada
async function processTask(task) {
  validateTask(task);
  const result = await executeTask(task);
  return result;
}

// ❌ EVITAR: Função com muita complexidade
async function processTask(task) {
  if (!task) return;
  if (task.type === 'A') {
    if (task.priority > 5) {
      // 15+ caminhos lógicos aqui...
    }
  }
  // complexity: 18 → WARNING
}
```

### Zero-Coupling via NERV

**Importações**:

```javascript
// ✅ BOM: Usa NERV para comunicação
const nerv = require('../nerv/nerv');
nerv.emit('TASK_STARTED', {...});

// ❌ EVITAR: Importação direta entre módulos
const kernel = require('../kernel/kernel'); // Viola zero-coupling
```

### Audit Levels

**Comentários Estruturados**:

```javascript
/* ==========================================================================
   src/module/file.js
   Audit Level: 700 — Descrição
   Status: CONSOLIDATED
========================================================================== */
```

ESLint preserva esses headers (regra `spaced-comment`).

---

## 🔧 Exceções e Overrides

### Testes (tests/\*)

Regras relaxadas:

- `no-console`: OFF (logs em testes permitidos)
- `max-lines-per-function`: OFF
- `complexity`: 20 (ao invés de 15)

### Scripts (scripts/\*)

Mesmas exceções dos testes.

### Config Files (\*.config.js)

Source type: `module` (ESM ao invés de CommonJS)

---

## 📊 Plugins Instalados

| Plugin             | Uso              | Files                     |
| ------------------ | ---------------- | ------------------------- |
| `@eslint/js`       | JavaScript base  | `**/*.js`                 |
| `@eslint/json`     | JSON validation  | `**/*.json`, `**/*.jsonc` |
| `@eslint/markdown` | Markdown linting | `**/*.md`                 |
| `@eslint/css`      | CSS validation   | `**/*.css`                |

---

## 🚫 Arquivos Ignorados

```javascript
ignores: [
  '**/node_modules/**',
  '**/logs/**',
  '**/fila/**', // Arquivos de fila
  '**/respostas/**', // Outputs de tarefas
  '**/profile/**', // Perfis Chromium
  '**/tmp/**',
  '**/*.min.js',
  'public/js/libs/**',
];
```

---

## 🛠️ Troubleshooting

### ESLint não está rodando

```bash
# Verificar instalação
npx eslint --version

# Recarregar VS Code
Ctrl+Shift+P → "Developer: Reload Window"
```

### Muitos warnings

```bash
# Ver apenas erros
npm run lint -- --quiet

# Fixar automaticamente
npm run lint:fix
```

### Configuração customizada

Editar [eslint.config.mjs](../eslint.config.mjs):

```javascript
rules: {
  "no-console": "off",  // Exemplo: permitir console.log
}
```

---

## 📚 Referências

- [ESLint v9 Docs](https://eslint.org/docs/latest/)
- [Flat Config Guide](https://eslint.org/docs/latest/use/configure/configuration-files)
- [Rules Reference](https://eslint.org/docs/latest/rules/)

---

## 🎓 Boas Práticas

### 1. Use const por padrão

```javascript
// ✅ BOM
const config = require('./config');

// ⚠️ EVITAR
let config = require('./config');
```

### 2. Prefixe variáveis não usadas com \_

```javascript
// ✅ BOM
app.use((req, res, _next) => {
  res.send('OK');
});

// ⚠️ WARNING: _next não usado
app.use((req, res, next) => {
  res.send('OK');
});
```

### 3. Use === ao invés de ==

```javascript
// ✅ BOM
if (value === null) { ... }

// ❌ ERRO
if (value == null) { ... }
```

### 4. Sempre use async/await corretamente

```javascript
// ✅ BOM
async function loadData() {
  const data = await fetchData();
  return data;
}

// ❌ ERRO: no-return-await
async function loadData() {
  return await fetchData();
}
```

### 5. Limite complexidade

```javascript
// ✅ BOM: Extrair lógica complexa
function validateTask(task) {
  if (!isValidType(task.type)) return false;
  if (!isValidPriority(task.priority)) return false;
  return true;
}

// ❌ EVITAR: If aninhado demais
function validateTask(task) {
  if (task) {
    if (task.type) {
      if (task.type === 'A') {
        if (task.priority) {
          // complexity > 15
        }
      }
    }
  }
}
```

---

**Última atualização**: 2026-01-20
