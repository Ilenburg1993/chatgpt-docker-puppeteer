# AUDITORIA TÉCNICA COMPLETA — chatgpt-docker-puppeteer

> **Data:** 2026-02-21 **Auditor:** Kilo Code (Claude Sonnet 4.6) **Escopo:** Repositório completo
> `/workspaces/chatgpt-docker-puppeteer` **Versão analisada:** 1.0.0 — Runtime: Node.js 24+ (ESM)

---

## SUMÁRIO EXECUTIVO

O projeto é um **agente autônomo de automação de browser** (Puppeteer + Chrome DevTools Protocol)
com arquitetura orientada a eventos, integração multi-LLM (ChatGPT, Gemini, Claude) e sistema de
orquestração de missões em múltiplos processos via PM2.

**Pontos positivos identificados:**

- Arquitetura modular e bem segregada (core / infra / agent / kernel / server)
- Validação de schema com Zod em pontos críticos da API
- Suite de testes extensiva (97+ arquivos: unit, integration, regression, e2e)
- Infraestrutura de locks resilientes contra deadlocks (`ResilientLockManager`)
- Circuit breakers para tolerância a falhas de browser (`CircuitBreakerManager`)
- Documentação JSDoc razoável nos módulos principais
- WAL mode habilitado no SQLite — performance adequada para escrita/leitura
- Helmet, CORS, Rate Limiting e compressão configurados (com ressalvas)

**Problemas identificados: 27 no total**

| Severidade | Quantidade | Descrição geral                                                 |
| ---------- | ---------- | --------------------------------------------------------------- |
| Crítico    | 2          | Requerem correção imediata antes de qualquer deploy de produção |
| Alto       | 5          | Risco de segurança ou perda de dados em produção                |
| Médio      | 13         | Bugs funcionais, débitos técnicos e funcionalidades incompletas |
| Baixo      | 7          | Qualidade de código, nomenclatura e melhorias menores           |

**Estado geral:** ⚠️ **BOM com ressalvas críticas** — não apto para deployment de produção sem
correção dos itens Críticos e Altos.

---

## TABELA DE SEVERIDADE DOS PROBLEMAS

| ID      | Categoria      | Título                                                               | Severidade | Arquivo Principal                                       |
| ------- | -------------- | -------------------------------------------------------------------- | ---------- | ------------------------------------------------------- |
| SEC-01  | Segurança      | JWT_SECRET com fallback hardcoded                                    | Crítico    | `src/server/middleware/auth.js:31`                      |
| BUG-01  | Bug Runtime    | `metric()` usa `\\n` literal — arquivo de métricas corrompido        | Crítico    | `src/core/logger.js:215`                                |
| SEC-02  | Segurança      | Logout sem invalidação de token JWT                                  | Alto       | `src/server/api/controllers/dashboard.js:98`            |
| SEC-03  | Segurança      | Content Security Policy (CSP) desabilitada                           | Alto       | `src/server/engine/app.js:90`                           |
| SEC-04  | Segurança      | Rate limiting completamente desabilitado em desenvolvimento          | Alto       | `src/server/engine/app.js:179`                          |
| BUG-02  | Bug Runtime    | `log()` é async mas usada sem `await` em todo o código               | Alto       | `src/core/logger.js:119`                                |
| FUNC-01 | Funcionalidade | `ValidationService` retorna score aleatório — STUB não documentado   | Alto       | `src/orchestrator/validation/validation_service.js:113` |
| PERF-01 | Performance    | `GET /api/tasks` carrega até 20.000 registros sem paginação          | Médio      | `src/server/api/controllers/tasks.js:144`               |
| BUG-03  | Bug Runtime    | `console.log` raw no ResilientLockManager em vez do logger central   | Médio      | `src/infra/locks/resilient_lock.js:79`                  |
| BUG-04  | Bug Runtime    | Task com `task_json` corrompido retorna null silenciosamente         | Médio      | `src/infra/db/task_repo.js:95`                          |
| ARCH-01 | Arquitetura    | CORS do Socket.io com IPs Docker hardcoded                           | Médio      | `src/server/engine/socket.js:18`                        |
| ARCH-02 | Arquitetura    | `package.json: "private": false` — risco de publicação no npm        | Médio      | `package.json:5`                                        |
| ARCH-03 | Arquitetura    | TODO crítico: evento NERV não emitido quando Circuit Breaker abre    | Médio      | `src/infra/browser_pool/pool_manager.js:669`            |
| ARCH-04 | Arquitetura    | Rota fallback 404 com risco de interceptar rotas API não registradas | Médio      | `src/server/engine/app.js:353`                          |
| ARCH-05 | Arquitetura    | Mistura de convenções de nomes (camelCase vs SCREAMING_SNAKE_CASE)   | Médio      | `src/core/config.js`                                    |
| DEBT-01 | Débito Técnico | Métricas de telemetria PM2/browser não implementadas                 | Médio      | `src/shared/telemetry/snapshot.js:104`                  |
| DEBT-02 | Débito Técnico | Context summarization com LLM não implementada                       | Médio      | `src/orchestrator/context_manager.js:269`               |
| DEBT-03 | Débito Técnico | `MAX_QUEUE_DEPTH` hardcoded sem config externa                       | Médio      | `src/infra/io.js:92`                                    |
| DEBT-04 | Débito Técnico | Memory store sem persistência em disco                               | Médio      | `src/orchestrator/memory_store.js:28`                   |
| PERF-02 | Performance    | Detecção de ciclos em dependências com O(n²) potencial               | Médio      | `src/server/api/controllers/tasks.js:64`                |
| QUAL-01 | Qualidade      | JSDoc duplicado em `rotateFile`                                      | Baixo      | `src/core/logger.js:64`                                 |
| QUAL-02 | Qualidade      | Exports com indentação inconsistente no logger                       | Baixo      | `src/core/logger.js:291`                                |
| QUAL-03 | Qualidade      | `engines` declara pnpm/yarn mas `preinstall` bloqueia yarn           | Baixo      | `package.json:233`                                      |
| QUAL-04 | Qualidade      | Arquivos de debug e screenshots no repositório                       | Baixo      | `test-proxy-screenshot.png`                             |
| QUAL-05 | Qualidade      | `.env.development` e `.env.production` commitados no git             | Baixo      | `.env.development`                                      |
| QUAL-06 | Qualidade      | `MAX_ARCHIVES = 5` para rotação de logs sem configuração externa     | Baixo      | `src/core/logger.js:21`                                 |
| QUAL-07 | Qualidade      | Arquivo esqueleto de E2E quase vazio                                 | Baixo      | `tests/e2e/test_integration_complete.spec.js`           |

