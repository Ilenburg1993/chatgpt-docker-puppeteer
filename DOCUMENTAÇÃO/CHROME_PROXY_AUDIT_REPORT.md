# Chrome Proxy Service - Audit & Upgrade Proposal
**Data**: 2 de Fevereiro de 2026
**Arquivo**: `src/infra/proxy/chromeProxyService.js` (652 linhas)
**Status**: ANÁLISE COMPLETA + PROPOSTAS DE MELHORIA

---

## 📊 EXECUTIVE SUMMARY

**Status Atual**: ✅ Funcional, ⚠️ Precisa de Hardening

**Métricas do Código**:
- **Linhas**: 652 (módulo principal)
- **Classes**: 1 (ChromeProxyService)
- **Métodos Públicos**: 7
- **Dependências**: 8 (express, helmet, http-proxy, prom-client, etc.)
- **`void err`**: 21 ocorrências (⚠️ silencia erros)

**Score de Qualidade**: 7.5/10
- ✅ Arquitetura sólida
- ✅ Métricas Prometheus
- ✅ Graceful shutdown
- ⚠️ Segurança precisa reforço
- ⚠️ Resiliência pode melhorar
- ❌ Muitos erros silenciados

---

## 1. ARQUITETURA ATUAL

### Componentes Principais

```
┌─────────────────────────────────────────────────────────────┐
│ ChromeProxyService                                          │
│                                                             │
│ ┌─────────────────────────────────────────────────────┐   │
│ │ HTTP Server (Express)                               │   │
│ │ • Health checks (/health, /healthz)                 │   │
│ │ • Metrics endpoint (/metrics)                       │   │
│ │ • Request forwarding (handleHTTPRequest)            │   │
│ │ • URL rewriting (rewriteWebSocketURL)               │   │
│ └─────────────────────────────────────────────────────┘   │
│                                                             │
│ ┌─────────────────────────────────────────────────────┐   │
│ │ WebSocket Proxy                                     │   │
│ │ • http-proxy library (preferred)                    │   │
│ │ • Raw socket fallback (net.connect)                 │   │
│ │ • Idle connection cleanup (60s timeout)             │   │
│ │ • Activity tracking (__lastActivity)                │   │
│ └─────────────────────────────────────────────────────┘   │
│                                                             │
│ ┌─────────────────────────────────────────────────────┐   │
│ │ Observability                                       │   │
│ │ • Prometheus metrics (7 metrics)                    │   │
│ │ • System logger integration                         │   │
│ │ • AsyncLocalStorage (request context)               │   │
│ │ • NERV integration (optional)                       │   │
│ └─────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘

Fluxo de Dados:
Puppeteer → localhost:9224 (HTTP/WS) → Proxy → host.docker.internal:9225 → Chrome
```

### Responsabilidades

1. **HTTP Forwarding**: Proxy requests `/json/*` com reescrita de URLs
2. **WebSocket Upgrade**: Proxy conexões CDP (Chrome DevTools Protocol)
3. **URL Rewriting**: Substitui `host.docker.internal:9225` → `localhost:9224`
4. **Health Checks**: Endpoints `/health` e `/healthz`
5. **Metrics**: Prometheus metrics em `/metrics`
6. **Idle Cleanup**: Fecha conexões WebSocket ociosas (60s)

---

## 2. ANÁLISE DE PROBLEMAS

### 🔴 CRÍTICO

#### 2.1 Segurança - CORS Wildcard

**Problema**:
```javascript
'Access-Control-Allow-Origin': '*'  // ❌ Muito permissivo
```

**Impacto**: Qualquer site pode fazer requests ao proxy (XSS attack vector).

**Correção**:
```javascript
// Whitelist de origens permitidas
const ALLOWED_ORIGINS = [
    'http://localhost:3008',     // Dashboard
    'http://127.0.0.1:3008',
    process.env.ALLOWED_ORIGIN   // Custom
].filter(Boolean);

const origin = req.headers.origin;
const allowedOrigin = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];

res.setHeader('Access-Control-Allow-Origin', allowedOrigin);
res.setHeader('Access-Control-Allow-Credentials', 'true');
```

