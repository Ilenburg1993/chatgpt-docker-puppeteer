# factory.js v2.0 - Auditoria Completa

**Data**: 2026-02-01 **Arquivo**: `src/driver/factory.js` **Status Atual**: v1.0 (Protocol 11 -
Zero-Bug Tolerance) **Linhas**: 177 **Responsabilidade**: Descoberta, instanciação Lazy-Load e
gestão reativa de cache de drivers

---

## 📊 Análise Inicial

### Contexto

Factory.js é o **padrão Factory** central para criação e cache de drivers. Responsabilidades:

- Auto-discovery de drivers no diretório targets/
- Lazy-loading de classes (carrega apenas quando necessário)
- Cache por página (WeakMap + Map)
- Auto-evicção reativa (driver.once('destroyed'))
- Invalidação global de cache

**Padrão de Design**: Factory + Singleton por página + WeakMap (GC-friendly)

**Dependências**:

- fs, path (Node.js core) ✅
- TargetDriver (herança validation) ✅
- logger (@core/logger) ✅

**Fluxo Típico**:

```
Boot: Discovery (fs.readdirSync) → driverRegistry
Runtime: getDriver() → cache check → lazy-load → instance cache → return
Cleanup: driver.destroy() → auto-eviction → invalidatePageCache()
```

---

## 🐛 BUGS IDENTIFICADOS (10)

### BUG #1: Discovery Sem Try-Catch em fs.readdirSync - ❌ CRÍTICO (P0)

**Severidade**: P0 (Crash em boot se TARGETS_DIR não existe ou sem permissão) **Localização**:
Linhas 40-54 **Impacto**: Se diretório targets/ não existe ou erro de permissão → crash fatal

**Código Atual**:

```javascript
// Linha 40-54
try {
  if (fs.existsSync(TARGETS_DIR)) {
    const files = fs.readdirSync(TARGETS_DIR); // ❌ Pode lançar EACCES, ENOENT
    for (const file of files) {
      if (file.endsWith('Driver.js')) {
        const targetKey = file.replace('Driver.js', '').toLowerCase();
        driverRegistry[targetKey] = {
          path: path.join(TARGETS_DIR, file),
          className: file.replace('.js', ''),
        };
      }
    }
    log('INFO', `[FACTORY] ${Object.keys(driverRegistry).length} targets mapeados no diretório.`);
  }
} catch (e) {
  log('FATAL', `[FACTORY] Erro catastrófico no mapeamento de drivers: ${e.message}`);
}
```

**Problema**:

1. `fs.readdirSync()` pode lançar erro mesmo depois de `fs.existsSync()` (race condition)
2. Try-catch captura erro, mas não previne que `driverRegistry` fique vazio
3. Se `driverRegistry` vazio → todos os `getDriver()` falham com "Target não suportado"
4. Nenhum fallback ou validação de que pelo menos 1 driver foi descoberto

**Correção**:

```javascript
// Linhas 40-60 - ✅ Try-catch robusto + validação de descoberta
try {
  if (fs.existsSync(TARGETS_DIR)) {
    const files = fs.readdirSync(TARGETS_DIR);
    let discovered = 0;

    for (const file of files) {
      if (file.endsWith('Driver.js')) {
        try {
          const targetKey = file.replace('Driver.js', '').toLowerCase();
          const driverPath = path.join(TARGETS_DIR, file);

          // ✅ Validar que arquivo é acessível
          if (fs.existsSync(driverPath)) {
            driverRegistry[targetKey] = {
              path: driverPath,
              className: file.replace('.js', ''),
            };
            discovered++;
          }
        } catch (fileError) {
          log('WARN', `[FACTORY] Erro ao processar ${file}: ${fileError.message}`);
        }
      }
    }

    if (discovered === 0) {
      log(
        'FATAL',
        `[FACTORY] Nenhum driver descoberto em ${TARGETS_DIR}. Sistema não pode operar.`,
      );
      throw new Error('No drivers discovered');
    }

    log('INFO', `[FACTORY] ${discovered} targets mapeados no diretório.`);
  } else {
    log('FATAL', `[FACTORY] Diretório de targets não existe: ${TARGETS_DIR}`);
    throw new Error(`Targets directory not found: ${TARGETS_DIR}`);
  }
} catch (e) {
  log('FATAL', `[FACTORY] Erro catastrófico no mapeamento de drivers: ${e.message}`);
  throw e; // ✅ Re-throw para prevenir execução com driverRegistry vazio
}
```

**Prioridade**: ❌ **CRÍTICO** - Previne boot com registry vazio