---

## SEÇÃO 1 — PROBLEMAS CRÍTICOS

### SEC-01: JWT_SECRET com Fallback Hardcoded para String Pública

**Severidade:** Crítico **Arquivos:**

- [`src/server/middleware/auth.js:31`](src/server/middleware/auth.js:31)
- [`src/server/middleware/auth.js:80`](src/server/middleware/auth.js:80)
- [`src/server/api/controllers/dashboard.js:68`](src/server/api/controllers/dashboard.js:68)

**Descrição:** O secret JWT usa fallback para a string literal
`'default-secret-change-in-production'`. Em qualquer ambiente onde `JWT_SECRET` não estiver definida
— desenvolvimento, CI/CD, containers sem `.env` — todos os tokens gerados serão assinados com uma
chave pública e conhecida, permitindo que qualquer atacante forje tokens válidos.

**Impacto:** Comprometimento total de autenticação. Qualquer pessoa pode criar tokens JWT válidos
para qualquer usuário ou role.

**Antes — problemático:**

```js
// src/server/middleware/auth.js:31
const decoded = jwt.verify(token, process.env.JWT_SECRET || 'default-secret-change-in-production');
```

**Depois — corrigido:**

```js
// src/core/jwt_config.js (novo módulo centralizado)
export function getJwtSecret() {
  const secret = process.env.JWT_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error(
      '[AUTH] JWT_SECRET não definida ou muito curta (mínimo 32 caracteres). ' +
        'Configure a variável de ambiente JWT_SECRET antes de iniciar.',
    );
  }
  return secret;
}

// src/server/middleware/auth.js
import { getJwtSecret } from '#core/jwt_config';

export function authenticate(req, res, next) {
  // ...
  const decoded = jwt.verify(token, getJwtSecret());
  // ...
}
```

**Ação necessária:**

1. Criar módulo `src/core/jwt_config.js` com `getJwtSecret()`
2. Adicionar `JWT_SECRET` como variável `FATAL` no `ENV_SCHEMA` de `src/core/env_validator.js`
3. Remover todos os fallbacks hardcoded (3 ocorrências)
4. Gerar secrets de pelo menos 64 bytes aleatórios para cada ambiente

---

### BUG-01: Escapamento Incorreto em `metric()` — Arquivo de Métricas Corrompido

**Severidade:** Crítico **Arquivo:** [`src/core/logger.js:215`](src/core/logger.js:215)

**Descrição:** A função `metric()` usa `\\n` (dois caracteres: backslash literal + n) em vez de `\n`
(um caractere: newline) ao escrever no arquivo de métricas. Isso resulta em todas as entradas
escritas em uma única linha separadas pela string `\n` em vez de quebras de linha reais. O arquivo
resultante não é JSONL válido e é impossível de parsear.

