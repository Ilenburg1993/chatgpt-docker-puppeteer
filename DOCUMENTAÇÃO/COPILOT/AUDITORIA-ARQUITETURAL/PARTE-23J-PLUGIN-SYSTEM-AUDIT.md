# PARTE-23J — Auditoria do Plugin System

**Data**: 2026-04-12 | **Status**: Canônico | **Versão**: 1.0
**Scope**: Análise completa do plugin system existente + plano de ativação
**Precedente**: PARTE-23G (situação atual), PARTE-23I (roadmap fase 5A)

---

## 1. Inventário Completo

### 1.1 Arquivos

| Arquivo                      | LoC     | Função                                   |
| ---------------------------- | ------- | ---------------------------------------- |
| `plugins/plugin-registry.js` | 225     | PluginRegistry class + discoverPlugins() |
| `plugins/index.js`           | 30      | Re-exports + CopilotPlugin typedef       |
| **Total**                    | **255** |                                          |

### 1.2 Status

- **Funcional**: Sim — código completo e testável
- **Integrado**: Não — **ÓRFÃO** (0 importadores fora de plugins/)
- **Feature-flagged**: Não (mas `sdk/feature-flags.js` já tem flag `plugins`)
- **Testado**: Não (0 specs para plugin-registry)

---

## 2. API Completa do PluginRegistry

### 2.1 Constructor
```js
new PluginRegistry()
// Estado interno: Map<string, CopilotPlugin>
```

### 2.2 Métodos Públicos

| Método                     | Signature                    | Comportamento                                                           |
| -------------------------- | ---------------------------- | ----------------------------------------------------------------------- |
| `register(plugin)`         | `(CopilotPlugin) → void`     | Valida + armazena. Throw se nome duplicado.                             |
| `install(name, container)` | `(string, Container) → void` | Resolve deps → chama `plugin.install(container)`. Throw se dep missing. |
| `installAll(container)`    | `(Container) → void`         | Itera registry, instala todos por ordem de dependência.                 |
| `list()`                   | `() → CopilotPlugin[]`       | Retorna cópia do array de plugins.                                      |
| `has(name)`                | `(string) → boolean`         | Verifica existência.                                                    |
| `get(name)`                | `(string) → CopilotPlugin`   | Retorna plugin. Throw se missing.                                       |
| `clear()`                  | `() → void`                  | Limpa registry.                                                         |

### 2.3 discoverPlugins()
```js
discoverPlugins(baseDir, registry)
// Escaneia subdirs: tools/, hooks/, bridges/, services/
// Para cada .js encontrado: import() dinâmico → espera default export
// Se export é CopilotPlugin → registry.register(plugin)
// Retorna registry
```

### 2.4 CopilotPlugin typedef
```js
/**
 * @typedef {Object} CopilotPlugin
 * @property {string} name — Unique identifier
 * @property {string} [version] — Semver
 * @property {string[]} [dependencies] — Plugin names required before install
 * @property {(container: import('#copilot/core').Container) => void} install — DI wiring
 * @property {() => void} [uninstall] — Cleanup (optional)
 */
```

---

## 3. Análise de Qualidade do Código

### 3.1 Pontos Fortes
- ✅ **Dependency resolution**: Verifica `plugin.dependencies` antes de install
- ✅ **DI integration**: `install(container)` recebe container — correto
- ✅ **Discovery automático**: Scan filesystem por convenção (tools/, hooks/, bridges/, services/)
- ✅ **Validation**: Verifica nome, unicidade, tipo
- ✅ **Clear/reset**: Para testes
- ✅ **Install order**: `installAll()` poderia fazer topological sort (atualmente iteração simples)

### 3.2 Pontos Fracos
- ❌ **Sem lifecycle hooks**: Falta `onBoot()`, `onShutdown()`, `onHealthCheck()`
- ❌ **Sem error isolation**: Se `plugin.install()` throws, `installAll()` para tudo
- ❌ **Sem topological sort**: Dependencies resolvidas por ordem de `Map.entries()` (pode falhar se ordem errada)
- ❌ **Sem uninstall enforcement**: `uninstall()` é opcional e nunca chamado
- ❌ **Sem versioning check**: `version` field existe mas não é comparado
- ❌ **Sem plugin metadata**: Falta description, author, category
- ❌ **Discovery path hardcoded**: `['tools', 'hooks', 'bridges', 'services']` — não configurável

### 3.3 Veredicto
**Usável como está para MVP**. Problemas listados acima são melhorias para V2 — não bloqueiam ativação.

---

## 4. O Que Impede a Ativação Hoje

### 4.1 Checklist de Ativação

| #   | Item                                                 | Status          | Esforço  |
| --- | ---------------------------------------------------- | --------------- | -------- |
| 1   | PluginRegistry precisa ser importado em algum lugar  | ❌ Não importado | 1 linha  |
| 2   | `discoverPlugins()` precisa ser chamado no boot      | ❌ Nunca chamado | 3 linhas |
| 3   | `registry.installAll(container)` precisa ser chamado | ❌ Nunca chamado | 1 linha  |
| 4   | Feature flag `plugins` em sdk/feature-flags.js       | ✅ Já existe!    | 0        |
| 5   | Pelo menos 1 plugin real para descobrir              | ❌ Nenhum        | ~50 LoC  |
| 6   | Testes para PluginRegistry                           | ❌ Nenhum        | ~80 LoC  |