---

### BUG #2: getDriver() Não Valida Parâmetros - ❌ CRÍTICO (P0)

**Severidade**: P0 (Null reference crashes) **Localização**: Linhas 73-79 **Impacto**: Se
page/config/signal são null/undefined → crashes múltiplos

**Código Atual**:

```javascript
// Linha 73-79
function getDriver(targetName, page, config, signal) {
    const key = (targetName || DEFAULT_TARGET).toLowerCase();

    // A. LIVENESS GUARD: Impede o acoplamento em abas mortas
    if (!page || page.isClosed()) { // ✅ Valida page
        throw new Error(`[FACTORY] Falha: Tentativa de acoplar driver em aba encerrada (${key}).`);
    }

    // ❌ Nenhuma validação de config ou signal
```

**Problema**:

1. `config` não é validado → linha 106 `cachedInstance.config = { ...config }` crash se config =
   null
2. `signal` não é validado → linha 109 `cachedInstance.signal = signal` aceita null (driver quebra)
3. Linha 123 `new DriverClass(page, { ...config }, signal)` crash se config = null

**Correção**:

```javascript
// Linhas 73-85 - ✅ Validar todos os parâmetros
function getDriver(targetName, page, config, signal) {
  // ✅ Validar parâmetros obrigatórios
  if (!page) {
    throw new Error('[FACTORY] Parameter "page" is required');
  }
  if (!config || typeof config !== 'object') {
    throw new Error('[FACTORY] Parameter "config" must be an object');
  }
  if (!signal || !(signal instanceof AbortSignal)) {
    throw new Error('[FACTORY] Parameter "signal" must be an AbortSignal instance');
  }

  const key = (targetName || DEFAULT_TARGET).toLowerCase();

  // A. LIVENESS GUARD
  if (page.isClosed()) {
    throw new Error(`[FACTORY] Falha: Tentativa de acoplar driver em aba encerrada (${key}).`);
  }
  // ... resto do código
}
```

**Prioridade**: ❌ **CRÍTICO** - Previne null reference crashes

---

### BUG #3: Cache Reaproveitamento Não Valida destroyed Property - ⚠️ ALTO (P1)

**Severidade**: P1 (Retorna driver destruído) **Localização**: Linhas 95-113 **Impacto**: Se driver
foi marcado como destroyed mas still in cache → comportamento indefinido

**Código Atual**:

```javascript
// Linha 95-113
if (instances.has(key)) {
  const cachedInstance = instances.get(key);

  if (!cachedInstance.destroyed) {
    // ❌ Assume que propriedade existe
    // Atualiza config e signal
    if (config && typeof config === 'object') {
      cachedInstance.config = { ...config };
    }
    cachedInstance.signal = signal;

    log('DEBUG', `[FACTORY] Reaproveitando driver em cache: ${cachedInstance.name}`);
    return cachedInstance;
  }
  // Se destruído, remove do cache
  instances.delete(key);
}
```

**Problema**:

1. `cachedInstance.destroyed` pode ser `undefined` se driver não implementa propriedade
2. Nenhuma validação de que `cachedInstance` é válido
3. Se driver customizado não tem `.destroyed` → sempre reutiliza (mesmo se inválido)
4. Nenhum logging de que driver destruído foi encontrado

**Correção**:

```javascript
// Linhas 95-120 - ✅ Validação robusta de cache
if (instances.has(key)) {
  const cachedInstance = instances.get(key);

  // ✅ Validar que instância é válida
  if (!cachedInstance) {
    log('WARN', `[FACTORY] Cached instance is null for ${key}, removing from cache`);
    instances.delete(key);
  } else {
    // ✅ Verificar estado destroyed com fallback
    const isDestroyed =
      cachedInstance.destroyed === true ||
      (typeof cachedInstance.isDestroyed === 'function' && cachedInstance.isDestroyed());

    if (!isDestroyed) {
      // Validar que driver ainda é válido (página não fechada)
      if (cachedInstance.page && !cachedInstance.page.isClosed()) {
        // Atualizar config e signal
        if (config && typeof config === 'object') {
          cachedInstance.config = { ...config };
        }
        cachedInstance.signal = signal;

        log('DEBUG', `[FACTORY] Reaproveitando driver em cache: ${cachedInstance.name}`);
        return cachedInstance;
      } else {
        log('WARN', `[FACTORY] Cached driver ${key} has closed page, invalidating`);
      }
    } else {
      log('DEBUG', `[FACTORY] Cached driver ${key} was destroyed, removing from cache`);
    }

    // Remover instância inválida
    instances.delete(key);
  }
}
```

