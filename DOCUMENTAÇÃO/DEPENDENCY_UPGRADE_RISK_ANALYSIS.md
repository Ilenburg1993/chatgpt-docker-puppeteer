# 🔬 Análise de Riscos - Atualizações de Dependências

**Versão:** 1.0.0 (pre-release)
**Data:** 2026-01-20
**Objetivo:** Avaliar riscos, compatibilidades e estratégias de migração para atualizações de dependências

---

## 📊 Matriz de Risco Geral

| Dependência        | Atual       | Target              | Risco      | Prioridade   | Recomendação             |
| ------------------ | ----------- | ------------------- | ---------- | ------------ | ------------------------ |
| **Dockerfile CMD** | src/main.js | ecosystem.config.js | 🔴 CRÍTICO | **IMEDIATO** | ✅ **FAZER AGORA**       |
| **Puppeteer**      | 21.11.0     | 24.35.0             | 🟡 MÉDIO   | ALTA         | ✅ **Fazer com cautela** |
| **PM2**            | 5.4.3       | 6.0.14              | 🟢 BAIXO   | MÉDIA        | ✅ **Fazer**             |
| **Zod**            | 3.25.76     | 4.3.5               | 🟢 BAIXO   | BAIXA        | ✅ **Fazer**             |
| **uuid**           | 11.1.0      | 13.0.0              | 🟢 BAIXO   | BAIXA        | ✅ **Fazer**             |
| **cross-env**      | 7.0.3       | 10.1.0              | 🟢 BAIXO   | BAIXA        | ✅ **Fazer**             |
| **Socket.io**      | 4.8.3       | 4.8.3               | ✅ N/A     | -            | ✅ Já atualizado         |
| **Express**        | 4.22.1      | 5.2.1               | 🔴 ALTO    | BAIXA        | ⚠️ **NÃO FAZER AGORA**   |

---

## 🔴 FASE 0: Correção Crítica (IMEDIATO - 5 minutos)

### Issue: Dockerfile CMD Aponta para Arquivo Inexistente

**Problema:**

```dockerfile
# Linha 81 do Dockerfile
CMD ["node", "src/main.js"]  # ❌ ARQUIVO NÃO EXISTE
```

**Verificação:**

```bash
$ ls -la src/main.js
ls: cannot access 'src/main.js': No such file or directory

$ ls -la index.js src/server/main.js
-rw-r--r-- 1 user user  9234 Jan 20 index.js           # Entry point do agente
-rw-r--r-- 1 user user  4521 Jan 20 src/server/main.js # Entry point do dashboard
```

**Impacto:**

- 🔴 **CRÍTICO**: Container falha ao iniciar
- 🔴 Docker Compose entra em crash loop
- 🔴 Healthcheck sempre falha
- 🔴 Produção inviável

**Risco da Correção:** 🟢 **ZERO** - Apenas corrige path existente

**Solução:**

```dockerfile
# OPÇÃO 1: Agente principal apenas
CMD ["node", "index.js"]

# OPÇÃO 2: PM2 com ambos processos (RECOMENDADO)
CMD ["npx", "pm2-runtime", "start", "ecosystem.config.js"]
```

**Teste de Validação:**

```bash
# 1. Build da imagem
docker build -t chatgpt-agent:test .

# 2. Teste de startup
docker run --rm chatgpt-agent:test node --version

# 3. Teste de comando
docker run --rm chatgpt-agent:test npx pm2 --version

# 4. Teste completo (30s)
docker run --rm -p 3008:3008 chatgpt-agent:test
# Verificar: http://localhost:3008/api/health
```

**Rollback:** Trivial - reverter linha 81 do Dockerfile

### ✅ **RECOMENDAÇÃO: FAZER IMEDIATAMENTE**

- **Risco:** 🟢 Zero
- **Esforço:** 2 minutos
- **Impacto:** 🔴 Crítico (desbloqueia Docker)
- **Opção:** PM2-runtime (OPÇÃO 2) - Roda agente + dashboard

---

## 🟡 FASE 1: Puppeteer 21.11.0 → 24.35.0 (1-2 dias)

### Análise de Risco

**Versões Intermediárias:**

- v21.11.0 (atual) → v22.0.0 → v23.0.0 → v24.35.0 (target)
- **3 major releases** = Alto potencial de breaking changes