### 4.2 Minimal Viable Integration (~10 linhas)

```js
// Em entry.js ou composition-root.js:
import { isExperimental } from '#copilot/sdk/feature-flags';
import { PluginRegistry, discoverPlugins } from '#copilot/plugins';

if (isExperimental('plugins')) {
    const registry = new PluginRegistry();
    await discoverPlugins(new URL('./plugins/', import.meta.url).pathname, registry);
    registry.installAll(container);
    log('INFO', `[Plugins] ${registry.list().length} plugins loaded`);
}
```

---

## 5. Plano de Plugins Builtin

### 5.1 audit-plugin (Canônico — 1º plugin)

```js
// plugins/builtin/audit-plugin.js
export default {
    name: 'audit',
    version: '1.0.0',
    dependencies: [],
    install(container) {
        const bus = container.resolve(EVENT_BUS);
        const auditLog = container.resolve(AUDIT_LOGGER);
        // Subscreve eventos de audit via EventBus
        bus.on('agent:*', (event) => auditLog.log(event));
        bus.on('session:*', (event) => auditLog.log(event));
    }
};
```

**Valor**: Demonstra pattern canônico. Migra wiring de audit de código espalhado para plugin.

### 5.2 mcp-plugin (Bridge management)

```js
// plugins/builtin/mcp-plugin.js
export default {
    name: 'mcp',
    version: '1.0.0',
    dependencies: [],
    install(container) {
        const bridge = container.resolve(MCP_BRIDGE);
        // Registra health check
        container.resolve(HEALTH_SERVICE)?.registerCheck('mcp', () => bridge.isHealthy());
        // Registra shutdown
        registerShutdownHandler('mcp-disconnect', () => bridge.disconnect(), 20);
    }
};
```

### 5.3 hooks-plugin (Preset management)

```js
// plugins/builtin/hooks-plugin.js
export default {
    name: 'hooks',
    version: '1.0.0',
    dependencies: [],
    install(container) {
        const hookBus = container.resolve(HOOK_BUS);
        const bus = container.resolve(EVENT_BUS);
        // Bridge hookBus → EventBus
        bridgeEmitter(hookBus, bus, hookEventMap);
    }
};
```

---

## 6. Perguntas e Respostas sobre o Plugin System

### Q1: Por que o plugin system foi criado mas nunca integrado?
**R**: Foi criado como parte de uma fase anterior de preparação (PARTE-21/22 refactoring), mas o foco mudou para god file splitting e DI container. O wiring ficou como TODO.

### Q2: Devemos ativar plugins agora ou esperar?
**R**: Ativar **com feature flag** (default OFF). A flag `plugins` já existe em `sdk/feature-flags.js`. Risco zero — se flag OFF, zero side effects.

### Q3: discoverPlugins() pode causar problemas de performance no boot?
**R**: Scan de 4 subdirectórios com `fs.readdir()` + dynamic `import()`. Se 0-5 plugins, overhead <50ms. Aceitável.

### Q4: O plugin system conflita com DI container?
**R**: Não — são complementares. Plugin.install(container) integra com DI. O pattern é: plugin registra tokens no container.

### Q5: Precisamos de topological sort para installAll()?
**R**: Para 3-5 builtin plugins, não. Para >10 plugins com deps complexas, sim. Implementar quando necessário (YAGNI).

### Q6: Como testar um plugin?
**R**: Unit test:
```js
test('audit-plugin installs correctly', () => {
    const container = new Container();
    container.register(EVENT_BUS, () => createEventBus());
    plugin.install(container);
    // Assert: bus has listeners
});
```

### Q7: O que falta para V2 do plugin system?
**R**: (1) Lifecycle hooks (onBoot, onShutdown), (2) Error isolation (try/catch em install), (3) Topological sort, (4) Plugin uninstall flow, (5) Metadata (description, category). Nenhum bloqueia V1 activation.

---

## 7. Relação com Outros Subsistemas

```
sdk/feature-flags.js ──→ isExperimental('plugins') ──→ guard
         │
         ▼
entry.js / composition-root.js
         │
         ▼
plugins/plugin-registry.js ──→ discoverPlugins()
         │                          │
         ▼                          ▼
PluginRegistry.installAll(container)    scan: tools/ hooks/ bridges/ services/
         │
         ▼
plugin.install(container) ──→ container.register() / container.resolve()
         │
         ▼
DI tokens ──→ EVENT_BUS, loggers, services, bridges
```

---

## 8. Métricas Pré/Pós Ativação

| Métrica                 | Antes      | Após V1     | Após V2         |
| ----------------------- | ---------- | ----------- | --------------- |
| Plugins loaded          | 0          | 3 builtin   | 5+              |
| Plugin system órfão     | ✅          | ❌           | ❌               |
| Feature-flagged         | Não        | Sim         | Sim             |
| Specs para plugins      | 0          | 3+          | 10+             |
| Wiring espalhado        | 3 arquivos | 3 + plugins | Plugins only    |
| Install error isolation | N/A        | Não         | Sim (try/catch) |