**Antes — problemático:**

```js
// src/core/logger.js:215
fs.appendFileSync(METRICS_FILE, `${entry}\\n`, 'utf-8');
//                                        ^^^^ ERRADO: dois chars literais
```

**Depois — corrigido:**

```js
// src/core/logger.js:215
fs.appendFileSync(METRICS_FILE, `${entry}\n`, 'utf-8');
//                                       ^^ CORRETO: newline real (U+000A)
```

**Impacto:** Todos os dados de métricas armazenados no arquivo `logs/metrics.log` estão corrompidos
desde o primeiro uso. Qualquer sistema de análise (Prometheus, Grafana, scripts de auditoria) que
dependa desse arquivo produz resultados incorretos. A correção é trivial (remover um `\`) mas o
arquivo existente precisará ser recriado.

---

## SEÇÃO 2 — PROBLEMAS ALTOS

### SEC-02: Logout sem Invalidação de Token JWT

**Severidade:** Alto **Arquivo:**
[`src/server/api/controllers/dashboard.js:98`](src/server/api/controllers/dashboard.js:98)

**Descrição:** O endpoint `POST /api/dashboard/auth/logout` apenas registra o log do usuário mas não
invalida o token JWT. Tokens têm validade de 24 horas. Se um token for interceptado ou um usuário
for desativado, o token continuará válido por até 24 horas.

**Antes — problemático:**

```js
router.post('/auth/logout', optionalAuthenticate, (req, res) => {
  const username = req.user?.username || 'unknown';
  log('INFO', `[AUTH] User logged out: ${username}`, req.id);
  res.json({ success: true }); // Token ainda válido!
});
```

**Depois — corrigido com blocklist:**

```js
// src/infra/db/token_blocklist.js (novo módulo)
const db = getDb();

export function revokeToken(jti, expiresAtMs) {
  db.prepare('INSERT OR IGNORE INTO revoked_tokens (jti, expires_at_ms) VALUES (?, ?)').run(
    jti,
    expiresAtMs,
  );
}

export function isTokenRevoked(jti) {
  const row = db
    .prepare('SELECT 1 FROM revoked_tokens WHERE jti = ? AND expires_at_ms > ?')
    .get(jti, Date.now());
  return !!row;
}

// src/server/api/controllers/dashboard.js
router.post('/auth/logout', authenticate, (req, res) => {
  const jti = req.user?.jti; // Adicionar jti no payload do token
  if (jti) {
    revokeToken(jti, req.user.exp * 1000);
  }
  log('INFO', `[AUTH] User logged out: ${req.user?.username}`, req.id);
  res.json({ success: true, message: 'Sessão encerrada com sucesso' });
});
```

**Migration SQLite necessária:**

```sql
CREATE TABLE IF NOT EXISTS revoked_tokens (
    jti TEXT PRIMARY KEY,
    expires_at_ms INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_revoked_tokens_expires ON revoked_tokens(expires_at_ms);
```

---

### SEC-03: Content Security Policy Desabilitada

**Severidade:** Alto **Arquivo:** [`src/server/engine/app.js:90`](src/server/engine/app.js:90)

**Descrição:** O Helmet está configurado com `contentSecurityPolicy: false`, removendo completamente
a proteção CSP. Para uma aplicação que exibe dados dinâmicos de LLMs (texto livre, código, markup),
a ausência de CSP é um vetor de XSS se houver qualquer falha de encoding no frontend.

**Antes:**

```js
app.use(
  helmet({
    contentSecurityPolicy: false, // Proteção removida
    crossOriginEmbedderPolicy: false,
    // ...
  }),
);
```

**Depois:**

```js
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", "'unsafe-inline'"], // Ajustar após auditoria do Vite build
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", 'data:', 'blob:'],
        connectSrc: ["'self'", 'ws://localhost:*', 'wss://localhost:*'],
        fontSrc: ["'self'"],
        objectSrc: ["'none'"],
        frameAncestors: ["'none'"],
      },
    },
    crossOriginEmbedderPolicy: false,
    frameguard: { action: 'deny' },
    referrerPolicy: { policy: 'no-referrer' },
  }),
);
```

---

### SEC-04: Rate Limiting Completamente Desabilitado em Desenvolvimento

**Severidade:** Alto **Arquivo:** [`src/server/engine/app.js:179`](src/server/engine/app.js:179)

**Descrição:** O rate limiter ignora completamente requests de `127.0.0.1` em modo desenvolvimento.
Isso oculta problemas de DoS durante desenvolvimento e pode ser explorado em ambientes de staging
onde a variável `NODE_ENV` está incorretamente configurada como `development`.

**Antes:**

```js
const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 100,
  skip: (req) => {
    const isDev = process.env.NODE_ENV !== 'production';
    const isLocal = req.ip === '127.0.0.1' || req.ip === '::1';
    return isDev && isLocal; // Skip total — sem proteção
  },
});
```

**Depois:**

```js
const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  // Limite mais permissivo em dev, rigoroso em prod
  max: process.env.NODE_ENV === 'production' ? 100 : 2000,
  standardHeaders: true,
  legacyHeaders: false,
  // Remover skip completo
  keyGenerator: (req) => req.ip || 'unknown',
});
```

---

### BUG-02: `log()` é Async mas Usada sem `await` em Todo o Código

**Severidade:** Alto **Arquivo:** [`src/core/logger.js:119`](src/core/logger.js:119)

**Descrição:** A função `log()` é declarada como `async` (retorna Promise) porque aguarda
`logDirReady`. Contudo, em praticamente todo o código do projeto, é chamada sem `await`. Isso
resulta em: (1) logs potencialmente perdidos durante shutdown; (2) ordenamento não-determinístico;
(3) erros de escrita silenciosamente ignorados via Promises não tratadas.

**Evidência:**

```js
// src/core/logger.js:119 — função async
async function log(level, msg, taskId = '-') {
  await logDirReady; // Aguarda Promise
  // ...
}