**Prioridade**: ⚠️ **ALTO** - Previne retorno de drivers inválidos

---

### BUG #4: Lazy-Load Sem Validação de require() - ⚠️ ALTO (P1)

**Severidade**: P1 (Crash se driver tem syntax error) **Localização**: Linhas 115-145 **Impacto**:
Se driver tem erro de sintaxe ou import → crash sem recovery

**Código Atual**:

```javascript
// Linha 115-145
try {
  // Carrega a classe apenas no momento da primeira necessidade
  const DriverClass = require(meta.path); // ❌ Pode lançar SyntaxError, MODULE_NOT_FOUND

  // Injeção de dependências no construtor
  const instance = new DriverClass(page, { ...config }, signal); // ❌ Pode lançar TypeError

  if (!(instance instanceof TargetDriver)) {
    // ✅ Valida herança
    throw new Error(`[FACTORY] '${meta.className}' viola o contrato TargetDriver.`);
  }

  // ... resto
} catch (e) {
  log('ERROR', `[FACTORY] Erro na ativação do driver '${key}': ${e.message}`);
  throw e; // ❌ Apenas re-throw, nenhum cleanup
}
```

**Problema**:

1. `require(meta.path)` pode falhar com SyntaxError, MODULE_NOT_FOUND, etc
2. `new DriverClass(...)` pode falhar no constructor do driver
3. Se erro ocorre, nenhum cleanup → cache fica inconsistente
4. Erro genérico não distingue entre erro de require vs erro de constructor
5. Stack trace completo não é logado (apenas `.message`)

**Correção**:

```javascript
// Linhas 115-165 - ✅ Try-catch granular + cleanup
let DriverClass;
let instance;

try {
  // ✅ Fase 1: Load da classe
  try {
    DriverClass = require(meta.path);
  } catch (requireError) {
    log('ERROR', `[FACTORY] Failed to load driver class '${key}': ${requireError.message}`, {
      stack: requireError.stack,
      path: meta.path,
    });
    throw new Error(`Driver class load failed: ${requireError.message}`);
  }

  // ✅ Validar que DriverClass é função (constructor)
  if (typeof DriverClass !== 'function') {
    throw new Error(`[FACTORY] '${meta.className}' exports is not a constructor function`);
  }

  // ✅ Fase 2: Instanciação
  try {
    instance = new DriverClass(page, { ...config }, signal);
  } catch (constructorError) {
    log('ERROR', `[FACTORY] Driver constructor failed for '${key}': ${constructorError.message}`, {
      stack: constructorError.stack,
    });
    throw new Error(`Driver construction failed: ${constructorError.message}`);
  }

  // ✅ Fase 3: Validação de contrato
  if (!(instance instanceof TargetDriver)) {
    throw new Error(`[FACTORY] '${meta.className}' viola o contrato TargetDriver.`);
  }

  // ✅ Fase 4: Setup de auto-eviction
  instance.once('destroyed', () => {
    const currentMap = pageInstanceCache.get(page);
    if (currentMap) {
      currentMap.delete(key);
      log('DEBUG', `[FACTORY] Cache removido para: ${key} (Ciclo encerrado)`);
    }
  });

  // ✅ Fase 5: Cache
  instances.set(key, instance);
  log('INFO', `[FACTORY] Novo Driver '${instance.name}' acoplado com sucesso.`);

  return instance;
} catch (e) {
  // ✅ Cleanup em caso de erro
  if (instance && typeof instance.destroy === 'function') {
    try {
      await instance.destroy();
    } catch (cleanupError) {
      log('WARN', `[FACTORY] Cleanup failed for ${key}: ${cleanupError.message}`);
    }
  }

  log('ERROR', `[FACTORY] Erro na ativação do driver '${key}': ${e.message}`, {
    stack: e.stack,
  });
  throw e;
}
```

**Prioridade**: ⚠️ **ALTO** - Robustez de lazy-loading

---

### BUG #5: invalidatePageCache Sem Timeout em destroy() - ⚠️ ALTO (P1)

**Severidade**: P1 (Hang possível) **Localização**: Linhas 148-167 **Impacto**: Se driver.destroy()
trava → invalidação nunca completa

**Código Atual**:

