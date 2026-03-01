# Guia de Variáveis de Ambiente

**chatgpt-docker-puppeteer** **Versão**: 1.0 **Data**: 2 de Fevereiro de 2026

---

## 📋 ÍNDICE

1. [Visão Geral](#visão-geral)
2. [Arquivos ENV](#arquivos-env)
3. [Hierarquia de Configuração](#hierarquia-de-configuração)
4. [Categorias de Variáveis](#categorias-de-variáveis)
5. [Variáveis Críticas](#variáveis-críticas)
6. [Setup por Ambiente](#setup-por-ambiente)
7. [Troubleshooting](#troubleshooting)
8. [FAQ](#faq)

---

## 1. VISÃO GERAL

Este projeto utiliza variáveis de ambiente para configuração flexível e segura. Todas as
configurações podem ser ajustadas sem modificar o código.

### Arquivos Disponíveis

| Arquivo            | Propósito                          | Commitar? |
| ------------------ | ---------------------------------- | --------- |
| `.env.example`     | Template com documentação completa | ✅ SIM    |
| `.env.development` | Configuração para desenvolvimento  | ❌ NÃO    |
| `.env.production`  | Configuração para produção         | ❌ NÃO    |
| `.env.test`        | Configuração para testes           | ❌ NÃO    |
| `.env`             | Arquivo ativo (criado por você)    | ❌ NÃO    |

### Princípios

1. **Segurança**: Nunca commite arquivos `.env` (apenas `.env.example`)
2. **Flexibilidade**: Suporta múltiplos ambientes (dev, prod, test)
3. **Documentação**: Cada variável está documentada em `.env.example`
4. **Fallback**: Sistema de 3 camadas (env → config.json → código)

---

## 2. ARQUIVOS ENV

### 2.1 `.env.example` (Template Completo)

**Propósito**: Template com todas as variáveis disponíveis e documentação completa.

**Como usar**:

```bash
# Copiar para criar seu .env
cp .env.example .env

# Editar valores conforme necessário
nano .env  # ou vim, code, etc.
```

**Conteúdo**: 150+ variáveis documentadas, organizadas em 17 categorias.

---

### 2.2 `.env.development` (Desenvolvimento Local)

**Propósito**: Configuração otimizada para desenvolvimento local.

**Características**:

- Log level: `debug` (verbose)
- Browser pool: 2 instâncias (leve)
- Timeouts: curtos (feedback rápido)
- CORS: localhost permitido
- Sem senha no dashboard

**Como usar**:

```bash
# Opção 1: Copiar para .env
cp .env.development .env

# Opção 2: Usar diretamente
NODE_ENV=development npm start
```

---

### 2.3 `.env.production` (Produção)

**Propósito**: Configuração hardened para produção.

**Características**:

- Log level: `info` (menos verbose)
- Browser pool: 5 instâncias (throughput)
- Timeouts: generosos (resiliência)
- CORS: whitelist estrita (segurança)
- **DASHBOARD_PASSWORD obrigatório**

**⚠️ CHECKLIST ANTES DE USAR**:

- [ ] `PUBLIC_IP` configurado
- [ ] `ALLOWED_ORIGINS` inclui domínios de produção
- [ ] `DASHBOARD_PASSWORD` definido (senha forte)
- [ ] `DASHBOARD_ORIGIN` configurado
- [ ] SSL/TLS habilitado
- [ ] Monitoramento configurado

**Como usar**:

```bash
# Copiar e ajustar
cp .env.production .env
nano .env  # Ajustar [REQUIRED] fields

# Gerar senha forte
openssl rand -base64 32

# Deploy
pm2 restart all --update-env
```

---

### 2.4 `.env.test` (Testes Automatizados)

**Propósito**: Configuração otimizada para CI/CD e testes locais.

**Características**:

- Log level: `error` (minimal)
- Browser pool: 1 instância (leve)
- MOCK_CHROME: habilitado (sem Chrome real)
- Portas alternativas (3009, 9234, 9235)
- Timeouts: mínimos (testes rápidos)

**Como usar**:

```bash
# Testes locais
NODE_ENV=test npm test

# CI/CD (GitHub Actions, GitLab CI)
# Já detectado automaticamente via NODE_ENV=test
```

---

## 3. HIERARQUIA DE CONFIGURAÇÃO

O sistema resolve configurações em **3 níveis**:

```
1. VARIÁVEL DE AMBIENTE (.env)  [PRIORIDADE MÁXIMA]
   ↓ (se não definido)
2. config.json
   ↓ (se não definido)
3. VALOR PADRÃO NO CÓDIGO [FALLBACK]
```

### Exemplo

```javascript
// src/infra/proxy/chromeProxyService.js (linha 50)
PROXY_PORT: parseInt(
  process.env.CHROME_PROXY_PORT || // 1. Env var
    CONFIG.CHROME_PROXY_PORT || // 2. config.json
    '9224', // 3. Padrão
  10
);
```

**Precedência**:

```bash
# .env
CHROME_PROXY_PORT=9999  # ← USADO (prioridade 1)

# config.json
"CHROME_PROXY_PORT": 9224  # ← IGNORADO

# código
'9224'  # ← IGNORADO
```

---

## 4. CATEGORIAS DE VARIÁVEIS

### 4.1 Ambiente e Execução

| Variável           | Valores                       | Padrão      | Descrição              |
| ------------------ | ----------------------------- | ----------- | ---------------------- |
| `NODE_ENV`         | development, production, test | development | Ambiente de execução   |
| `SERVER_MODE`      | split, integrated             | split       | Modo do servidor (PM2) |
| `SERVER_AUTHORITY` | standalone, orchestrated      | standalone  | Autoridade do processo |

---

### 4.2 Portas e Networking

| Variável            | Tipo   | Padrão               | Descrição                  |
| ------------------- | ------ | -------------------- | -------------------------- |
| `SERVER_PORT`       | number | 3008                 | Porta do Dashboard         |
| `CHROME_PROXY_PORT` | number | 9224                 | Porta do proxy (container) |
| `CHROME_PORT`       | number | 9225                 | Porta do Chrome (Windows)  |
| `CHROME_HOST`       | string | host.docker.internal | Host do Chrome             |
| `PUBLIC_IP`         | string | auto                 | IP público do container    |
| `HOST`              | string | 0.0.0.0              | Bind do servidor HTTP      |

**Exemplo Docker Desktop**:

```bash
CHROME_HOST=host.docker.internal
CHROME_PORT=9225
CHROME_PROXY_PORT=9224
```

**Exemplo WSL2 (bridge custom)**:

```bash
CHROME_HOST=172.17.0.1
CHROME_PORT=9225
PUBLIC_IP=172.17.0.2
```

---

### 4.3 Chrome Browser

| Variável                          | Valores                             | Padrão     | Descrição                |
| --------------------------------- | ----------------------------------- | ---------- | ------------------------ |
| `BROWSER_MODE`                    | launcher, connect, wsEndpoint, auto | wsEndpoint | Modo de conexão          |
| `PUPPETEER_LOCAL_LAUNCH_DISABLED` | true, false                         | true       | Desabilitar launch local |
| `MOCK_CHROME`                     | 0, 1                                | 0          | Mock para testes         |

**Modos de conexão**:

- `wsEndpoint`: **RECOMENDADO** - Usa Chrome Proxy, WebSocket direto
- `connect`: HTTP endpoint (2 requests: HTTP + WS)
- `launcher`: Puppeteer inicia Chrome (não funciona em Docker)
- `auto`: Tenta todos com fallback

---

### 4.4 Chrome Proxy Service (v2.0)

| Variável             | Tipo    | Padrão             | Descrição                             |
| -------------------- | ------- | ------------------ | ------------------------------------- |
| `WS_IDLE_TIMEOUT_MS` | number  | 300000             | Timeout idle WebSocket (5min)         |
| `ALLOWED_ORIGINS`    | string  | localhost:3008,... | CORS whitelist (separado por vírgula) |
| `NERV_INTEGRATION`   | boolean | true               | Habilitar integração NERV             |

**Exemplo CORS**:

```bash
# Desenvolvimento
ALLOWED_ORIGINS=http://localhost:3008,http://127.0.0.1:3008

# Produção
ALLOWED_ORIGINS=https://app.exemplo.com,https://www.exemplo.com
```

---

### 4.5 Browser Pool

| Variável                | Tipo    | Padrão      | Descrição                      |
| ----------------------- | ------- | ----------- | ------------------------------ |
| `BROWSER_POOL_SIZE`     | number  | 3           | Tamanho do pool                |
| `ALLOCATION_STRATEGY`   | string  | round-robin | Estratégia de alocação         |
| `HEALTH_CHECK_INTERVAL` | number  | 30000       | Intervalo de health check (ms) |
| `ALLOW_DEGRADED_MODE`   | boolean | true        | Continuar sem browser saudável |
| `AUTO_RETRY_CHROME`     | boolean | true        | Retry automático               |
| `MAX_AUTO_RETRIES`      | number  | 2           | Máximo de retries              |

**Estratégias**:

- `round-robin`: Distribuição uniforme
- `least-busy`: Escolhe browser menos ocupado
- `random`: Aleatório

---

### 4.6 Logging e Telemetria

| Variável           | Valores                  | Padrão | Descrição              |
| ------------------ | ------------------------ | ------ | ---------------------- |
| `LOG_LEVEL`        | debug, info, warn, error | info   | Nível de log           |
| `NERV_BUFFER_SIZE` | number                   | 1000   | Buffer de eventos NERV |
| `NERV_TELEMETRY`   | boolean                  | true   | Telemetria NERV        |

**Níveis de log**:

- `debug`: Muito verbose (desenvolvimento)
- `info`: Produção padrão
- `warn`: Apenas avisos
- `error`: Apenas erros críticos

---

### 4.7 Kernel e Context

| Variável                | Tipo   | Padrão         | Descrição               |
| ----------------------- | ------ | -------------- | ----------------------- |
| `KERNEL_CYCLE_INTERVAL` | number | 50             | Ciclo do kernel (ms)    |
| `CONTEXT_STRATEGY`      | string | sliding_window | Estratégia de contexto  |
| `CONTEXT_MAX_TOKENS`    | number | 100000         | Máximo de tokens        |
| `SUMMARIZATION_POLICY`  | string | on_overflow    | Política de sumarização |

---

### 4.8 Modules (Triage, Frame, Biomechanics, Recovery, Submission)

**150+ variáveis** para fine-tuning de módulos. Veja `.env.example` para lista completa.

**Exemplo Biomechanics**:

```bash
# Digitação humana
BIOMECH_HUMAN_TIMEOUT=60000  # 60s (LLM longo)

# Zen Mode (muitos caracteres)
BIOMECH_ZEN_THRESHOLD=2000
BIOMECH_ZEN_TIMEOUT=30000
```

---

## 5. VARIÁVEIS CRÍTICAS

### 5.1 Segurança (Produção)

| Variável             | Obrigatório    | Descrição                             |
| -------------------- | -------------- | ------------------------------------- |
| `DASHBOARD_PASSWORD` | ✅ SIM         | Senha do dashboard (produção)         |
| `ALLOWED_ORIGINS`    | ✅ SIM         | Whitelist CORS (domínios de produção) |
| `PUBLIC_IP`          | ⚠️ Recomendado | IP público do container               |
| `NODE_ENV`           | ✅ SIM         | Definir como `production`             |

**Gerar senha forte**:

```bash
openssl rand -base64 32
```

---

### 5.2 Networking (Docker)

| Variável            | Valor Docker Desktop   | Descrição                  |
| ------------------- | ---------------------- | -------------------------- |
| `CHROME_HOST`       | `host.docker.internal` | Host do Chrome (Windows)   |
| `CHROME_PORT`       | `9225`                 | Porta do Chrome            |
| `CHROME_PROXY_PORT` | `9224`                 | Porta do proxy (container) |

**Validação**:

```bash
# Verificar se Chrome está acessível
curl http://host.docker.internal:9225/json/version

# Verificar proxy
curl http://localhost:9224/health
```

---

### 5.3 Performance (Produção)

| Variável              | Desenvolvimento | Produção | Descrição                     |
| --------------------- | --------------- | -------- | ----------------------------- |
| `BROWSER_POOL_SIZE`   | 2               | 5        | Pool maior = mais throughput  |
| `LOG_LEVEL`           | debug           | info     | Menos logs = mais performance |
| `ALLOW_DEGRADED_MODE` | true            | false    | Fail-fast em produção         |
| `WS_IDLE_TIMEOUT_MS`  | 300000          | 300000   | 5min (LLM-friendly)           |

---

## 6. SETUP POR AMBIENTE

### 6.1 Desenvolvimento Local (Docker Desktop + Windows)

```bash
# 1. Copiar template
cp .env.development .env

# 2. Verificar variáveis (geralmente ok sem ajustes)
cat .env

# 3. Iniciar Chrome no Windows
START-CHROME-SIMPLE.bat

# 4. Iniciar sistema
make start
# ou
npx pm2 start ecosystem.config.cjs

# 5. Validar
curl http://localhost:3008/api/health
curl http://localhost:9224/health
```

**Troubleshooting**:

```bash
# Proxy não conecta ao Chrome
# → Verifique se Chrome está rodando com --remote-debugging-port=9225

# CORS errors
# → Adicione origem em ALLOWED_ORIGINS

# Ports ocupados
# → Ajuste SERVER_PORT, CHROME_PROXY_PORT
```

---

### 6.2 Produção (Cloud/VPS)

```bash
# 1. Copiar template de produção
cp .env.production .env

# 2. Ajustar variáveis OBRIGATÓRIAS
nano .env

# Checklist:
# - PUBLIC_IP=<IP ou domínio>
# - ALLOWED_ORIGINS=https://seu-dominio.com
# - DASHBOARD_PASSWORD=<senha forte>
# - DASHBOARD_ORIGIN=https://seu-dominio.com
# - LOG_LEVEL=info
# - ALLOW_DEGRADED_MODE=false

# 3. Validar config
node -e "require('dotenv').config(); console.log(process.env.DASHBOARD_PASSWORD)"

# 4. Deploy
npx pm2 start ecosystem.config.cjs --env production

# 5. Validar
curl https://seu-dominio.com/api/health
curl https://seu-dominio.com/api/health/pm2
```

**Segurança**:

```bash
# Verificar permissões do .env
chmod 600 .env  # Apenas owner pode ler/escrever

# Verificar se não está no git
git status  # .env não deve aparecer

# Verificar .gitignore
grep "^\.env$" .gitignore  # Deve retornar .env
```

---

### 6.3 CI/CD (GitHub Actions, GitLab CI)

```yaml
# .github/workflows/test.yml
name: Tests
on: [push, pull_request]

jobs:
  test:
    runs-on: ubuntu-latest
    env:
      NODE_ENV: test
      MOCK_CHROME: 1
      LOG_LEVEL: error
    steps:
      - uses: actions/checkout@v2
      - name: Setup Node.js
        uses: actions/setup-node@v2
        with:
          node-version: '20'
      - name: Install dependencies
        run: npm ci
      - name: Run tests
        run: npm test
```

**Ou usar .env.test**:

```yaml
- name: Setup env
  run: cp .env.test .env
- name: Run tests
  run: npm test
```

---

## 7. TROUBLESHOOTING

### 7.1 Chrome Proxy não conecta

**Sintomas**:

```
Error: Chrome unreachable
Error: connect ECONNREFUSED 127.0.0.1:9225
```

**Soluções**:

```bash
# 1. Verificar se Chrome está rodando (Windows)
# Executar: START-CHROME-SIMPLE.bat

# 2. Validar porta do Chrome
netstat -ano | findstr :9225  # Windows
lsof -i :9225                 # Linux/Mac

# 3. Verificar CHROME_HOST
# Docker Desktop: host.docker.internal
# WSL2: IP do host (ex: 172.17.0.1)

# 4. Testar conexão direta
curl http://host.docker.internal:9225/json/version

# 5. Verificar proxy
curl http://localhost:9224/health
```

---

### 7.2 CORS Errors

**Sintomas**:

```
Access to fetch at 'http://localhost:9224' from origin 'http://evil.com'
has been blocked by CORS policy
```

**Soluções**:

```bash
# Adicionar origem em ALLOWED_ORIGINS
ALLOWED_ORIGINS=http://localhost:3008,http://nova-origem.com

# Verificar formato (separado por vírgula, sem espaços)
# ✅ Correto
ALLOWED_ORIGINS=http://localhost:3008,http://localhost:8080

# ❌ Errado (com espaços)
ALLOWED_ORIGINS=http://localhost:3008, http://localhost:8080

# Restart
pm2 restart chrome-proxy
```

---

### 7.3 Dashboard Password

**Sintomas**:

```
Dashboard authentication required
```

**Soluções**:

```bash
# Desenvolvimento: sem senha
DASHBOARD_PASSWORD=

# Produção: definir senha
DASHBOARD_PASSWORD=$(openssl rand -base64 32)

# Verificar
echo $DASHBOARD_PASSWORD

# Restart
pm2 restart dashboard-web --update-env
```

---

### 7.4 Port Already in Use

**Sintomas**:

```
Error: Port 3008 is already in use
```

**Soluções**:

```bash
# Verificar processo usando porta
lsof -i :3008  # Linux/Mac
netstat -ano | findstr :3008  # Windows

# Opção 1: Matar processo
kill <PID>

# Opção 2: Usar porta alternativa
SERVER_PORT=3009

# Restart
pm2 restart all
```

---

## 8. FAQ

### Q1: Qual arquivo .env usar?

**A**: Depende do ambiente:

- Desenvolvimento local: `.env.development` ou copie `.env.example`
- Produção: `.env.production` (ajuste [REQUIRED] fields)
- Testes: `.env.test` (CI/CD)

---

### Q2: Preciso commitar .env?

**A**: ❌ **NUNCA** commite `.env`, `.env.development`, `.env.production`, `.env.test`. ✅
**Sempre** commite `.env.example` (template).

**Verificação**:

```bash
# .gitignore deve conter
.env
.env.*
!.env.example
```

---

### Q3: Como atualizar .env em produção sem downtime?

**A**:

```bash
# 1. Editar .env
nano .env

# 2. Reload sem downtime (PM2)
pm2 reload all --update-env

# 3. Validar
curl http://localhost:3008/health
```

---

### Q4: Posso usar múltiplos .env?

**A**: Sim, com ferramentas:

```bash
# dotenv-cli
npm install -g dotenv-cli
dotenv -e .env.production npm start

# env-cmd
npm install -g env-cmd
env-cmd -f .env.production npm start

# direnv (auto-load ao entrar no diretório)
```

---

### Q5: Como validar meu .env?

**A**:

```bash
# 1. Verificar sintaxe
grep -v '^#' .env | grep -v '^$' | grep '='

# 2. Testar load
node -e "require('dotenv').config(); console.log(process.env.SERVER_PORT)"

# 3. Verificar variáveis críticas
node -e "
const required = ['CHROME_HOST', 'CHROME_PORT', 'SERVER_PORT'];
require('dotenv').config();
required.forEach(v => {
  if (!process.env[v]) console.error('Missing:', v);
  else console.log('✓', v, '=', process.env[v]);
});
"
```

---

### Q6: Diferença entre .env e config.json?

**A**:

- **`.env`**: Configuração por ambiente (dev, prod, test)
- **`config.json`**: Configuração compartilhada/base

**Prioridade**: `.env` > `config.json` > código

**Quando usar cada um**:

- **`.env`**: Valores que mudam por ambiente (portas, IPs, senhas)
- **`config.json`**: Valores estáveis (arquitetura, features flags)

---

### Q7: Como debugar variáveis não carregadas?

**A**:

```bash
# 1. Verificar se .env existe
ls -la .env

# 2. Verificar conteúdo
cat .env | grep CHROME_PROXY_PORT

# 3. Testar load manual
node -e "
require('dotenv').config();
console.log('CHROME_PROXY_PORT:', process.env.CHROME_PROXY_PORT);
"

# 4. Verificar precedência
# PM2 pode ter env vars que sobrescrevem .env
pm2 env 0  # Ver env do processo 0

# 5. Verificar se dotenv está instalado
npm list dotenv
```

---

### Q8: Posso usar .env com Docker Compose?

**A**: Sim:

```yaml
# docker-compose.yml
services:
  app:
    build: .
    env_file:
      - .env.production
    # ou
    environment:
      - NODE_ENV=${NODE_ENV}
      - SERVER_PORT=${SERVER_PORT}
```

**Ou passar via CLI**:

```bash
docker-compose --env-file .env.production up
```

---

## 9. REFERÊNCIAS

- **Documentação oficial dotenv**: https://github.com/motdotla/dotenv
- **12-Factor App (Config)**: https://12factor.net/config
- **Guia de segurança**: Nunca commite secrets, use vault em produção
- **WSL Integration**: `DOCUMENTAÇÃO/WSL_INTEGRATION_GUIDE.md`
- **Chrome Proxy**: `DOCUMENTAÇÃO/RELATORIOS/RECLASSIFICADOS/CHROME_PROXY_V2_IMPLEMENTATION.md`
- **Port Architecture**: `DOCUMENTAÇÃO/PORT_ARCHITECTURE_ANALYSIS.md`

---

**Versão**: 1.0 **Última atualização**: 2 de Fevereiro de 2026 **Autor**: GitHub Copilot (Claude
Sonnet 4.5)
