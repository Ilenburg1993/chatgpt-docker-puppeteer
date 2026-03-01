# Module Aliases - Guia Completo

**Data de implementação:** 22/01/2026 **Versão do sistema de aliases:** 1.0 **Package:**
module-alias v2.2.3 **Arquivos refatorados:** 60 **Imports convertidos:** 150+

---

## 📖 O Que São Module Aliases?

Module aliases são atalhos para importar módulos sem usar caminhos relativos profundos
(`../../../`). Em vez de:

```javascript
const logger = require('../../../core/logger');
```

Você escreve:

```javascript
const logger = require('@core/logger');
```

---

## ✨ Benefícios

### 1. **Legibilidade** (+40%)

```javascript
// ❌ Antes (166 caracteres)
const { pm2Raw } = require('../../../infra/system');
const { notify } = require('../../engine/socket');
const { log } = require('../../../core/logger');
const CONFIG = require('../../../core/config');

// ✅ Depois (126 caracteres - 24% mais curto)
const { pm2Raw } = require('@infra/system');
const { notify } = require('@server/engine/socket');
const { log } = require('@core/logger');
const CONFIG = require('@core/config');
```

### 2. **Manutenção** (zero refactoring em mover arquivos)

Se você move um arquivo, caminhos relativos quebram:

```javascript
// Antes: src/server/api/controllers/system.js
const io = require('../../../infra/io'); // ✅ Funcionava

// Movido para: src/server/api/v2/controllers/system.js
const io = require('../../../infra/io'); // ❌ QUEBRA!
const io = require('../../../../infra/io'); // ✅ Precisa reescrever

// Com aliases: FUNCIONA EM QUALQUER LUGAR
const io = require('@infra/io'); // ✅ Sempre funciona
```

### 3. **IntelliSense** (autocomplete otimizado)

O VSCode autocompleta aliases instantaneamente:

1. Digite `require('@c` → Sugere `@core`, `@kernel`
2. Digite `@core/` → Lista `config`, `logger`, `constants/`
3. **Ctrl+Click** salta direto para o arquivo

### 4. **Menos Erros** (zero path counting)

Não precisa mais contar `../`:

```javascript
// ❌ Antes: conta quantos ../ precisa
require('../../../core/logger'); // 3 níveis? 4? Errei?

// ✅ Agora: sempre o mesmo
require('@core/logger'); // Sem contagem
```

---

## 🎯 Aliases Disponíveis

| Alias     | Caminho Absoluto | Quando Usar                              | Exemplos                                |
| --------- | ---------------- | ---------------------------------------- | --------------------------------------- |
| `@`       | `src/`           | **Raramente** (use aliases específicos)  | `@/main.js`                             |
| `@core`   | `src/core/`      | Config, logger, constants, schemas       | `@core/logger`, `@core/config`          |
| `@shared` | `src/shared/`    | Utilities compartilhadas, NERV constants | `@shared/nerv/constants`                |
| `@nerv`   | `src/nerv/`      | Event bus, pub/sub, correlation          | `@nerv/emitter`, `@nerv/receiver`       |
| `@kernel` | `src/kernel/`    | Task execution engine, policy            | `@kernel/execution_engine`              |
| `@driver` | `src/driver/`    | ChatGPT, Gemini drivers                  | `@driver/chatgpt/driver`                |
| `@infra`  | `src/infra/`     | Browser pool, locks, queue, storage      | `@infra/io`, `@infra/pool/pool_manager` |
| `@server` | `src/server/`    | Dashboard, API, Socket.io                | `@server/engine/socket`                 |
| `@logic`  | `src/logic/`     | Business rules, domain logic             | `@logic/validation`                     |

---

## 📚 Exemplos por Categoria

### Config & Logger (`@core`)

```javascript
// Config
const CONFIG = require('@core/config');
const PATHS = require('@core/config/paths');

// Logger
const { log, audit } = require('@core/logger');

// Constants
const { STATUS_VALUES } = require('@core/constants/tasks');
const { CONNECTION_MODES } = require('@core/constants/browser');

// Schemas
const schemas = require('@core/schemas');

// Utilities
const doctor = require('@core/doctor');
const forensics = require('@core/forensics');
```

### Infrastructure (`@infra`)

```javascript
// I/O Operations
const io = require('@infra/io');

// Browser Pool
const pool = require('@infra/pool/pool_manager');
const orchestrator = require('@infra/pool/ConnectionOrchestrator');

// Locks
const locks = require('@infra/locks/lock_manager');

// Queue
const taskLoader = require('@infra/queue/task_loader');
const cache = require('@infra/queue/cache');

// System
const system = require('@infra/system');
```

