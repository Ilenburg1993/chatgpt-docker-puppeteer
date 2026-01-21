# ⚙️ Guia de Configuração

**Versão**: 1.0
**Última Atualização**: 21/01/2026
**Público-Alvo**: DevOps, Desenvolvedores
**Tempo de Leitura**: ~30 min

---

## 📖 Visão Geral

Este documento detalha **todos os parâmetros de configuração** do sistema `chatgpt-docker-puppeteer`: arquivos de config, variáveis de ambiente, schemas de validação, tuning por ambiente.

---

## 📁 Arquivos de Configuração

### 1. config.json (Configuração Principal)

**Localização**: `./config.json` (root)

```json
{
  "browserMode": "launcher",
  "externalBrowserPort": 9222,
  "maxWorkers": 3,
  "kernelCycleMs": 50,
  "queueDir": "./fila",
  "responsesDir": "./respostas",
  "logLevel": "INFO",
  "dashboardPort": 3008,
  "dashboardPassword": null,
  "browserPoolSize": 3,
  "healthCheckInterval": 30000,
  "taskTimeout": 300000,
  "lockTimeout": 60000,
  "cacheInvalidationDebounce": 100,
  "adaptiveDelayMin": 50,
  "adaptiveDelayMax": 150,
  "collectionPollInterval": 1000,
  "collectionMaxStable": 3,
  "nervBufferMaxSize": 10000,
  "queueConcurrency": 10,
  "broadcastDebounce": 50
}
```

---

### Parâmetros Detalhados

| Parâmetro                     | Tipo         | Padrão        | Descrição                            | Range Válido                     |
| ----------------------------- | ------------ | ------------- | ------------------------------------ | -------------------------------- |
| **browserMode**               | string       | `launcher`    | Modo de conexão do browser           | `launcher`, `external`, `hybrid` |
| **externalBrowserPort**       | number       | `9222`        | Porta do Chrome remote debugging     | 1024-65535                       |
| **maxWorkers**                | number       | `3`           | Max workers simultâneos (P9.9)       | 1-20                             |
| **kernelCycleMs**             | number       | `50`          | Ciclo do kernel loop (20Hz)          | 20-200                           |
| **queueDir**                  | string       | `./fila`      | Diretório da fila de tasks           | Path absoluto/relativo           |
| **responsesDir**              | string       | `./respostas` | Diretório de respostas               | Path absoluto/relativo           |
| **logLevel**                  | string       | `INFO`        | Nível de log                         | `DEBUG`, `INFO`, `WARN`, `ERROR` |
| **dashboardPort**             | number       | `3008`        | Porta do dashboard HTTP              | 1024-65535                       |
| **dashboardPassword**         | string\|null | `null`        | Senha do dashboard (null = sem auth) | Min 8 chars ou null              |
| **browserPoolSize**           | number       | `3`           | Tamanho do pool de browsers          | 1-10                             |
| **healthCheckInterval**       | number       | `30000`       | Intervalo de health checks (ms)      | 5000-300000                      |
| **taskTimeout**               | number       | `300000`      | Timeout de task (5min)               | 30000-600000                     |
| **lockTimeout**               | number       | `60000`       | Timeout de locks (1min)              | 10000-300000                     |
| **cacheInvalidationDebounce** | number       | `100`         | Debounce de cache (file watcher)     | 50-1000                          |
| **adaptiveDelayMin**          | number       | `50`          | Delay mínimo adaptativo (ms)         | 10-500                           |
| **adaptiveDelayMax**          | number       | `150`         | Delay máximo adaptativo (ms)         | 50-2000                          |
| **collectionPollInterval**    | number       | `1000`        | Intervalo de poll de coleta (1s)     | 500-5000                         |
| **collectionMaxStable**       | number       | `3`           | Max iterações estáveis (coleta)      | 2-10                             |
| **nervBufferMaxSize**         | number       | `10000`       | Tamanho máx buffer NERV (P9.3)       | 1000-100000                      |
| **queueConcurrency**          | number       | `10`          | Concorrência de fila (P9.7 p-limit)  | 1-50                             |
| **broadcastDebounce**         | number       | `50`          | Debounce de broadcasts (P9.8)        | 10-500                           |

