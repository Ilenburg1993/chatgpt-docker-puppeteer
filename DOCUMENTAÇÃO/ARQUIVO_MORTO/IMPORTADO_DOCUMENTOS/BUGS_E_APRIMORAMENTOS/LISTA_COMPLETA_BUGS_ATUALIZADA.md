# Lista Completa de Bugs - Auditoria Main.js (ATUALIZADA)

**Data da Auditoria:** 2026-02-13 (Atualizada após P1-4 fixes) **Arquivos Auditados:** `src/main.js`
(1372 linhas), `src/server/main.js` (394 linhas) **Total de Bugs Restantes:** 14 (5 P0/P1, 8 P2, 1
P3)

---

## ✅ Bugs JÁ CORRIGIDOS (P1-4 Campaign)

Antes de listar os bugs restantes, reconhecemos as correções já implementadas:

1. ✅ **BUG-P1-4-01:** src/server/main.js:271 - `await HighLevelNERV.sendEvent()` adicionado
2. ✅ **BUG-P1-4-02:** src/server/main.js:278 - `persistServerState(nerv, ...)` recebe NERV
   corretamente
3. ✅ **BUG-P1-4-03:** src/server/main.js:270-275 - Double-catch removido
4. ✅ **BUG-P1-4-04:** src/main.js:307 - `setInfraPolicyNERV(nerv)` chamado corretamente
5. ✅ **BUG-P1-4-05:** src/shared/nerv/utils.js - `isValidNERV()` implementado
6. ✅ **BUG-P1-4-06:** 13 missing `await` em adapters NERV corrigidos (ver
   P1_4_NERV_EMISSION_FIXES_SUMMARY.md)

**Parabéns pela campanha P1-4! 🎉**

---

## ❌ Bugs Críticos (P0/P1) - Ação Imediata Requerida

### BUG-001 - Missing `await` em async .start() methods (taskProjector, queueWorker, agentLoop)

**Prioridade:** P1 **Tipo:** Bug - Async/Await Violation + Resource Leak **Arquivo:**
`src/main.js:560, 591, 619` **Impacto:** Alto - Race conditions, silent failures, boot completes
antes de workers ready **Esforço:** Baixo (1h)

#### Problema

Três workers são iniciados sem `await`, permitindo que boot prossiga antes da inicialização
completar:

```javascript
// src/main.js:560 - ❌ NÃO AWAITED
taskProjector.start();

// src/main.js:591 - ❌ NÃO AWAITED
heartbeatWatchdog.start();

// src/main.js:619 - ❌ NÃO AWAITED
agentLoop.start();

// Linha 621 loga "✅ SSOT workers online" IMEDIATAMENTE
log('INFO', '[BOOT] ✅ SSOT workers online');
```

**Problemas específicos:**

- Se `.start()` retorna Promise (async), não há garantia que worker está ready
- Boot pode completar enquanto worker ainda está inicializando
- Erros durante `.start()` não são capturados (unhandled rejection)
- Inconsistente com `kernel.start()` que É awaited (L504-506)

#### Código Proposto

```javascript
// src/main.js:560
await taskProjector.start();
log('DEBUG', '[BOOT] TaskProjector iniciado');

// src/main.js:591
await heartbeatWatchdog.start();
log('DEBUG', '[BOOT] HeartbeatWatchdog iniciado');

// src/main.js:619
await agentLoop.start();
log('DEBUG', '[BOOT] AgentLoop iniciado');

// Agora podemos garantir:
log('INFO', '[BOOT] ✅ SSOT workers online');
```

#### Validação

1. Adicionar log no `.start()` de cada worker
2. Verificar ordem de logs: worker logs ANTES de "workers online"
3. Testar com worker que demora 5s para start() — boot deve esperar

---

### BUG-002 - Missing try-catch em telemetry/watcher initialization

**Prioridade:** P2 **Tipo:** Bug - Error Handling Gap **Arquivo:**
`src/server/main.js:198-200, 215-216` **Impacto:** Médio - Crash não tratado se init() falha
**Esforço:** Baixo (1h)

#### Problema

5 inicializações SEM error handling:

```javascript
// src/server/main.js:198-200 - ❌ SEM TRY-CATCH
pm2Bridge.init();
logTail.init();
hardwareTelemetry.init();

// src/server/main.js:215-216 - ❌ SEM TRY-CATCH
fsWatcher.init();
logWatcher.init();
```

Todas as outras inicializações (SSOT, snapshot, kernel) TÊM try-catch. Inconsistência causa crashes
não tratados.

#### Código Proposto

```javascript
// src/server/main.js:198-200
try {
  pm2Bridge.init();
  log('DEBUG', '[BOOT] PM2 Bridge inicializado');
} catch (err) {
  log('WARN', `[BOOT] PM2 Bridge init falhou: ${err.message}`);
}

try {
  logTail.init();
  log('DEBUG', '[BOOT] LogTail inicializado');
} catch (err) {
  log('WARN', `[BOOT] LogTail init falhou: ${err.message}`);
}

try {
  hardwareTelemetry.init();
  log('DEBUG', '[BOOT] Hardware Telemetry inicializado');
} catch (err) {
  log('WARN', `[BOOT] Hardware Telemetry init falhou: ${err.message}`);
}

// Mesmo padrão para fsWatcher e logWatcher (L215-216)
```

---

### BUG-003 - NERV Discovery Listener NÃO É LIMPO (Resource Leak)

**Prioridade:** P1 **Tipo:** Bug - Resource Leak **Arquivo:** `src/main.js:392-419` **Impacto:**
Alto - Memory leak em event registry do NERV **Esforço:** Médio (2h)

#### Problema

Listener registrado para discovery, mas cleanup só acontece em 2 cenários (linha 414):

1. ✅ Evento SERVER_READY recebido (L404)
2. ✅ Timeout após 30s (L412-418)

**MAS**: Se timeout for desabilitado (`discoveryTimeoutMs = 0`), listener NUNCA é removido:

```javascript
// src/main.js:411-418
if (discoveryTimeoutMs > 0) {
  setTimeout(() => {
    try {
      if (typeof unsub === 'function') unsub();
    } catch (e) {
      /* noop */
    }
  }, discoveryTimeoutMs);
}
// ❌ Se discoveryTimeoutMs === 0, setTimeout NUNCA executa
// ❌ unsub() NUNCA é chamado
```

**Impacto:**

- `discoveryTimeoutMs=0` → listener órfão para sempre
- Em múltiplos boots (testes, PM2 restart), listeners acumulam
- Memory leak no event bus do NERV

#### Código Proposto

```javascript
// src/main.js:392-419
let unsub = null;
let cleanupExecuted = false;

const cleanup = () => {
  if (cleanupExecuted) return;
  cleanupExecuted = true;

  if (typeof unsub === 'function') {
    unsub();
    unsub = null;
    log('DEBUG', '[BOOT] Discovery listener removido');
  }
};

try {
  unsub =
    typeof nerv.onEvent === 'function'
      ? nerv.onEvent((envelope) => {
          try {
            if (
              !envelope ||
              !envelope.type ||
              envelope.type.action_code !== ActionCode.SERVER_READY
            )
              return;
            if (envelope.identity && envelope.identity.actor !== ActorRole.SERVER) return;

            discoveredServerInfo = envelope.payload || null;
            log('INFO', '[BOOT] Server descoberto via NERV:', discoveredServerInfo);

            cleanup(); // ✅ Remove listener após descoberta
          } catch (e) {
            /* ignore */
          }
        })
      : null;

  if (discoveryTimeoutMs > 0) {
    setTimeout(() => {
      cleanup(); // ✅ Remove listener após timeout
    }, discoveryTimeoutMs);
  } else {
    // ✅ Mesmo sem timeout, remove após boot completo
    setTimeout(cleanup, 60000); // Max 1min para discovery
  }
} catch (err) {
  log('DEBUG', `[BOOT] Falha ao registrar discovery NERV: ${err.message}`);
} finally {
  // ✅ Garantir cleanup mesmo se exception
  if (!cleanupExecuted) {
    setTimeout(cleanup, 60000);
  }
}
```

---

### BUG-004 - Missing `await` em sendEvent() do Chrome Proxy (startup + shutdown)

