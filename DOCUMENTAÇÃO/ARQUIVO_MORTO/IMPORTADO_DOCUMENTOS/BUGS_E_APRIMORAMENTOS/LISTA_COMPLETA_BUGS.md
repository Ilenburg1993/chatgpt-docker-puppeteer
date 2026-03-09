# Lista Completa de Bugs - Auditoria Main.js

**Data da Auditoria:** 2026-02-12 **Arquivos Auditados:** `src/main.js` (1372 linhas),
`src/server/main.js` (394 linhas) **Total de Bugs Críticos:** 11 (3 P0, 5 P1, 3 P2)

---

## Bugs Críticos (P0) - Ação Imediata Requerida

### BUG-001 - Missing await em sendEvent() na inicialização do Chrome Proxy

**Prioridade:** P0 **Tipo:** Bug - Async/Await Violation **Arquivo:** `src/main.js:355` **Impacto:**
Alto - Evento NERV não aguardado pode causar race conditions **Esforço:** Baixo - Adicionar
palavra-chave await

#### Problema

Durante a inicialização do Chrome Proxy Service, o evento `INFRA_READY` é enviado via NERV sem
`await`, violando o padrão async/await do codebase. Isso pode causar race conditions onde o sistema
assume que a infraestrutura está pronta antes do evento ser efetivamente publicado.

#### Código Atual

```javascript
// src/main.js:355
sendEvent(nerv, ActorRole.INFRA, ActionCode.INFRA_READY, {
  component: 'ChromeProxyService',
  proxy_port: CHROME_PROXY_PORT,
  chrome_port: CHROME_PORT,
  chrome_host: CHROME_HOST,
});
```

#### Código Proposto

```javascript
// src/main.js:355
await sendEvent(nerv, ActorRole.INFRA, ActionCode.INFRA_READY, {
  component: 'ChromeProxyService',
  proxy_port: CHROME_PROXY_PORT,
  chrome_port: CHROME_PORT,
  chrome_host: CHROME_HOST,
});
```

#### Validação

- Executar smoke test de boot sequence
- Verificar logs NERV para garantir ordem correta dos eventos
- Confirmar que não há warnings de unhandled promises

---

### BUG-002 - Missing await em HighLevelNERV.sendEvent() no SERVER_READY

**Prioridade:** P0 **Tipo:** Bug - Async/Await Violation **Arquivo:** `src/server/main.js:270`
**Impacto:** Alto - Evento SERVER_READY não aguardado pode causar descoberta inconsistente
**Esforço:** Baixo - Adicionar palavra-chave await

#### Problema

O evento `SERVER_READY` é publicado sem `await`, permitindo que o bootstrap continue antes da
publicação ser confirmada. Isso pode causar falhas de descoberta onde o Maestro ou outros processos
não detectam o servidor como pronto.

#### Código Atual

```javascript
// src/server/main.js:270
try {
  HighLevelNERV.sendEvent(nerv, ActorRole.SERVER, ActionCode.SERVER_READY, payload);
  log('DEBUG', '[BOOT] Evento NERV SERVER_READY publicado (standalone)');
} catch (err) {
  log('WARN', `[BOOT] Falha ao publicar SERVER_READY via HighLevelNERV: ${err.message}`);
}
```

#### Código Proposto

```javascript
// src/server/main.js:270
try {
  await HighLevelNERV.sendEvent(nerv, ActorRole.SERVER, ActionCode.SERVER_READY, payload);
  log('DEBUG', '[BOOT] Evento NERV SERVER_READY publicado (standalone)');
} catch (err) {
  log('WARN', `[BOOT] Falha ao publicar SERVER_READY via HighLevelNERV: ${err.message}`);
}
```

#### Validação

- Executar `npx pm2 start ecosystem.config.cjs`
- Verificar logs NERV para confirmar publicação bem-sucedida
- Testar descoberta de serviço via `src/nerv/discovery.js::waitForServerReady()`

---

### BUG-003 - Missing await em sendEvent() durante shutdown