---

### Schema de Validação (Zod)

```javascript
// src/core/schemas.js
const { z } = require('zod');

const configSchema = z.object({
    browserMode: z.enum(['launcher', 'external', 'hybrid']),
    externalBrowserPort: z.number().int().min(1024).max(65535),
    maxWorkers: z.number().int().min(1).max(20),
    kernelCycleMs: z.number().int().min(20).max(200),
    queueDir: z.string().min(1),
    responsesDir: z.string().min(1),
    logLevel: z.enum(['DEBUG', 'INFO', 'WARN', 'ERROR']),
    dashboardPort: z.number().int().min(1024).max(65535),
    dashboardPassword: z.string().min(8).nullable(),
    browserPoolSize: z.number().int().min(1).max(10),
    healthCheckInterval: z.number().int().min(5000).max(300000),
    taskTimeout: z.number().int().min(30000).max(600000),
    lockTimeout: z.number().int().min(10000).max(300000),
    cacheInvalidationDebounce: z.number().int().min(50).max(1000),
    adaptiveDelayMin: z.number().int().min(10).max(500),
    adaptiveDelayMax: z.number().int().min(50).max(2000),
    collectionPollInterval: z.number().int().min(500).max(5000),
    collectionMaxStable: z.number().int().min(2).max(10),
    nervBufferMaxSize: z.number().int().min(1000).max(100000),
    queueConcurrency: z.number().int().min(1).max(50),
    broadcastDebounce: z.number().int().min(10).max(500)
}).strict();

// Validation on load
const validatedConfig = configSchema.parse(rawConfig);
```

---

## 🌍 Variáveis de Ambiente (.env)

### Estrutura Completa

```bash
# ========================================
# BROWSER CONFIGURATION
# ========================================
BROWSER_MODE=launcher
EXTERNAL_BROWSER_PORT=9222
BROWSER_POOL_SIZE=3
LAUNCH_ARGS=--no-sandbox,--disable-setuid-sandbox,--disable-dev-shm-usage
USER_AGENT_ROTATION=true
STEALTH_ENABLED=true
HEADLESS=true
DEVTOOLS_ENABLED=false
PROFILE_DIR=./profile

# ========================================
# KERNEL CONFIGURATION
# ========================================
MAX_WORKERS=3
KERNEL_CYCLE_MS=50
POLICY_EVALUATION_ENABLED=true
OBSERVATION_STORE_SIZE=1000
MEMOIZATION_ENABLED=true
KERNEL_TIMEOUT_MS=5000

# ========================================
# SECURITY
# ========================================
DASHBOARD_PASSWORD=
ENABLE_AUTH=false
JWT_SECRET=your-jwt-secret-min-32-chars
SESSION_SECRET=your-session-secret-min-32-chars
RATE_LIMIT_MAX=100
RATE_LIMIT_WINDOW_MS=60000
CORS_ORIGIN=*
HTTPS_ENABLED=false

# ========================================
# PERFORMANCE
# ========================================
HEAP_MONITORING_ENABLED=true
HEAP_THRESHOLD_MB=400
CACHE_METRICS_ENABLED=true
QUEUE_CONCURRENCY=10
NERV_BUFFER_MAX_SIZE=10000
BROADCAST_DEBOUNCE_MS=50
FILE_WATCHER_DEBOUNCE_MS=100
ADAPTIVE_DELAY_MIN_MS=50
ADAPTIVE_DELAY_MAX_MS=150
GC_MANUAL_TRIGGER=false

# ========================================
# PATHS
# ========================================
QUEUE_DIR=./fila
RESPONSES_DIR=./respostas
LOGS_DIR=./logs
PROFILE_DIR=./profile
TMP_DIR=./tmp
BACKUP_DIR=./backups

# ========================================
# LOGGING
# ========================================
LOG_LEVEL=INFO
LOG_TO_FILE=true
LOG_TO_CONSOLE=true
LOG_ROTATION_SIZE=10485760
LOG_RETENTION_DAYS=7

# ========================================
# MISC
# ========================================
NODE_ENV=production
PORT=3008
DASHBOARD_PORT=3008
```