```javascript
// Linha 148-167
async function invalidatePageCache(page) {
  if (pageInstanceCache.has(page)) {
    const instances = pageInstanceCache.get(page);
    log('DEBUG', `[FACTORY] Invalidação forçada: Limpando ${instances.size} drivers da aba.`);

    for (const [name, driver] of instances.entries()) {
      try {
        if (!driver.destroyed) {
          await driver.destroy(); // ❌ Nenhum timeout
        }
      } catch (e) {
        log('WARN', `[FACTORY] Erro no descarte do driver '${name}': ${e.message}`);
      }
    }

    instances.clear();
    pageInstanceCache.delete(page);
  }
}
```

**Problema**:

1. `driver.destroy()` pode travar indefinidamente
2. Se 1 driver trava → toda invalidação para
3. Nenhum timeout protection
4. Loop sequencial (`for...of`) → lento para muitos drivers
5. Se erro ocorre, continua loop mas não reporta quais drivers falharam

**Correção**:

```javascript
// Linhas 148-185 - ✅ Timeout protection + parallel cleanup
async function invalidatePageCache(page, options = {}) {
  const timeout = options.timeout || 5000; // 5s default

  if (pageInstanceCache.has(page)) {
    const instances = pageInstanceCache.get(page);
    log('DEBUG', `[FACTORY] Invalidação forçada: Limpando ${instances.size} drivers da aba.`);

    // ✅ Cleanup paralelo com timeout
    const cleanupPromises = [];
    const failedDrivers = [];

    for (const [name, driver] of instances.entries()) {
      const cleanupPromise = (async () => {
        try {
          if (!driver.destroyed) {
            // ✅ Timeout wrapper
            const destroyPromise = driver.destroy();
            const timeoutPromise = new Promise((_, reject) => {
              setTimeout(() => reject(new Error('Destroy timeout')), timeout);
            });

            await Promise.race([destroyPromise, timeoutPromise]);
            log('DEBUG', `[FACTORY] Driver ${name} destroyed successfully`);
          }
        } catch (e) {
          failedDrivers.push({ name, error: e.message });
          log('WARN', `[FACTORY] Erro no descarte do driver '${name}': ${e.message}`);
        }
      })();

      cleanupPromises.push(cleanupPromise);
    }

    // ✅ Aguardar todos os cleanups (paralelo)
    await Promise.allSettled(cleanupPromises);

    if (failedDrivers.length > 0) {
      log(
        'WARN',
        `[FACTORY] ${failedDrivers.length}/${instances.size} drivers falharam no cleanup`,
        {
          failed: failedDrivers,
        },
      );
    }

    instances.clear();
    pageInstanceCache.delete(page);

    log(
      'INFO',
      `[FACTORY] Page cache invalidated. Success: ${instances.size - failedDrivers.length}/${instances.size}`,
    );
  }
}
```

**Prioridade**: ⚠️ **ALTO** - Previne hang em cleanup

---

### BUG #6: Nenhuma Validação de TargetDriver Herança em Discovery - 📝 MÉDIO (P2)

**Severidade**: P2 (Drivers inválidos no registry) **Localização**: Linhas 40-54 **Impacto**:
Drivers que não herdam de TargetDriver são descobertos mas falham em getDriver()

**Problema**:

1. Discovery apenas verifica `file.endsWith('Driver.js')` → pattern matching frágil
2. Nenhuma validação de que classe exporta TargetDriver
3. Drivers inválidos só são detectados em runtime (getDriver)
4. Erro de validação não é user-friendly

**Correção**:

```javascript
// ✅ Validação opcional em discovery (pode ser lenta)
// Adicionar parâmetro de config para ativar
const VALIDATE_DRIVERS_ON_BOOT = process.env.FACTORY_VALIDATE_BOOT === 'true';

for (const file of files) {
  if (file.endsWith('Driver.js')) {
    const targetKey = file.replace('Driver.js', '').toLowerCase();
    const driverPath = path.join(TARGETS_DIR, file);

    // ✅ Validação opcional
    if (VALIDATE_DRIVERS_ON_BOOT) {
      try {
        const DriverClass = require(driverPath);
        const testInstance = new DriverClass(null, {}, new AbortController().signal);

        if (!(testInstance instanceof TargetDriver)) {
          log('WARN', `[FACTORY] Driver ${file} não herda de TargetDriver, ignorando`);
          continue;
        }
      } catch (validationError) {
        log('WARN', `[FACTORY] Driver ${file} falhou na validação: ${validationError.message}`);
        continue;
      }
    }

    driverRegistry[targetKey] = {
      path: driverPath,
      className: file.replace('.js', ''),
    };
  }
}
```

**Prioridade**: 📝 **MÉDIO** - Melhora UX mas não crítico

---