**Prioridade:** P0 **Tipo:** Bug - Async/Await Violation **Arquivo:** `src/main.js:991` **Impacto:**
Alto - Evento de shutdown não aguardado pode causar término abrupto **Esforço:** Baixo - Adicionar
palavra-chave await

#### Problema

Durante a sequência de shutdown, o evento `SHUTDOWN_COMPLETE` é enviado sem `await`, permitindo que
o processo termine antes da notificação ser enviada. Isso pode deixar dependentes (Dashboard,
Maestro) sem conhecimento do shutdown gracioso.

#### Código Atual

```javascript
// src/main.js:991
sendEvent(bootContext.nerv, ActorRole.MAESTRO, ActionCode.SHUTDOWN_COMPLETE, {
  phase: 'all',
  duration: Date.now() - start,
});
```

#### Código Proposto

```javascript
// src/main.js:991
await sendEvent(bootContext.nerv, ActorRole.MAESTRO, ActionCode.SHUTDOWN_COMPLETE, {
  phase: 'all',
  duration: Date.now() - start,
});
```

#### Validação

- Executar shutdown gracioso via `kill -SIGTERM <pid>`
- Verificar logs NERV para confirmar recebimento do evento SHUTDOWN_COMPLETE
- Confirmar que Dashboard recebe notificação antes do processo terminar

---

## Bugs de Alta Prioridade (P1) - Corrigir em Sprint Atual

### BUG-004 - Resource Leak: setTimeout sem referência para cleanup

**Prioridade:** P1 **Tipo:** Bug - Resource Leak **Arquivo:** `src/main.js:412-418` **Impacto:**
Médio - Timer órfão persiste se boot falhar entre fases **Esforço:** Médio - Armazenar referência e
adicionar cleanup em shutdown

#### Problema

Um `setTimeout` é criado para validação retardada do Browser Pool, mas não há referência armazenada
para cleanup. Se o processo for terminado durante a fase de boot, o timer persiste como recurso
órfão.

#### Código Atual

```javascript
// src/main.js:412-418
setTimeout(() => {
  if (typeof bootResilienceManager?.validateState === 'function') {
    bootResilienceManager.validateState().catch((err) => {
      log('WARN', `[BOOT] Validação retardada do Browser Pool falhou: ${err.message}`);
    });
  }
}, 5000);
```

#### Código Proposto

```javascript
// src/main.js:412-418 + shutdown sequence
let bootValidationTimer = null;

// No boot:
bootValidationTimer = setTimeout(() => {
  if (typeof bootResilienceManager?.validateState === 'function') {
    bootResilienceManager.validateState().catch((err) => {
      log('WARN', `[BOOT] Validação retardada do Browser Pool falhou: ${err.message}`);
    });
  }
}, 5000);

// Na função shutdown() (adicionar antes da fase 1):
if (bootValidationTimer) {
  clearTimeout(bootValidationTimer);
  bootValidationTimer = null;
  log('DEBUG', '[SHUTDOWN] Boot validation timer limpo');
}
```

#### Validação

- Executar boot seguido de shutdown imediato (< 5s)
- Verificar que timer é cancelado antes de disparar
- Confirmar que não há "Validação retardada" nos logs após shutdown

---

### BUG-005 - Resource Leak: Event listener unsub nunca executado

**Prioridade:** P1 **Tipo:** Bug - Resource Leak **Arquivo:** `src/main.js:392-409` **Impacto:**
Médio - Listener persiste após shutdown se Chrome Proxy não inicializar **Esforço:** Médio -
Armazenar unsub e chamar em shutdown

#### Problema

Um listener é registrado para o evento `CHROME_PROXY_READY`, mas a função `unsub` retornada nunca é
armazenada ou chamada. Se o Chrome Proxy nunca disparar o evento (falha de inicialização), o
listener persiste indefinidamente.

#### Código Atual