**Prioridade:** P1 **Tipo:** Bug - Async/Await Violation **Arquivo:** `src/main.js:355, 991`
**Impacto:** Alto - Eventos NERV não aguardados podem causar silent failures **Esforço:** Baixo
(30min)

#### Problema

Dois `sendEvent()` chamados SEM `await`:

```javascript
// src/main.js:355 - ❌ NÃO AWAITED
sendEvent(
    nerv,
    ActorRole.INFRA,
    ActionCode.INFRA_READY,
    {...}
);

// src/main.js:991 - ❌ NÃO AWAITED
sendEvent(
    nerv,
    ActorRole.INFRA,
    ActionCode.INFRA_SHUTDOWN,
    {...}
);
```

Segundo P1_4_NERV_EMISSION_FIXES_SUMMARY.md, `sendEvent()` foi marcado como `async` e agora retorna
Promise. Não aguardar = fire-and-forget.

#### Código Proposto

```javascript
// src/main.js:355
await sendEvent(
  nerv,
  ActorRole.INFRA,
  ActionCode.INFRA_READY,
  {
    component: 'ChromeProxyService',
    port: proxyPort,
    host: CONFIG.CHROME_PROXY_HOST,
    timestamp: Date.now(),
    mode: 'inline',
  },
  null,
  null,
);

// src/main.js:991
await sendEvent(
  nerv,
  ActorRole.INFRA,
  ActionCode.INFRA_SHUTDOWN,
  { component: 'ChromeProxyService', timestamp: Date.now() },
  null,
  null,
);
```

---

### BUG-005 - Discovery Failure Silenciado (server/main.js)

**Prioridade:** P1 **Tipo:** Bug - Error Handling Gap **Arquivo:** `src/server/main.js:278`
**Impacto:** Alto - Server nunca descoberto por Maestro em modo split **Esforço:** Baixo (1h)

#### Problema

`persistServerState()` é awaited ✅ mas erros são apenas logged como WARN:

```javascript
// src/server/main.js:263-281
try {
  try {
    await HighLevelNERV.sendEvent(nerv, ActorRole.SERVER, ActionCode.SERVER_READY, payload);
    log('DEBUG', '[BOOT] Evento NERV SERVER_READY publicado (standalone)');
  } catch (err) {
    log('WARN', `[BOOT] Não foi possível publicar SERVER_READY via NERV: ${err.message}`);
    // ❌ Erro silenciado, boot continua
  }

  // Fallback file-based
  await persistServerState(nerv, port, authority);
} catch (err) {
  log('WARN', `[BOOT] Falha geral na publicação SERVER_READY: ${err.message}`);
  // ❌ Erro silenciado novamente
}
```

**Impacto:**

- Maestro esperando SERVER_READY timeout após 30s
- Em modo split, server fica inacessível
- PM2 readiness gate (L317-320) passa mesmo sem discovery

#### Código Proposto

```javascript
// src/server/main.js:270-281
try {
  await HighLevelNERV.sendEvent(nerv, ActorRole.SERVER, ActionCode.SERVER_READY, payload);
  log('DEBUG', '[BOOT] Evento NERV SERVER_READY publicado (standalone)');
} catch (err) {
  // ✅ Retry 1 vez antes de falhar
  log('WARN', `[BOOT] NERV SERVER_READY falhou, tentando novamente...`);

  try {
    await new Promise((resolve) => setTimeout(resolve, 2000)); // Espera 2s
    await HighLevelNERV.sendEvent(nerv, ActorRole.SERVER, ActionCode.SERVER_READY, payload);
    log('INFO', '[BOOT] NERV SERVER_READY publicado (retry bem-sucedido)');
  } catch (retryErr) {
    log('ERROR', `[BOOT] CRITICAL: SERVER_READY falhou após retry: ${retryErr.message}`);

    // ✅ Se em modo standalone, isso é crítico — abort boot
    if (Authority.isStandalone(authority)) {
      throw new Error(`Discovery crítica falhou: ${retryErr.message}`);
    }
  }
}
```

---

## Bugs de Média Prioridade (P2) - Corrigir em Sprints Futuros

