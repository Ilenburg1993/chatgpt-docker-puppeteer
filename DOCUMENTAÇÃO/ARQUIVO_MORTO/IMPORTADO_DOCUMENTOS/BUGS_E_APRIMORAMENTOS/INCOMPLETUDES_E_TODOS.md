# Incompletudes e TODOs - Auditoria Main.js

**Data da Auditoria:** 2026-02-12 **Arquivos Auditados:** `src/main.js`, `src/server/main.js`
**Total de Incompletudes:** 8

---

## TODOs Comentados (Código Inativo)

### TODO-001 - Snapshot de telemetria não implementado (main.js)

**Prioridade:** P2 **Tipo:** Incompletude - Feature Commented Out **Arquivo:** `src/main.js:201-206`
**Impacto:** Médio - Telemetria sem snapshot causa respostas lentas no Dashboard **Esforço:** Alto -
Implementar módulo snapshot completo

#### Problema

Há um bloco TODO comentado para inicializar um snapshot de telemetria em background. Sem isso,
endpoints de telemetria precisam coletar dados on-demand a cada request, causando latência.

#### Código Atual

```javascript
// src/main.js:201-206
// TODO: Inicia snapshot de telemetria em background para respostas rápidas
// try {
//     const intervalMs = parseInt(process.env.SNAPSHOT_INTERVAL_MS || '60000', 10);
//     snapshot.start(intervalMs);
// } catch (e) {
//     log('WARN', `[BOOT] Falha ao iniciar snapshot de telemetria: ${e.message}`);
// }
```

#### Proposta de Implementação

1. Criar módulo `src/shared/telemetry/snapshot.js`
2. Implementar cache in-memory com TTL configurável
3. Background worker que atualiza snapshot a cada N segundos
4. Endpoints de API consomem snapshot em vez de dados live

#### Tarefas

- [ ] Criar módulo `snapshot.js` com interface `start()`, `stop()`, `get()`
- [ ] Implementar worker em setInterval com graceful cleanup
- [ ] Adicionar métricas: CPU, Memory, PM2 processes, NERV events/sec
- [ ] Descomentar código de inicialização no boot
- [ ] Adicionar cleanup no shutdown sequence
- [ ] Testar performance: endpoint deve responder < 10ms

---

### TODO-002 - Snapshot de telemetria não implementado (server/main.js)

**Prioridade:** P2 **Tipo:** Incompletude - Duplicate TODO **Arquivo:** `src/server/main.js:201-206`
**Impacto:** Médio - Mesma incompletude do TODO-001 **Esforço:** Alto - Compartilhado com TODO-001

#### Problema

TODO idêntico ao TODO-001, mas no contexto do processo SERVER. Ambos apontam para o mesmo módulo
snapshot ausente.

#### Código Atual

```javascript
// src/server/main.js:201-206
// TODO: Inicia snapshot de telemetria em background para respostas rápidas
// try {
//     const intervalMs = parseInt(process.env.SNAPSHOT_INTERVAL_MS || '60000', 10);
//     snapshot.start(intervalMs);
// } catch (e) {
//     log('WARN', `[BOOT] Falha ao iniciar snapshot de telemetria: ${e.message}`);
// }
```

#### Proposta de Implementação

Mesma solução do TODO-001. Uma vez implementado o módulo `snapshot.js`, descomentar em ambos os
arquivos.

---

## Features Incompletas

### INCOMPLETE-001 - TaskSyncBridge condicional pode ser esquecido

**Prioridade:** P3 **Tipo:** Incompletude - Feature Gated by ENV **Arquivo:**
`src/server/main.js:244-253` **Impacto:** Baixo - Feature útil pode ficar desabilitada por padrão
**Esforço:** Baixo - Documentar ou habilitar por padrão

#### Problema

O `TaskSyncBridge` (sincronização de tasks NERV → Dashboard) é gated por
`ENABLE_TASK_SYNC_BRIDGE === 'true'`. Não há documentação sobre quando/por que desabilitar essa
feature, sugerindo que pode ter sido deixada desabilitada durante desenvolvimento e esquecida.