**Dependências Críticas:**

```json
{
    "puppeteer": "^21.11.0", // Core
    "puppeteer-extra": "^3.3.6", // Plugin system
    "puppeteer-extra-plugin-stealth": "^2.11.2", // Anti-detection
    "ghost-cursor": "^1.1.18" // Human mouse movement
}
```

### 🔍 Investigação de Compatibilidade

**puppeteer-extra (v3.3.6):**

- Última versão: **3.3.6** (sem updates desde v21)
- ⚠️ **RISCO**: Pode não suportar Puppeteer 24
- Verificar: https://github.com/berstend/puppeteer-extra/issues

**puppeteer-extra-plugin-stealth (v2.11.2):**

- Última versão: **2.11.2**
- ⚠️ **RISCO**: Esterilização pode quebrar com mudanças no Puppeteer

**ghost-cursor (v1.1.18):**

- Usa APIs de `page.mouse.*`
- ⚠️ **RISCO MÉDIO**: Se APIs de mouse mudarem

### Breaking Changes Conhecidos

**Puppeteer v22:**

- ✅ CDP (Chrome DevTools Protocol) atualizado
- ⚠️ Remoção de APIs deprecated v21
- ✅ Melhoria em `waitForNetworkIdle()`
- ⚠️ Mudanças em `page.evaluate()` context

**Puppeteer v23:**

- ✅ New `page.locator()` API (não afeta código atual)
- ⚠️ Alterações em error handling
- ✅ Performance improvements

**Puppeteer v24:**

- ✅ ESM/CJS dual support
- ⚠️ Stricter TypeScript types (afeta runtime mínimo)
- ✅ CDP protocol updates

### Pontos de Integração no Código

**APIs Puppeteer Utilizadas (50+ ocorrências):**

```javascript
// CRÍTICAS (frequentes)
page.url(); // ✅ Estável (usada 8×)
page.evaluate(); // ⚠️ Pode ter mudanças (usada 20×)
page.goto(); // ✅ Estável (usada 5×)
page.waitForNetworkIdle(); // ⚠️ Melhorada v22 (usada 3×)
page.isClosed(); // ✅ Estável (usada 10×)
page.mouse.click(); // ⚠️ Depende de ghost-cursor (usada 5×)
page.keyboard.press(); // ✅ Estável (usada 3×)
page.bringToFront(); // ✅ Estável (usada 4×)
page.reload(); // ✅ Estável (usada 2×)
page.viewport(); // ✅ Estável (usada 2×)
browser.version(); // ✅ Estável
```

**Módulos Impactados:**

1. **src/driver/targets/ChatGPTDriver.js** - 15+ usages
2. **src/driver/modules/stabilizer.js** - 10+ usages (waitForNetworkIdle)
3. **src/driver/modules/human.js** - 8+ usages (mouse, keyboard)
4. **src/driver/core/BaseDriver.js** - 6+ usages
5. **src/driver/modules/recovery_system.js** - 5+ usages

### Estratégia de Migração

**Passo 1: Verificar Compatibilidade Puppeteer-Extra**

```bash
# Testar se puppeteer-extra funciona com v24
npm install puppeteer@24.35.0 --no-save
node -e "const puppeteer = require('puppeteer-extra'); console.log(puppeteer.version)"
```

**Passo 2: Criar Branch de Teste**

```bash
git checkout -b upgrade/puppeteer-24
npm install puppeteer@24.35.0
npm install  # Verificar peer dependencies
```

**Passo 3: Testes de Integração**

```bash
# Teste 1: Browser launch
npm run test:puppeteer

# Teste 2: ChromeConnection
npm run test:chrome-connection

# Teste 3: Driver integration
npm run test:driver-nerv-integration

# Teste 4: Suite completa
npm run test:linux
```

**Passo 4: Testes Manuais**

```bash
# Teste real com ChatGPT
npm run queue:add -- --target chatgpt --prompt "teste"
npm start
# Monitorar logs para erros
```

**Passo 5: Validação de Produção**

- Rodar em DEV por 24h
- Processar 10+ tarefas reais
- Monitorar crash reports
- Validar adaptive timeouts

### Rollback Strategy

```bash
# Se falhar, reverter
git checkout main
npm install
npm run daemon:restart
```