```javascript
// src/main.js:392-409
nerv.onEvent((envelope) => {
  try {
    const action = envelope?.type?.action_code;
    if (action === ActionCode.CHROME_PROXY_READY) {
      log('INFO', '[BOOT] Chrome Proxy confirmado via NERV');
      clearTimeout(fallbackTimer);
      if (!proxyConfirmed) {
        proxyConfirmed = true;
        resolve();
      }
    }
  } catch (_) {
    /* noop */
  }
});
```

#### Código Proposto

```javascript
// src/main.js:392-409 + adicionar variável no escopo de boot()
let chromeProxyListener = null;

// No boot:
chromeProxyListener = nerv.onEvent((envelope) => {
  try {
    const action = envelope?.type?.action_code;
    if (action === ActionCode.CHROME_PROXY_READY) {
      log('INFO', '[BOOT] Chrome Proxy confirmado via NERV');
      clearTimeout(fallbackTimer);
      if (!proxyConfirmed) {
        proxyConfirmed = true;
        resolve();
      }
    }
  } catch (_) {
    /* noop */
  }
});

// Na função shutdown() (adicionar antes da fase 1):
if (typeof chromeProxyListener === 'function') {
  chromeProxyListener();
  chromeProxyListener = null;
  log('DEBUG', '[SHUTDOWN] Chrome Proxy listener removido');
}
```

#### Validação

- Executar boot com Chrome indisponível (para acionar fallback)
- Executar shutdown e verificar que `unsub()` é chamado
- Confirmar que listener não persiste após shutdown (verificar via NERV telemetry)

---

### BUG-006 - Double-catch pattern com error handling inconsistente

**Prioridade:** P1 **Tipo:** Bug - Error Handling Anti-pattern **Arquivo:**
`src/server/main.js:269-276` **Impacto:** Médio - Erros de NERV são silenciados, dificultando
debugging **Esforço:** Baixo - Remover inner try-catch redundante

#### Problema

Há um padrão de try-catch aninhado onde o catch interno loga um warning genérico, mas o catch
externo também loga outro warning. Isso gera logs duplicados e dificulta o rastreamento do erro
original.

#### Código Atual

```javascript
// src/server/main.js:269-276
try {
  try {
    HighLevelNERV.sendEvent(nerv, ActorRole.SERVER, ActionCode.SERVER_READY, payload);
    log('DEBUG', '[BOOT] Evento NERV SERVER_READY publicado (standalone)');
  } catch (err) {
    log('WARN', `[BOOT] Falha ao publicar SERVER_READY via HighLevelNERV: ${err.message}`);
  }
} catch (err) {
  log('WARN', `[BOOT] Não foi possível publicar SERVER_READY via NERV: ${err.message}`);
}
```

#### Código Proposto

```javascript
// src/server/main.js:269-276
try {
  await HighLevelNERV.sendEvent(nerv, ActorRole.SERVER, ActionCode.SERVER_READY, payload);
  log('DEBUG', '[BOOT] Evento NERV SERVER_READY publicado (standalone)');
} catch (err) {
  log('WARN', `[BOOT] Falha ao publicar SERVER_READY via HighLevelNERV: ${err.message}`);
}
```

#### Validação

- Simular falha de NERV (desconectar bus)
- Verificar que apenas 1 log de erro é gerado (não duplicado)
- Confirmar que stack trace completo é preservado

---

### BUG-007 - setNERV() nunca chamado para infra_failure_policy

**Prioridade:** P1 **Tipo:** Bug - Missing Initialization **Arquivo:**
`src/core/infra_failure_policy.js:8-16` + `src/main.js` (missing call) **Impacto:** Alto - Eventos
INFRA_EMERGENCY nunca publicados via NERV **Esforço:** Baixo - Adicionar chamada `setNERV()` no boot

#### Problema

O módulo `infra_failure_policy.js` exporta uma função `setNERV()` que deve ser chamada durante o
boot para injetar a instância NERV. Porém, uma busca em `src/main.js` não encontra nenhuma chamada a
`setNERV()`, significando que `nervInstance` permanece `null`. Consequentemente, eventos críticos de
infraestrutura (`INFRA_EMERGENCY`) nunca são publicados via NERV.