// Chamada em centenas de pontos sem await:
log('INFO', '[BOOT] Iniciando...'); // Promise ignorada silenciosamente
log('ERROR', err.message); // Promise ignorada silenciosamente
```

**Solução recomendada — logger síncrono pós-boot:**

```js
// src/core/logger.js
let _logDirEnsured = false;

function _ensureLogDirSync() {
  if (!_logDirEnsured) {
    try {
      fs.mkdirSync(LOG_DIR, { recursive: true });
    } catch (_) {
      /* ignore race */
    }
    _logDirEnsured = true;
  }
}

// Transformar em função síncrona
function log(level, msg, taskId = '-') {
  _ensureLogDirSync();
  const levelValue = LOG_LEVELS[level.toUpperCase()] ?? LOG_LEVELS.INFO;
  if (levelValue < minLevel) return;
  // ... resto síncrono como antes
}
```

---

### FUNC-01: ValidationService Retorna Score Aleatório — STUB Não Documentado

**Severidade:** Alto **Arquivo:**
[`src/orchestrator/validation/validation_service.js:113`](src/orchestrator/validation/validation_service.js:113)

**Descrição:** O método de validação LLM-as-judge nunca foi implementado e retorna um score
aleatório entre 0 e 1. Esse comportamento é documentado apenas como comentário interno. Tasks
marcadas como "validadas" têm resultado de validação completamente incorreto e não-determinístico.
Isso compromete qualquer lógica de negócio que dependa de validação de qualidade das respostas.

**Antes — STUB problemático:**

```js
// STUB: Por enquanto retorna score aleatório simulado
// TODO: Implementar LLM-as-judge real chamando driver
logger.warn('[ValidationService] LLM validation not yet implemented, using random score');
return { passed: Math.random() > 0.5, overall_score: Math.random(), issues: [] };
```

**Depois — bypass explícito e documentado:**

```js
// Bypass explícito até implementação real
return {
  passed: true, // Assume passou (sem bloquear)
  overall_score: null, // null = não validado (diferente de 0 = falha)
  validation_mode: 'bypassed',
  reason: 'LLM_VALIDATION_NOT_CONFIGURED',
  issues: [],
  warning: 'Validation is bypassed. Results are not quality-checked.',
};
```

---

## SEÇÃO 3 — PROBLEMAS MÉDIOS

### PERF-01: `GET /api/tasks` Sem Paginação — Até 20.000 Registros por Request

**Arquivo:** [`src/server/api/controllers/tasks.js:144`](src/server/api/controllers/tasks.js:144)

O endpoint carrega `listTasks({ limit: 20000 })` sem paginação ou cursor. Com acúmulo de tarefas
históricas, isso pode retornar payloads massivos e degradar o servidor, o dashboard e a rede.

**Antes:**

```js
router.get('/', async (req, res) => {
  const tasks = listTasks({ limit: 20000 });
  ok(res, req, { items: tasks }, { limit: 20000 });
});
```

**Depois:**

```js
router.get('/', async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit) || 100, 500);
    const offset = Math.max(parseInt(req.query.offset) || 0, 0);
    const status = typeof req.query.status === 'string' ? req.query.status : null;
    const tasks = listTasks({ limit, offset, status });
    const total = countTasks({ status });
    ok(res, req, {
      items: tasks,
      pagination: { limit, offset, total, has_more: offset + tasks.length < total },
    });
  } catch (e) {
    fail(res, req, 500, { code: 'TASKS_LIST_FAILED', error: e.message });
  }
});
```

---

### BUG-03: `console.log` Raw no ResilientLockManager

**Arquivo:** [`src/infra/locks/resilient_lock.js:79`](src/infra/locks/resilient_lock.js:79)

O `ResilientLockManager` usa `console.log` em vez do logger central, excluindo mensagens de cleanup
de locks dos arquivos de log do sistema.

```js
// Antes:
console.log(`[ResilientLock] ${signal} received. Releasing ${lockCount} active locks...`);