### BUG #7: WeakMap Sem Comentário de Limitação - 📝 MÉDIO (P2)

**Severidade**: P2 (Documentação) **Localização**: Linha 29 **Impacto**: Desenvolvedores podem não
entender limitação de WeakMap (keys só objects)

**Problema**:

1. Comentário diz "O WeakMap garante que, se a aba fechar, o lixo seja coletado"
2. Mas não explica que keys DEVEM ser objects (não strings/numbers)
3. Não explica que WeakMap não é iterável
4. Não explica quando usar WeakMap vs Map

**Correção**:

```javascript
/**
 * Cache de instâncias vivas (WeakMap).
 *
 * ✅ Estrutura: WeakMap<Page, Map<targetName, DriverInstance>>
 *
 * Por que WeakMap?
 *
 * - Keys devem ser objetos (Page instance)
 * - GC automático: Se page é coletado → entry é removido automaticamente
 * - Previne memory leaks: Drivers não mantém páginas vivas
 *
 * Limitações:
 *
 * - Não iterável (não tem .keys(), .values(), .entries())
 * - Não tem .size
 * - Keys apenas objects (não strings/numbers)
 *
 * Inner Map:
 *
 * - Keys: targetName (string) - ex: 'chatgpt', 'gemini'
 * - Values: DriverInstance (TargetDriver subclass)
 */
const pageInstanceCache = new WeakMap();
```

**Prioridade**: 📝 **MÉDIO** - Documentação

---

### BUG #8: DEFAULT_TARGET Hardcoded - 📝 MÉDIO (P2)

**Severidade**: P2 (Flexibilidade) **Localização**: Linha 18 **Impacto**: Default target é hardcoded
como 'chatgpt' → não configurável

**Problema**:

1. `const DEFAULT_TARGET = 'chatgpt';` hardcoded
2. Se chatgpt driver não existe → todos os getDriver(null) falham
3. Nenhuma validação de que DEFAULT_TARGET existe no registry
4. Não pode ser configurado via env var ou config

**Correção**:

```javascript
/**
 * Target padrão quando nenhum é especificado. ✅ Configurável via env var FACTORY_DEFAULT_TARGET ✅ Fallback: primeiro
 * driver descoberto se env var não definida
 */
let DEFAULT_TARGET = process.env.FACTORY_DEFAULT_TARGET || 'chatgpt';

// ... depois do discovery ...

// ✅ Validar que DEFAULT_TARGET existe ou usar primeiro descoberto
if (!driverRegistry[DEFAULT_TARGET.toLowerCase()]) {
  const availableTargets = Object.keys(driverRegistry);
  if (availableTargets.length > 0) {
    DEFAULT_TARGET = availableTargets[0];
    log(
      'WARN',
      `[FACTORY] Default target '${process.env.FACTORY_DEFAULT_TARGET || 'chatgpt'}' não encontrado. Usando '${DEFAULT_TARGET}'`,
    );
  } else {
    log('FATAL', '[FACTORY] Nenhum target disponível e default target inválido');
    throw new Error('No valid default target');
  }
}
```

**Prioridade**: 📝 **MÉDIO** - Flexibilidade

---

### BUG #9: Nenhum Getter para driverRegistry - 📝 BAIXO (P3)

**Severidade**: P3 (API improvement) **Localização**: Linha 169 **Impacto**: Apenas
`availableTargets` é exportado (array), não metadata completo

**Problema**:

1. `module.exports` apenas exporta `availableTargets: Object.keys(driverRegistry)`
2. Nenhum acesso ao metadata (path, className)
3. Ferramentas de debugging não podem ver registry completo
4. Não pode verificar se target existe antes de chamar getDriver()

**Correção**:

```javascript
// Linhas 169-175 - ✅ Exportar métodos de introspecção
module.exports = {
  getDriver,
  invalidatePageCache,
  availableTargets: Object.keys(driverRegistry),

  // ✅ Novos métodos de introspecção
  getDriverMetadata(targetName) {
    const key = (targetName || '').toLowerCase();
    return driverRegistry[key] || null;
  },

  getAllDriversMetadata() {
    return { ...driverRegistry }; // Clone para imutabilidade
  },

  hasTarget(targetName) {
    const key = (targetName || '').toLowerCase();
    return key in driverRegistry;
  },

  getDefaultTarget() {
    return DEFAULT_TARGET;
  },
};
```

**Prioridade**: 📝 **BAIXO** - API improvement

---

### BUG #10: Nenhuma Telemetria (EventEmitter) - 📝 BAIXO (P3)