#### 2.2 Erro Handling - `void err` (21 ocorrências)

**Problema**:
```javascript
try {
    this.metrics.httpRequests.inc();
} catch (err) {
    void err;  // ❌ Silencia erro completamente
}
```

**Impacto**: Falhas em métricas/logs são invisíveis, dificulta debugging.

**Correção**:
```javascript
try {
    this.metrics.httpRequests.inc();
} catch (err) {
    // Log com contexto mínimo
    this.log('debug', 'Metrics error (non-critical)', {
        metric: 'httpRequests',
        error: err.message
    });
}
```

#### 2.3 Rate Limiting Desativado

**Problema**:
```javascript
// Código comentado:
// try {
//     this.app.use(rateLimit({ ... }));
// } catch (err) {
//     void err;
// }
```

**Impacto**: Sem proteção contra DoS/flood attacks.

**Correção**:
```javascript
// Ativar com configuração adequada
const limiter = rateLimit({
    windowMs: 60 * 1000,        // 1 minuto
    max: 1000,                  // 1000 requests/min (alto para proxy)
    message: 'Too many requests',
    standardHeaders: true,
    legacyHeaders: false,
    skip: (req) => req.url === '/health'  // Exceção para health checks
});

this.app.use(limiter);
```

---

### 🟡 IMPORTANTE

#### 2.4 Idle Timeout Muito Curto

**Problema**:
```javascript
this._idleTimeoutMs = parseInt(process.env.WS_IDLE_TIMEOUT_MS || '60000', 10);
// 60s é curto para sessões LLM (prompts podem demorar 5+ minutos)
```

**Impacto**: Conexões WebSocket fechadas prematuramente durante prompts longos.

**Correção**:
```javascript
// Timeout mais generoso para LLM automation
this._idleTimeoutMs = parseInt(
    process.env.WS_IDLE_TIMEOUT_MS || '300000',  // 5 minutos
    10
);

// Adicionar ping/pong para keep-alive
socket.on('ping', () => {
    markActive(socket);
    socket.pong();
});
```

#### 2.5 Sem Circuit Breaker

**Problema**: Quando Chrome está down, proxy continua tentando conectar indefinidamente.

**Correção**:
```javascript
class CircuitBreaker {
    constructor(threshold = 5, timeout = 30000) {
        this.failures = 0;
        this.threshold = threshold;
        this.timeout = timeout;
        this.state = 'CLOSED';  // CLOSED, OPEN, HALF_OPEN
        this.nextAttempt = 0;
    }

    async call(fn) {
        if (this.state === 'OPEN') {
            if (Date.now() < this.nextAttempt) {
                throw new Error('Circuit breaker OPEN');
            }
            this.state = 'HALF_OPEN';
        }

        try {
            const result = await fn();
            this.onSuccess();
            return result;
        } catch (err) {
            this.onFailure();
            throw err;
        }
    }

    onSuccess() {
        this.failures = 0;
        this.state = 'CLOSED';
    }

    onFailure() {
        this.failures++;
        if (this.failures >= this.threshold) {
            this.state = 'OPEN';
            this.nextAttempt = Date.now() + this.timeout;
        }
    }
}

// Uso no constructor
this.circuitBreaker = new CircuitBreaker(5, 30000);

// Uso em proxyReq.on('error')
await this.circuitBreaker.call(async () => {
    // Connection logic
});
```

#### 2.6 PUBLIC_IP Detection Frágil

**Problema**:
```javascript
_detectPublicIP() {
    const interfaces = os.networkInterfaces();
    const preferredNames = ['Ethernet', 'Wi-Fi', 'eth0', 'wlan0', 'en0'];
    // Pode falhar em ambientes cloud/Docker custom
}
```

