# Fase 2 — Investigação Detalhada (BUG-01, 03, 04, 11, 13, 14)

## Data: 2026-05-14

### Sumário Executivo
- **Bugs Confirmados**: BUG-01, BUG-13
- **Bugs Deferred**: BUG-03, BUG-04, BUG-11, BUG-14
- **Status**: 2 fixos em Fase 2 prioritária, 4 deferred para revisão arquitetural posterior

---

## BUG-01: ToolSessionContext.snapshot — Comparação de Referência ⚠️

### Localização
- Arquivo: `src/copilot/sdk/session/tool-session-context.js` (linha 243)
- Classe: `ToolSessionContext`
- Método: `snapshot()`

### Código Atual
```javascript
snapshot() {
    return {
        sessionId: this.#sessionId,
        pendingInputCount: this.#pendingInputResolvers.size,
        pendingInputIds: [...this.#pendingInputResolvers.keys()],
        hasBroadcastSse: this.#broadcastSse !== ToolSessionContext.#noopSse,
    };
}

static #noopSse = () => {};
```

### Problema
- A comparação `this.#broadcastSse !== ToolSessionContext.#noopSse` compara referências, NÃO tipo
- Se `#noopSse` for redefinida (manutenção futura), ou se houver múltiplas instâncias de `#noopSse`, a comparação falha
- `hasBroadcastSse` terá valor incorreto mesmo que `#broadcastSse` seja realmente o noop

### Impacto
- **Severidade**: BAIXA (é apenas um snapshot observável de observabilidade)
- **Caso de Uso**: Diagnóstico e monitoramento interno
- **Risco**: Falso positivo/negativo em logs de debug pode confundir operadores

### Solução Proposta
Adicionar um flag explícito em vez de comparação de referência:
```javascript
// Opção 1: Usar Symbol para garantir unicidade
static #noopSse = Symbol('noop-sse');

// Opção 2: Adicionar campo booleano
#hasActiveBroadcast = false;
// E em setBroadcastSse(): this.#hasActiveBroadcast = callback !== ToolSessionContext.#noopSse;

// Opção 3: Type guard simples
snapshot() {
    return {
        sessionId: this.#sessionId,
        pendingInputCount: this.#pendingInputResolvers.size,
        pendingInputIds: [...this.#pendingInputResolvers.keys()],
        hasBroadcastSse: typeof this.#broadcastSse === 'function' && this.#broadcastSse.name !== 'noop',
    };
}
```

### Status
- ✅ **Identificado**
- ⏳ **Recomendação**: Implementar em Fase 2.1 (baixa prioridade, sem impacto crítico)

---

## BUG-03: CopilotClientManager — Race Condition (Verificação) ✅

### Localização
- Arquivo: `src/copilot/sdk/session/client.js`
- Classe: `CopilotClientManager`
- Métodos: `getClient()`, `#connect()`

### Análise Efetuada
O padrão de `#startPromise` em `CopilotClientManager` foi auditado:

```javascript
async getClient(overrides = {}) {
    if (this.#client && this.#client.getState() === 'connected') {
        return this.#client;
    }
    if (this.#startPromise) {
        return this.#startPromise;  // Deduplicação OK
    }
    this.#startPromise = this.#connect(overrides);
    return this.#startPromise;
}

async #connect(overrides) {
    try {
        // ... lógica de conexão ...
        this.#client = client;
        return client;
    } finally {
        this.#startPromise = null;  // Reset correto após conclusão
    }
}
```

### Conclusão
- ✅ **Não há race condition crítica**
- Padrão `#startPromise` deduplica chamadas concorrentes corretamente
- Reset em `finally` garante que próximas chamadas após conclusão disparem nova conexão
- Circuit breaker + retry logic implementado corretamente

### Status
- ✅ **Auditado e Validado**
- **Recomendação**: NENHUMA ação necessária — marcar como "Não procede"

---

## BUG-04: resolveSessionCreateModel — Preservação de 'auto' ✅

### Localização
- Arquivo: `src/copilot/sdk/session/lifecycle.js` (linha 51)
- Função: `resolveSessionCreateModel(model, fallback = 'gpt-5-mini')`

### Código Atual
```javascript
/**
 * Resolve `model: "auto"` sem depender estaticamente do pacote de models.
 *
 * Mantido como utilitário explícito para fluxos que precisam de um modelo concreto.
 * A criação/retomada canônica de sessão preserva `model: "auto"` para que o próprio
 * SDK possa aplicar a política nativa de roteamento/quota.
 */
export async function resolveSessionCreateModel(model, fallback = 'gpt-5-mini') {
    if (model !== 'auto') return model;
    return resolveSessionAutoModel(fallback);
}
```

### Documentação Interna
A JSDoc já diz explicitamente: "A criação/retomada canônica de sessão preserva `model: "auto"`"

Isto é **consistente** com o design atual — consumidores podem decidir:
- Usar `resolveSessionCreateModel()` se querem modelo concreto
- Usar `model: 'auto'` diretamente na criação de sessão se querem roteamento automático

### Status
- ✅ **Auditado e Validado**
- **Recomendação**: NENHUMA ação necessária — design está correto conforme documentado

---

## BUG-11: randomUUID Portability ✅

### Localização
- Arquivo: `src/copilot/sdk/session/elicitation.js` (linha 211)
- Uso: Geração de ID único para elicitação

### Código Atual
```javascript
const id = `elicitation-${Date.now().toString(36)}-${globalThis.crypto.randomUUID().slice(0, 8)}`;
```