### BUG-006 - Signal Handlers NÃO SÃO REMOVIDOS (Resource Leak)

**Prioridade:** P2 **Tipo:** Bug - Resource Leak **Arquivo:** `src/main.js:1264-1304` **Impacto:**
Médio - Closures capturam contexto, memory não é GC'd **Esforço:** Médio (2h)

#### Problema

5 signal handlers registrados, mas NUNCA removidos:

```javascript
// src/main.js:1264-1304
process.on('SIGTERM', signalHandler);
process.on('SIGINT', signalHandler);
process.on('SIGHUP', sighupHandler);
process.on('uncaughtException', uncaughtHandler);
process.on('unhandledRejection', rejectionHandler);

// ❌ NUNCA CHAMADO: process.removeListener(...)
```

**Impacto:**

- Closures em handlers capturam `context`, `nerv`, etc.
- Memory não pode ser GC'd até process.exit()
- Em testes com múltiplos boots, handlers acumulam

#### Código Proposto

```javascript
// Armazenar referências dos handlers
const signalCleanup = {
  sigterm: null,
  sigint: null,
  sighup: null,
  uncaught: null,
  rejection: null,
};

signalCleanup.sigterm = () => triggerShutdown('SIGTERM');
process.on('SIGTERM', signalCleanup.sigterm);

// ... repeat para outros signals

// Na função shutdown(), ANTES de process.exit():
process.removeListener('SIGTERM', signalCleanup.sigterm);
process.removeListener('SIGINT', signalCleanup.sigint);
process.removeListener('SIGHUP', signalCleanup.sighup);
process.removeListener('uncaughtException', signalCleanup.uncaught);
process.removeListener('unhandledRejection', signalCleanup.rejection);

log('DEBUG', '[SHUTDOWN] Signal handlers removidos');
```

---

### BUG-007 - Missing Post-Start Validation (Workers)

**Prioridade:** P2 **Tipo:** Bug - Validation Gap **Arquivo:** `src/main.js:560-621` **Impacto:**
Médio - Workers podem falhar silenciosamente, boot reporta sucesso **Esforço:** Baixo (1.5h)

#### Problema

Após `.start()` de cada worker, NÃO há validação:

```javascript
// src/main.js:560
taskProjector.start();

// src/main.js:621 - ❌ Loga sucesso SEM verificar se start() funcionou
log('INFO', '[BOOT] ✅ SSOT workers online');
```

Compare com `kernel.start()` que valida (L504-507).

#### Código Proposto

```javascript
// Após cada .start():
await taskProjector.start();
if (!taskProjector.isRunning?.()) {
  log('WARN', '[BOOT] taskProjector.start() completou mas worker não está running');
}

await heartbeatWatchdog.start();
if (!heartbeatWatchdog.isActive?.()) {
  log('WARN', '[BOOT] heartbeatWatchdog.start() completou mas watchdog não está ativo');
}

// Só loga sucesso APÓS todas as validações
log('INFO', '[BOOT] ✅ SSOT workers online e validados');
```

---

### BUG-008 - Signal Handler Race Condition (Concurrent Shutdown)

**Prioridade:** P1 **Tipo:** Bug - Race Condition **Arquivo:** `src/main.js:1230-1257` **Impacto:**
Alto - Shutdown concorrente pode causar double-close **Esforço:** Médio (2h)

#### Problema

Múltiplos signals podem disparar `triggerShutdown()` concorrentemente:

```javascript
// src/main.js:1230-1257
let _shutdownInProgress = false;

function triggerShutdown(signal) {
  if (_shutdownInProgress) {
    log('WARN', `[SIGNAL] Shutdown já em andamento, ignorando ${signal}`);
    return;
  }

  _shutdownInProgress = true;
  // ... await shutdown() ...
}

// ❌ RACE: Se SIGTERM e SIGINT chegam ao mesmo tempo (< 1ms):
// 1. SIGTERM: _shutdownInProgress = false → true
// 2. SIGINT: _shutdownInProgress = false → true (ainda não atualizou!)
// 3. Ambos chamam await shutdown()
```

#### Código Proposto