**Correção**:
```javascript
_detectPublicIP() {
    // 1. Env var (mais confiável)
    if (process.env.PUBLIC_IP) return process.env.PUBLIC_IP;

    // 2. Docker internal IP (container)
    const dockerInternal = this._getDockerInternalIP();
    if (dockerInternal) return dockerInternal;

    // 3. Network interfaces (fallback)
    return this._scanNetworkInterfaces();
}

_getDockerInternalIP() {
    const interfaces = os.networkInterfaces();
    // Docker cria interface eth0 com IP 172.17.0.x
    if (interfaces.eth0) {
        const ipv4 = interfaces.eth0.find(
            iface => iface.family === 'IPv4' &&
                     iface.address.startsWith('172.')
        );
        if (ipv4) return ipv4.address;
    }
    return null;
}
```

---

### 🟢 MELHORIAS

#### 2.7 Métricas - Faltam Labels

**Problema**: Métricas sem contexto (endpoint, status code, method).

**Correção**:
```javascript
// Substituir Counter simples por Counter com labels
this.metrics = {
    httpRequests: new promClient.Counter({
        name: 'chrome_proxy_http_requests_total',
        help: 'Total HTTP requests',
        labelNames: ['method', 'path', 'status']  // ✅ Labels
    }),

    wsUpgrades: new promClient.Counter({
        name: 'chrome_proxy_ws_upgrades_total',
        help: 'Total WebSocket upgrades',
        labelNames: ['success']  // ✅ Track failures
    })
};

// Uso com labels
this.metrics.httpRequests.inc({
    method: req.method,
    path: req.url,
    status: proxyRes.statusCode
});
```

#### 2.8 Cache de `/json/version`

**Problema**: Cada request a `/json/version` vai ao Chrome (overhead).

**Correção**:
```javascript
constructor() {
    this.cache = {
        version: null,
        versionTTL: 30000,  // 30s cache
        versionExpires: 0
    };
}

async handleHTTPRequest(req, res) {
    if (req.url === '/json/version') {
        // Cache hit
        if (this.cache.version && Date.now() < this.cache.versionExpires) {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(this.cache.version);
            return;
        }

        // Cache miss - fetch e cache
        const data = await this._fetchVersion();
        this.cache.version = data;
        this.cache.versionExpires = Date.now() + this.cache.versionTTL;
        res.end(data);
    }
}
```

#### 2.9 Compression Middleware

**Problema**: Respostas HTTP não são comprimidas (bandwidth desperdiçado).

**Correção**:
```javascript
const compression = require('compression');

// No start()
this.app.use(compression({
    filter: (req, res) => {
        // Comprimir apenas JSON
        if (req.headers['x-no-compression']) return false;
        return compression.filter(req, res);
    },
    threshold: 512  // Comprimir apenas > 512 bytes
}));
```

#### 2.10 Graceful Shutdown - Timeout

**Problema**: `stop()` espera indefinidamente se conexões não fecham.

**Correção**:
```javascript
async stop() {
    this.log('info', 'Shutting down proxy...');

    // 1. Parar de aceitar novas conexões
    if (this.server) {
        this.server.close();
    }

    // 2. Fechar conexões ativas gracefully (10s timeout)
    const closePromises = Array.from(this.activeConnections).map(socket => {
        return new Promise(resolve => {
            socket.on('close', resolve);
            socket.end();  // Graceful close

            // Forçar após 10s
            setTimeout(() => {
                if (!socket.destroyed) {
                    socket.destroy();
                }
                resolve();
            }, 10000);
        });
    });

    await Promise.all(closePromises);
    this.activeConnections.clear();

    this.log('info', 'Shutdown complete');
}
```

---

## 3. PROPOSTAS DE UPGRADE

### 3.1 Health Check Aprimorado

**Atual**: Apenas retorna `{ status: 'ok' }`.

**Proposta**: Health check com validação real do Chrome.