---

### Categorias de Variáveis

#### 1. Browser (9 variáveis)

| Variável                | Tipo    | Padrão             | Descrição                                                                                                        |
| ----------------------- | ------- | ------------------ | ---------------------------------------------------------------------------------------------------------------- |
| `BROWSER_MODE`          | string  | `launcher`         | Modo de conexão: launcher (PM2 inicia), external (conecta existente), hybrid (tenta external, fallback launcher) |
| `EXTERNAL_BROWSER_PORT` | number  | `9222`             | Porta do Chrome remote debugging protocol                                                                        |
| `BROWSER_POOL_SIZE`     | number  | `3`                | Quantos browsers manter no pool (P9.2 circuit breaker)                                                           |
| `LAUNCH_ARGS`           | string  | `--no-sandbox,...` | Args do Chrome (separados por vírgula)                                                                           |
| `USER_AGENT_ROTATION`   | boolean | `true`             | Rotacionar User-Agent a cada sessão                                                                              |
| `STEALTH_ENABLED`       | boolean | `true`             | Usar puppeteer-extra-plugin-stealth                                                                              |
| `HEADLESS`              | boolean | `true`             | Modo headless (sem UI)                                                                                           |
| `DEVTOOLS_ENABLED`      | boolean | `false`            | Abrir DevTools automaticamente                                                                                   |
| `PROFILE_DIR`           | string  | `./profile`        | Diretório do perfil do browser                                                                                   |

#### 2. Kernel (6 variáveis)

| Variável                    | Tipo    | Padrão | Descrição                                    |
| --------------------------- | ------- | ------ | -------------------------------------------- |
| `MAX_WORKERS`               | number  | `3`    | **P9.9**: Workers simultâneos (configurável) |
| `KERNEL_CYCLE_MS`           | number  | `50`   | Ciclo do kernel loop (20Hz)                  |
| `POLICY_EVALUATION_ENABLED` | boolean | `true` | Avaliar políticas (MAX_WORKERS, etc)         |
| `OBSERVATION_STORE_SIZE`    | number  | `1000` | Tamanho do histórico de observações          |
| `MEMOIZATION_ENABLED`       | boolean | `true` | **P9.5**: Cache de serialização JSON         |
| `KERNEL_TIMEOUT_MS`         | number  | `5000` | **P9.4**: Timeout do ciclo do kernel         |

#### 3. Security (8 variáveis)

| Variável               | Tipo    | Padrão                | Descrição                                       |
| ---------------------- | ------- | --------------------- | ----------------------------------------------- |
| `DASHBOARD_PASSWORD`   | string  | `` (vazio)            | Senha do dashboard (vazio = sem auth, **P8.4**) |
| `ENABLE_AUTH`          | boolean | `false`               | Habilitar autenticação JWT                      |
| `JWT_SECRET`           | string  | `your-jwt-secret`     | Secret para JWT (min 32 chars)                  |
| `SESSION_SECRET`       | string  | `your-session-secret` | Secret para sessions (min 32 chars)             |
| `RATE_LIMIT_MAX`       | number  | `100`                 | Max requests por janela                         |
| `RATE_LIMIT_WINDOW_MS` | number  | `60000`               | Janela de rate limit (1min)                     |
| `CORS_ORIGIN`          | string  | `*`                   | Origens permitidas (CORS)                       |
| `HTTPS_ENABLED`        | boolean | `false`               | Usar HTTPS (requer cert)                        |

#### 4. Performance (10 variáveis)