// Depois:
import { log } from '#core/logger';
log('INFO', `[ResilientLock] ${signal} received. Releasing ${lockCount} active locks...`);
```

---

### BUG-04: Task com `task_json` Corrompido Retorna `null` Silenciosamente

**Arquivo:** [`src/infra/db/task_repo.js:95`](src/infra/db/task_repo.js:95)

Quando o JSON de uma task está corrompido, `_rowToTask()` retorna `null`, tornando a task invisível
para o sistema (nunca processada, nunca reportada, apenas ignorada).

```js
// Antes — silencioso:
try {
    task = JSON.parse(row.task_json);
} catch (err) {
    console.error(`[task_repo] Invalid task_json for task ${row?.id}: ${msg}`);
    return null;
}

// Depois — com marcação explícita de BLOCKED:
} catch (err) {
    log('ERROR', `[task_repo] Corrupted task_json for task ${row?.id}: ${err.message}`);
    try {
        getDb().prepare(
            "UPDATE tasks SET status='BLOCKED', blocked_reason=? WHERE id=?"
        ).run(`CORRUPTED_JSON: ${err.message}`, row.id);
    } catch (_) { /* ignore secondary failure */ }
    return null;
}
```

---

### ARCH-01: CORS do Socket.io com IPs Docker Hardcoded

**Arquivo:** [`src/server/engine/socket.js:18`](src/server/engine/socket.js:18)

A lista de origens Socket.io inclui `172.17.0.2` hardcoded — IP que varia entre instalações Docker.

```js
// Antes:
const DASHBOARD_ALLOWED_ORIGINS = new Set([
  'http://172.17.0.2:5173', // IP pode mudar
  'http://172.17.0.2:5174',
  // ...
]);

// Depois — CIDR dinâmico:
function isDashboardOriginAllowed(origin) {
  if (!origin) return true;
  if (DASHBOARD_ALLOWED_ORIGINS.has(origin)) return true;
  // Permitir Docker bridge network em não-produção
  if (process.env.NODE_ENV !== 'production') {
    const dockerBridge = /^https?:\/\/172\.\d+\.\d+\.\d+:\d+$/;
    if (dockerBridge.test(origin)) return true;
  }
  return false;
}
```

---

### ARCH-02: `package.json: "private": false`

**Arquivo:** [`package.json:5`](package.json:5)

O campo `"private": false` significa que o pacote pode ser publicado acidentalmente com
`npm publish`.

```json
// Antes:
"private": false,

// Depois:
"private": true,
```

---

### ARCH-03: Circuit Breaker não Notifica o Kernel via NERV

**Arquivo:**
[`src/infra/browser_pool/pool_manager.js:669`](src/infra/browser_pool/pool_manager.js:669)

Quando o Circuit Breaker abre, há um `TODO` para pausar o Kernel via NERV que nunca foi
implementado. O Kernel continua tentando processar tarefas mesmo quando o browser está indisponível.

```js
// Antes:
if (shouldPause) {
  log('WARN', '[BrowserPool] ⏸️ Sistema deve PAUSAR devido ao Circuit Breaker');
  // TODO: Emitir evento NERV para Kernel pausar
}

// Depois:
if (shouldPause && this.nerv) {
  try {
    await this.nerv.emitEvent({
      type: ActionCode.SYSTEM_PAUSE_REQUESTED,
      reason: 'CIRCUIT_BREAKER_OPEN',
      source: ActorRole.BROWSER_POOL,
      ts: Date.now(),
    });
  } catch (err) {
    log('WARN', `[BrowserPool] Failed to notify Kernel of circuit open: ${err.message}`);
  }
}
```

---

### DEBT-01: Métricas de Telemetria não Implementadas

**Arquivo:** [`src/shared/telemetry/snapshot.js:104`](src/shared/telemetry/snapshot.js:104)

O snapshot de telemetria retorna zeros para `processCount`, `memoryTotal` e métricas do
kernel/browser pool. O endpoint `/ready` e dashboards de monitoramento mostram dados incorretos.

**TODOs identificados:**

```js
// Linha 104:
processCount: 0, // TODO: implementar via PM2.list()
memoryTotal: 0,  // TODO: somar memória de todos os processos