**Severidade**: P3 (Observability) **Localização**: Toda a factory **Impacto**: Nenhum evento
emitido → zero visibilidade de lifecycle

**Problema**:

1. Factory não herda de EventEmitter
2. Nenhum evento de discovery, cache hit/miss, instantiation, invalidation
3. Impossível monitorar factory sem modificar código
4. Nenhuma integração com NERV ou telemetria

**Correção**:

```javascript
const EventEmitter = require('events');

// ✅ Factory Events
const FACTORY_EVENTS = {
  DISCOVERY_COMPLETE: 'factory:discovery_complete',
  DRIVER_CREATED: 'factory:driver_created',
  DRIVER_REUSED: 'factory:driver_reused',
  DRIVER_EVICTED: 'factory:driver_evicted',
  CACHE_INVALIDATED: 'factory:cache_invalidated',
  ERROR: 'factory:error',
};

class DriverFactory extends EventEmitter {
  constructor() {
    super();
    this.registry = Object.create(null);
    this.pageCache = new WeakMap();
    this.discover();
  }

  discover() {
    // ... discovery logic ...
    this.emit(FACTORY_EVENTS.DISCOVERY_COMPLETE, {
      targetCount: Object.keys(this.registry).length,
      targets: Object.keys(this.registry),
    });
  }

  getDriver(targetName, page, config, signal) {
    // ... lógica ...

    if (cacheHit) {
      this.emit(FACTORY_EVENTS.DRIVER_REUSED, { target: key, name: driver.name });
    } else {
      this.emit(FACTORY_EVENTS.DRIVER_CREATED, { target: key, name: driver.name });
    }

    return driver;
  }

  // ... outros métodos
}

// Singleton instance
const factory = new DriverFactory();

module.exports = {
  getDriver: factory.getDriver.bind(factory),
  invalidatePageCache: factory.invalidatePageCache.bind(factory),
  on: factory.on.bind(factory),
  once: factory.once.bind(factory),
  availableTargets: Object.keys(factory.registry),
};
```

**Prioridade**: 📝 **BAIXO** - Observability (pode ser onda futura)

---

## 🚀 MELHORIAS IDENTIFICADAS (12)

### IMPROVEMENT #1: FACTORY_CONFIG - Zero Magic Numbers (P1)

**Status**: 📋 Não implementado **Impacto**: Hardcoded values para timeouts, paths, etc

**v1.0**: 2 magic values (DEFAULT_TARGET, TARGETS_DIR path)

**v2.0 Proposto**:

```javascript
const FACTORY_CONFIG = {
  TARGETS_DIR: path.join(__dirname, 'targets'),
  DEFAULT_TARGET: process.env.FACTORY_DEFAULT_TARGET || 'chatgpt',
  VALIDATE_ON_BOOT: process.env.FACTORY_VALIDATE_BOOT === 'true',
  INVALIDATE_TIMEOUT_MS: 5000,
  DISCOVERY_RETRY_COUNT: 3,
  MAX_CACHE_SIZE_PER_PAGE: 10, // Limite de drivers por página
};
```

---

### IMPROVEMENT #2: JSDoc Completo (P1)

**Status**: ⚠️ Parcial (apenas getDriver tem JSDoc completo)

| Função              | v1.0 JSDoc | Completo? |
| ------------------- | ---------- | --------- |
| getDriver           | ✅ Full    | ✅        |
| invalidatePageCache | ⚠️ Partial | ❌        |
| Discovery block     | ❌ None    | ❌        |
| driverRegistry      | ⚠️ Partial | ❌        |
| pageInstanceCache   | ⚠️ Partial | ❌        |

**v2.0**: JSDoc completo para todos (15+ métodos após refactor)

---

### IMPROVEMENT #3: EventEmitter Inheritance (P1)

**Status**: ❌ Não implementado **Impacto**: Zero visibilidade de eventos

**v2.0**: 6 eventos propostos

- `factory:discovery_complete`
- `factory:driver_created`
- `factory:driver_reused`
- `factory:driver_evicted`
- `factory:cache_invalidated`
- `factory:error`

---

### IMPROVEMENT #4: Health Check Endpoint (P2)

**Status**: ❌ Não implementado

```javascript
function getHealth() {
  const cacheStats = {
    totalPages: 0,
    totalDrivers: 0,
    byTarget: {},
  };

  // ✅ Iterar sobre pageCache (impossível com WeakMap)
  // Alternativa: Manter Map secundário para stats

  return {
    discovered: Object.keys(driverRegistry).length,
    targets: Object.keys(driverRegistry),
    defaultTarget: DEFAULT_TARGET,
    cache: cacheStats,
  };
}
```