#### Código Atual

```javascript
// src/core/infra_failure_policy.js:8
let nervInstance = null;

// src/core/infra_failure_policy.js:14-16
function setNERV(nerv) {
  nervInstance = nerv;
}

// src/main.js - MISSING CALL TO setNERV()
```

#### Código Proposto

```javascript
// src/main.js - Adicionar após criação do NERV (linha ~274):
import { setNERV as setInfraPolicyNERV } from '#core/infra_failure_policy';

// Dentro de boot(), após linha 274:
setInfraPolicyNERV(nerv);
log('DEBUG', '[BOOT] NERV injetado em infra_failure_policy');
```

#### Validação

- Executar boot completo e verificar log "NERV injetado em infra_failure_policy"
- Simular falha de infraestrutura (kill Chrome process)
- Verificar logs NERV para confirmar recebimento de evento INFRA_EMERGENCY

---

### BUG-008 - Discovery publishServerReady() chamado sem NERV instance

**Prioridade:** P1 **Tipo:** Bug - Missing Parameter **Arquivo:** `src/server/main.js:74` +
`src/nerv/discovery.js:17-30` **Impacto:** Alto - Evento SERVER_READY nunca publicado via NERV no
persistServerState **Esforço:** Baixo - Passar instância NERV como primeiro parâmetro

#### Problema

A função `persistServerState()` chama `Discovery.publishServerReady(null, payload)` passando `null`
como instância NERV (linha 74). Analisando `src/nerv/discovery.js:17-30`, a função espera um objeto
`nerv` como primeiro parâmetro e só publica o evento se `nerv` estiver definido. Como está recebendo
`null`, o evento SERVER_READY nunca é publicado via NERV, apenas loga "no-op (NERV ausente)".

#### Código Atual

```javascript
// src/server/main.js:74
await Discovery.publishServerReady(null, payload);

// src/nerv/discovery.js:19-24
if (nerv) {
  try {
    return await HighLevelNERV.sendEvent(nerv, ActorRole.SERVER, ActionCode.SERVER_READY, payload);
  } catch (err) {
    log('WARN', `[DISCOVERY] Falha ao publicar SERVER_READY via NERV: ${err.message}`);
  }
}
```

#### Código Proposto

```javascript
// src/server/main.js:58 - Adicionar parâmetro nerv na função
async function persistServerState(nerv, port, authority = Authority.SERVER_AUTHORITIES.STANDALONE) {
  // ...
  try {
    await Discovery.publishServerReady(nerv, payload);
    log(
      'DEBUG',
      '[BOOT] persistServerState delegated to Discovery (NERV-first, file fallback opt-in)',
    );
  } catch (err) {
    log('WARN', `[BOOT] persistServerState delegation failed: ${err.message}`);
  }
}

// src/server/main.js:149 - Passar nerv ao chamar persistServerState
if (Authority.isStandalone(authority)) {
  await persistServerState(nerv, port, authority);
} else {
  log('DEBUG', '[BOOT] persistServerState skip (delegated)');
}
```

#### Validação

- Executar boot do servidor em modo standalone
- Verificar logs para confirmar "Evento NERV SERVER_READY publicado"
- Confirmar que NÃO aparece "no-op (NERV ausente)" nos logs
- Testar descoberta de serviço usando `waitForServerReady()`

---

## Bugs de Média Prioridade (P2) - Backlog

### BUG-009 - Typeof check desnecessário antes de process.exit()

**Prioridade:** P2 **Tipo:** Bug - Redundant Check **Arquivo:** `src/server/main.js:352`
**Impacto:** Baixo - Código redundante sem impacto funcional **Esforço:** Baixo - Remover typeof
check

#### Problema

Há um `typeof authority !== 'undefined'` antes de chamar `process.exit()`, mas `authority` é sempre
definido no escopo (mesmo que seja `undefined`, é uma variável declarada). O check `typeof` é
redundante.

#### Código Atual