```javascript
async _checkChromeHealth() {
    try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 3000);

        const res = await fetch(
            `http://${this.config.CHROME_HOST}:${this.config.CHROME_PORT}/json/version`,
            { signal: controller.signal }
        );

        clearTimeout(timeout);

        if (!res.ok) {
            return { healthy: false, error: `HTTP ${res.status}` };
        }

        const json = await res.json();
        return {
            healthy: true,
            browser: json.Browser,
            protocolVersion: json['Protocol-Version']
        };
    } catch (err) {
        return { healthy: false, error: err.message };
    }
}

// No endpoint /health
app.get('/health', async (req, res) => {
    const uptime = Math.floor((Date.now() - this.stats.startTime) / 1000);
    const chromeHealth = await this._checkChromeHealth();

    const status = chromeHealth.healthy ? 'ok' : 'degraded';
    const statusCode = chromeHealth.healthy ? 200 : 503;

    res.writeHead(statusCode, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
        status,
        uptime,
        chrome: chromeHealth,
        stats: {
            httpRequests: this.stats.httpRequests,
            wsUpgrades: this.stats.wsUpgrades,
            errors: this.stats.errors,
            activeConnections: this.activeConnections.size
        }
    }));
});
```

### 3.2 Retry com Backoff Exponencial

**Proposta**: Retry automático para falhas transientes.

```javascript
async _retryWithBackoff(fn, maxRetries = 3, baseDelay = 1000) {
    for (let attempt = 0; attempt < maxRetries; attempt++) {
        try {
            return await fn();
        } catch (err) {
            if (attempt === maxRetries - 1) throw err;

            const delay = baseDelay * Math.pow(2, attempt);
            this.log('warn', `Retry ${attempt + 1}/${maxRetries} após ${delay}ms`, {
                error: err.message
            });

            await new Promise(resolve => setTimeout(resolve, delay));
        }
    }
}

// Uso em proxyReq
const proxyReq = await this._retryWithBackoff(() => {
    return http.request(options, proxyRes => { /* ... */ });
}, 3, 500);
```

### 3.3 Request Tracing

**Proposta**: Correlation IDs para rastreamento end-to-end.

```javascript
// Middleware para injetar correlation ID
app.use((req, res, next) => {
    const correlationId = req.headers['x-correlation-id'] ||
                          req.headers['x-request-id'] ||
                          uuidv4();

    req.correlationId = correlationId;
    res.setHeader('X-Correlation-ID', correlationId);

    // AsyncLocalStorage context
    this.asyncLocalStorage.run({ correlationId }, next);
});

// Logs com correlation ID
log(level, message, meta = {}) {
    const store = this.asyncLocalStorage.getStore();
    const correlationId = store?.correlationId || 'unknown';

    const enrichedMeta = { ...meta, correlationId };
    // ...
}
```

### 3.4 Config Validation

**Proposta**: Validar configuração no constructor.

```javascript
_validateConfig() {
    const required = ['PROXY_PORT', 'CHROME_HOST', 'CHROME_PORT'];
    const missing = required.filter(key => !this.config[key]);

    if (missing.length > 0) {
        throw new Error(`Missing required config: ${missing.join(', ')}`);
    }

    // Validar tipos
    if (!Number.isInteger(this.config.PROXY_PORT) ||
        this.config.PROXY_PORT < 1 ||
        this.config.PROXY_PORT > 65535) {
        throw new Error(`Invalid PROXY_PORT: ${this.config.PROXY_PORT}`);
    }

    if (!Number.isInteger(this.config.CHROME_PORT) ||
        this.config.CHROME_PORT < 1 ||
        this.config.CHROME_PORT > 65535) {
        throw new Error(`Invalid CHROME_PORT: ${this.config.CHROME_PORT}`);
    }
}