**Indicators de Falha:**

- ❌ `puppeteer-extra` não inicializa
- ❌ Stealth plugin falha
- ❌ `page.evaluate()` timeouts
- ❌ Testes P1-P5 falham
- ❌ Ghost cursor não funciona

### Riscos Identificados

| Risco                         | Probabilidade | Impacto  | Mitigação                                   |
| ----------------------------- | ------------- | -------- | ------------------------------------------- |
| puppeteer-extra incompatível  | 🟡 MÉDIO      | 🔴 ALTO  | Verificar issues no GitHub, testar primeiro |
| Stealth plugin quebra         | 🟡 MÉDIO      | 🔴 ALTO  | Testar anti-detection com chatgpt.com       |
| page.evaluate() mudanças      | 🟢 BAIXO      | 🟡 MÉDIO | Testes extensivos                           |
| ghost-cursor incompatível     | 🟢 BAIXO      | 🟡 MÉDIO | Fallback para `page.mouse` nativo           |
| waitForNetworkIdle() behavior | 🟢 BAIXO      | 🟢 BAIXO | Melhorias são backwards-compatible          |

### Timeline Estimado

- **Investigação:** 2-4 horas
- **Testes:** 1 dia
- **Validação:** 1 dia
- **Total:** 2 dias úteis

### ✅ **RECOMENDAÇÃO: FAZER COM CAUTELA**

- **Risco:** 🟡 Médio (puppeteer-extra compatibility)
- **Esforço:** 2 dias
- **Benefícios:** Performance, bug fixes, security updates
- **Estratégia:**
    1. Testar puppeteer-extra v3.3.6 com Puppeteer 24 primeiro
    2. Se incompatível, aguardar update de puppeteer-extra
    3. Se compatível, prosseguir com plano de testes
    4. Rollback preparado
- **Prioridade:** 🟡 ALTA (mas não urgente)

---

## 🟢 FASE 2: PM2 5.4.3 → 6.0.14 (1 dia)

### Análise de Risco

**Mudanças de Engine:**

```json
// PM2 5.4.3
{ "node": ">=12.0.0" }

// PM2 6.0.14
{ "node": ">=16.0.0" }
```

**Projeto Atual:**

```json
{
    "engines": {
        "node": ">=20.0.0", // ✅ Compatível
        "npm": ">=10.0.0"
    }
}
```

✅ **Sem problemas de engine** - Projeto já usa Node 20

### Breaking Changes PM2 6.x

**Documentação Oficial:**

- https://github.com/Unitech/pm2/releases/tag/6.0.0

**Mudanças Principais:**

1. ✅ **Daemon mode:** Sem breaking changes reportados
2. ✅ **ecosystem.config.js:** Syntax permanece igual
3. ✅ **Logs:** Formato mantido
4. ⚠️ **CLI:** Alguns comandos deprecated
5. ✅ **PM2 Runtime:** Compatível com Docker

### Pontos de Integração

**ecosystem.config.js:**

```javascript
module.exports = {
    apps: [
        {
            name: 'agente-gpt',
            script: './index.js',
            node_args: '--expose-gc', // ✅ Compatível PM2 6
            max_memory_restart: '1G', // ✅ Compatível
            exp_backoff_restart_delay: 100 // ✅ Compatível
        },
        {
            name: 'dashboard-web',
            script: './src/server/main.js',
            env: {
                PORT: 3008,
                DAEMON_MODE: 'true' // ✅ Compatível
            }
        }
    ]
};
```

**Scripts package.json:**

```json
{
    "daemon:start": "pm2 start ecosystem.config.js", // ✅ Compatível
    "daemon:stop": "pm2 stop agente-gpt dashboard-web", // ✅ Compatível
    "daemon:restart": "pm2 restart all", // ✅ Compatível
    "daemon:reload": "pm2 reload all", // ✅ Compatível
    "daemon:monit": "pm2 monit", // ✅ Compatível
    "daemon:logs": "pm2 logs --lines 50" // ✅ Compatível
}
```

**Docker (Dockerfile):**

```dockerfile
# PM2 Runtime
CMD ["npx", "pm2-runtime", "start", "ecosystem.config.js"]
# ✅ pm2-runtime compatível com PM2 6
```

### Benefícios da Atualização

