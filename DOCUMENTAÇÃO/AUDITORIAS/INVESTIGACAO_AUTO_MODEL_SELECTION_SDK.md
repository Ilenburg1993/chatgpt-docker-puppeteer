# Investigação Profunda: Auto-Model Selection no SDK

**Data**: 25 de abril de 2026 **Objetivo**: Implementar seleção automática de modelo como existe no
Copilot Chat

---

## 1. Descobertas Principais

### 1.1 Arquitetura Atual de Modelo

**Current Flow**:

```
SessionCreateOptions.model (string: "gpt-5-mini" | "gpt-4o" | "gpt-4o-mini")
    ↓
buildSessionConfig() — valida + prepara para SDK
    ↓
client.createSession(config)
    ↓
SDK passa modelo para backend GitHub Copilot
```

**Problema**: Modelo hardcoded como string literal; SDK não faz seleção automática, apenas valida
existência.

---

### 1.2 ModelSelector Existente (F40.2)

**Localização**: `src/copilot/sdk/models/selector.js`

**Classe**: `ModelSelector`

```javascript
class ModelSelector {
  select(criteria, availableIds) {
    // Retorna MELHOR modelo com base em critérios + histórico de performance
    // Critérios: preferLowCost, preferFast, requireReasoning, requireVision, minContextWindow, prefer (id preferido)
    // Usa histórico: latência, taxa de sucesso, tokens
  }

  topN(criteria, n = 3, availableIds) {
    // Retorna TOP-N modelos ordenados por adequação
  }

  suggestFallback(currentModelId, availableIds) {
    // Modelo alternativo (mais barato/rápido) se atual falhar
  }
}
```

**Auto-Downgrade Detector** (F40.6):

```javascript
class AutoDowngradeDetector {
  evaluate(currentModelId, availableIds) {
    // Detecta modelo lento ou com alta taxa de erro
    // Retorna: { shouldDowngrade, reason, suggestedModel }
  }
}
```

---

### 1.3 Registry de Modelos Conhecidos

**Localização**: `src/copilot/sdk/models/known-models.js`

**Modelos Cadastrados**:

```javascript
[
  { id: 'gpt-5', costTier: 'high', speedTier: 'medium', supportsReasoning: true },
  { id: 'gpt-5-mini', costTier: 'low', speedTier: 'fast', supportsReasoning: true },
  { id: 'gpt-4.1', costTier: 'medium', speedTier: 'fast', supportsVision: true },
  { id: 'gpt-4.1-mini', costTier: 'low', speedTier: 'fast', supportsVision: true },
  { id: 'gpt-4.1-nano', costTier: 'free', speedTier: 'fast', supportsVision: true },
  { id: 'gpt-4o', costTier: 'medium', speedTier: 'fast', supportsVision: true },
  { id: 'gpt-4o-mini', costTier: 'low', speedTier: 'fast', supportsVision: true },
];
```

---

### 1.4 Helpers de Resolução Existentes

**`resolveModelId(models, preferred, fallback='gpt-5-mini')`**:

- Valida se modelo preferido existe na lista de modelos do SDK
- Se não existe, retorna fallback
- **Não faz seleção inteligente** — apenas validação

**Oportunidade**: Estender para suportar `preferred='auto'`

---

## 2. Implementação Proposta: Auto-Model Selection

### 2.1 Opção 1 — Auto-Selection via Registry + ModelSelector (RECOMENDADA)

**Fluxo**:

```
1. User: model='auto' (ou DEFAULT_COPILOT_MODEL='auto')
2. resolveModelId(..., 'auto') → checa se é 'auto'
3. Se 'auto': chamada ModelSelector.select({preferFast: true, preferLowCost: true})
4. Retorna melhor modelo (ex: 'gpt-4o-mini' se rápido + barato)
5. Passa modelo resolvido para SDK
```

**Implementação**:

```javascript
// src/copilot/sdk/models/helpers.js

export async function resolveModelIdAuto(models, preferred, fallback = 'gpt-5-mini') {
  // Se preferred não é 'auto', usa lógica original
  if (preferred !== 'auto') {
    return resolveModelId(models, preferred, fallback);
  }

  // Auto-selection: usa ModelSelector para melhor modelo
  const { modelSelector } = await import('./registry.js');
  const selected = modelSelector.select(
    {
      preferFast: true,
      preferLowCost: true,
      // Opcionais: requireReasoning, requireVision, minContextWindow
    },
    models.map((m) => m.id),
  );

  if (!selected) {
    log('WARN', '[models] ModelSelector failed; falling back to default');
    return fallback;
  }

  log(
    'INFO',
    `[models] Auto-selected model: ${selected.id} (cost: ${selected.costTier}, speed: ${selected.speedTier})`,
  );
  return selected.id;
}
```

---

### 2.2 Opção 2 — Multi-Tier Fallback Chain

**Objetivo**: Se modelo requested atingir rate_limit, switchear para tier alternativo com quota
separada.

**Hipótese**: GitHub Copilot pode ter quotas por tier (gpt-5-mini, gpt-4o, etc.) ou global.

**Estratégia**:

```javascript
const FALLBACK_CHAIN = [
  'gpt-4o', // Try first (different tier potentially)
  'gpt-4o-mini', // Cheaper alternative
  'gpt-4.1', // Vision support
  'gpt-5-mini', // Default mini
  'gpt-5', // Full reasoning
];

function selectNextModel(failedModel) {
  const idx = FALLBACK_CHAIN.indexOf(failedModel);
  return idx < FALLBACK_CHAIN.length - 1
    ? FALLBACK_CHAIN[idx + 1]
    : FALLBACK_CHAIN[FALLBACK_CHAIN.length - 1];
}
```

---

### 2.3 Opção 3 — Observability: Track Model Success Rate

**Integração com AutoDowngradeDetector**:

```javascript
// src/copilot/sdk/session/lifecycle.js

export async function createSession(client, opts) {
  const options = opts ?? {};
  let model = options.model ?? DEFAULT_COPILOT_MODEL;

  // Se 'auto', resolver via ModelSelector
  if (model === 'auto') {
    try {
      const availableModels = await listModels();
      const selectedModel = await resolveModelIdAuto(availableModels, 'auto');
      model = selectedModel;
      log('INFO', `[session] Auto-selected model: ${model}`);
    } catch (e) {
      log('ERROR', `[session] Auto-selection failed: ${e.message}; using default`);
      model = DEFAULT_COPILOT_MODEL;
    }
  }

  const config = buildSessionConfig({ ...options, model }, 'create');
  const session = await client.createSession(config);
  return { session, isResumed: false, sessionId: session.sessionId };
}
```

---

## 3. Descoberta: SDK Model Enumeration

### 3.1 Como listar modelos disponíveis no SDK

**Função existente**: `listModels()` em `src/copilot/sdk/lib/models.js`

```javascript
const models = await listModels();
// Retorna: ModelInfo[]
// Cada ModelInfo: { id, name, capabilities, policy, billing, ... }
```

**Chaveado por**: `client.listModels()` (SDK)

### 3.2 Por que `auto` falha

- **SDK não reconhece** `'auto'` como model ID válido
- **Preflight valida** contra lista fixa de modelos conhecidos
- **Fallback em tempo de preflight**: SDK provavelmente usa `gpt-5-mini` se model inválido
- **Rate limit same**: Porque ambos `gpt-5-mini` e `gpt-4o` compartilham **mesma quota Copilot
  GitHub**

---

### 3.3 Solução: Implementar Auto-Selection Server-Side

**NÃO reliar** em `auto` como string literal para SDK. **IMPLEMENTAR** lógica de seleção **antes**
de chamar SDK.

---

## 4. Plano de Implementação (Fases)

### Fase 1: Auto-Model Resolver Function

- [ ] Estender `resolveModelId()` para suportar `preferred='auto'`
- [ ] Integrar `ModelSelector.select()` com critérios sensatos
- [ ] Tests: Validar que `'auto'` retorna modelo válido