```javascript
// src/server/main.js:352
if (typeof authority !== 'undefined' && Authority.isStandalone(authority)) {
  process.exit(1);
}
```

#### Código Proposto

```javascript
// src/server/main.js:352
if (Authority.isStandalone(authority)) {
  process.exit(1);
}
```

#### Validação

- Executar boot com falha intencional em modo standalone
- Verificar que `process.exit(1)` é chamado corretamente

---

### BUG-010 - Config duplication: process.env vs CONFIG object

**Prioridade:** P2 **Tipo:** Code Smell - Configuration Duplication **Arquivo:**
`src/server/main.js:139`, `src/main.js` (múltiplas ocorrências) **Impacto:** Médio - Dificulta
manutenção e pode causar inconsistências **Esforço:** Alto - Refatorar para usar CONFIG centralizado

#### Problema

O código mistura acesso direto a `process.env` com uso do objeto `CONFIG` importado. Isso cria
duplicação de lógica de configuração e dificulta mudanças centralizadas. Por exemplo,
`process.env.SERVER_PORT` é acessado diretamente em vez de usar `CONFIG.SERVER_PORT`.

#### Código Atual

```javascript
// src/server/main.js:139
const basePort = Number(process.env.SERVER_PORT || process.env.PORT || 3008);

// Deveria usar CONFIG centralizado:
// import CONFIG from '#core/config';
// const basePort = CONFIG.SERVER_PORT || 3008;
```

#### Proposta de Correção

1. Centralizar todas as configurações em `src/core/config.js`
2. Substituir acesso direto a `process.env` por `CONFIG.*`
3. Adicionar validação de tipos em config.js (Number, Boolean)

#### Validação

- Executar suite de testes completa
- Verificar que todas as configurações são lidas corretamente
- Confirmar que mudanças em `.env` são refletidas via CONFIG

---

### BUG-011 - Sync I/O no boot path (realpathSync)

**Prioridade:** P2 **Tipo:** Performance - Blocking I/O **Arquivo:** `src/server/main.js:369`
**Impacto:** Baixo - Adiciona ~10-50ms de latência no boot **Esforço:** Médio - Substituir por
operações assíncronas

#### Problema

O código usa `fs.realpathSync()` para determinar se o arquivo é o entrypoint. Operações síncronas de
I/O bloqueiam a thread principal e adicionam latência ao boot path.

#### Código Atual

```javascript
// src/server/main.js:369
__isDirectRun = fs.realpathSync(argvFile) === fs.realpathSync(__entryFile);
```

#### Código Proposto

```javascript
// Usar comparação de caminhos normalizados sem I/O:
import { resolve } from 'node:path';

__isDirectRun = resolve(argvFile) === resolve(__entryFile);
```

#### Validação

- Medir tempo de boot antes e depois (usar console.time)
- Verificar que detecção de direct run continua funcionando
- Testar com symlinks e relative paths

---

## Resumo Estatístico

| Prioridade   | Quantidade | % do Total |
| ------------ | ---------- | ---------- |
| P0 (Crítico) | 3          | 27%        |
| P1 (Alta)    | 5          | 45%        |
| P2 (Média)   | 3          | 27%        |
| **TOTAL**    | **11**     | **100%**   |

### Distribuição por Tipo

- **Async/Await Violations:** 3 (BUG-001, BUG-002, BUG-003)
- **Resource Leaks:** 2 (BUG-004, BUG-005)
- **Error Handling:** 1 (BUG-006)
- **Missing Initialization:** 2 (BUG-007, BUG-008)
- **Code Smells:** 3 (BUG-009, BUG-010, BUG-011)

### Impacto Estimado

- **Alto:** 5 bugs (45%)
- **Médio:** 4 bugs (36%)
- **Baixo:** 2 bugs (18%)

### Esforço Estimado Total

- **Baixo:** 7 bugs (~2-3 horas)
- **Médio:** 3 bugs (~3-4 horas)
- **Alto:** 1 bug (~4-6 horas)

**Total estimado:** 9-13 horas de desenvolvimento + 4-6 horas de testes