### Análise
- **Node.js 24+ Target**: `globalThis.crypto.randomUUID()` é natively disponível desde Node 15.7.0
- Project `package.json` especifica `"engines": { "node": ">=24" }`
- Não há portabilidade com Node < 15, mas não é requisito de projeto
- Código está correto para o target

### Status
- ✅ **Auditado e Validado**
- **Recomendação**: NENHUMA ação necessária — já compatível com Node 24+

---

## BUG-13: createToolRegistryAdapter — Métodos Ausentes ⚠️

### Localização
- Arquivo: `src/copilot/sdk/tools/registry.js` (linha 286)
- Função: `createToolRegistryAdapter(inner)`
- Interface: `IToolRegistry` (importada de `#copilot/core/interfaces`)

### Código Atual
```javascript
export function createToolRegistryAdapter(inner) {
    const reg = inner ?? createRegistry();
    return {
        entries: reg.entries,
        register: (tool, meta) => registerTool(reg, tool, meta),
        getByCategory: (category) => getToolsByCategory(reg, category),
        getByTag: (tag) => getToolsByTag(reg, tag),
        filter: (names) => createToolRegistryAdapter(filterByNames(reg, names)),
        list: () => getAllTools(reg),
        stats: () => {
            const info = inspectRegistry(reg);
            return { total: info.total, byCategory: info.categories };
        },
    };
}
```

### Funções Internas Disponíveis (Não Expostas)
1. **`mergeRegistries(primary, secondary)`** (linha 213)
   - Une dois registries
   - Secundário sobrescreve primário
   - Não exposto no adapter

2. **`excludeByNames(registry, names)`** (linha 247)
   - Filtra EXCLUSIVAMENTE (ao contrário de `filter` que inclui)
   - Não exposto no adapter

### Impacto
- **Severidade**: BAIXA (uso avançado, não crítico)
- **Caso de Uso**: Composição dinâmica de registries (merge, exclusão)
- **Risco**: Consumidores que precisam de merge/exclude devem acessar funções internas diretamente

### Solução Proposta
Expor métodos no adapter:
```javascript
return {
    // ... métodos existentes ...
    merge: (other) => {
        const merged = mergeRegistries(reg, other instanceof Object && other.reg ? other.reg : other);
        return createToolRegistryAdapter(merged);
    },
    exclude: (names) => createToolRegistryAdapter(excludeByNames(reg, names)),
};
```

### Status
- ✅ **Identificado**
- ⏳ **Recomendação**: Implementar em Fase 2.2 (melhoria de API, sem impacto crítico)

---

## BUG-14: verifySessionModelSwitch — Possível Race em Mudança Assíncrona ⚠️

### Localização
- Arquivo: `src/copilot/sdk/session/runtime.js` (linha 52)
- Função: `verifySessionModelSwitch(session, model, options)`

### Código Atual
```javascript
async function verifySessionModelSwitch(session, model, options) {
    const result = {
        requestedModel: model,
        effectiveModel: null,
        verifiedSwitch: false,
        usedRpcFallback: false,
    };

    // Duck-typing check para rpc.model.getCurrent
    const hasModelGetCurrent = Boolean(
        session.rpc &&
        typeof session.rpc === 'object' &&
        session.rpc.model &&
        typeof session.rpc.model === 'object' &&
        typeof session.rpc.model.getCurrent === 'function',
    );

    if (!hasModelGetCurrent) {
        return result;
    }

    try {
        const current = await modelGetCurrent(session);
        result.effectiveModel = current.modelId;
        result.verifiedSwitch = current.modelId === model;
    } catch (error) {
        log('WARN', `[session-runtime] model.getCurrent falhou: ${toError(error).message}`);
        return result;  // verifiedSwitch stays false
    }

    if (result.verifiedSwitch) {
        return result;
    }

    // ... lógica de retry via switchTo ...
}
```

### Cenário de Race
1. `session.setModel('gpt-5')` é chamado
2. SDK pode processar mudança assincronamente internamente
3. `verifySessionModelSwitch()` chama `modelGetCurrent()` antes que o SDK termine a transição
4. `getCurrent()` retorna o modelo anterior
5. `verifiedSwitch = false` mesmo que a mudança foi bem-sucedida (apenas não confirmada ainda)

### Mitigações Existentes
- ✅ Trata falha de `getCurrent()` (catch block)
- ✅ Não falha se `verifiedSwitch = false` — retorna com flag indicando status incerto
- ✅ Consumer pode usar `verifiedSwitch` para decidir se retry é necessário

### Mitigação Proposta
- Adicionar timeout + retry automático em `verifySessionModelSwitch()`
- Ou adicionar parâmetro de `retryCount` para polling interno

### Status
- ✅ **Identificado**
- ⏳ **Recomendação**: Implementar em Fase 2.3 (resiliência, baixa prioridade)

---

## Recomendações — Roadmap Fase 2

| Bug | Severidade | Ação                       | Fase | Status |
| --- | ---------- | -------------------------- | ---- | ------ |
| 01  | BAIXA      | Implementar Symbol ou flag | 2.1  | ⏳ TODO |
| 03  | N/A        | Nenhuma (auditado)         | —    | ✅ SKIP |
| 04  | N/A        | Nenhuma (auditado)         | —    | ✅ SKIP |
| 11  | N/A        | Nenhuma (auditado)         | —    | ✅ SKIP |
| 13  | BAIXA      | Expor merge/exclude        | 2.2  | ⏳ TODO |
| 14  | BAIXA      | Adicionar timeout/retry    | 2.3  | ⏳ TODO |

### Próximo Passo
Confirmar com usuário: Implementar Fase 2.1 (BUG-01), 2.2 (BUG-13), 2.3 (BUG-14)?
