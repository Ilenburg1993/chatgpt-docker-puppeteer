# Auditoria Interna de Validação — `src/copilot/sdk` (14-05-2026)

> Escopo estrito: **somente `src/copilot/sdk`**
>
> Base comparativa: `DOCUMENTAÇÃO/COPILOT/AUDITORIA_EXTERNA_CLAUDE_SONNET_14-05-2026.md`
>
> SDK instalado validado: `@github/copilot-sdk@0.3.0`

---

## 1) Método aplicado

1. Leitura integral da auditoria externa (arquivo completo).
2. Inspeção direta dos arquivos citados no `src/copilot/sdk`.
3. Verificação de contrato do SDK real em `node_modules/@github/copilot-sdk/dist/generated/rpc.d.ts`
   e `types.d.ts`.
4. Execução dos gates no escopo Copilot:
   - `npm run typecheck:strict:src.copilot.sdk` ✅
   - `npx eslint src/copilot/sdk --cache ...` ✅
   - `npm run test:copilot:unit` ❌ (1 falha)

---

## 2) Resultado dos gates (escopo copilot)

### 2.1 Typecheck strict

- **Status:** passou
- Evidência: `tsc -p config/typing/strict/tsconfig.strict.src.copilot.sdk.json` sem erros.

### 2.2 Lint

- **Status:** passou
- Escopo executado: `src/copilot/sdk`.

### 2.3 Unit tests copilot

- **Status:** falhou (1 caso)
- Falha observada:
  - `tests/unit/copilot/sdk/test_sdk_experimental_f22.spec.js`
  - Expectativa: `EXPERIMENTAL_FEATURES` com 5 itens
  - Real: 8 itens (`fleet, skills, mcp, plugins, extensions, sessions, history, usage`)
- Conclusão: a suíte de teste está desalinhada com a evolução de `src/copilot/sdk/feature-flags.js`.

---

## 3) Validação da auditoria externa — ponto a ponto

Legenda:

- **Confirmado** = procede no estado atual
- **Parcial** = há fundamento, mas com ajuste de causa/escopo/prioridade
- **Não procede / desatualizado** = não se sustenta no código atual ou no contrato real do SDK 0.3.0

## 3.1 Bugs (BUG-01..17)

| ID     | Veredito                       | Observação interna                                                                                                                                                                                                                                             |
| ------ | ------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| BUG-01 | **Parcial**                    | Há problema em `ToolSessionContext.snapshot()`, mas a causa não é invalidez de `ClassName.#staticPrivate`. O problema real é semântico: `#broadcastSse` inicia com função inline e comparação com `#noopSse` pode marcar `hasBroadcastSse` de forma incorreta. |
| BUG-02 | **Confirmado**                 | `getCompactionMethod()` usa `bind` desnecessário e perde clareza/tipagem; há caminho mais seguro com closures explícitas.                                                                                                                                      |
| BUG-03 | **Não procede**                | O padrão `#startPromise` + `finally` em `#connect()` é consistente; não foi encontrada race crítica comprovável nesse ponto.                                                                                                                                   |
| BUG-04 | **Parcial**                    | `resolveSessionCreateModel()` pode confundir consumo externo, mas o próprio módulo já documenta preservação de `model='auto'` na criação de sessão.                                                                                                            |
| BUG-05 | **Confirmado**                 | Cache de modelos não deduplica requisições concorrentes em voo.                                                                                                                                                                                                |
| BUG-06 | **Parcial**                    | Existe risco de `_loadPromise` em voo interferir após reset; porém só reordenar 3 linhas não resolve integralmente sem estratégia de versão/token.                                                                                                             |
| BUG-07 | **Confirmado**                 | `content-exclusion-check` hardcoded em `session/permissions.js` (sem constante canônica).                                                                                                                                                                      |
| BUG-08 | **Confirmado**                 | `getWorkspaceRpc()` faz cast sem validar método obrigatório (`listFiles/readFile/createFile`).                                                                                                                                                                 |
| BUG-09 | **Confirmado**                 | `HookBus.emitHook()` encapsula múltiplas emissões em um único `try/catch`, podendo interromper propagação cruzada em erro de listener.                                                                                                                         |
| BUG-10 | **Confirmado**                 | `_scoreAndSort()` pode gerar `NaN` para tiers desconhecidos (`COST_ORDER[...]`/`SPEED_ORDER[...]`).                                                                                                                                                            |
| BUG-11 | **Não procede (runtime alvo)** | Em Node 24, `globalThis.crypto.randomUUID()` está disponível. É melhoria de portabilidade, não bug crítico do runtime alvo.                                                                                                                                    |
| BUG-12 | **Confirmado**                 | `quota-monitor.start()` engole erro inicial sem hook explícito de erro.                                                                                                                                                                                        |
| BUG-13 | **Confirmado**                 | `createToolRegistryAdapter()` não expõe `exclude`/`merge`, apesar de utilitários existirem no módulo.                                                                                                                                                          |
| BUG-14 | **Confirmado**                 | Verificação imediata pós-switch em `session/runtime.js` pode gerar falso-negativo de convergência (sem retry curto).                                                                                                                                           |
| BUG-15 | **Confirmado**                 | `agentDeselect()` descarta retorno potencial de `session.rpc.agent.deselect()`.                                                                                                                                                                                |
| BUG-16 | **Confirmado**                 | Mensagem de erro em `client-events.assertClient()` pode ser mais diagnóstica (estado não inicializado).                                                                                                                                                        |
| BUG-17 | **Confirmado**                 | Falta API explícita para verificar prontidão do builder em `tools/custom.js` antes de `buildCustomTools()`.                                                                                                                                                    |