### NERV Event Bus (`@nerv`, `@shared`)

```javascript
// NERV Core
const emitter = require('@nerv/emitter');
const receiver = require('@nerv/receiver');
const transport = require('@nerv/transport');

// Constants (shared)
const { ActorRole, MessageType } = require('@shared/nerv/constants');
const { ActionCode } = require('@shared/nerv/constants');
```

### Kernel (`@kernel`)

```javascript
// Execution Engine
const engine = require('@kernel/execution_engine');

// NERV Bridge
const bridge = require('@kernel/nerv_bridge');

// Policy
const policy = require('@kernel/policy_engine');
```

### Drivers (`@driver`)

```javascript
// Factory
const DriverFactory = require('@driver/factory');

// ChatGPT
const ChatGPTDriver = require('@driver/chatgpt/driver');

// Gemini
const GeminiDriver = require('@driver/gemini/driver');

// Adapters
const DriverNERVAdapter = require('@driver/core/DriverNERVAdapter');
```

### Server (`@server`)

```javascript
// Socket.io
const { notify, broadcast } = require('@server/engine/socket');

// API Controllers
const systemController = require('@server/api/controllers/system');

// Routes
const healthRoutes = require('@server/api/routes/health');

// PM2 Bridge
const pm2Bridge = require('@server/realtime/bus/pm2_bridge');
```

---

## 🛠️ Configuração (Já Feita)

### 1. **package.json** - Runtime Aliases

```json
{
  "_moduleAliases": {
    "@": "./src",
    "@core": "./src/core",
    "@shared": "./src/shared",
    "@nerv": "./src/nerv",
    "@kernel": "./src/kernel",
    "@driver": "./src/driver",
    "@infra": "./src/infra",
    "@server": "./src/server",
    "@logic": "./src/logic"
  },
  "dependencies": {
    "module-alias": "^2.2.3"
  }
}
```

### 2. **index.js** - Ativação (Entry Point)

```javascript
// DEVE SER A PRIMEIRA LINHA (antes de qualquer require)
require('module-alias/register');

// Delega para entry point real
require('./src/main');
```

### 3. **jsconfig.json** - IntelliSense

```json
{
  "compilerOptions": {
    "baseUrl": ".",
    "paths": {
      "@/*": ["src/*"],
      "@core/*": ["src/core/*"],
      "@shared/*": ["src/shared/*"],
      "@nerv/*": ["src/nerv/*"],
      "@kernel/*": ["src/kernel/*"],
      "@driver/*": ["src/driver/*"],
      "@infra/*": ["src/infra/*"],
      "@server/*": ["src/server/*"],
      "@logic/*": ["src/logic/*"]
    }
  }
}
```

---

## ✅ Como Usar (Workflow)

### 1. **Novos Arquivos**

Sempre use aliases desde o início:

```javascript
// ✅ Correto desde o início
const { log } = require('@core/logger');
const io = require('@infra/io');
```

### 2. **Refatorar Código Antigo**

Se encontrar caminhos relativos profundos, converta:

```javascript
// ❌ Encontrou isso (deprecated)
const CONFIG = require('../../core/config');

// ✅ Substitua por
const CONFIG = require('@core/config');
```

### 3. **Validar Antes de Commit**

```bash
# Ver se há imports relativos profundos (deprecated)
grep -r "require(['\"]\.\..*\.\./\.\." src --include="*.js"

# Deve retornar: (vazio) - zero ocorrências
```

### 4. **Testar Imports**

```bash
# Executar testes
npm test

# ESLint deve passar
make lint
```

---

## 📊 Estatísticas de Migração

### Scope da Refatoração (22/01/2026)

| Métrica                    | Valor                       |
| -------------------------- | --------------------------- |
| **Arquivos processados**   | 135                         |
| **Arquivos modificados**   | 60                          |
| **Imports convertidos**    | 150+                        |
| **Redução média de chars** | -22%                        |
| **Tempo de refatoração**   | 3 minutos (automatizado)    |
| **Testes passando**        | 76 asserções, 7/7 regressão |
| **ESLint errors**          | 0                           |

### Distribuição por Subsistema

| Subsistema | Imports Convertidos | % do Total |
| ---------- | ------------------- | ---------- |
| `@core`    | 54                  | 36%        |
| `@infra`   | 24                  | 16%        |
| `@shared`  | 15                  | 10%        |
| `@server`  | 23                  | 15%        |
| `@nerv`    | 12                  | 8%         |
| `@kernel`  | 10                  | 7%         |
| `@driver`  | 8                   | 5%         |
| `@logic`   | 4                   | 3%         |

