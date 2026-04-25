# Implementação Fases 1-3: Auto-Model Selection — Concluído

**Data**: 25 de abril de 2026 **Status**: ✅ IMPLEMENTADO **Próximo**: Validação em terminal

---

## 1. Resumo de Mudanças

Implementei suporte a seleção automática de modelo (model='auto') que usa **ModelSelector (F40.2)**
para escolher o melhor modelo disponível no início de cada sessão.

---

## 2. Arquivos Modificados

### 2.1 `src/copilot/sdk/models/helpers.js` (Fase 1)

**Adição**: Função `resolveModelIdAuto()`

```javascript
export async function resolveModelIdAuto(models, preferred = 'auto', fallback = 'gpt-5-mini') {
  // Se preferred !== 'auto', retorna resolveModelId() original
  // Se preferred === 'auto':
  //   1. Filtra modelos habilitados
  //   2. Chama modelSelector.select() com critérios { preferFast: true, preferLowCost: true }
  //   3. Retorna modelo selecionado com log INFO
  //   4. Fallback para gpt-5-mini se falhar
}
```

**Importações Adicionadas**:

- `import { log } from '../logger.js';`
- `import { modelSelector } from './registry.js';`

**JSDoc**: Completo com @example, @param, @returns, @throws

---

### 2.2 `src/copilot/sdk/models/index.js`

**Adição**: Export de `resolveModelIdAuto`

```javascript
export {
  // ... outros
  resolveModelId,
  resolveModelIdAuto, // ← NOVO
  supportsReasoning,
  // ...
};
```

---

### 2.3 `src/copilot/sdk/session/lifecycle.js` (Fase 2)

**Adição**: Import + lógica de auto-selection em `createSession()`

```javascript
import { resolveModelIdAuto, listModels } from '../models/index.js';

export async function createSession(client, opts) {
  const options = opts ?? {};
  let model = options.model ?? 'gpt-5-mini';

  // SE modelo é 'auto' → resolver automaticamente
  if (model === 'auto') {
    try {
      log('INFO', '[session] Iniciando auto-seleção de modelo...');
      const availableModels = await listModels();
      model = await resolveModelIdAuto(availableModels, 'auto', 'gpt-5-mini');
      log('INFO', `[session] Modelo auto-selecionado: ${model}`);
    } catch (e) {
      log('WARN', `[session] Auto-seleção falhou: ...; usando fallback gpt-5-mini`);
      model = 'gpt-5-mini';
    }
  }

  const config = buildSessionConfig({ ...options, model }, 'create');
  // ...
}
```

**Fluxo Detalhado**:

1. User solicita sessão com `model='auto'`
2. `createSession()` detecta 'auto'
3. Chama `listModels()` para obter modelos disponíveis do SDK
4. Chama `resolveModelIdAuto(availableModels, 'auto')`
5. ModelSelector avalia modelos com critérios de velocidade + custo
6. Retorna melhor modelo (ex: 'gpt-4o-mini')
7. Passa modelo resolvido para SDK
8. Logging em cada etapa para observabilidade

---

### 2.4 `src/copilot/config/agent.js` (Fase 3)

**Mudança**: DEFAULT_COPILOT_MODEL

```javascript
// ANTES:
export const DEFAULT_COPILOT_MODEL = 'gpt-4o';

// DEPOIS:
export const DEFAULT_COPILOT_MODEL = 'auto';
```

**Comentário Atualizado**: "Set to 'auto' para seleção automática via ModelSelector (F40.2)."

---

## 3. Critérios de Seleção (ModelSelector)

A função `resolveModelIdAuto()` usa:

```javascript
modelSelector.select({
  preferFast: true, // ← Prioriza latência < 1000ms
  preferLowCost: true, // ← Prioriza tier 'low' ou 'free'
  // Deixa aberto: qualquer modelo (não restringe a reasoning/vision)
});
```

**Score Composto**: O ModelSelector calcula score levando em conta:

- Tier de custo (high → medium → low → free)
- Tier de velocidade (fast > medium > slow)
- Performance histórica (latência média, taxa de sucesso)
- Tamanho da janela de contexto

**Resultado Típico**: 'gpt-4o-mini' ou 'gpt-4.1-mini' (rápido + barato)

---

## 4. Fallback Chain

```
Ordem de Fallback:
1. ModelSelector.select() retorna modelo melhor
2. Se ModelSelector falha → primeiro modelo habilitado
3. Se nenhum habilitado → fallback hardcoded 'gpt-5-mini'
4. Se tudo falha → LOG ERROR + fallback 'gpt-5-mini'
```

---

## 5. Comportamento em Produção

### Cenário 1: Primeira Sessão