| Variável                   | Tipo    | Padrão  | Descrição                          |
| -------------------------- | ------- | ------- | ---------------------------------- |
| `HEAP_MONITORING_ENABLED`  | boolean | `true`  | **P9.1**: Monitorar heap           |
| `HEAP_THRESHOLD_MB`        | number  | `400`   | Threshold de alerta de heap        |
| `CACHE_METRICS_ENABLED`    | boolean | `true`  | **P9.6**: Métricas de cache        |
| `QUEUE_CONCURRENCY`        | number  | `10`    | **P9.7**: Concorrência com p-limit |
| `NERV_BUFFER_MAX_SIZE`     | number  | `10000` | **P9.3**: Tamanho máx buffer NERV  |
| `BROADCAST_DEBOUNCE_MS`    | number  | `50`    | **P9.8**: Debounce de broadcasts   |
| `FILE_WATCHER_DEBOUNCE_MS` | number  | `100`   | Debounce do file watcher           |
| `ADAPTIVE_DELAY_MIN_MS`    | number  | `50`    | Delay mínimo adaptativo            |
| `ADAPTIVE_DELAY_MAX_MS`    | number  | `150`   | Delay máximo adaptativo            |
| `GC_MANUAL_TRIGGER`        | boolean | `false` | Forçar GC manual (apenas debug)    |

#### 5. Paths (6 variáveis)

| Variável        | Tipo   | Padrão        | Descrição                  |
| --------------- | ------ | ------------- | -------------------------- |
| `QUEUE_DIR`     | string | `./fila`      | Diretório da fila de tasks |
| `RESPONSES_DIR` | string | `./respostas` | Diretório de respostas LLM |
| `LOGS_DIR`      | string | `./logs`      | Diretório de logs          |
| `PROFILE_DIR`   | string | `./profile`   | Perfis do browser          |
| `TMP_DIR`       | string | `./tmp`       | Arquivos temporários       |
| `BACKUP_DIR`    | string | `./backups`   | Backups                    |

#### 6. Logging (5 variáveis)

| Variável             | Tipo    | Padrão     | Descrição                            |
| -------------------- | ------- | ---------- | ------------------------------------ |
| `LOG_LEVEL`          | string  | `INFO`     | DEBUG, INFO, WARN, ERROR             |
| `LOG_TO_FILE`        | boolean | `true`     | Escrever logs em arquivo             |
| `LOG_TO_CONSOLE`     | boolean | `true`     | Exibir logs no console               |
| `LOG_ROTATION_SIZE`  | number  | `10485760` | Tamanho max do arquivo de log (10MB) |
| `LOG_RETENTION_DAYS` | number  | `7`        | Dias de retenção de logs             |

---

## 📄 dynamic_rules.json (Regras Dinâmicas)

**Localização**: `./dynamic_rules.json` (root)

```json
{
  "targets": {
    "chatgpt": {
      "url": "https://chat.openai.com",
      "selectors": {
        "input": "textarea[data-id='root']",
        "submit": "button[data-testid='send-button']",
        "response": "div.markdown"
      },
      "timeouts": {
        "navigation": 30000,
        "input": 10000,
        "response": 120000
      }
    },
    "gemini": {
      "url": "https://gemini.google.com",
      "selectors": {
        "input": "div.ql-editor",
        "submit": "button[aria-label='Send']",
        "response": "div.model-response"
      },
      "timeouts": {
        "navigation": 30000,
        "input": 10000,
        "response": 120000
      }
    }
  },
  "validation": {
    "minLength": 10,
    "maxLength": 50000,
    "forbiddenTerms": []
  },
  "retry": {
    "maxAttempts": 3,
    "backoffMultiplier": 1.5,
    "initialDelay": 2000
  }
}
```

---

## ⚙️ ecosystem.config.js (PM2)

**Localização**: `./ecosystem.config.js` (root)