#### Código Atual

```javascript
// src/server/main.js:244-253
if (process.env.ENABLE_TASK_SYNC_BRIDGE === 'true') {
  try {
    taskSyncBridge.initialize({ socketHub, nervClient: nerv });
    log('INFO', '[BOOT] TaskSyncBridge inicializado (NERV → Dashboard)');
  } catch (err) {
    log('WARN', `[BOOT] Falha ao inicializar TaskSyncBridge: ${err.message}`);
  }
} else {
  log('INFO', '[BOOT] TaskSyncBridge desativado (ENABLE_TASK_SYNC_BRIDGE!=true)');
}
```

#### Proposta de Correção

1. **Opção A (Habilitar por padrão):** Remover condicional e sempre inicializar
2. **Opção B (Documentar):** Adicionar comentário explicando quando desabilitar
3. **Opção C (Feature flag formal):** Mover para CONFIG com default `true`

#### Recomendação

Opção C - Adicionar ao `src/core/config.js`:

```javascript
ENABLE_TASK_SYNC_BRIDGE: process.env.ENABLE_TASK_SYNC_BRIDGE !== 'false'; // Default true
```

---

## Funcionalidades Ausentes (Gap Analysis)

### GAP-001 - Validação de estado antes de shutdown

**Prioridade:** P2 **Tipo:** Gap - Missing Validation **Arquivo:** `src/main.js:919-1214` (shutdown
sequence) **Impacto:** Médio - Shutdown pode corromper estado se executado durante operações
críticas **Esforço:** Alto - Implementar state machine e guards

#### Problema

A função `shutdown()` executa cleanup imediato sem validar se há operações críticas em andamento
(ex: missão executando, transação SSOT aberta, browser navegando). Isso pode causar:

- Perda de dados de missões não finalizadas
- Corrupção de SSOT se shutdown durante write
- Chrome processes órfãos se kill durante navegação

#### Proposta de Implementação

1. Adicionar fase 0.5: "Pre-flight checks"
   - Verificar se há missões ativas (MissionRunner)
   - Verificar se há transações SSOT abertas (Kernel)
   - Verificar se Browser Pool tem páginas navegando
2. Se operações críticas detectadas:
   - **Opção A:** Aguardar conclusão (timeout 30s)
   - **Opção B:** Forçar término e logar warning
   - **Opção C:** Rejeitar shutdown (retornar erro)

#### Código Proposto (esboço)

```javascript
async function shutdown(signal, bootContext) {
  const start = Date.now();
  log('INFO', `[SHUTDOWN] Iniciando sequência (signal=${signal})`);

  // FASE 0.5 - PRE-FLIGHT CHECKS
  try {
    const activeMissions = bootContext.missionManager?.getActiveMissions?.() || [];
    const activeTransactions = bootContext.kernel?.getActiveTransactions?.() || [];

    if (activeMissions.length > 0 || activeTransactions.length > 0) {
      log(
        'WARN',
        `[SHUTDOWN] Operações críticas em andamento: ${activeMissions.length} missões, ${activeTransactions.length} transações`,
      );

      // Aguardar conclusão (timeout 30s)
      await Promise.race([
        waitForCriticalOps(bootContext),
        new Promise((resolve) => setTimeout(resolve, 30000)),
      ]);
    }
  } catch (err) {
    log('WARN', `[SHUTDOWN] Pre-flight checks falhou: ${err.message}`);
  }

  // ... resto do shutdown sequence
}
```

---

### GAP-002 - Falta health check endpoint para readiness

**Prioridade:** P2 **Tipo:** Gap - Missing Feature **Arquivo:** `src/server/main.js` (endpoint
ausente) **Impacto:** Médio - Dificulta orquestração (PM2, Docker, Kubernetes) **Esforço:** Médio -
Implementar endpoint `/health` e `/ready`

#### Problema