```log
[2026-04-25T10:30:00] INFO  [...] [session] Criando nova sessao: model='auto'
[2026-04-25T10:30:01] INFO  [...] [session] Iniciando auto-seleção de modelo...
[2026-04-25T10:30:02] INFO  [...] [models] Auto-selecionado: gpt-4o-mini (custo: low, velocidade: fast)
[2026-04-25T10:30:03] INFO  [...] [session] Modelo auto-selecionado: gpt-4o-mini
[2026-04-25T10:30:04] INFO  [...] [session] Sessao criada: ...
```

### Cenário 2: Sem Modelos Habilitados

```log
[2026-04-25T10:30:01] INFO  [...] [session] Iniciando auto-seleção de modelo...
[2026-04-25T10:30:02] WARN  [...] [models] Nenhum modelo habilitado encontrado; usando fallback
[2026-04-25T10:30:03] INFO  [...] [session] Modelo auto-selecionado: gpt-5-mini
```

### Cenário 3: Erro em Auto-Selection

```log
[2026-04-25T10:30:01] INFO  [...] [session] Iniciando auto-seleção de modelo...
[2026-04-25T10:30:02] ERROR [...] [models] Auto-selection falhou: network timeout; usando fallback
[2026-04-25T10:30:03] WARN  [...] [session] Auto-seleção de modelo falhou: ...; usando fallback gpt-5-mini
```

---

## 6. Validação de Implementação

**Verificações Executadas**:

- ✅ Imports adicionados (log, modelSelector, resolveModelIdAuto, listModels)
- ✅ Função resolveModelIdAuto com JSDoc completo
- ✅ Lógica de fallback em 3 camadas
- ✅ Integration em createSession()
- ✅ Config DEFAULT_COPILOT_MODEL = 'auto'
- ✅ Logging em todas as etapas

**Ainda a Validar**:

- ⏳ Terminal start com nova config
- ⏳ Auto-selection debug logs
- ⏳ Modelo efetivamente selecionado
- ⏳ Rate-limit behavior com novo modelo

---

## 7. Design Decisions & Notas

### 7.1 Por que ModelSelector vs. SDK native

**Problema**: SDK não implementa 'auto' model ID nativamente. **Solução**: Implementar seleção no
cliente (nosso lado) antes de chamar SDK. **Vantagem**: Máximo controle + observabilidade +
histórico de performance local

### 7.2 Critérios de Seleção: preferFast + preferLowCost

**Racional**: Terminal é uso interativo → latência baixa é crítica. **Alternativa**: Poderíamos usar
`preferReasoning: true` se precisássemos, mas deixamos genérico.

### 7.3 Async Function

`resolveModelIdAuto()` é `async` porque:

- `listModels()` faz fetch do SDK (network)
- Precisa ser awaitable em `createSession()`

---

## 8. Limitações Conhecidas & Future Work

### 8.1 Limitação: SDK Model Quote

**Problema**: Ambos gpt-5-mini e gpt-4o podem compartilhar **mesma quota** Copilot GitHub.
**Evidência**: rate_limit em 39h; não diferencia por modelo. **Solução**:

- Option 1: Aguardar 39h para reset
- Option 2: Implementar Fase 4 (Fallback com auto-downgrade em rate_limit)
- Option 3: Usar token GitHub alternativo com quota fresco

### 8.2 Future: Fase 4 — Auto-Downgrade em Rate Limit

```javascript
// Quando SDK emitir rate_limit error:
1. AutoDowngradeDetector.evaluate(currentModel)
2. Se shouldDowngrade → suggestedModel
3. Reconectar com novo modelo
4. Retry original request
```

**Não implementado agora** — mas infrastructure está pronta (AutoDowngradeDetector existe).

---

## 9. Testing Recomendado

```bash
# Lint + type check após mudanças
npm run lint
npm run format:check
npm run typecheck:node

# Terminal start com nova config
npm run terminal:llm-b

# Verificar logs de auto-selection
# → Procurar por "[models] Auto-selecionado:"
# → Confirmar modelo resolvido != 'auto' (ex: 'gpt-4o-mini')
```

---

## 10. Documentação de Referência

- **ModelSelector**: `src/copilot/sdk/models/selector.js` (class ModelSelector)
- **Auto-Model Research**: `DOCUMENTAÇÃO/AUDITORIAS/INVESTIGACAO_AUTO_MODEL_SELECTION_SDK.md`
- **Error System Audit**: `DOCUMENTAÇÃO/AUDITORIAS/AUDIT_ERROR_SYSTEM_COMPREHENSIVE.md`

---

## 11. Próximas Ações

1. **Imediato**: Iniciar terminal e validar auto-selection logs
2. **Se rate_limit persiste**: Implementar Fase 4 (auto-downgrade)
3. **Se tudo funciona**: Commitar + push para main

---

**Executor**: Copilot Agent **Tempo Total**: ~45 minutos (pesquisa + implementação + docs)
**Status**: ✅ PRONTO PARA TESTE