constructor(config = {}) {
    this.config = { ...LOCAL_CONFIG, ...config };
    this._validateConfig();  // ✅ Fail-fast
    // ...
}
```

---

## 4. ROADMAP DE IMPLEMENTAÇÃO

### Fase 1: Hardening (Crítico) - 1-2 dias

- [ ] **P0**: Corrigir CORS wildcard → whitelist
- [ ] **P0**: Substituir `void err` por logs adequados (21 ocorrências)
- [ ] **P0**: Ativar rate limiting
- [ ] **P1**: Aumentar idle timeout (60s → 300s)
- [ ] **P1**: Adicionar config validation

**Entregável**: Proxy mais seguro e confiável.

### Fase 2: Resiliência (Importante) - 2-3 dias

- [ ] **P1**: Implementar circuit breaker
- [ ] **P1**: Retry com backoff exponencial
- [ ] **P2**: Melhorar PUBLIC_IP detection
- [ ] **P2**: Graceful shutdown com timeout

**Entregável**: Proxy resiliente a falhas do Chrome.

### Fase 3: Observabilidade (Melhoria) - 1-2 dias

- [ ] **P2**: Métricas com labels (method, status, path)
- [ ] **P2**: Health check com validação Chrome
- [ ] **P2**: Request tracing (correlation IDs)
- [ ] **P3**: Cache de `/json/version`

**Entregável**: Debugging e monitoramento aprimorados.

### Fase 4: Performance (Nice-to-have) - 1 dia

- [ ] **P3**: Compression middleware
- [ ] **P3**: Connection pooling ao Chrome
- [ ] **P3**: Keep-alive (ping/pong)

**Entregável**: Proxy mais eficiente.

---

## 5. MÉTRICAS DE SUCESSO

### Antes (Atual)

| Métrica               | Valor Atual      |
| --------------------- | ---------------- |
| **CORS Security**     | ❌ Wildcard (`*`) |
| **Error Visibility**  | ❌ 21 `void err`  |
| **Rate Limiting**     | ❌ Desativado     |
| **Idle Timeout**      | ⚠️ 60s (curto)    |
| **Circuit Breaker**   | ❌ Não existe     |
| **Health Check**      | ⚠️ Básico         |
| **Metrics Labels**    | ❌ Sem labels     |
| **Config Validation** | ❌ Não existe     |

### Depois (Target)

| Métrica               | Valor Target          |
| --------------------- | --------------------- |
| **CORS Security**     | ✅ Whitelist           |
| **Error Visibility**  | ✅ Logs estruturados   |
| **Rate Limiting**     | ✅ 1000 req/min        |
| **Idle Timeout**      | ✅ 300s (5min)         |
| **Circuit Breaker**   | ✅ 5 falhas → 30s open |
| **Health Check**      | ✅ Valida Chrome real  |
| **Metrics Labels**    | ✅ method/status/path  |
| **Config Validation** | ✅ Fail-fast           |

---

## 6. PRIORIZAÇÃO (MoSCoW)

### Must Have (P0-P1)
1. ✅ Corrigir CORS wildcard
2. ✅ Substituir `void err` por logs
3. ✅ Ativar rate limiting
4. ✅ Aumentar idle timeout
5. ✅ Config validation
6. ✅ Circuit breaker

### Should Have (P2)
7. ✅ Retry com backoff
8. ✅ Métricas com labels
9. ✅ Health check aprimorado
10. ✅ Request tracing

### Could Have (P3)
11. ⏸️ Compression middleware
12. ⏸️ Cache de `/json/version`
13. ⏸️ Connection pooling

### Won't Have (Fora de Escopo)
- Load balancing múltiplos Chrome backends
- Autenticação/autorização (fora do escopo do proxy)
- TLS/SSL termination (não necessário em rede interna)

---

## 7. RISCOS E MITIGAÇÕES

| Risco                               | Probabilidade | Impacto | Mitigação                                  |
| ----------------------------------- | ------------- | ------- | ------------------------------------------ |
| Breaking change em prod             | Baixa         | Alto    | Testes E2E antes de deploy                 |
| Circuit breaker muito strict        | Média         | Médio   | Configurar threshold alto (5-10 falhas)    |
| Rate limiting bloqueia uso legítimo | Baixa         | Médio   | Limite alto (1000 req/min) + whitelist IPs |
| Idle timeout fecha sessões ativas   | Baixa         | Alto    | Timeout generoso (5min) + keep-alive       |

---

## 8. TESTES NECESSÁRIOS

### Unit Tests
```javascript
describe('ChromeProxyService', () => {
    it('should validate config on construction', () => {
        expect(() => new ChromeProxyService({ PROXY_PORT: 'invalid' }))
            .toThrow('Invalid PROXY_PORT');
    });

    it('should rewrite WebSocket URLs correctly', () => {
        const proxy = new ChromeProxyService();
        const data = JSON.stringify({
            webSocketDebuggerUrl: 'ws://host.docker.internal:9225/devtools/...'
        });
        const rewritten = proxy.rewriteWebSocketURL(data, 'localhost:9224');
        expect(rewritten).toContain('ws://localhost:9224/devtools/');
    });

    it('should open circuit breaker after threshold failures', async () => {
        const breaker = new CircuitBreaker(3, 5000);
        const failingFn = () => Promise.reject(new Error('fail'));

        for (let i = 0; i < 3; i++) {
            await expect(breaker.call(failingFn)).rejects.toThrow();
        }

        expect(breaker.state).toBe('OPEN');
    });
});
```

### Integration Tests
```javascript
describe('ChromeProxyService E2E', () => {
    let proxy, chromeProcess;

    beforeAll(async () => {
        // Start real Chrome
        chromeProcess = startChrome();

        // Start proxy
        proxy = new ChromeProxyService();
        await proxy.start();
    });

    it('should proxy HTTP requests to Chrome', async () => {
        const res = await fetch('http://localhost:9224/json/version');
        expect(res.ok).toBe(true);
        const json = await res.json();
        expect(json.Browser).toContain('Chrome');
    });

    it('should upgrade to WebSocket', async () => {
        const ws = new WebSocket('ws://localhost:9224/devtools/browser/abc-123');
        await new Promise(resolve => ws.on('open', resolve));
        expect(ws.readyState).toBe(WebSocket.OPEN);
    });

    afterAll(async () => {
        await proxy.stop();
        chromeProcess.kill();
    });
});
```

---

## 9. COMPARAÇÃO COM ALTERNATIVAS

| Solução                   | Prós                         | Contras                          | Score  |
| ------------------------- | ---------------------------- | -------------------------------- | ------ |
| **Atual (Custom Proxy)**  | Controle total, customizável | Manutenção, bugs próprios        | 7.5/10 |
| **nginx reverse proxy**   | Maduro, performante          | Menos flexível, config complexa  | 8/10   |
| **Envoy proxy**           | Service mesh, observability  | Overhead alto, curva aprendizado | 7/10   |
| **http-proxy-middleware** | Simples, Node.js native      | Menos features, sem WS robusto   | 6/10   |

**Recomendação**: **Manter custom proxy** após hardening. Oferece melhor integração com NERV e customizações específicas do projeto.

---

## 10. CONCLUSÃO

O Chrome Proxy Service está **funcional e atende aos requisitos**, mas precisa de **hardening** em:

1. **Segurança** (CORS, rate limiting)
2. **Resiliência** (circuit breaker, retry)
3. **Observabilidade** (métricas, health checks)

Com as melhorias propostas, o proxy alcançará **enterprise-grade quality** (Score 9/10).

**Próximos Passos**:
1. Revisar e aprovar propostas
2. Implementar Fase 1 (Hardening)
3. Testar em ambiente de staging
4. Deploy gradual em produção

---

**Versão**: 1.0
**Aprovação Pendente**: Sim
**Estimativa Total**: 5-8 dias de desenvolvimento