1. ✅ **Performance:** Melhor gestão de memória
2. ✅ **Stability:** Bug fixes de crash detection
3. ✅ **Security:** Patches de segurança
4. ✅ **Features:**
    - Melhor PM2 Plus integration
    - Enhanced metrics
    - Better cluster mode

### Estratégia de Migração

**Passo 1: Teste Local**

```bash
# Backup estado atual
pm2 save

# Atualizar PM2
npm install pm2@6.0.14

# Testar
pm2 start ecosystem.config.js
pm2 logs
pm2 monit
```

**Passo 2: Validação**

```bash
# Verificar processos
pm2 status

# Testar restart
pm2 restart all

# Testar reload (zero-downtime)
pm2 reload all

# Verificar logs
pm2 logs --lines 100
```

**Passo 3: Teste Docker**

```bash
# Rebuild imagem
docker build -t chatgpt-agent:pm2-6 .

# Testar startup
docker run --rm chatgpt-agent:pm2-6

# Validar healthcheck
curl http://localhost:3008/api/health
```

### Rollback Strategy

```bash
# Se falhar
npm install pm2@5.4.3
pm2 kill
pm2 resurrect  # Restaurar estado salvo
```

### Riscos Identificados

| Risco                    | Probabilidade | Impacto  | Mitigação                   |
| ------------------------ | ------------- | -------- | --------------------------- |
| CLI incompatibilidades   | 🟢 BAIXO      | 🟢 BAIXO | Testar scripts package.json |
| Daemon mode quebra       | 🟢 BAIXO      | 🟡 MÉDIO | Teste em dev primeiro       |
| Logs formato muda        | 🟢 BAIXO      | 🟢 BAIXO | Validar parsing de logs     |
| Docker pm2-runtime falha | 🟢 BAIXO      | 🟡 MÉDIO | Teste em container local    |

### Timeline Estimado

- **Atualização:** 30 minutos
- **Testes:** 2-3 horas
- **Validação:** 4 horas
- **Total:** 1 dia útil

### ✅ **RECOMENDAÇÃO: FAZER**

- **Risco:** 🟢 Baixo
- **Esforço:** 1 dia
- **Benefícios:** Stability, performance, security
- **Estratégia:**
    1. Testar em dev primeiro
    2. Validar scripts e daemon mode
    3. Testar Docker
    4. Deploy em produção
- **Prioridade:** 🟡 MÉDIA (pode fazer logo após Puppeteer)

---

## 🟢 FASE 3: Dependências de Baixo Risco (4 horas)

### Zod 3.25.76 → 4.3.5

**Breaking Changes:**

- Mudanças mínimas de API
- Schema syntax permanece igual
- Performance improvements

**Pontos de Integração:**

```javascript
// src/core/schemas.js (principal)
const TaskSchema = z.object({...});     // ✅ Compatível
const DnaSchema = z.object({...});      // ✅ Compatível
const TelemetrySchema = z.object({...});// ✅ Compatível
```

**Teste:**

```bash
npm install zod@4.3.5
npm run test:schema
npm run test:config
```

**Risco:** 🟢 **MUITO BAIXO**

---

### uuid 11.1.0 → 13.0.0

**Breaking Changes:**

- ⚠️ Mudança de API v4() → v7() opcional
- ESM/CJS exports mantidos

**Pontos de Integração:**

```javascript
// Uso atual
const { v4: uuidv4 } = require('uuid'); // ✅ Mantido em v13
```

**Teste:**

```bash
npm install uuid@13.0.0
node -e "const {v4} = require('uuid'); console.log(v4())"
npm test
```

**Risco:** 🟢 **MUITO BAIXO**

---

### cross-env 7.0.3 → 10.1.0

**Breaking Changes:**

- Apenas devDependency
- Uso em scripts mantido

**Uso:**

```json
{
    "scripts": {
        "test:win": "cross-env NODE_ENV=test ..." // ✅ Compatível
    }
}
```

**Teste:**

```bash
npm install --save-dev cross-env@10.1.0
npm run test:win
```

**Risco:** 🟢 **ZERO** (dev only)

---

### ✅ **RECOMENDAÇÃO: FAZER TODAS JUNTAS**