---

### IMPROVEMENT #5: Cache Size Limit (P2)

**Status**: ❌ Não implementado **Impacto**: Drivers ilimitados por página → memory leak possível

**v2.0**:

```javascript
const MAX_DRIVERS_PER_PAGE = 10;

// Em getDriver(), antes de instances.set():
if (instances.size >= MAX_DRIVERS_PER_PAGE) {
  log('WARN', `[FACTORY] Cache limit reached for page (${instances.size}). Evicting oldest.`);
  // Evict LRU driver
  const oldestKey = instances.keys().next().value;
  const oldestDriver = instances.get(oldestKey);
  await oldestDriver.destroy();
  instances.delete(oldestKey);
}
```

---

### IMPROVEMENT #6: Lazy-Load Error Recovery (P2)

**Status**: ❌ Não implementado

**v2.0**: Cache de erros (não tentar re-load de driver quebrado)

```javascript
const failedDrivers = new Set(); // Drivers que falharam no load

// Em getDriver():
if (failedDrivers.has(key)) {
  throw new Error(`[FACTORY] Driver ${key} previously failed to load`);
}

// No catch do lazy-load:
failedDrivers.add(key);
```

---

### IMPROVEMENT #7: Metrics Collection (P2)

**Status**: ❌ Não implementado

```javascript
const metrics = {
  driversCreated: 0,
  driversReused: 0,
  driversDestroyed: 0,
  cacheHits: 0,
  cacheMisses: 0,
  discoveryTime: 0,
};
```

---

### IMPROVEMENT #8: Async Discovery (P3)

**Status**: ❌ Não implementado (discovery é síncrono)

**Problema**: Discovery é síncrono (bloqueia boot)

**v2.0**: Async discovery com Promise

```javascript
async function discover() {
  const files = await fs.promises.readdir(TARGETS_DIR);
  // ... resto async
}
```

---

### IMPROVEMENT #9: Hot-Reload de Drivers (P3)

**Status**: ❌ Não implementado

**v2.0**: Permitir adicionar drivers em runtime

```javascript
function reloadDriver(targetName) {
  const key = targetName.toLowerCase();
  delete require.cache[driverRegistry[key].path];
  // Re-discover
}
```

---

### IMPROVEMENT #10: Driver Versioning (P3)

**Status**: ❌ Não implementado

**v2.0**: Suportar múltiplas versões de um driver

```javascript
driverRegistry['chatgpt@v1'] = { path: '...', version: '1.0.0' };
driverRegistry['chatgpt@v2'] = { path: '...', version: '2.0.0' };
```

---

### IMPROVEMENT #11: LRU Cache Policy (P3)

**Status**: ❌ Não implementado (cache é FIFO implícito)

**v2.0**: Implementar LRU (Least Recently Used)

```javascript
// Manter timestamp de último uso
const lastUsed = new WeakMap(); // Page -> Map<target, timestamp>

// Ao reutilizar driver:
lastUsed.get(page).set(key, Date.now());

// Ao evict: Escolher driver com menor timestamp
```

---

### IMPROVEMENT #12: Dependency Injection Container (P3)

**Status**: ❌ Não implementado (construtor fixo)

**v2.0**: Permitir injeção customizada

```javascript
function getDriver(targetName, page, config, signal, options = {}) {
  const { customLogger, customAbortController } = options;

  const instance = new DriverClass(
    page,
    config,
    signal,
    customLogger || log,
    customAbortController || AbortController,
  );
}
```

---

## 📋 COMPARAÇÃO v1.0 vs v2.0 (Proposta)

### Estrutura

| Aspecto                | v1.0                             | v2.0 Proposto                |
| ---------------------- | -------------------------------- | ---------------------------- |
| **Tipo**               | Module exports                   | EventEmitter class           |
| **Constantes**         | 2 (hardcoded)                    | FACTORY_CONFIG (6 keys)      |
| **Funções Exportadas** | 3 (getDriver, invalidate, array) | 8 (+metadata, +health, +has) |
| **Eventos**            | 0                                | 6 eventos                    |
| **Validações**         | 2 (page.isClosed, instanceof)    | 12+ validações               |
| **Try-Catch**          | 2 (discovery, lazy-load)         | 6 (granular)                 |
| **Timeouts**           | 0                                | 2 (invalidate, lazy-load)    |
| **Métricas**           | 0                                | 7 métricas                   |

### Linhas de Código Estimadas

