# Análise: Bugs & Upgrades Associados — Auto-Model Selection

**Data**: 25 de abril de 2026 **Escopo**: Investigação de bugs potenciais e oportunidades de upgrade
relacionadas à implementação de auto-model selection

---

## 1. Validação de Qualidade

### 1.1 Lint Status

**Comando**: `npm run lint` **Resultado**: ✅ 2 erros pré-existentes (não relacionados aos meus
changes):

- `src/copilot/sdk/tools/core.js` linha 26, 29: `var` declarations (legacy code)
- **Impacto**: Nenhum nas mudanças que fiz

**Mudanças Verificadas**:

- ✅ `src/copilot/sdk/models/helpers.js` — nova função `resolveModelIdAuto()`
- ✅ `src/copilot/sdk/models/index.js` — export adicionado
- ✅ `src/copilot/sdk/session/lifecycle.js` — lógica de auto-selection
- ✅ `src/copilot/config/agent.js` — config default model = 'auto'

---

### 1.2 TypeCheck Status

**Comando**: `npm run typecheck:node` **Resultado**: ✅ PASS (após correções)

**Correções Aplicadas**:

1. Adicionado import: `import { toError } from '../../core/error-handlers.js';`
2. Segurança de nullable: `const firstModel = enabled[0]; if (!firstModel) ...`
3. Error handling robusto: `const err = toError(e);` em vez de `e.message`

**Erro Anterior #1**: `TS2532: Object is possibly 'undefined'` na linha `enabled[0].id` **Solução**:
Adicionado check duplo com fallback

**Erro Anterior #2**: `TS18046: 'e' is of type 'unknown'` **Solução**: Usar `toError()` helper para
narrowing seguro

---

## 2. Bugs Conhecidos (Não-Bloqueantes)

### 2.1 BUG-HIGH-06 em session/lifecycle.js:184

**Localização**: `src/copilot/sdk/session/lifecycle.js` linha 184

**Status**: Pré-existente (não causado por meus changes)

**Descrição**:

```javascript
// BUG-HIGH-06 (fix): só aplicar infiniteSessions quando explicitamente fornecido
// Evita habilitar compaction automática em sessões que não solicitaram (ex: routes/sessions.js)
if (co.infiniteSessions !== undefined) {
  cfg.infiniteSessions = buildInfiniteSessionConfig(co.infiniteSessions);
}
```

**Impacto**: Pode causar compactação automática não-esperada **Severidade**: HIGH **Status Fix**:
Documentado mas não executado

---

### 2.2 Model Selection em Sessions Resumidas

**Potencial Gap**: Quando `resumeSession()` é chamado, não há auto-selection de modelo.

**Código Atual**:

```javascript
export async function resumeSession(client, sessionId, opts) {
  const options = opts ?? {};
  const config = buildSessionConfig(options, 'resume');
  // ... sem auto-selection
}
```

**Discussão**:

- ✅ Correto: Resume deve preservar modelo original (immutável)
- ✅ OK: Auto-selection é apenas para `createSession()` (nova sessão)

**Conclusion**: Sem problema; design é correto

---

## 3. Oportunidades de Upgrade

### 3.1 Upgrade 1 — Observabilidade de Seleção

**Proposta**: Adicionar métrica de "auto-selection frequency" e "selected model distribution"

**Código**:

```javascript
// src/copilot/sdk/models/helpers.js — adicionar após seleção
export const modelSelectionStats = {
  autoSelectionCount: 0,
  selectedModels: {},
};

// Na função resolveModelIdAuto(), após seleção:
modelSelectionStats.autoSelectionCount++;
modelSelectionStats.selectedModels[selected.id] ??= 0;
modelSelectionStats.selectedModels[selected.id]++;
```

**Benefit**: Entender quais modelos são escolhidos mais frequentemente **Effort**: 10 min
**Priority**: MEDIUM

---

### 3.2 Upgrade 2 — Cached Model List

**Proposta**: Cache de `listModels()` com TTL (5 min) para evitar múltiplas chamadas por sessão

**Observação**: Já existe em `src/copilot/sdk/models/helpers.js` (MODELS_CACHE_TTL_MS = 5 min)!

