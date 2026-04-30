# 61 — Mapeamento de desacoplamento de facades e seams internos neutros

**Data:** 2026-04-30 **Escopo:** `src/copilot/agent/facades/**` + `src/copilot/agent/runtime/**`.

---

## 1. Objetivo

Fechar uma dívida central da Faixa E: reduzir dependências cruzadas entre facades críticas,
substituindo reutilização “facade→facade” por seams internos neutros com ownership explícito.

Regra aplicada nesta onda:

> facades públicas podem continuar expondo a API canônica para bordas, mas a lógica compartilhada
> entre elas deve morar em módulos internos de domínio (runtime/sdk), não em acoplamentos diretos
> entre facades.

---

## 2. Transformações aplicadas

### 2.1 Extração de readers internos de runtime

Foram criados módulos internos neutros:

- `src/copilot/agent/runtime/status-readers.js`
- `src/copilot/agent/runtime/governance-readers.js`

Funções movidas/centralizadas:

- status/health/sdk-resource snapshot readers;
- permission mode/capability readers;
- context factory capabilities;
- tool registry e entries.

### 2.2 Facades convertidas para consumo dos módulos neutros

Refactors aplicados:

- `agent-runtime-status.js` virou façade fina (re-export) sobre `runtime/status-readers.js`;
- `agent-runtime-controls.js` passou a consumir `runtime/status-readers.js` e
  `runtime/governance-readers.js`, mantendo API pública e removendo acoplamento com
  `agent-runtime-status.js`;
- `agent-runtime-capabilities.js` deixou de importar `agent-runtime-controls.js` e
  `agent-runtime-status.js`, passando a ler diretamente dos seams internos neutros.

### 2.3 Remoção de dependências cruzadas de SDK entre facades

- `agent-model-config.js` deixou de importar `agent-runtime-status.js` e `agent-sdk-access.js`;
- `agent-session-ops.js` deixou de importar `agent-sdk-access.js` e `agent-sdk-runtime.js`;
- `agent-sdk-access.js` deixou de re-exportar de `agent-sdk-runtime.js` e passou a implementar
  localmente `canReadAgentSdkSessionMessages`/`readAgentSdkSessionMessages`.

---

## 3. Resultado factual do desacoplamento

Após a onda, o grep de imports relativos entre facades críticas retornou apenas referências de
`index.js` (barrel), sem acoplamentos operacionais entre os arquivos de façade.

Em termos arquiteturais:

- facades continuam a superfície pública estável;
- lógica compartilhada crítica ficou em módulos internos explícitos de runtime;
- o custo de evolução de cada façade caiu, pois dependências agora são semânticas por camada, não
  por arquivo público vizinho.

---

## 4. Contratos atualizados

- `tests/unit/copilot/contracts/test_facade_bypass_matrix.spec.js`
  - matriz de `allowedFacadeImports` ajustada para refletir a eliminação de imports cruzados;
  - facades críticas agora operam com `allowedFacadeImports: []` nos pontos limpos nesta onda.

- `tests/unit/copilot/contracts/test_arch_contracts.spec.js`
  - mantido verde no conjunto focado após a extração.

---

## 5. Validação executada

- `npx vitest run --config vitest.copilot.config.js`
  - `test_facade_bypass_matrix.spec.js`
  - `test_arch_contracts.spec.js`
  - `test_runtime_state_governance.spec.js`
  - `test_runtime_state_registry_inventory.spec.js`
  - **resultado:** verde.

- `npm run typecheck:strict:src.copilot`
  - **resultado:** verde.

- `eslint` focado em facades/runtime/helpers/contratos tocados
  - **resultado:** verde (sem erros de lint).

---

## 6. Leitura arquitetural consolidada

Este checkpoint fecha mais um trecho real da Faixa E:

- a matriz de facades deixa de ser apenas classificação e passa a refletir redução efetiva de
  acoplamento;
- facades públicas permanecem estáveis para bordas, mas deixam de formar uma “mini malha” de imports
  internos;
- seams internos (`agent/runtime/*`) passam a concentrar leitura compartilhada com ownership
  explícito e testável.

Próximo foco recomendado: continuar a convergência em adapters SDK/bordas para evitar reabertura de
payload ad hoc e estado vivo anônimo fora de registries explícitos (Faixa F/G residual).