## 3.2 Gaps SDK 0.3.0 (GAP-01..12)

| ID     | Veredito                     | Observação interna                                                                                                                |
| ------ | ---------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| GAP-01 | **Não procede / já coberto** | `types.js` já contempla `history` em `ExperimentalSession.rpc`.                                                                   |
| GAP-02 | **Confirmado**               | `clearModelsCache` existe em `models/index.js`, mas não é reexportado no barrel raiz `sdk/index.js`.                              |
| GAP-03 | **Não procede (SDK real)**   | `snapshot.rewind` **não existe** no RPC gerado de 0.3.0 (`generated/rpc.d.ts`).                                                   |
| GAP-04 | **Não procede (SDK real)**   | `backgroundTasks.*` não aparece no RPC gerado de 0.3.0.                                                                           |
| GAP-05 | **Não procede (SDK real)**   | Namespace `context.*` não existe no RPC gerado de 0.3.0 (há `workspaces.getWorkspace`).                                           |
| GAP-06 | **Não procede**              | `onEvent` já é carregado via `SessionConfig` do SDK; tipagem não está “unknown” no contrato efetivo.                              |
| GAP-07 | **Parcial**                  | O módulo de capabilities é minimalista (foco em elicitation). É melhoria válida expandir helpers, mas não bug de compatibilidade. |
| GAP-08 | **Não procede (SDK real)**   | Alias `getFile` não aparece no contrato RPC/FS observado; `readFile` é o método real.                                             |
| GAP-09 | **Não procede (SDK real)**   | `MCPHTTPServerConfig` de 0.3.0 não expõe campo `auth` no `types.d.ts`.                                                            |
| GAP-10 | **Não procede (SDK real)**   | Não há namespace RPC `pending.*` no contrato; há handlers `tools/commands/ui/permissions` e evento `pending_messages.modified`.   |
| GAP-11 | **Não procede (SDK real)**   | Não há namespace RPC `subagent.*` no contrato 0.3.0 (apenas eventos `subagent.*`).                                                |
| GAP-12 | **Confirmado**               | `ClientOptionsBuilder` não tem método explícito para `sessionStatePath` (apenas `merge`).                                         |

## 3.3 Duplicidades e ambiguidades (DUP-01..09)

| ID     | Veredito       | Observação interna                                                                                                                                           |
| ------ | -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| DUP-01 | **Parcial**    | Duplicidade funcional (`getSessionCapabilities`) existe em módulos, mas o barrel já privilegia `capabilities.js` e evita export duplicado direto de `ui.js`. |
| DUP-02 | **Confirmado** | Guards (`assertSession/assertClient/assertRpcSession`) estão espalhados com variações.                                                                       |
| DUP-03 | **Confirmado** | `SessionCreateOptions` e `SessionResumeOptions` repetem grande bloco comum em `lifecycle.js`.                                                                |
| DUP-04 | **Confirmado** | `AgentInfo` repetido em `agent/agents.js`, `rpc/ops.js`, `rpc/session-facade.js`.                                                                            |
| DUP-05 | **Confirmado** | Tipos de compaction duplicados (`CompactionResult` x `CompactionCompactResult`).                                                                             |
| DUP-06 | **Confirmado** | `rpc/server.js` mantém `ModelInfo` local duplicando shape já centralizável via `types.js`.                                                                   |
| DUP-07 | **Confirmado** | Utilitários `stringOr/objectOr*/tsOrNow` repetidos em múltiplos normalizadores de evento.                                                                    |
| DUP-08 | **Confirmado** | Reexport de `log` em `session/index.js` pode conflitar semanticamente com logger principal.                                                                  |
| DUP-09 | **Confirmado** | `resolveSessionAutoModelFromCatalog()` é wrapper trivial sobre factory+invoke.                                                                               |