```javascript
module.exports = {
    apps: [
        {
            name: 'agente-gpt',
            script: './index.js',
            instances: 1,
            exec_mode: 'fork',
            autorestart: true,
            watch: false,
            max_memory_restart: '800M',
            env: {
                NODE_ENV: 'production'
            },
            error_file: './logs/agente-gpt-err.log',
            out_file: './logs/agente-gpt-out.log',
            log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
            merge_logs: true,
            min_uptime: '10s',
            max_restarts: 10,
            restart_delay: 4000
        },
        {
            name: 'dashboard-web',
            script: 'npx',
            args: 'http-server ./public -p 3009',
            instances: 1,
            autorestart: true,
            watch: false,
            max_memory_restart: '200M'
        }
    ]
};
```

---

## 🎯 Tuning por Ambiente

### Development (Local)

```bash
# .env.development
NODE_ENV=development
BROWSER_MODE=external
MAX_WORKERS=1
LOG_LEVEL=DEBUG
DASHBOARD_PASSWORD=
HEADLESS=false
```

**Características**:
- Browser externo (debug facilitado)
- 1 worker (simplicidade)
- Logs DEBUG (máximo detalhe)
- Sem autenticação
- Browser visível (headless=false)

**Throughput esperado**: ~15 tasks/h

---

### Staging

```bash
# .env.staging
NODE_ENV=staging
BROWSER_MODE=launcher
MAX_WORKERS=2
LOG_LEVEL=INFO
DASHBOARD_PASSWORD=staging-secret
HEADLESS=true
ENABLE_AUTH=true
HEAP_MONITORING_ENABLED=true
```

**Características**:
- Launcher mode (PM2 gerencia browser)
- 2 workers (testes de concorrência)
- Logs INFO (moderado)
- Auth básica (senha)
- Headless (sem UI)
- Telemetria ativada

**Throughput esperado**: ~30 tasks/h

---

### Production

```bash
# .env.production
NODE_ENV=production
BROWSER_MODE=launcher
MAX_WORKERS=10
LOG_LEVEL=WARN
DASHBOARD_PASSWORD=${DASHBOARD_PASSWORD_SECRET}
HEADLESS=true
ENABLE_AUTH=true
JWT_SECRET=${JWT_SECRET}
RATE_LIMIT_MAX=100
CORS_ORIGIN=https://dashboard.example.com
HTTPS_ENABLED=true
HEAP_MONITORING_ENABLED=true
CACHE_METRICS_ENABLED=true
```

**Características**:
- 10 workers (máxima performance)
- Logs WARN (apenas problemas)
- Senha via env secret (segurança)
- JWT auth
- Rate limiting estrito
- CORS restrito
- HTTPS obrigatório
- Telemetria completa

**Throughput esperado**: ~150 tasks/h

---

## 🚀 Cenários de Tuning Avançado

### 1. High-Throughput (Max Performance)

**Objetivo**: Maximizar tasks/hora

```json
{
  "maxWorkers": 10,
  "kernelCycleMs": 20,
  "browserPoolSize": 10,
  "queueConcurrency": 20,
  "nervBufferMaxSize": 50000,
  "adaptiveDelayMin": 30,
  "adaptiveDelayMax": 100
}
```

**Impacto**:
- Throughput: ~150 tasks/h (+400% vs baseline)
- CPU: ~70% (+300%)
- Memory: ~1.2GB (+700%)
- Latency p95: ~4200ms (+50%)

**Trade-offs**:
- ⚠️ Alto consumo de recursos
- ⚠️ Risco de rate limiting (LLMs)
- ⚠️ Maior chance de browser crashes

---

### 2. Low-Resource (Constrained Environment)

**Objetivo**: Minimizar uso de CPU/Memory

```json
{
  "maxWorkers": 1,
  "kernelCycleMs": 100,
  "browserPoolSize": 1,
  "queueConcurrency": 5,
  "nervBufferMaxSize": 5000,
  "adaptiveDelayMin": 100,
  "adaptiveDelayMax": 300,
  "heapThresholdMb": 200
}
```