Não há endpoint HTTP para health check que valide se o servidor está realmente pronto para aceitar
requisições. O campo `app.locals.runtimeReadiness` é definido (linha 326), mas não há endpoint
expondo essa informação.

Isso dificulta:

- PM2 wait-ready (atualmente depende apenas de `process.send('ready')`)
- Load balancer health checks
- Container orchestration (Docker, Kubernetes)

#### Proposta de Implementação

Criar 2 endpoints:

**1. `/health` - Liveness probe**

- Retorna 200 se processo está vivo (mesmo que não ready)
- Usado por orchestrators para detectar processo morto

**2. `/ready` - Readiness probe**

- Retorna 200 apenas se `app.locals.runtimeReadiness` completo
- Valida que NERV, serverAdapter, httpServer estão ativos
- Retorna 503 Service Unavailable se algum componente faltando

#### Código Proposto

```javascript
// src/server/api/controllers/health.js (NOVO ARQUIVO)
import { log } from '#core/logger';

export function liveness(req, res) {
  res.status(200).json({
    status: 'alive',
    pid: process.pid,
    uptime: process.uptime(),
  });
}

export function readiness(req, res) {
  const app = req.app;
  const runtime = app.locals.runtimeReadiness || {};
  const required = app.locals.requiredReadiness || [];

  const missing = required.filter((key) => !runtime[key]);

  if (missing.length > 0) {
    log('WARN', `[HEALTH] Readiness check falhou: faltando ${missing.join(', ')}`);
    return res.status(503).json({
      status: 'not_ready',
      missing,
      runtime,
    });
  }

  res.status(200).json({
    status: 'ready',
    runtime,
  });
}

// src/server/api/router.js - Adicionar rotas:
import * as health from './controllers/health.js';

app.get('/health', health.liveness);
app.get('/ready', health.readiness);
```

---

### GAP-003 - Falta validação de NERV instance antes de uso

**Prioridade:** P1 **Tipo:** Gap - Missing Validation **Arquivo:** `src/main.js` (múltiplas
ocorrências) **Impacto:** Alto - Crash em runtime se NERV não inicializar corretamente **Esforço:**
Baixo - Adicionar guards antes de cada uso

#### Problema

Após criar a instância NERV (linha 274), o código assume que `nerv` é sempre válido e tem os métodos
esperados (`onEvent`, `sendEvent`, `close`). Se a criação de NERV falhar silenciosamente (retornar
objeto parcial ou corrupto), o código pode crashar em runtime.

#### Locais sem Validação

1. Linha 392: `nerv.onEvent(...)` - Assume que método existe
2. Linha 689-711: `sendToClient` fallback - Assume que NERV é válido
3. Linha 991: `sendEvent` no shutdown - Pode crashar se NERV já foi destruído

#### Proposta de Correção

Criar helper `isValidNERV()` e usar antes de cada operação:

```javascript
// src/shared/nerv/utils.js (NOVO ARQUIVO)
export function isValidNERV(nerv) {
  return (
    nerv &&
    typeof nerv === 'object' &&
    typeof nerv.onEvent === 'function' &&
    typeof nerv.sendEvent === 'function'
  );
}

// Uso no código:
import { isValidNERV } from '#shared/nerv/utils';

// Antes de linha 392:
if (!isValidNERV(nerv)) {
  throw new Error('[BOOT] NERV instance inválida após criação');
}

// Antes de linha 991 (shutdown):
if (isValidNERV(bootContext.nerv)) {
  await sendEvent(bootContext.nerv, ActorRole.MAESTRO, ActionCode.SHUTDOWN_COMPLETE, {
    phase: 'all',
    duration: Date.now() - start,
  });
} else {
  log('WARN', '[SHUTDOWN] NERV inválido, pulando evento SHUTDOWN_COMPLETE');
}
```

---

### GAP-004 - Falta retry logic para Chrome Proxy connection