## 3.4 Typecheck strict (TC-01..05)

| ID    | Veredito                           | Observação interna                                                                                                        |
| ----- | ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| TC-01 | **Não procede como erro atual**    | Em JS/JSDoc, Promise rejeitada não vira “erro de tipo formal” nesse formato; não falhou no strict gate atual.             |
| TC-02 | **Não confirmado no estado atual** | Sem evidência de falha no gate strict vigente para esse ponto específico.                                                 |
| TC-03 | **Não confirmado no estado atual** | O gate strict de `src.copilot.sdk` passou; item não reproduzido como erro ativo.                                          |
| TC-04 | **Parcial**                        | Há cast final de `buildSessionConfig` que mascara `disableResume` fora do tipo puro do SDK; melhoria de clareza é válida. |
| TC-05 | **Parcial (estilo/ergonomia)**     | Muitos casts em `known-models.js`; melhoria de manutenção, sem quebra atual de strict gate.                               |

## 3.5 Arquitetura/experimental/performance/robustez

| ID      | Veredito                       | Observação interna                                                                                                    |
| ------- | ------------------------------ | --------------------------------------------------------------------------------------------------------------------- |
| ARQ-01  | **Confirmado**                 | Wrappers RPC não aceitam `AbortSignal` padrão para chamadas longas.                                                   |
| ARQ-02  | **Confirmado**                 | `defaultClientManager` instanciado no import (eager singleton).                                                       |
| ARQ-03  | **Confirmado**                 | Barrel raiz define wrappers triviais para `createTool/createToolSync` (acoplamento desnecessário).                    |
| ARQ-04  | **Parcial**                    | `persistent-paths.js` depende de `#copilot/boot`; risco de custo de import existe, precisa medição antes de redesign. |
| ARQ-05  | **Confirmado**                 | `SDK_LAYER_ACCESS_POLICY` é informativo; enforcement automatizado ausente.                                            |
| ARQ-06  | **Confirmado**                 | Duplicidade de IDs canônicos `claude-*-4-5` e `claude-*.4.5` em `known-models.js`.                                    |
| ARQ-07  | **Confirmado**                 | Telemetria usa emitter singleton único (sem fan-out nativo).                                                          |
| ARQ-08  | **Confirmado**                 | Retry por operação RPC individual não está padronizado (retry concentrado em conexão/lifecycle).                      |
| EXP-01  | **Parcial**                    | Observação documental útil; não é bug funcional.                                                                      |
| EXP-02  | **Não procede (SDK real)**     | `fleetStop/fleetStatus` não aparecem no contrato RPC 0.3.0.                                                           |
| EXP-03  | **Não procede (SDK real)**     | `skills.get` não aparece no contrato RPC 0.3.0.                                                                       |
| EXP-04  | **Não procede (SDK real)**     | `extensions.getStatus/getLogs` não aparecem no contrato RPC 0.3.0.                                                    |
| EXP-05  | **Não procede (SDK real)**     | `plugins.install/uninstall` não aparecem no contrato RPC 0.3.0.                                                       |
| PERF-01 | **Confirmado**                 | `session-fs.resolveWithinRoot()` valida política async por operação; pode gerar overhead em loops intensos.           |
| PERF-02 | **Confirmado**                 | `ensureCustomToolsLoadedSync()` bloqueia event-loop quando acionado no hot path.                                      |
| PERF-03 | **Confirmado (baixo impacto)** | `ModelRegistry.all()` gera array novo a cada chamada.                                                                 |
| ROB-01  | **Confirmado**                 | `reconnectClientBestEffort()` sem timeout explícito.                                                                  |

---

## 4) Situação atual vs situação ideal

## 4.1 Situação atual (resumo executivo)

- Base `sdk` está funcional e com boa organização por superfície.
- Parte relevante da auditoria externa procede, mas **há itens desatualizados** por drift do código
  e por inferências não suportadas pelo contrato real do SDK 0.3.0.
- O maior risco imediato hoje está em:
  1. Robustez/confiabilidade de wrappers (`HookBus`, `workspace RPC guards`, `compaction method`,
     `model selector tiers`)
  2. Consistência API pública (barrel incompleto, adapters incompletos)
  3. Débito de duplicidade tipada/documental
- Gate de testes revela desalinhamento entre implementação e expectativa antiga em feature flags
  experimentais.

## 4.2 Situação ideal alvo

- SDK wrapper **estritamente alinhado** ao contrato efetivo de `@github/copilot-sdk@0.3.0`.
- API pública coesa (barrels completos, sem wrappers triviais desnecessários, sem duplicidades de
  typedef).