```javascript
let _shutdownPromise = null;

async function triggerShutdown(signal) {
  // ✅ Retorna Promise existente se já em andamento
  if (_shutdownPromise) {
    log('WARN', `[SIGNAL] Shutdown já em andamento, aguardando conclusão...`);
    return _shutdownPromise;
  }

  _shutdownPromise = (async () => {
    try {
      log('INFO', `[SIGNAL] Shutdown iniciado via ${signal}`);
      await shutdown(signal, bootContext);
      process.exit(0);
    } catch (err) {
      log('FATAL', `[SIGNAL] Shutdown falhou: ${err.message}`);
      process.exit(1);
    }
  })();

  return _shutdownPromise;
}
```

---

### BUG-009 - Missing Timeout em SSOT Workers Bootstrap

**Prioridade:** P2 **Tipo:** Bug - Hangs / Deadlock Risk **Arquivo:** `src/main.js:547-625`
**Impacto:** Médio - Boot pode ficar pendurado se worker initialization hang **Esforço:** Médio (2h)

#### Problema

Bloco SSOT SEM timeout wrapper:

```javascript
// src/main.js:547-625
try {
  // ... inicialização de 7 workers ...
  // ❌ Se algum worker.start() hang, boot nunca completa
} catch (err) {
  log('FATAL', `[BOOT] SSOT workers falhou: ${err.message}`);
  process.exit(1);
}
```

#### Código Proposto

```javascript
const SSOT_INIT_TIMEOUT = 30000; // 30s

try {
  await Promise.race([
    // Inicialização normal
    (async () => {
      // ... todo código SSOT ...
    })(),

    // Timeout watchdog
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error('SSOT init timeout após 30s')), SSOT_INIT_TIMEOUT),
    ),
  ]);

  log('INFO', '[BOOT] ✅ SSOT workers online');
} catch (err) {
  log('FATAL', `[BOOT] SSOT workers init falhou: ${err.message}`);
  process.exit(1);
}
```

---

### BUG-010 a BUG-014 - Issues Menores (P2/P3)

Ver relatório completo dos Agents para detalhes de:

- **BUG-010:** ContextManager injection não validada (P2)
- **BUG-011:** ServerNERVAdapter não validado pós-instantiation (P2)
- **BUG-012:** CONFIG.reload() em SIGHUP sem timeout (P2)
- **BUG-013:** global.chromeProxy não limpo após shutdown (P3)
- **BUG-014:** Reconciler error handling ambíguo (P2)

---

## Resumo Estatístico

| Prioridade      | Quantidade | % do Total |
| --------------- | ---------- | ---------- |
| P0/P1 (Crítico) | 5          | 36%        |
| P2 (Médio-Alto) | 8          | 57%        |
| P3 (Baixo)      | 1          | 7%         |
| **TOTAL**       | **14**     | **100%**   |

### Distribuição por Categoria

- **Async/Await Violations:** 3 bugs (BUG-001, BUG-004, BUG-005)
- **Resource Leaks:** 3 bugs (BUG-003, BUG-006, BUG-013)
- **Error Handling Gaps:** 2 bugs (BUG-002, BUG-005)
- **Validation Gaps:** 3 bugs (BUG-007, BUG-010, BUG-011)
- **Race Conditions:** 2 bugs (BUG-008, BUG-009)
- **Other:** 1 bug (BUG-012, BUG-014)

### Esforço Total Estimado

- **Baixo (< 2h):** 7 bugs (~8 horas)
- **Médio (2-4h):** 6 bugs (~16 horas)
- **Alto (> 4h):** 1 bug (~6 horas)

**Total: 30 horas** de desenvolvimento + 10 horas de testes = **40 horas (~1 sprint)**

---

## Próximos Passos

1. ✅ **Aprovar Sprint 1** - Corrigir bugs P0/P1 (5 bugs, 14h)
2. ✅ **Code Review** - Revisar cada fix antes de merge
3. ✅ **Testes de Regressão** - Garantir que fixes não quebram funcionalidade existente
4. ✅ **Sprint 2** - Abordar bugs P2 restantes

**Ver também:** [RESUMO_EXECUTIVO.md](RESUMO_EXECUTIVO.md) para roadmap completo e aprovação
executiva.