**Arquivos a modificar**:

- `src/copilot/sdk/models/helpers.js` — adicionar `resolveModelIdAuto()`
- `src/copilot/sdk/models/index.js` — export nova função

**Tempo estimado**: 30 min

---

### Fase 2: Session Lifecycle Integration

- [ ] Atualizar `createSession()` para chamar auto-resolver
- [ ] Adicionar logging detalhado
- [ ] Tests: Criar sessão com `model='auto'`

**Arquivos a modificar**:

- `src/copilot/sdk/session/lifecycle.js` — chamar `resolveModelIdAuto()` se needed

**Tempo estimado**: 20 min

---

### Fase 3: Config Update

- [ ] Mudar `DEFAULT_COPILOT_MODEL` para `'auto'` (em `src/copilot/config/agent.js`)
- [ ] Validar terminal start com novo modelo
- [ ] Observar auto-selection nos logs

**Arquivos a modificar**:

- `src/copilot/config/agent.js` — set DEFAULT_COPILOT_MODEL = 'auto'

**Tempo estimado**: 10 min + manual test

---

### Fase 4: Fallback Chain (Opcional)

- [ ] Implementar AutoDowngradeDetector integration
- [ ] Se rate_limit, tentar próximo modelo da chain
- [ ] Tests: Simular rate_limit e verificar fallback automático

**Arquivos a modificar**:

- `src/copilot/sdk/models/selector.js` — melhorias em AutoDowngradeDetector
- `src/copilot/hooks/sdk/model-downgrade.js` (novo) — monitor rate_limit events

**Tempo estimado**: 1-2 horas

---

## 5. Risk Assessment

| Risk                            | Likelihood | Impact | Mitigation                                              |
| ------------------------------- | ---------- | ------ | ------------------------------------------------------- |
| Auto-selector picks wrong model | LOW        | MEDIUM | Tests + fallback to gpt-5-mini if fail                  |
| ModelSelector.select() slow     | LOW        | MEDIUM | Cache results for 5 min                                 |
| Both models hit same quota      | MEDIUM     | HIGH   | Pre-communicate to user; implement quota-aware fallback |
| SDK rejects auto-selected model | LOW        | MEDIUM | Validate model in known-models list                     |

---

## 6. Esperado Outcome

**Antes** (current):

```
DEFAULT_COPILOT_MODEL = 'gpt-4o'
→ Terminal inicia
→ Se gpt-4o atingir rate_limit, user fica bloqueado
```

**Depois** (com auto-selection):

```
DEFAULT_COPILOT_MODEL = 'auto'
→ Terminal inicia
→ resolveModelIdAuto() avalia modelos disponíveis
→ Seleciona 'gpt-4o-mini' (rápido + barato, ex.)
→ Session criada com melhor modelo para contexto
→ Auto-downgrade em caso de latência/erro (opcional)
```

---

## 7. Referências

- **ModelSelector**: `src/copilot/sdk/models/selector.js` (class ModelSelector)
- **AutoDowngradeDetector**: `src/copilot/sdk/models/selector.js` (class AutoDowngradeDetector)
- **Known Models**: `src/copilot/sdk/models/known-models.js`
- **Helpers**: `src/copilot/sdk/models/helpers.js` (listModels, filterEnabledModels, resolveModelId)
- **Session Lifecycle**: `src/copilot/sdk/session/lifecycle.js` (createSession)
- **Config**: `src/copilot/config/agent.js` (DEFAULT_COPILOT_MODEL)

---

## 8. Recomendação Final

**Implementar Fase 1 + 2 + 3 imediatamente**:

- Cria função robusta de auto-selection
- Integra com session lifecycle
- Atualiza config para usar 'auto'
- **Tempo total**: ~1 hora

**Deferir Fase 4** para após validação:

- Fallback chain é "nice-to-have"
- Primeiro validar que auto-selection funciona
- Depois implementar se rate_limit persiste