- Operações RPC críticas com:
  - cancelamento cooperativo (`AbortSignal`) onde aplicável,
  - retries e timeouts consistentes,
  - validação defensiva de namespaces/métodos.
- Testes unitários copilot 100% verdes com expectativas atualizadas para a superfície experimental
  vigente.

---

## 5) Itens extras encontrados nesta auditoria interna

1. **Desalinhamento teste x implementação em feature flags**
   - Código usa 8 flags experimentais; teste ainda espera 5.
2. **Drift entre auditoria externa e SDK real**
   - Diversos GAPs/EXPs citados não existem no contrato real de RPC do SDK 0.3.0.
3. **Oportunidade de “contrato de compatibilidade” automatizado**
   - Falta checagem automatizada (CI) para detectar divergência entre wrappers locais e
     `generated/rpc.d.ts`.

---

## 6) Roadmap proposto (fases e subfases)

## Fase 0 — Baseline e alinhamento de contrato (curta, obrigatória)

### Subfase 0.1 — Congelar baseline

- Registrar versão alvo (`@github/copilot-sdk@0.3.0`) e hash de referência da auditoria.
- Criar checklist de compatibilidade wrapper ↔ contrato RPC.

### Subfase 0.2 — Corrigir expectativa de testes

- Atualizar `test_sdk_experimental_f22.spec.js` para 8 flags (ou ajustar implementação se decisão
  arquitetural for voltar para 5).
- Reexecutar `npm run test:copilot:unit`.

## Fase 1 — Correções de robustez prioritária (bugs confirmados)

### Subfase 1.1 — Runtime correctness

- BUG-02, BUG-08, BUG-09, BUG-10, BUG-15.

### Subfase 1.2 — Segurança e UX operacional

- BUG-07, BUG-12, BUG-16, BUG-17.

### Subfase 1.3 — Concorrência/cache

- BUG-05 + hardening de reset em `tools/custom.js` (BUG-06 parcial).

## Fase 2 — Coesão de API pública e compatibilidade

### Subfase 2.1 — Barrels e builders

- GAP-02 (`clearModelsCache` no root barrel).
- GAP-12 (`sessionStatePath` explícito em `ClientOptionsBuilder`).

### Subfase 2.2 — Adapter completeness

- Completar `createToolRegistryAdapter` com `exclude`/`merge`.

### Subfase 2.3 — Helpers de capabilities

- Expandir `session/capabilities.js` para helpers coerentes com superfície disponível (sem inventar
  RPC inexistente).

## Fase 3 — Redução de duplicidade estrutural

### Subfase 3.1 — Tipos centrais

- Centralizar `AgentInfo`, `CompactionResult`, `ModelInfo` local.

### Subfase 3.2 — Guards e normalizadores

- Consolidar asserts de sessão/client/rpc.
- Extrair `event-normalize-utils.js`.

### Subfase 3.3 — Limpeza de API

- Rever reexport ambíguo de `log` em `session/index.js`.
- Simplificar adapters triviais (ex.: `session-resolution-adapter`).

## Fase 4 — Arquitetura e resiliência operacional

### Subfase 4.1 — Cancelamento e timeout

- Introduzir padrão `AbortSignal` + timeout nas operações longas.

### Subfase 4.2 — Retry policy por operação

- Estruturar política central reutilizável para wrappers RPC.

### Subfase 4.3 — Performance defensiva

- Cache curto para validação de policy em `session-fs`.
- Revisar carregamento síncrono de custom tools.

## Fase 5 — Governança contínua

### Subfase 5.1 — Auditoria automatizada de imports/políticas

- Implementar verificador executável para `SDK_LAYER_ACCESS_POLICY`.

### Subfase 5.2 — Contrato wrapper ↔ SDK

- Adicionar teste/auditoria que falha CI quando wrappers locais divergem do `generated/rpc.d.ts`.

---

## 7) Plano de execução recomendado para o próximo ciclo (imediato)

1. Corrigir a falha atual da suíte (`feature-flags` vs teste).
2. Aplicar lote de correções críticas confirmadas (Fase 1).
3. Reexecutar gates no escopo:
   - `npm run typecheck:strict:src.copilot.sdk`
   - `npx eslint src/copilot/sdk`
   - `npm run test:copilot:unit`
4. Só então avançar para Fase 2+.

---

## 8) Conclusão

A auditoria externa foi útil e capturou diversos pontos reais; porém parte relevante está
desatualizada frente ao estado atual do código e ao contrato efetivo do SDK 0.3.0. A estratégia
correta agora é:

- preservar o que foi confirmado,
- descartar o que não se sustenta no contrato real,
- executar o roadmap faseado acima para entrar no próximo ciclo de hardening com baixo risco e alta
  rastreabilidade.