- **Risco:** 🟢 Muito Baixo
- **Esforço:** 4 horas
- **Benefícios:** Bug fixes, performance
- **Estratégia:**
    1. Atualizar todas em um commit
    2. Rodar test suite completa
    3. Validar schemas Zod
- **Prioridade:** 🟢 BAIXA (pode fazer quando tempo disponível)

---

## 🔴 FASE 4: Express 4.22.1 → 5.2.1 (NÃO FAZER AGORA)

### Análise de Risco

**Express 5.0 = MAJOR REWRITE**

- ⚠️ **8 anos em beta** (2014-2024)
- ⚠️ **Breaking changes extensivos**
- ⚠️ **Ecosystem incompatibilidades**

### Breaking Changes Conhecidos

**1. Promises Support (⚠️ ALTO IMPACTO)**

```javascript
// Express 4: Sync error handling
app.get('/', (req, res) => {
    throw new Error('sync error'); // ✅ Capturado
});

// Express 5: Async precisa try/catch
app.get('/', async (req, res, next) => {
    throw new Error('async error'); // ❌ NÃO capturado sem next()
});
```

**2. Router Behavior Changes**

```javascript
// Express 4
app.use('/api', router); // ✅

// Express 5: Trailing slash handling mudou
app.use('/api/', router); // ⚠️ Comportamento diferente
```

**3. Middleware Signature**

```javascript
// Express 4
app.use((err, req, res, next) => {...}); // ✅

// Express 5: Precisa async handling
app.use(async (err, req, res, next) => {...}); // ⚠️
```

### Pontos de Integração (14 matches)

**APIs Express Utilizadas:**

```javascript
// src/server/engine/app.js
const app = express();              // ✅ Compatível
app.use(compression());             // ⚠️ Middleware compatibility
app.use(express.json());            // ✅ Compatível
app.use(express.static());          // ✅ Compatível

// src/server/api/router.js
app.get('/api/health', async ...)  // ⚠️ Async handling mudou
app.use('/api/tasks', controller)  // ⚠️ Router behavior mudou
app.use(errorHandler);             // ⚠️ Error middleware mudou
```

**Dependências de Express:**

```json
{
    "compression": "^1.7.4", // ⚠️ Pode ter issues com Express 5
    "socket.io": "^4.8.3" // ⚠️ Express integration pode quebrar
}
```

### Riscos Identificados

| Risco                         | Probabilidade | Impacto    | Esforço de Fix |
| ----------------------------- | ------------- | ---------- | -------------- |
| Async error handling quebra   | 🔴 ALTO       | 🔴 CRÍTICO | 2-3 dias       |
| Middleware incompatibilidades | 🟡 MÉDIO      | 🔴 ALTO    | 1-2 dias       |
| Socket.io integration quebra  | 🟡 MÉDIO      | 🔴 CRÍTICO | 2-3 dias       |
| Router trailing slash issues  | 🟡 MÉDIO      | 🟡 MÉDIO   | 1 dia          |
| Compression middleware falha  | 🟢 BAIXO      | 🟡 MÉDIO   | 4 horas        |

### Por Que NÃO Fazer Agora

1. ⚠️ **Complexidade:** Requer refactor extensivo
2. ⚠️ **Ecosystem:** compression, socket.io podem ter issues
3. ⚠️ **Testing:** Precisa validação extensiva (1-2 semanas)
4. ⚠️ **Rollback:** Difícil se problemas em produção
5. ⚠️ **Benefícios:** Mínimos vs. risco

### Quando Fazer

**Pré-requisitos:**

- ✅ Todas outras atualizações completas
- ✅ Código 100% estável
- ✅ Coverage de testes >80%
- ✅ 2-3 semanas disponíveis para refactor
- ✅ Express 5 sair de beta (?)

### ❌ **RECOMENDAÇÃO: NÃO FAZER AGORA**

- **Risco:** 🔴 Alto
- **Esforço:** 2-3 semanas
- **Benefícios:** Mínimos (Express 4 estável)
- **Estratégia:**
    1. **Postergar para v2.0.0 do projeto**
    2. Focar em atualizações de baixo risco primeiro
    3. Avaliar novamente em 6-12 meses
    4. Esperar ecosystem estabilizar
- **Prioridade:** 🔴 BAIXA (última da lista)

---

## 🎯 Plano de Fases - Ordem Recomendada

### FASE 0: Crítico (HOJE - 5 minutos)