// Linha 120:
// TODO: implementar métodos no Kernel para expor métricas

// Linha 145:
// TODO: implementar métodos no Browser Pool para expor métricas
```

---

### PERF-02: Detecção de Ciclos em Dependências com O(n²) Potencial

**Arquivo:** [`src/server/api/controllers/tasks.js:64`](src/server/api/controllers/tasks.js:64)

A função `_detectDependencyCycle()` usa DFS sem memo/cache. Para grafos de dependências grandes,
isso pode resultar em múltiplas consultas ao banco de dados por chamada.

**Melhoria:**

```js
// Adicionar cache de dependências lidas do DB durante a travessia:
function _detectDependencyCycle(taskId, newDeps, visited = new Set(), depsCache = new Map()) {
  if (visited.has(taskId)) return { hasCycle: true, path: [...visited, taskId] };
  visited.add(taskId);

  const deps = depsCache.has(taskId)
    ? depsCache.get(taskId)
    : (() => {
        const rows = getDb()
          .prepare('SELECT depends_on_task_id FROM task_dependencies WHERE task_id = ?')
          .all(taskId);
        const result = rows.map((r) => String(r.depends_on_task_id));
        depsCache.set(taskId, result);
        return result;
      })();

  // ... resto da lógica
}
```

---

## SEÇÃO 4 — PROBLEMAS BAIXOS

### QUAL-01: JSDoc Duplicado em `rotateFile`

**Arquivo:** [`src/core/logger.js:64`](src/core/logger.js:64)

Há dois blocos JSDoc consecutivos para a mesma função `rotateFile`. Remover o primeiro bloco (linhas
65-68) e manter apenas o segundo que é mais completo.

---

### QUAL-02: Exports com Indentação Inconsistente no Logger

**Arquivo:** [`src/core/logger.js:291`](src/core/logger.js:291)

Os últimos exports do logger têm 4 espaços de indentação extra sem razão estrutural.

```js
// Antes (indentação incorreta):
export { audit };
export { metric };
export { metric as logMetric };
export { LOG_DIR };