**Prioridade:** P2 **Tipo:** Gap - Missing Resilience **Arquivo:** `src/main.js:311-384`
**Impacto:** Médio - Boot falha se Chrome Proxy não responder no primeiro timeout **Esforço:**
Alto - Implementar retry com backoff

#### Problema

A inicialização do Chrome Proxy usa um único timeout de 10s (linha 375). Se o proxy não responder
(ex: Chrome demorando para inicializar), o boot falha completamente. Não há retry logic.

#### Código Atual

```javascript
// src/main.js:375-383
const fallbackTimer = setTimeout(() => {
  if (!proxyConfirmed) {
    log('WARN', '[BOOT] Chrome Proxy não confirmado via NERV, continuando...');
    proxyConfirmed = true;
    resolve();
  }
}, 10000);
```

#### Proposta de Implementação

Implementar retry com exponential backoff (3 tentativas):

```javascript
async function waitForChromeProxyWithRetry(nerv, maxRetries = 3) {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const timeout = 10000 * Math.pow(1.5, attempt - 1); // 10s, 15s, 22.5s
      log(
        'INFO',
        `[BOOT] Aguardando Chrome Proxy (tentativa ${attempt}/${maxRetries}, timeout=${timeout}ms)`,
      );

      await waitForChromeProxy(nerv, timeout);
      log('INFO', '[BOOT] Chrome Proxy confirmado');
      return true;
    } catch (err) {
      if (attempt === maxRetries) {
        log('ERROR', `[BOOT] Chrome Proxy não confirmado após ${maxRetries} tentativas`);
        throw err;
      }
      log('WARN', `[BOOT] Chrome Proxy timeout, tentando novamente... (${attempt}/${maxRetries})`);
      await new Promise((resolve) => setTimeout(resolve, 2000)); // 2s entre retries
    }
  }
}
```

---

## Código Comentado (Dead Code)

### DEAD-001 - Imports comentados em main.js

**Prioridade:** P3 **Tipo:** Dead Code - Commented Imports **Arquivo:** `src/main.js` (verificar via
grep) **Impacto:** Baixo - Polui código sem impacto funcional **Esforço:** Baixo - Remover linhas
comentadas

#### Problema

Pode haver imports ou código comentado que não é mais necessário. Isso polui o arquivo e dificulta
manutenção.

#### Ação Recomendada

Executar grep para encontrar:

```bash
grep -n "^// import\|^//const\|^//let" src/main.js src/server/main.js
```

Se encontrado, avaliar se é temporário (manter com TODO + data) ou permanente (remover).

---

## Resumo Estatístico

| Categoria                   | Quantidade | Prioridade Média |
| --------------------------- | ---------- | ---------------- |
| TODOs Comentados            | 2          | P2               |
| Features Incompletas        | 1          | P3               |
| Gaps (Validação/Resilience) | 4          | P1.75            |
| Dead Code                   | 1          | P3               |
| **TOTAL**                   | **8**      | **P2.1**         |

### Distribuição por Prioridade

- **P1:** 1 incompletude (12.5%)
- **P2:** 5 incompletudes (62.5%)
- **P3:** 2 incompletudes (25%)

### Esforço Estimado Total

- **Baixo:** 2 items (~2 horas)
- **Médio:** 3 items (~6 horas)
- **Alto:** 3 items (~12 horas)

**Total estimado:** 20 horas de desenvolvimento

### Próximos Passos Recomendados

1. **Curto Prazo (Sprint Atual):**
   - GAP-003: Adicionar validação de NERV (2h)
   - INCOMPLETE-001: Mover TaskSyncBridge para CONFIG (1h)
   - DEAD-001: Limpar código comentado (1h)

2. **Médio Prazo (Próximos 2 Sprints):**
   - GAP-002: Implementar health check endpoints (4h)
   - GAP-001: Validação de estado antes de shutdown (8h)
   - GAP-004: Retry logic para Chrome Proxy (6h)

3. **Longo Prazo (Backlog):**
   - TODO-001/002: Implementar snapshot de telemetria (12h)