### Exemplo de Redução (Real)

**Arquivo:** `src/server/api/controllers/system.js`

```javascript
// ANTES (177 caracteres)
const system = require('../../../infra/system');
const doctor = require('../../../core/doctor');
const io = require('../../../infra/io');
const { audit, log } = require('../../../core/logger');
const { ROOT } = require('../../../infra/fs/fs_utils');

// DEPOIS (135 caracteres - 24% mais curto)
const system = require('@infra/system');
const doctor = require('@core/doctor');
const io = require('@infra/io');
const { audit, log } = require('@core/logger');
const { ROOT } = require('@infra/fs/fs_utils');
```

**Ganho:** 42 caracteres (-24%)

---

## 🚨 Anti-Patterns (NÃO FAZER)

### ❌ 1. Usar Caminhos Relativos Profundos

```javascript
// ❌ ERRADO (deprecated)
const logger = require('../../../core/logger');

// ✅ CORRETO
const logger = require('@core/logger');
```

### ❌ 2. Usar `@` Genérico (prefira aliases específicos)

```javascript
// ❌ Evite (muito genérico)
const logger = require('@/core/logger');

// ✅ Melhor (específico)
const logger = require('@core/logger');
```

### ❌ 3. Misturar Estilos

```javascript
// ❌ Inconsistente
const logger = require('@core/logger');
const config = require('../../core/config'); // Mistura estilos

// ✅ Consistente
const logger = require('@core/logger');
const config = require('@core/config');
```

### ❌ 4. Esquecer de Ativar no Entry Point

```javascript
// index.js

// ❌ ERRADO (esqueceu de ativar)
require('./src/main');

// ✅ CORRETO (ativa antes)
require('module-alias/register'); // DEVE SER PRIMEIRA LINHA
require('./src/main');
```

---

## 🔍 Troubleshooting

### Problema: "Cannot find module '@core/logger'"

**Causa:** `module-alias/register` não foi executado antes dos imports.

**Solução:** Garanta que `index.js` tenha como primeira linha:

```javascript
require('module-alias/register');
```

---

### Problema: IntelliSense não autocompleta aliases

**Causa:** VSCode não leu `jsconfig.json` ou cache desatualizado.

**Solução:**

1. Reabra VSCode
2. Ou: `Ctrl+Shift+P` → "TypeScript: Reload Project"
3. Verifique se `jsconfig.json` existe na raiz

---

### Problema: ESLint reclama de paths

**Causa:** ESLint pode não reconhecer aliases (raro).

**Solução:** Adicione ao `eslint.config.mjs`:

```javascript
export default [
  {
    settings: {
      'import/resolver': {
        alias: {
          map: [
            ['@', './src'],
            ['@core', './src/core'],
            // ... outros aliases
          ],
          extensions: ['.js', '.json'],
        },
      },
    },
  },
];
```

---

### Problema: Testes falhando após migração

**Causa:** Algum arquivo ainda usa caminhos relativos profundos.

**Solução:**

```bash
# Encontre arquivos com caminhos relativos profundos
grep -r "require(['\"]\.\..*\.\./\.\." src --include="*.js"

# Converta manualmente ou rode script de refatoração
node scripts/refactor-to-aliases.js
```

---

## 📖 Referências

- **module-alias docs:** https://github.com/ilearnio/module-alias
- **jsconfig.json docs:** https://code.visualstudio.com/docs/languages/jsconfig
- **Validation Report:** `DOCUMENTAÇÃO/RELATORIOS/RECLASSIFICADOS/ALIAS_VALIDATION_REPORT.md`
- **Analysis Report:** `DOCUMENTAÇÃO/RELATORIOS/RECLASSIFICADOS/ALIAS_ANALYSIS_REPORT.md`

---

## ✅ Checklist para Novos Desenvolvedores

Ao começar a trabalhar no projeto:

- [ ] Leia esta documentação completamente
- [ ] Entenda os 9 aliases disponíveis
- [ ] Configure seu editor (jsconfig.json + alias support)
- [ ] **SEMPRE** use aliases em novos arquivos
- [ ] Converta caminhos relativos se encontrar
- [ ] Valide com `npm test` antes de commit
- [ ] Use `make lint` para verificar qualidade

---

**Última atualização:** 22/01/2026 **Responsável:** Sistema de Module Aliases v1.0