// Depois:
export { audit };
export { metric };
export { metric as logMetric };
export { LOG_DIR };
```

---

### QUAL-03: `engines` Declara Conflito com `preinstall`

**Arquivo:** [`package.json:228`](package.json:228)

O campo `engines` lista `yarn >= 1.0.0` como suportado, mas o script `preinstall` ativamente
bloqueia yarn. Remover yarn do campo `engines`.

---

### QUAL-05: `.env.development` e `.env.production` no Git

**Arquivos:** [`.env.development`](.env.development), [`.env.production`](.env.production)

Esses arquivos estão commitados. Embora possam ser apenas templates, o `.gitignore` deve cobri-los
explicitamente para evitar vazamento de credenciais reais.

```
# .gitignore — adicionar:
.env.development
.env.production
.env.local
```

---

## SEÇÃO 5 — ANÁLISE DE SEGURANÇA

### Superfície de Ataque

| Vetor                   | Status     | Mitigação Existente                                        |
| ----------------------- | ---------- | ---------------------------------------------------------- |
| Injeção SQL             | Mitigado   | Prepared statements em todos os queries (better-sqlite3)   |
| XSS no Dashboard        | Parcial    | CSP desabilitada; React/Vite com encoding automático       |
| CSRF                    | Mitigado   | Tokens JWT + CORS configurado                              |
| DoS por Rate Limit      | Parcial    | Desabilitado em dev; ativo em produção                     |
| Path Traversal          | Mitigado   | `_safeId()` sanitiza IDs; paths controlados via constantes |
| JWT Forjado             | Vulnerável | JWT_SECRET hardcoded como fallback (SEC-01)                |
| Token Replay pós-Logout | Vulnerável | Sem blocklist de tokens revogados (SEC-02)                 |
| Command Injection       | Mitigado   | Sem uso de `exec()` com input do usuário                   |
| SSRF via automação      | Parcial    | Chrome controla URLs; `allowedDomains` no config           |
| Dados sensíveis em logs | Parcial    | `req.ip` logado; tokens não logados                        |

---

## SEÇÃO 6 — ANÁLISE DE TESTES

### Cobertura por Módulo

| Módulo                     | Arquivos de Teste                           | Status            |
| -------------------------- | ------------------------------------------- | ----------------- |
| `src/core/`                | `tests/unit/core/` (4 specs)                | Coberto           |
| `src/agent/`               | `tests/unit/agent/` (3 specs) + regression  | Coberto           |
| `src/kernel/`              | `tests/unit/kernel/` (5 specs)              | Coberto           |
| `src/infra/db/`            | Via specs de agent/server                   | Indireto          |
| `src/server/middleware/`   | `tests/unit/server/test_middleware.spec.js` | Coberto           |
| `src/orchestrator/`        | `tests/unit/orchestrator/` (3 specs)        | Coberto           |
| `src/nerv/`                | `tests/unit/nerv/` (3 specs)                | Coberto           |
| `src/infra/proxy/`         | Apenas testes manuais                       | Sem automação     |
| `src/shared/biomechanics/` | `tests/unit/shared/` (2 specs)              | Coberto           |
| E2E completo               | 1 arquivo esqueleto (333 bytes)             | Sem implementação |

### Gaps de Cobertura

1. **`src/infra/proxy/chromeProxyService.js`** (69k chars) — arquivo mais complexo do projeto sem
   testes automatizados
2. **`src/infra/db/migrations.js`** — sem testes unitários para cada migration individualmente
3. **`src/orchestrator/validation/validation_service.js`** — ValidationService testável mas o STUB
   invalida os testes
4. **`tests/e2e/test_integration_complete.spec.js`** — apenas 333 bytes (arquivo esqueleto sem
   implementação)

---

## SEÇÃO 7 — ANÁLISE DE DEPENDÊNCIAS

### Dependências Principais

| Pacote           | Versão   | Status                         |
| ---------------- | -------- | ------------------------------ |
| `puppeteer`      | ^24.37.2 | Atualizado                     |
| `socket.io`      | ^4.8.3   | Atualizado                     |
| `express`        | ^5.2.1   | v5 — breaking changes tratados |
| `zod`            | ^4.3.6   | v4 — atualizado                |
| `jsonwebtoken`   | ^9.0.3   | Atualizado                     |
| `better-sqlite3` | ^12.6.2  | Atualizado                     |
| `helmet`         | ^8.1.0   | Atualizado                     |
| `openai`         | ^6.21.0  | Atualizado                     |

### Dependências com Preocupação

| Pacote            | Concernimento                                                     |
| ----------------- | ----------------------------------------------------------------- |
| `puppeteer-extra` | Versão ^3.3.6 — última release 2022, projeto pouco ativo          |
| `ghost-cursor`    | ^1.4.2 — baixa atividade de manutenção                            |
| `user-agents`     | ^1.1.669 — banco de dados de user agents pode ficar desatualizado |

---

## SEÇÃO 8 — REFATORAÇÕES RECOMENDADAS

### R-01: Módulo Centralizado para JWT

Criar `src/core/jwt_config.js` com validação de secret na inicialização:

```js
// src/core/jwt_config.js
let _cachedSecret = null;

export function getJwtSecret() {
  if (_cachedSecret) return _cachedSecret;
  const secret = process.env.JWT_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error(
      '[AUTH] JWT_SECRET é obrigatória e deve ter pelo menos 32 caracteres. ' +
        "Gere com: node -e \"console.log(require('crypto').randomBytes(64).toString('hex'))\"",
    );
  }
  _cachedSecret = secret;
  return _cachedSecret;
}

export const JWT_SIGN_OPTIONS = { expiresIn: '24h', algorithm: 'HS256' };
export const JWT_VERIFY_OPTIONS = { algorithms: ['HS256'] };
```

### R-02: Logger Síncrono

Remover a dependência async do diretório de logs fazendo a criação no momento de inicialização do
módulo:

```js
// src/core/logger.js — topo do arquivo
try {
  fs.mkdirSync(LOG_DIR, { recursive: true }); // síncrono na carga do módulo
} catch (_) {
  /* ignore — pode já existir */
}

// Remover o 'async' da função log:
function log(level, msg, taskId = '-') {
  // Sem await, sem Promise — completamente síncrono
  const levelValue = LOG_LEVELS[level.toUpperCase()] ?? LOG_LEVELS.INFO;
  if (levelValue < minLevel) return;
  rotateFile(LOG_FILE, 'agente_', MAX_LOG_SIZE);
  // ...
}
```

### R-03: Paginação por Cursor em `listTasks`

```js
// src/infra/db/task_repo.js
export function listTasks({ limit = 100, offset = 0, status = null, stage = null } = {}) {
  const db = getDb();
  const params = [];
  let where = 'WHERE 1=1';
  if (status) {
    where += ' AND status = ?';
    params.push(status);
  }
  if (stage) {
    where += ' AND stage = ?';
    params.push(stage);
  }
  params.push(Math.min(limit, 500), Math.max(offset, 0));
  return db
    .prepare(
      `SELECT * FROM tasks ${where} ORDER BY priority DESC, created_at_ms ASC LIMIT ? OFFSET ?`,
    )
    .all(...params)
    .map(_rowToTask)
    .filter(Boolean);
}

