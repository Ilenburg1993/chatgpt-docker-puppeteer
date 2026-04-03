# models.js — Auditoria

**Módulo**: `src/copilot/lib/` **Arquivo**: `models.js` **LOC**: 253 | **Score**: 9.0/10

## Responsabilidade

Listagem, filtragem, caching (5min TTL) e configuração de modelos SDK. Funções: `listModels`,
`clearModelsCache`, `filterEnabledModels`, `filterReasoningModels`, `filterVisionModels`,
`pickModel`, `resolveModelId`, `buildReasoningConfig`, `supportsReasoning`,
`getSupportedReasoningEfforts`, `getModelById`, `indexModelsById`, `getContextWindowSize`.

## Achados

### C13-M01 — P5

**`_modelsCache` module-level: isolamento entre testes**

Cache em variável de módulo não é resetado entre test runs. `clearModelsCache()` existe mas não é
chamada automaticamente. Testes que verificam modelos podem receber dados de cache de testes
anteriores.

### C13-M02 — P5

**`buildReasoningConfig` edge case: `supported.length === 0` silencioso**

```js
if (supported.length > 0 && !supported.includes(effort)) {
  throw new Error(`Reasoning effort '${effort}' not supported...`);
}
// Se supported.length === 0: effort é passado sem throw → pode ser inválido
```

Se o campo `supportedReasoningEfforts` retornado pelo SDK está vazio (bug ou modelo ambíguo),
`effort` é enviado ao cliente sem validação.

## Destaques Positivos

- Cache auto-invalidado em caso de erro (`_modelsCache = null` no catch)
- `filterEnabledModels`: semanticamente correto — inclui modelos sem política (`!m.policy`)
- `resolveModelId` tem fallback `'gpt-4.1'` documentado como default confiável
- `pickModel` suporta `enabledOnly: true` por default — safe default

---

_Gerado automaticamente pelo COPILOT-FULL-AUDIT MF-II._