**Impacto**:
- Throughput: ~30-40 tasks/h (-70%)
- CPU: ~8% (-70%)
- Memory: ~120MB (-80%)
- Latency p95: ~5000ms (+80%)

**Trade-offs**:
- ✅ Ideal para VPS pequenas (1GB RAM)
- ⚠️ Baixo throughput
- ⚠️ Fila pode acumular

---

### 3. High-Availability (99.9% Uptime)

**Objetivo**: Máxima confiabilidade

```json
{
  "browserMode": "hybrid",
  "maxWorkers": 5,
  "browserPoolSize": 7,
  "healthCheckInterval": 10000,
  "taskTimeout": 600000,
  "lockTimeout": 120000,
  "retry": {
    "maxAttempts": 5,
    "backoffMultiplier": 2.0
  }
}
```

**+ PM2**:
```javascript
{
  max_restarts: 50,
  restart_delay: 2000,
  min_uptime: '30s'
}
```

**Impacto**:
- Uptime: 99.9%
- Throughput: ~60-80 tasks/h (moderado)
- Memory: ~600MB (oversized pool)
- Falhas recuperadas: 98%

**Trade-offs**:
- ✅ Tolerância a crashes
- ✅ Retries agressivos
- ⚠️ Oversized resources (+30% overhead)

---

## ✅ Checklist de Configuração

### Pré-Deployment

- [ ] `config.json` validado (schema Zod)
- [ ] `.env` preenchido (50+ variáveis)
- [ ] `dynamic_rules.json` atualizado (targets corretos)
- [ ] Diretórios criados (`fila/`, `respostas/`, `logs/`)
- [ ] Permissões corretas (`chmod 755`)
- [ ] Browser acessível (external mode) ou instalado (launcher)

### Pós-Deployment

- [ ] Health check passando (`/api/health` 200 OK)
- [ ] PM2 status OK (`pm2 status`)
- [ ] Logs sem erros (`tail -f logs/agente-gpt-out.log`)
- [ ] Dashboard acessível (`http://localhost:3008`)
- [ ] Task de teste executada com sucesso
- [ ] Métricas normais (CPU <30%, Memory <600MB)

---

## 🐛 Troubleshooting

### Problema: Config validation failed

**Erro**:
```
[ERROR] Configuration validation failed:
  - maxWorkers: Expected number, received string
  - dashboardPassword: String must contain at least 8 character(s)
```

**Solução**:
1. Verificar tipos (números sem aspas)
2. Password min 8 chars ou null
3. Validar com: `node -e "require('./src/core/config').validateConfig()"`

---

### Problema: MAX_WORKERS não está sendo aplicado

**Diagnóstico**:
```bash
# Verificar config carregado
curl http://localhost:3008/api/health | jq '.config.maxWorkers'
```

**Soluções**:
1. `.env` override: Verificar se `MAX_WORKERS` está em `.env` (override de config.json)
2. PM2 restart: `pm2 restart agente-gpt --update-env`
3. Hot-reload: `curl -X POST http://localhost:3008/api/config/reload`

---

### Problema: Dashboard retorna 401 Unauthorized

**Causa**: `dashboardPassword` configurado mas não enviando no request

**Solução**:
```bash
# Incluir password em requests
curl -u :YOUR_PASSWORD http://localhost:3008/api/queue

# Ou via header
curl -H "Authorization: Bearer YOUR_PASSWORD" http://localhost:3008/api/queue
```

---

## 📚 Referências

- [API_REFERENCE.md](API_REFERENCE.md) - Endpoints da API
- [DEPLOYMENT.md](DEPLOYMENT.md) - Deploy com Docker/PM2
- [DEVELOPMENT.md](DEVELOPMENT.md) - Setup local
- [ARCHITECTURE_v2.md](ARCHITECTURE_v2.md) - Arquitetura NERV

---

*Última revisão: 21/01/2026 | Contribuidores: AI Architect, DevOps Team*
