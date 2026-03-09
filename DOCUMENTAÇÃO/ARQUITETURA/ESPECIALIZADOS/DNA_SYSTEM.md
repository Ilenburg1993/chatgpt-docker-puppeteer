> **Status**: Especializado **Não é baseline principal**: use [ARCHITECTURE.md](../ARCHITECTURE.md)
> como fonte oficial. **Quando consultar**: apenas para aprofundamento deste recorte.

# DNA System V2.0 - Complete Architecture

> **Sistema de Identidade e Evolução Automática do Driver**
>
> Versão 2.0 - Fevereiro 2026
>
> Backup automático, rollback, auto-evolução via SADI

---

## 📋 Índice

1. [Visão Geral](#visão-geral)
2. [Arquitetura](#arquitetura)
3. [Componentes](#componentes)
4. [API Reference](#api-reference)
5. [Uso Prático](#uso-prático)
6. [Integração SADI](#integração-sadi)
7. [Testes](#testes)
8. [Troubleshooting](#troubleshooting)

---

## Visão Geral

O **DNA System** é o mecanismo que define a identidade e capacidades do robot, além de gerenciar a
evolução automática de seletores aprendidos via SADI Protocol.

### O Que É

- **Identidade do Robot**: `robot_id` único + 24 capabilities declaradas
- **DNA Evolutivo**: `dynamic_rules.json` com seletores aprendidos (SADI V19)
- **Backup System**: Últimas 10 versões do DNA em memória
- **Auto-Evolution**: SADI pode persistir seletores automaticamente (confidence ≥ 75)

### Problema Resolvido

**Antes (V1.0)**:

- ❌ Seletores descobertos manualmente
- ❌ Sem backup (uma versão do DNA)
- ❌ Perda de dados em crash
- ❌ Capabilities desatualizadas (6 itens)

**Agora (V2.0)**:

- ✅ SADI persiste seletores automaticamente
- ✅ 10 versões de backup + rollback
- ✅ Recovery de corrupção (3-tier fallback)
- ✅ 24 capabilities modernas com versionamento

---

## Arquitetura

```
┌─────────────────────────────────────────────────┐
│            IDENTITY LAYER                       │
│  (identity_manager.js)                          │
│  - robot_id: uuid v4                            │
│  - 24 capabilities declaradas                   │
│  - Version tracking (TASK_SCHEMA_V5, etc.)     │
└─────────────────────────────────────────────────┘
                     ↓
┌─────────────────────────────────────────────────┐
│            STORAGE LAYER                        │
│  (dna_store.js)                                 │
│  - getDna() → load + validate                   │
│  - saveDna() → backup + persist                 │
│  - rollbackDna() → restore version              │
│  - getDnaHistory() → list backups               │
└─────────────────────────────────────────────────┘
                     ↓
┌─────────────────────────────────────────────────┐
│            EVOLUTION LAYER                      │
│  (dna_evolution.js)                             │
│  - evolveWithSadiProtocol() → auto-persist      │
│  - Confidence threshold: 75/100                 │
│  - Rate limiting: 5 evolutions/domain/session   │
│  - Evolution stats per domain                   │
└─────────────────────────────────────────────────┘
                     ↓
┌─────────────────────────────────────────────────┐
│            PERSISTENCE FILES                    │
│  - robot_identity.json (robot_id)               │
│  - dynamic_rules.json (learned selectors)       │
│  - DNA_HISTORY[] (in-memory, 10 versions)       │
└─────────────────────────────────────────────────┘
```

### Fluxo de Boot

```javascript
// Phase 2 do boot (main.js)
1. IdentityManager.initialize()
   → Load robot_identity.json
   → Declare 24 capabilities

2. io.getDna()
   → Try cache (fast path)
   → Try disk + Zod validation
   → Try recovery from DNA_HISTORY[0]
   → Fallback: DEFAULT_DNA (baseline)

3. dnaEvolution.resetEvolutionCounters()
   → Clear session stats
```

---

## Componentes

### 1. identity_manager.js

**Localização**: `src/core/identity_manager.js`

**Responsabilidade**: Define a identidade do robot e suas 24 capabilities.

#### Capabilities Declaradas (V2.0)

```javascript
const ROBOT_CAPABILITIES = [
  // Core
  'BROWSER_CONTROL_V3', // Puppeteer + lifecycle hooks
  'TASK_SCHEMA_V5', // Task structure validation
  'RESPONSE_CAPTURE_V2', // capture() com frames

  // SADI Integration
  'SADI_V19', // Full SADI protocol support
  'AUTOMATIC_MIGRATION_V4_V5', // v4→v5 adapter layer

  // IPC
  'NERV_PROTOCOL_V2', // Event bus integration
  'WEBSOCKET_IPC', // Socket.io communication

  // Mission System
  'MISSION_ORCHESTRATION', // Workflows multi-etapa
  'LLM_AS_JUDGE', // Validation logic

  // Chrome Proxy
  'WINDOWS_CHROME_PROXY', // v3.0 integration
  'CONNECTION_MODES_3', // launcher/external/auto

  // Security
  'INPUT_SANITIZATION', // XSS prevention
  'RATE_LIMITING', // Throttle controls

  // DNA System
  'DNA_EVOLUTION_TRACKING', // Auto-persist selectors
  'DNA_BACKUP_ROLLBACK', // 10-version history

  // Observability
  'STRUCTURED_LOGGING', // Winston + log levels
  'HEALTH_ENDPOINTS', // /health, /metrics
  'PM2_MONITORING', // Process management

  // Recovery
  'CHECKPOINT_RECOVERY', // <5min granularity
  'CIRCUIT_BREAKER', // Fault tolerance
  'GRACEFUL_SHUTDOWN', // Cleanup on exit

  // File System
  'ATOMIC_FILE_OPERATIONS', // No corruption
  'PID_VALIDATED_LOCKS', // Concurrency safety

  // Dashboard
  'DASHBOARD_V2', // React + Socket.io
  'REST_API_V2', // Express routes
];
```

#### API

```javascript
const identity = require('@core/identity_manager');

// Get unique robot ID (generated once)
const robotId = identity.getRobotId(); // → 'abc-123-def-456'

// Get capabilities
const caps = identity.getCapabilities(); // → 24 capabilities array

// Check specific capability
if (identity.hasCapability('TASK_SCHEMA_V5')) {
  // Use Task Schema V5 features
}

// Initialize (called in boot phase 2)
await identity.initialize();
```

---

### 2. dna_store.js

**Localização**: `src/infra/storage/dna_store.js`

**Responsabilidade**: Persistence layer para `dynamic_rules.json` + backup system.

#### Features

✅ **In-Memory Backup** (10 versões) ✅ **Rollback Mechanism** (restore any version) ✅ **3-Tier
Fallback** (cache → disk → recovery → baseline) ✅ **Atomic Writes** (temp file + rename, via io.js)
✅ **Zod Validation** (DNA schema enforcement)

#### Backup Strategy

```javascript
const DNA_HISTORY = []; // Max 10 versions
const MAX_HISTORY_SIZE = 10;

// On every saveDna():
1. Clone current DNA → DNA_HISTORY[0]
2. Shift array if size > 10
3. Write to disk (atomic)
4. Update cache
```

#### API

```javascript
const dnaStore = require('@infra/storage/dna_store');

// Load DNA (with fallback)
const dna = await dnaStore.getDna();
// → Try cache → disk → recovery → DEFAULT_DNA

// Save DNA (with backup)
await dnaStore.saveDna(updatedDna, 'author-name');
// → Backup old version → Write to disk → Update cache

// Rollback to previous version
await dnaStore.rollbackDna(0); // 0 = most recent backup
// → Restore from DNA_HISTORY[0] → Write to disk

// Get backup history
const history = dnaStore.getDnaHistory();
// → [{ timestamp, version, evolution_count, author }, ...]
```

#### Recovery Logic (3-Tier Fallback)

```javascript
async function getDna() {
  // Tier 1: Cache (fast path)
  if (DNA_CACHE.timestamp > Date.now() - CACHE_TTL) {
    return DNA_CACHE.data;
  }

  // Tier 2: Disk + Validation
  try {
    const raw = fs.readFileSync(DNA_PATH, 'utf8');
    const dna = JSON.parse(raw);
    DNA_SCHEMA.parse(dna); // Zod validation
    updateCache(dna);
    return dna;
  } catch (error) {
    logger.error('[DNA] Disk read failed, trying recovery', error);
  }

  // Tier 3: Recovery from backup
  if (DNA_HISTORY.length > 0) {
    logger.warn('[DNA] Recovering from most recent backup');
    const recovered = DNA_HISTORY[0];
    await saveDna(recovered, 'recovery-system');
    return recovered;
  }

  // Tier 4: Baseline (last resort)
  logger.error('[DNA] All recovery attempts failed, using DEFAULT_DNA');
  await saveDna(DEFAULT_DNA, 'baseline-init');
  return DEFAULT_DNA;
}
```

---

### 3. dna_evolution.js

**Localização**: `src/infra/storage/dna_evolution.js`

**Responsabilidade**: Automatic DNA evolution engine para integração SADI.

#### Features

✅ **Confidence Threshold** (minimum 75/100) ✅ **Rate Limiting** (5 evolutions/domain/session) ✅
**Duplicate Detection** (don't save same selector twice) ✅ **Evolution Statistics** (per domain
tracking) ✅ **Two Protocols**: Simple selector + Full SADI protocol

#### Evolution Rules

```javascript
const MIN_CONFIDENCE = 75; // Minimum confidence to accept
const MAX_EVOLUTIONS_PER_DOMAIN = 5; // Per session limit

// Per session counters
const evolutionCounters = {
  'chatgpt.com': 2, // 2 evolutions this session
  'gemini.google.com': 0,
};
```

#### API

```javascript
const dnaEvolution = require('@infra/storage/dna_evolution');

// Evolve with simple selector (SADI V19 compact)
const result = await dnaEvolution.evolveWithSadiProtocol(
  {
    target: 'textarea[data-id="root"]',
    selector: '#prompt-textarea',
    confidence: 85,
    shadowRoot: false,
  },
  'chatgpt.com',
  'send-message',
);

if (result.accepted) {
  console.log('DNA evolved!', result.stats);
} else {
  console.log('Evolution rejected:', result.reason);
}

// Evolve with full protocol (context + shadow + frame)
await dnaEvolution.evolveWithFullProtocol(fullSadiProtocol);

// Reset counters (called on boot)
dnaEvolution.resetEvolutionCounters();

// Get stats
const stats = dnaEvolution.getEvolutionStats();
// → { 'chatgpt.com': 2, 'gemini.google.com': 0 }
```

#### Evolution Logic

```javascript
async function evolveWithSadiProtocol(protocol, domain, intent) {
  // 1. Validation
  if (protocol.confidence < MIN_CONFIDENCE) {
    return { accepted: false, reason: 'LOW_CONFIDENCE' };
  }

  // 2. Rate Limiting
  const counter = evolutionCounters[domain] || 0;
  if (counter >= MAX_EVOLUTIONS_PER_DOMAIN) {
    return { accepted: false, reason: 'RATE_LIMITED' };
  }

  // 3. Load current DNA
  const dnaStore = getDnaStore(); // Lazy load (avoid circular dep)
  const dna = await dnaStore.getDna();

  // 4. Check duplicates
  const rules = dna.targets[domain]?.[intent] || [];
  const isDuplicate = rules.some((r) => r.selector === protocol.selector);
  if (isDuplicate) {
    return { accepted: false, reason: 'DUPLICATE' };
  }

  // 5. Persist
  if (!dna.targets[domain]) dna.targets[domain] = {};
  if (!dna.targets[domain][intent]) dna.targets[domain][intent] = [];

  dna.targets[domain][intent].push({
    target: protocol.target,
    selector: protocol.selector,
    confidence: protocol.confidence,
    shadowRoot: protocol.shadowRoot,
    learned_at: new Date().toISOString(),
  });

  await dnaStore.saveDna(dna, `sadi-evolution-${domain}`);

  // 6. Update stats
  evolutionCounters[domain] = counter + 1;

  return {
    accepted: true,
    stats: {
      domain,
      total_rules: dna.targets[domain][intent].length,
      session_evolutions: evolutionCounters[domain],
    },
  };
}
```

---

### 4. io.js (Unified Facade)

**Localização**: `src/infra/io.js`

**Responsabilidade**: Central hub para todas as operações de I/O (filesystem, DNA, tasks, queue).

#### DNA-Related Exports

```javascript
const io = require('@infra/io');

// DNA Store
const dna = await io.getDna();
await io.saveDna(dna, 'author-name');
await io.rollbackDna(0);
const history = io.getDnaHistory();

// DNA Evolution
const result = await io.evolveWithSadiProtocol(protocol, domain, intent);
await io.evolveWithFullProtocol(fullProtocol);
const stats = io.getEvolutionStats();

// Identity
const robotId = io.getRobotId();
const capabilities = io.getCapabilities();
```

---

### 5. Persistence Files

#### robot_identity.json

**Localização**: `robot_identity.json` (root)

**Estrutura**:

```json
{
  "robot_id": "abc-123-def-456",
  "version": 1,
  "created_at": "2026-02-15T10:00:00.000Z"
}
```

**Geração**: Automática no primeiro boot (identity_manager.js).

---

#### dynamic_rules.json

**Localização**: `dynamic_rules.json` (root)

**Estrutura** (DNA Schema V5):

```json
{
  "version": 5,
  "evolution_count": 7,
  "last_updated": "2026-02-15T12:30:00.000Z",
  "targets": {
    "chatgpt.com": {
      "send-message": [
        {
          "target": "textarea[data-id='root']",
          "selector": "#prompt-textarea",
          "confidence": 92,
          "shadowRoot": false,
          "learned_at": "2026-02-15T10:15:00.000Z"
        }
      ]
    },
    "gemini.google.com": {
      "send-prompt": [
        {
          "target": ".chat-input",
          "selector": "textarea.ql-editor",
          "confidence": 88,
          "shadowRoot": true,
          "framePath": ["iframe#content"],
          "learned_at": "2026-02-15T11:45:00.000Z"
        }
      ]
    }
  }
}
```

**Backup**: DNA_HISTORY[] mantém últimas 10 versões em memória (não escritas em disco).

---

## API Reference

### IdentityManager

```javascript
const identity = require('@core/identity_manager');

// Initialize (boot phase 2)
await identity.initialize();

// Get robot ID
const robotId = identity.getRobotId();
// → 'abc-123-def-456'

// Get capabilities
const capabilities = identity.getCapabilities();
// → ['BROWSER_CONTROL_V3', 'TASK_SCHEMA_V5', ...]

// Check capability
if (identity.hasCapability('DNA_EVOLUTION_TRACKING')) {
  // Feature available
}
```

---

### DNA Store

```javascript
const dnaStore = require('@infra/storage/dna_store');

// Load DNA (with 3-tier fallback)
const dna = await dnaStore.getDna();

// Save DNA (with backup)
await dnaStore.saveDna(updatedDna, 'author-name');

// Rollback to version
await dnaStore.rollbackDna(versionIndex); // 0 = most recent

// Get backup history
const history = dnaStore.getDnaHistory();
// → [{
//     timestamp: '2026-02-15T12:00:00.000Z',
//     version: 5,
//     evolution_count: 6,
//     author: 'sadi-evolution-chatgpt.com'
// }, ...]
```

---

### DNA Evolution

```javascript
const dnaEvolution = require('@infra/storage/dna_evolution');

// Evolve with SADI protocol (simple)
const result = await dnaEvolution.evolveWithSadiProtocol(
  {
    target: 'textarea[data-id="root"]',
    selector: '#prompt-textarea',
    confidence: 85,
    shadowRoot: false,
  },
  'chatgpt.com',
  'send-message',
);

if (result.accepted) {
  console.log('Evolution accepted!');
  console.log('Total rules:', result.stats.total_rules);
  console.log('Session evolutions:', result.stats.session_evolutions);
} else {
  console.log('Rejected:', result.reason);
  // Reasons: LOW_CONFIDENCE, RATE_LIMITED, DUPLICATE
}

// Evolve with full protocol (context + shadow + frame)
await dnaEvolution.evolveWithFullProtocol({
  target: 'textarea',
  selector: '.ql-editor',
  confidence: 88,
  shadowRoot: true,
  framePath: ['iframe#content'],
  context: { page: 'chat', attempt: 3 },
});

// Reset session counters (called on boot)
dnaEvolution.resetEvolutionCounters();

// Get evolution statistics
const stats = dnaEvolution.getEvolutionStats();
// → { 'chatgpt.com': 2, 'gemini.google.com': 1 }
```

---

### Unified I/O Facade

```javascript
const io = require('@infra/io');

// DNA operations (delegates to dna_store.js)
const dna = await io.getDna();
await io.saveDna(dna, 'manual-update');
await io.rollbackDna(0);
const history = io.getDnaHistory();

// Evolution operations (delegates to dna_evolution.js)
const result = await io.evolveWithSadiProtocol(protocol, domain, intent);
await io.evolveWithFullProtocol(fullProtocol);
const stats = io.getEvolutionStats();

// Identity operations (delegates to identity_manager.js)
const robotId = io.getRobotId();
const capabilities = io.getCapabilities();
```

---

## Uso Prático

### Cenário 1: Manual DNA Update

```javascript
const io = require('@infra/io');

// 1. Load current DNA
const dna = await io.getDna();

// 2. Add new selector manually
if (!dna.targets['example.com']) {
  dna.targets['example.com'] = {};
}
dna.targets['example.com']['login'] = [
  {
    target: 'button[type="submit"]',
    selector: '#login-button',
    confidence: 100, // Manual = always 100
    shadowRoot: false,
    learned_at: new Date().toISOString(),
  },
];

// 3. Save (will backup old version automatically)
await io.saveDna(dna, 'manual-admin-update');

console.log('DNA updated! Backup created automatically.');
```

---

### Cenário 2: Automatic SADI Evolution

```javascript
// Inside SADI V19 (adaptSelectorFallback method)

async adaptSelectorFallback(target, intent) {
    // 1. Try discovering selector
    const discovered = await this.discoverSelector(target);

    if (discovered && discovered.confidence >= 75) {
        // 2. Persist automatically
        const result = await io.evolveWithSadiProtocol({
            target,
            selector: discovered.selector,
            confidence: discovered.confidence,
            shadowRoot: discovered.isShadowRoot
        }, this.domain, intent);

        if (result.accepted) {
            logger.info(`[SADI] DNA evolved for ${intent}`, result.stats);
            return discovered.selector;
        } else {
            logger.warn(`[SADI] Evolution rejected: ${result.reason}`);
        }
    }

    return null;
}
```

---

### Cenário 3: Rollback After Bad Evolution

```javascript
const io = require('@infra/io');

// 1. Get backup history
const history = io.getDnaHistory();

console.log('Available backups:');
history.forEach((backup, index) => {
  console.log(`[${index}] v${backup.version} - ${backup.timestamp} (${backup.author})`);
});

// 2. Rollback to version
await io.rollbackDna(1); // Restore backup index 1

console.log('DNA rolled back successfully!');

// 3. Verify rollback
const dna = await io.getDna();
console.log('Current version:', dna.version);
console.log('Evolution count:', dna.evolution_count);
```

---

### Cenário 4: Check Evolution Stats

```javascript
const io = require('@infra/io');

// Get session statistics
const stats = io.getEvolutionStats();

console.log('Evolution stats this session:');
Object.entries(stats).forEach(([domain, count]) => {
  console.log(`  ${domain}: ${count}/5 evolutions`);
});

// Check if domain is rate limited
const isLimited = stats['chatgpt.com'] >= 5;
if (isLimited) {
  console.log('ChatGPT domain is rate limited (restart session to reset)');
}
```

---

## Integração SADI

### SADI V19 Protocol

O SADI (Selector Adaptation & Discovery Intelligence) usa o DNA System para persistir seletores
descobertos.

#### Fluxo de Integração

```javascript
// 1. SADI discovers selector
const discovered = await sadi.discoverSelector('textarea[data-id="root"]');
// → { selector: '#prompt-textarea', confidence: 85, isShadowRoot: false }

// 2. SADI attempts auto-evolution
if (discovered.confidence >= 75) {
  const result = await io.evolveWithSadiProtocol(
    {
      target: 'textarea[data-id="root"]',
      selector: discovered.selector,
      confidence: discovered.confidence,
      shadowRoot: discovered.isShadowRoot,
    },
    'chatgpt.com',
    'send-message',
  );

  if (result.accepted) {
    // Success: DNA updated, backup created
    logger.info('[SADI] Selector persisted to DNA', {
      domain: 'chatgpt.com',
      intent: 'send-message',
      selector: discovered.selector,
      session_evolutions: result.stats.session_evolutions,
    });
  } else {
    // Rejected: confidence too low, rate limited, or duplicate
    logger.warn('[SADI] Evolution rejected', { reason: result.reason });
  }
}

// 3. Next execution uses persisted selector
const dna = await io.getDna();
const rules = dna.targets['chatgpt.com']?.['send-message'] || [];
const bestRule = rules.sort((a, b) => b.confidence - a.confidence)[0];
// → Use bestRule.selector
```

---

### BaseDriver Integration

```javascript
class BaseDriver {
  async sendMessage(message, driver) {
    const intent = 'send-message';

    // 1. Try DNA-stored selectors first
    const dna = await io.getDna();
    const rules = dna.targets[this.domain]?.[intent] || [];

    for (const rule of rules.sort((a, b) => b.confidence - a.confidence)) {
      try {
        const element = await this.page.$(rule.selector);
        if (element) {
          await element.type(message);
          logger.info(`[DNA] Used stored selector: ${rule.selector}`);
          return;
        }
      } catch (error) {
        logger.warn(`[DNA] Stored selector failed: ${rule.selector}`);
      }
    }

    // 2. Fallback to SADI discovery
    const discovered = await this.sadi.adaptSelectorFallback('textarea[data-id="root"]', intent);

    if (discovered) {
      // SADI will auto-persist if confidence >= 75
      await this.page.type(discovered, message);
    } else {
      throw new Error('No selector available for send-message');
    }
  }
}
```

---

## Testes

**Localização**: `tests/test_dna_system.js`

### Test Suite (7 testes, 100% pass rate)

```bash
cd /workspaces/chatgpt-docker-puppeteer
node -r module-alias/register tests/test_dna_system.js
```

#### Tests Executados

1. **IdentityManager - Capabilities V2.0**
   - Valida 24 capabilities declaradas
   - Verifica getRobotId() retorna UUID válido

2. **DNA Store - Load & Validation**
   - Carrega DNA do disco
   - Valida estrutura via Zod schema
   - Verifica version === 5

3. **DNA Store - Backup System**
   - Salva DNA e verifica backup criado
   - Valida DNA_HISTORY.length <= 10

4. **DNA Store - Target Rules Resolution**
   - Busca rules para domain conhecido
   - Testa fallback para domain desconhecido (retorna [])

5. **DNA Evolution - Stats**
   - Valida getEvolutionStats() retorna objeto
   - Verifica estrutura { domain: count }

6. **DNA Evolution - SADI Protocol**
   - Tenta evoluir com confidence baixa (50 < 75)
   - Valida rejeição (reason: 'LOW_CONFIDENCE')

7. **DNA Store - Rollback**
   - Salva DNA inicial (v5)
   - Salva DNA modificado (v6)
   - Rollback para versão anterior
   - Verifica restauração bem-sucedida

### Exemplo de Output

```
===========================================
  DNA SYSTEM V2.0 - COMPREHENSIVE TESTS
===========================================

✅ IdentityManager - Capabilities V2.0
   - Capabilities count: 24
   - Robot ID: abc-123-def-456 (valid UUID)

✅ DNA Store - Load & Validation
   - DNA version: 5
   - Evolution count: 2
   - Targets domains: 2

✅ DNA Store - Backup System
   - Backups available: 1/10
   - Most recent: 2026-02-15T12:00:00.000Z (author: test-backup)

✅ DNA Store - Target Rules Resolution
   - chatgpt.com rules: 1
   - unknown.com rules: 0 (fallback OK)

✅ DNA Evolution - Stats
   - Stats structure: valid object
   - Domains tracked: 0 (fresh session)

✅ DNA Evolution - SADI Protocol
   - Low confidence rejected: LOW_CONFIDENCE (expected)

✅ DNA Store - Rollback
   - Before rollback: v6
   - After rollback: v5
   - Rollback successful

===========================================
  Test Summary
===========================================
✅ Passed: 7
❌ Failed: 0

Total: 7 tests
```

---

## Troubleshooting

### Problema 1: DNA corrompido

**Sintoma**: `getDna()` retorna DEFAULT_DNA mesmo com arquivo existente.

**Causa**: JSON inválido ou schema Zod falhou.

**Solução**:

```javascript
// 1. Verificar histórico de backups
const history = io.getDnaHistory();
console.log('Backups disponíveis:', history.length);

// 2. Restaurar backup mais recente
if (history.length > 0) {
  await io.rollbackDna(0);
  console.log('DNA restaurado do backup');
} else {
  // 3. Resetar para baseline
  const DEFAULT_DNA = {
    version: 5,
    evolution_count: 0,
    last_updated: new Date().toISOString(),
    targets: {},
  };
  await io.saveDna(DEFAULT_DNA, 'manual-reset');
}
```

---

### Problema 2: Evolution rejeitada (LOW_CONFIDENCE)

**Sintoma**: SADI descobre selector mas não persiste.

**Causa**: Confidence < 75.

**Solução**:

```javascript
// Opção 1: Aceitar confidence menor (ajustar MIN_CONFIDENCE em dna_evolution.js)
const MIN_CONFIDENCE = 65; // Reduzir threshold

// Opção 2: Persistir manualmente
const dna = await io.getDna();
dna.targets['chatgpt.com']['send-message'].push({
  target: 'textarea',
  selector: '#prompt-textarea',
  confidence: 100, // Manual = 100
  shadowRoot: false,
  learned_at: new Date().toISOString(),
});
await io.saveDna(dna, 'manual-override');
```

---

### Problema 3: Rate Limited (5 evolutions/session)

**Sintoma**: `result.reason === 'RATE_LIMITED'`.

**Causa**: Domain atingiu limite de 5 evolutions nesta sessão.

**Solução**:

```javascript
// Opção 1: Reiniciar sistema (reseta counters)
make restart

// Opção 2: Resetar counters manualmente (NOT RECOMMENDED)
const dnaEvolution = require('@infra/storage/dna_evolution');
dnaEvolution.resetEvolutionCounters();

// Opção 3: Aumentar limite (ajustar MAX_EVOLUTIONS_PER_DOMAIN em dna_evolution.js)
const MAX_EVOLUTIONS_PER_DOMAIN = 10;
```

---

### Problema 4: Duplicate selector

**Sintoma**: `result.reason === 'DUPLICATE'`.

**Causa**: Selector já existe no DNA para esse domain+intent.

**Solução**:

```javascript
// Verificar rules existentes
const dna = await io.getDna();
const rules = dna.targets['chatgpt.com']?.['send-message'] || [];
console.log(
  'Rules existentes:',
  rules.map((r) => r.selector),
);

// Se quiser forçar update (aumentar confidence):
const index = rules.findIndex((r) => r.selector === '#prompt-textarea');
if (index >= 0) {
  rules[index].confidence = 95; // Update
  await io.saveDna(dna, 'manual-confidence-update');
}
```

---

### Problema 5: DNA_HISTORY vazio após restart

**Sintoma**: `getDnaHistory()` retorna `[]`.

**Causa**: DNA_HISTORY é in-memory (não persiste entre sessões).

**Comportamento Esperado**: Backups são perdidos no restart. Apenas a versão atual (disk) persiste.

**Alternativa**:

- Implementar DNA_HISTORY em arquivo separado (e.g., `dna_history.json`)
- Trade-off: Performance vs. persistência

---

## Changelog

### V2.0 (Fevereiro 2026)

#### ✅ Adicionado

- ✅ 24 capabilities modernizadas (V1.0 tinha 6)
- ✅ Backup system (10 versões in-memory)
- ✅ Rollback mechanism
- ✅ Auto-evolution engine (dna_evolution.js)
- ✅ Confidence threshold (75/100)
- ✅ Rate limiting (5 evolutions/domain/session)
- ✅ Evolution statistics
- ✅ 3-tier fallback (cache → disk → recovery → baseline)
- ✅ Duplicate detection
- ✅ 7 comprehensive tests (100% pass rate)

#### 🔧 Corrigido

- ✅ Circular dependency (io ↔ dna_evolution → lazy load pattern)
- ✅ Error handling robusto (recovery de corrupção)
- ✅ Atomic writes (via io.js)

#### 🚀 Melhorado

- ✅ Performance (cache com TTL de 60s)
- ✅ Logging (Winston integration)
- ✅ Validation (Zod schema enforcement)

---

### V1.0 (Baseline)

#### Features

- ✅ Basic DNA storage (dynamic_rules.json)
- ✅ Manual selector updates
- ✅ 6 generic capabilities
- ✅ Single version (no backup)

---

## Próximos Passos (Future V3.0)

### Planejado

1. **Persistent Backup History**
   - Salvar DNA_HISTORY em arquivo separado
   - Manter backups entre restarts

2. **API Endpoints**
   - GET /dna → Full DNA
   - GET /dna/history → Backups
   - POST /dna/rollback → Restore version
   - POST /dna/evolve → Manual evolution
   - GET /dna/stats → Session statistics

3. **Dashboard Integration**
   - UI para visualizar DNA
   - Rollback via dashboard
   - Evolution stats em real-time (Socket.io)

4. **Advanced Evolution Rules**
   - Confidence decay (selectors antigos perdem confiança)
   - Automatic cleanup (remover rules com confidence < 50)
   - A/B testing de selectors

5. **Multi-Domain Learning**
   - SADI aprende padrões cross-domain
   - Shared selectors (e.g., `button[type="submit"]` em todos os sites)

---

## Licença

MIT License - Ver LICENSE file no root do projeto.

---

## Contato

- **Projeto**: chatgpt-docker-puppeteer
- **Versão**: DNA System V2.0
- **Data**: Fevereiro 2026
- **Status**: ✅ PRODUCTION READY (7/7 tests passing)

---

**EOF**