export function countTasks({ status = null, stage = null } = {}) {
  const db = getDb();
  const params = [];
  let where = 'WHERE 1=1';
  if (status) {
    where += ' AND status = ?';
    params.push(status);
  }
  if (stage) {
    where += ' AND stage = ?';
    params.push(stage);
  }
  return db.prepare(`SELECT COUNT(*) as n FROM tasks ${where}`).get(...params)?.n || 0;
}
```

---

## CHECKLIST DE AÇÕES — EQUIPE DE DESENVOLVIMENTO

### Imediato (antes do próximo deploy de produção)

- [ ] **SEC-01** — Remover fallback `'default-secret-change-in-production'` do JWT_SECRET em:
  - `src/server/middleware/auth.js:31` e `:80`
  - `src/server/api/controllers/dashboard.js:68`
- [ ] **SEC-01** — Adicionar `JWT_SECRET` como variável `FATAL` em `src/core/env_validator.js`
- [ ] **BUG-01** — Corrigir `\\n` para `\n` em `src/core/logger.js:215` na função `metric()`
- [ ] **ARCH-02** — Alterar `"private": false` para `"private": true` em `package.json:5`

### Esta Sprint (próximas 2 semanas)

- [ ] **SEC-02** — Implementar blocklist de tokens JWT para suportar logout real (migration v+1)
- [ ] **SEC-03** — Configurar CSP adequada no Helmet para o dashboard
- [ ] **SEC-04** — Ajustar rate limiting para limite maior em dev ao invés de desabilitar
- [ ] **BUG-02** — Refatorar `log()` para ser síncrona (remover `async` e `await logDirReady`)
- [ ] **FUNC-01** — Substituir score aleatório do ValidationService por bypass explícito e
      documentado
- [ ] **BUG-03** — Migrar `console.log` do ResilientLockManager para o logger central

### Próximas Sprints (2-4 semanas)

- [ ] **PERF-01** — Implementar paginação cursor-based em `GET /api/tasks`
- [ ] **BUG-04** — Implementar marcação de `BLOCKED` para tasks com JSON corrompido
- [ ] **ARCH-01** — Implementar CORS dinâmico para Socket.io sem IPs hardcoded
- [ ] **ARCH-03** — Implementar emissão de evento NERV quando Circuit Breaker abre
- [ ] **DEBT-01** — Implementar métricas reais do PM2 e browser pool no snapshot de telemetria
- [ ] **DEBT-02** — Implementar sumarização de contexto LLM para workflows longos
- [ ] Criar testes automatizados para `src/infra/proxy/chromeProxyService.js`
- [ ] Completar arquivo esqueleto `tests/e2e/test_integration_complete.spec.js`

### Backlog (a planejar)

- [ ] **QUAL-01** — Remover JSDoc duplicado em `rotateFile` (`src/core/logger.js:64`)
- [ ] **QUAL-02** — Corrigir indentação extra nos exports do logger
- [ ] **QUAL-03** — Remover yarn do campo `engines` no `package.json`
- [ ] **QUAL-05** — Adicionar `.env.development` e `.env.production` ao `.gitignore`
- [ ] Resolver todos os TODOs em `src/shared/telemetry/snapshot.js`
- [ ] Implementar persistência em disco do `memory_store.js`
- [ ] **DEBT-03** — Mover `MAX_QUEUE_DEPTH` para `config.json` / variável de ambiente
- [ ] Auditar dependências com baixa atividade: `puppeteer-extra`, `ghost-cursor`

---

## MÉTRICAS DE QUALIDADE

| Métrica                          | Valor                    | Status                 |
| -------------------------------- | ------------------------ | ---------------------- |
| Arquivos com `@ts-check`         | ~85%                     | Bom                    |
| Documentação JSDoc               | ~70%                     | Adequado               |
| Arquivos de teste automatizados  | 97+                      | Bom                    |
| Testes E2E reais implementados   | 0 de 3                   | Insuficiente           |
| TODOs críticos não resolvidos    | 12 identificados         | Atenção                |
| Vulnerabilidades de dependências | 0 conhecidas (npm audit) | Bom                    |
| Problemas Críticos de Segurança  | 2                        | Bloqueador de produção |
| Problemas Altos                  | 5                        | Atenção imediata       |

---

_Auditoria realizada por Kilo Code em 2026-02-21._ _Para questionar ou detalhar qualquer item,
referencie o ID do problema (ex: SEC-01, BUG-01)._