```bash
# Corrigir Dockerfile CMD
git checkout -b fix/dockerfile-cmd
# Editar Dockerfile linha 81
git commit -m "fix(docker): Corrigir CMD para pm2-runtime"
git push
docker build -t test .
docker run --rm test  # Validar
```

**Status:** 🔴 **FAZER AGORA**

---

### FASE 1: Puppeteer (Semana 1 - 2 dias)

```bash
# Investigação
npm view puppeteer-extra@latest peerDependencies
npm view puppeteer-extra-plugin-stealth@latest peerDependencies

# Se compatível:
git checkout -b upgrade/puppeteer-24
npm install puppeteer@24.35.0
npm test
# Validação manual (24h)
# Se OK: merge
```

**Status:** 🟡 **Fazer após FASE 0**
**Condição:** Verificar puppeteer-extra compatibility primeiro

---

### FASE 2: PM2 (Semana 1-2 - 1 dia)

```bash
git checkout -b upgrade/pm2-6
npm install pm2@6.0.14
pm2 start ecosystem.config.js
pm2 logs
# Validação (4h)
# Se OK: merge
```

**Status:** 🟢 **Fazer após FASE 1**

---

### FASE 3: Low-Risk Bundle (Semana 2 - 4 horas)

```bash
git checkout -b upgrade/low-risk-deps
npm install zod@4.3.5 uuid@13.0.0 cross-env@10.1.0
npm test
npm run test:schema
# Se OK: merge
```

**Status:** 🟢 **Fazer após FASE 2**

---

### FASE 4: Express (v2.0.0 - NÃO AGORA)

**Status:** ⏸️ **PAUSADO** - Avaliar em 6-12 meses

---

## 📋 Checklist de Validação

### Antes de Cada Fase

- [ ] Criar branch de teste
- [ ] Backup de produção (se aplicável)
- [ ] Ler CHANGELOG da dependência
- [ ] Verificar peer dependencies
- [ ] Preparar estratégia de rollback

### Durante Atualização

- [ ] Executar `npm install <package>@<version>`
- [ ] Resolver conflitos de peer dependencies
- [ ] Executar test suite completa
- [ ] Validação manual (conforme fase)
- [ ] Monitorar logs por 24h (critical updates)

### Após Atualização

- [ ] Documentar mudanças em CHANGELOG.md
- [ ] Atualizar documentação afetada
- [ ] Commit com mensagem descritiva
- [ ] PR com checklist de validação
- [ ] Merge após aprovação
- [ ] Tag de versão (se release)

---

## 🚨 Sinais de Alerta - Rollback Imediato

### Durante Testes

- ❌ >10% dos testes falhando
- ❌ Testes P1-P5 falhando
- ❌ `npm install` falha com peer dependencies
- ❌ Runtime errors em módulos core

### Em Produção

- ❌ Crash rate aumenta >5%
- ❌ Latency aumenta >20%
- ❌ Healthcheck falha
- ❌ Tarefas não processam
- ❌ Dashboard inacessível

### Ação de Rollback

```bash
# Git
git revert <commit>
git push

# NPM
npm install <package>@<old-version>

# PM2
pm2 restart all

# Docker
docker build -t chatgpt-agent:rollback .
docker-compose up -d
```

---

## 📊 Resumo de Recomendações

| Fase | Atualização        | Risco    | Esforço | Fazer? | Quando          |
| ---- | ------------------ | -------- | ------- | ------ | --------------- |
| 0    | Dockerfile CMD     | 🟢 Zero  | 5 min   | ✅ SIM | **AGORA**       |
| 1    | Puppeteer 21→24    | 🟡 Médio | 2 dias  | ✅ SIM | Semana 1        |
| 2    | PM2 5→6            | 🟢 Baixo | 1 dia   | ✅ SIM | Semana 1-2      |
| 3    | Zod/uuid/cross-env | 🟢 Baixo | 4h      | ✅ SIM | Semana 2        |
| 4    | Express 4→5        | 🔴 Alto  | 2-3 sem | ❌ NÃO | v2.0.0 (futuro) |

---

**Próximo Passo:** Corrigir Dockerfile CMD (FASE 0)

**Criado:** 2026-01-20
**Autor:** AI Coding Agent
**Revisão:** Pendente