| Seção                 | v1.0    | v2.0 Est. | Δ         |
| --------------------- | ------- | --------- | --------- |
| Imports + Config      | 20      | 50        | +150%     |
| Discovery             | 15      | 60        | +300%     |
| getDriver()           | 50      | 120       | +140%     |
| invalidatePageCache() | 20      | 50        | +150%     |
| Helpers               | 0       | 80        | NEW       |
| JSDoc                 | 30      | 100       | +233%     |
| **TOTAL**             | **177** | **~460**  | **+160%** |

---

## 🎯 PRIORIZAÇÃO DE IMPLEMENTAÇÃO

### Sprint 1: CRÍTICO (P0) - 2-3 horas

- [x] BUG #1: Discovery try-catch robusto
- [x] BUG #2: Validar parâmetros de getDriver()
- [x] IMPROVEMENT #1: FACTORY_CONFIG

### Sprint 2: ALTO (P1) - 3-4 horas

- [x] BUG #3: Validação de cache destroyed
- [x] BUG #4: Lazy-load try-catch granular
- [x] BUG #5: Timeout em invalidatePageCache
- [x] IMPROVEMENT #2: JSDoc completo
- [x] IMPROVEMENT #3: EventEmitter inheritance

### Sprint 3: MÉDIO (P2) - 2-3 horas

- [x] BUG #6: Validação de herança em discovery
- [x] BUG #7: Documentação WeakMap
- [x] BUG #8: DEFAULT_TARGET configurável
- [x] IMPROVEMENT #4: Health check
- [x] IMPROVEMENT #5: Cache size limit
- [x] IMPROVEMENT #6: Error recovery
- [x] IMPROVEMENT #7: Metrics

### Sprint 4: BAIXO (P3) - 2-3 horas

- [x] BUG #9: Getters para registry
- [x] BUG #10: Telemetria completa
- [x] IMPROVEMENT #8-12: Features avançadas

**Total Estimado**: 9-13 horas (full v2.0)

---

## 📊 RESUMO EXECUTIVO

### Bugs Encontrados

✅ **10 bugs** (2 P0 críticos, 3 P1 altos, 3 P2 médios, 2 P3 baixos)

**Críticos (P0)**:

1. Discovery sem validação de registry vazio → boot com 0 drivers
2. getDriver() sem validação de parâmetros → null reference crashes

**Altos (P1)**: 3. Cache reaproveitamento sem validação robusta → drivers destruídos retornados 4.
Lazy-load sem try-catch granular → crashes sem recovery 5. invalidatePageCache sem timeout → hang
possível

### Melhorias Identificadas

✅ **12 melhorias** (3 P1, 5 P2, 4 P3)

**Prioritárias (P1)**:

1. FACTORY_CONFIG (zero magic numbers)
2. JSDoc completo (todas as funções)
3. EventEmitter inheritance (6 eventos)

### Esforço de Implementação

- **Sprint 1 (P0)**: 2-3h → Previne crashes críticos
- **Sprint 2 (P1)**: 3-4h → Robustez e telemetria
- **Sprint 3 (P2)**: 2-3h → Observability e docs
- **Sprint 4 (P3)**: 2-3h → Features avançadas

**Total**: 9-13 horas para v2.0 completo

### Crescimento Estimado

```
v1.0: 177 linhas
v2.0: ~460 linhas
──────────────────
Δ: +283 linhas (+160%)
```

---

## 🎉 RECOMENDAÇÕES

### Implementação Obrigatória (P0-P1)

1. ✅ Validação de parâmetros em getDriver()
2. ✅ Discovery robusto com validação de registry
3. ✅ Timeout em invalidatePageCache()
4. ✅ Try-catch granular em lazy-load
5. ✅ Cache validation robusta

### Implementação Recomendada (P2)

6. ✅ EventEmitter inheritance (telemetria)
7. ✅ FACTORY_CONFIG centralizado
8. ✅ Health check endpoint
9. ✅ JSDoc completo
10. ✅ Cache size limit

### Implementação Opcional (P3)

11. ✅ Hot-reload de drivers
12. ✅ LRU cache policy
13. ✅ Metrics collection
14. ✅ Async discovery

---

**Conclusão**: Factory.js v1.0 é funcional mas tem **2 bugs críticos P0** que podem causar crashes.
v2.0 propõe transformação em **EventEmitter class** com validações robustas, telemetria completa e
observability.

---

**Versão**: v2.0 (Audit Complete) **Data**: 2026-02-01 **Status**: 📋 READY FOR IMPLEMENTATION