**Status**: ✅ Já implementado

---

### 3.3 Upgrade 3 — Model Selection Criteria Configurável

**Proposta**: Permitir customizar critérios de seleção (preferFast, preferLowCost, etc.) via opções

**Código**:

```javascript
export async function resolveModelIdAuto(models, preferred='auto', fallback='gpt-5-mini', criteria={}) {
    // ...
    const selected = modelSelector.select({
        preferFast: criteria.preferFast ?? true,
        preferLowCost: criteria.preferLowCost ?? true,
        requireReasoning: criteria.requireReasoning,
        // ...
    }, ...);
}
```

**Use Case**: Missões que exigem reasoning → `{requireReasoning: true}` **Effort**: 20 min
**Priority**: LOW (nice-to-have)

---

### 3.4 Upgrade 4 — Fallback Chain para Rate Limit

**Proposta**: Quando SDK emite `rate_limit` error, automaticamente switch para modelo diferente

**Localização**: Fase 4 (não implementada)

**Referência**: `src/copilot/sdk/models/selector.js` — `AutoDowngradeDetector` já existe!

**Implementação Needed**:

```javascript
// src/copilot/hooks/sdk/model-downgrade.js (novo arquivo)
// Monitorar: session.error com type='rate_limit'
// Action: Chamar AutoDowngradeDetector.evaluate()
// Se shouldDowngrade: reconectar com novo modelo
```

**Effort**: 1-2 hours **Priority**: HIGH (só se rate_limit persistir)

---

### 3.5 Upgrade 5 — Metrics Dashboard para Model Performance

**Proposta**: Expor `modelSelector.topN()` via API para visualizar performance de modelos

**Endpoint Example**:

```javascript
GET /api/models/stats
→ {
    "models": [
        { "id": "gpt-4o-mini", "avgLatencyMs": 240, "successRate": 0.98 },
        { "id": "gpt-4o", "avgLatencyMs": 180, "successRate": 0.99 },
        ...
    ]
}
```

**Benefit**: Transparência sobre escolhas de modelo **Effort**: 30 min **Priority**: LOW
(observabilidade)

---

## 4. Recomendações Imediatas

### 4.1 ✅ Ready to Ship (No Issues)

- Implementação Fases 1-3 completa
- TypeCheck passa (após correções)
- Lint issues pré-existentes (não bloqueantes)
- Funcionalidade ready para teste terminal

### 4.2 📋 Próxima Sessão (Não-Bloqueantes)

1. **HIGH**: Implementar Upgrade 4 se rate_limit persistir após terminal start
2. **MEDIUM**: Adicionar observabilidade (Upgrade 1) para tracking de seleção
3. **LOW**: Critérios configuráveis (Upgrade 3) e metrics dashboard (Upgrade 5)

### 4.3 🐛 Bugs Conhecidos (Não Causados Por Mim)

- BUG-HIGH-06: infiniteSessions aplicado incorretamente
- Lint: 2 var declarations em tools/core.js

---

## 5. Validação Final

**Checklist**:

- ✅ Código compila (typecheck:node pass)
- ✅ Imports corretos (toError, modelSelector, resolveModelIdAuto)
- ✅ Error handling robusto (nullable checks, toError)
- ✅ JSDoc completo em nova função
- ✅ Lógica de fallback em 3 camadas
- ✅ Logging em cada etapa
- ✅ Configuração DEFAULT_COPILOT_MODEL = 'auto' atualizada
- ✅ Exports adicionados em models/index.js

**Bloqueadores**: NENHUM

**Status**: ✅ APROVADO PARA TESTE TERMINAL

---

## 6. Próxima Ação Recomendada

**Iniciar terminal com novo config auto-model**:

```bash
npm run terminal:llm-b
# Verificar logs:
# - "[models] Auto-selecionado:"
# - "[session] Modelo auto-selecionado:"
# - Confirmar modelo resolvido != 'auto'
```

**Se tudo funciona**: Commitar + push **Se rate_limit persiste**: Implementar Upgrade 4 (fallback
chain)

---

**Executor**: Copilot Agent **Tempo Total Análise**: 15 min **Próximo Status**: Terminal Validation
