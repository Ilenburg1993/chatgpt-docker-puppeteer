# 03 — Bugs e Misalignments: SDK vs `src/copilot`

**Data**: 2026-03-21 | **Revisado**: 2026-03-21
**Status**: Versão Definitiva (pós revisão crítica)
**Referência**: 01-INVENTARIO-SDK-COMPLETO.md, 02-GAPS-FUNCIONAIS-SDK.md

---

## Classificação

| Tipo             | Definição                                                              |
| ---------------- | ---------------------------------------------------------------------- |
| **BUG**          | Código que produz resultado incorreto ou comportamento não-intencional |
| **MISALIGNMENT** | Código que funciona mas diverge do design/contrato do SDK              |
| **DEAD CODE**    | Código presente mas nunca invocado/utilizado                           |
| **DEBT**         | Workaround ou hack técnico documentado que precisa ser resolvido       |

---

## BUG-01: ~~Campo `injectHookContext` inexistente no `SessionConfig`~~ → FALSO POSITIVO

- **Tipo**: ~~MISALIGNMENT~~ → **FALSO POSITIVO** | **Severidade**: ~~BAIXO~~ → N/A
- **Localização**: `src/copilot/agent/lifecycle/session-setup.js:102`
- **Investigação**: `injectHookContext` **NÃO é um campo fantasma**. O campo é consumido legitimamente por `initializer.js:120` (`const injectContext = sessionOptions.injectHookContext !== false;`) para decidir se deve injetar hook system context (session-briefing.md + session.json) como `systemMessage.sections.guidelines`. O campo nunca é passado ao SDK — é um flag interno consumido antes de montar o `opts` que vai ao `resumeOrCreate()`. O `pickDefined()` em `initializer.js:140` não inclui `injectHookContext`.
- **Correção**: Nenhuma necessária. O código funciona como projetado.
- **Esforço**: 0

---

## BUG-02: ~~`mode: 'customize'` com `content` — semântica ambígua~~ → RECLASSIFICADO como DEBT

- **Tipo**: ~~BUG~~ → **DEBT** | **Severidade**: ~~MÉDIO~~ → BAIXO
- **Localização**: `src/copilot/sdk/session/lifecycle.js:104-109` (`buildSystemMessageConfig()`)
- **Investigação profunda**: O SDK `SystemMessageCustomizeConfig` em `types.d.ts` **aceita** o campo `content?: string`, documentado como "Additional content appended after all sections. Equivalent to append mode's content field — provided for convenience." Portanto `{ mode: 'customize', content }` é **comportamento válido e documentado** do SDK. O código original não é um bug.
- **Reclassificação**: Embora funcional, a construção manual em `lifecycle.js` duplica lógica que o builder `system-message.js` centraliza. O debt é: (1) construção manual vs builder, (2) não uso de `sections[]` para overrides granulares. Isso será resolvido pela Faixa I (System Prompt Modular), que substituirá todo este caminho por um assembler centralizado.
- **Correção**: Defer para Faixa I (System Prompt Modular). Nenhum fix imediato necessário — o código funciona corretamente.
- **Esforço**: 0 (absorvido pela Faixa I)

---

## BUG-03: ~~`buildSessionConfig` cast via `Record<string, unknown>` bypassa tipagem~~ → ✅ CORRIGIDO

- **Tipo**: ~~DEBT~~ → **CORRIGIDO** | **Severidade**: ~~MÉDIO~~ → N/A
- **Localização**: `src/copilot/sdk/session/lifecycle.js:buildSessionConfig()`
- **Correção aplicada**: Refatorado para objeto tipado `Partial<SessionConfig> & { disableResume?: boolean }`. Removidos todos os `Record<string, unknown>`, string-indexed property assignment e double-casts nas chamadas a `createSession()`/`resumeSession()`. Typedefs `SessionCreateOptions` e `SessionResumeOptions` atualizados com tipos SDK reais (`SessionConfig['hooks']`, `SessionConfig['onUserInputRequest']`, `Record<string, MCPServerConfig>`, `CustomAgentConfig[]`). Testes passam (18/18).
- **Esforço**: Realizado

---

## BUG-04: ~~Client lifecycle events implementados mas não wired~~ → RECLASSIFICADO

- **Tipo**: ~~DEAD CODE~~ → **DEBT** (refactor oportunístico) | **Severidade**: ~~ALTO~~ → BAIXO
- **Localização**: `src/copilot/sdk/session/client-events.js` (módulo wrapper tipado)
- **Descrição original**: O módulo fornece wrappers tipados para `client.on('session.created', handler)` etc.
- **Reclassificação**: Os lifecycle events **JÁ estão wired** em `src/copilot/agent/session/boot-wiring.js` (linhas 139-157), usando `client.on()` diretamente com `SESSION_LIFECYCLE_EVENTS` do barrel `#copilot/sdk`. O módulo `client-events.js` é uma abstração superior (tipada, com assertions, unsubscribe pattern), mas a funcionalidade equivalente já existe.
- **Ação futura** (DEBT): Migrar `boot-wiring.js` para usar `onLifecycleEvents()` de `client-events.js` em vez de `client.on()` direto. Não é blocker.
- **Esforço**: P (refactor de ~15 linhas)

---

## BUG-05: Experimental RPC wrappers sem exposição (19 funções orpãs)

- **Tipo**: DEAD CODE | **Severidade**: ALTO
- **Localização**: `src/copilot/sdk/rpc/experimental.js` (inteiro módulo, ~400 linhas)
- **Descrição**: O módulo exporta 19 funções para fleet, agents, skills, MCP, plugins, extensions. O barrel `sdk/index.js` re-exporta todas. Porém:
  1. **Zero tools** em `src/copilot/tools/` usam essas funções
  2. **Zero routes** em `src/copilot/server/routes/` expõem esses endpoints
  3. **Zero imports** dessa API existem fora do barrel

  São 400 linhas de código funcional mas inacessível ao usuário final.
- **Correção**: Criar tools e/ou REST routes para cada subsistema (ver GAP-C01 no doc 02).
- **Esforço**: G (criação de múltiplas tools + routes)

---

## BUG-06: ~~`reasoningEffort` sem validação de valores permitidos~~ → ✅ CORRIGIDO

- **Tipo**: ~~MISALIGNMENT~~ → **CORRIGIDO** | **Severidade**: ~~BAIXO~~ → N/A
- **Localização**: `src/copilot/sdk/session/lifecycle.js:buildSessionConfig()`
- **Correção aplicada**: `reasoningEffort` agora é validado contra `Object.values(REASONING_EFFORTS)` em `buildSessionConfig()`. Valores inválidos geram `log('WARN', ...)` antes de serem passados ao SDK. Typedef `SessionCreateOptions.reasoningEffort` atualizado para `ReasoningEffortLevel` (`'low' | 'medium' | 'high' | 'xhigh'`).
- **Esforço**: Realizado

---

## BUG-07: `session-setup.js` não passa configurações experimentais

- **Tipo**: MISALIGNMENT | **Severidade**: MÉDIO
- **Localização**: `src/copilot/agent/lifecycle/session-setup.js:buildSessionOptions()`
- **Descrição**: `buildSessionOptions()` constrói as opções de sessão mas não inclui:
  - `availableTools` / `excludedTools` (SDK filtering nativo)
  - `skillDirectories` / `disabledSkills`
  - `agent` (initial agent name)
  - `onEvent` (early event handler)
  - `clientName`
  - `configDir`

  Todas são opções válidas de `SessionConfig` que foram ignoradas.
- **Correção**: Adicionar passagem dessas opções quando disponíveis no `AgentContext` ou config.
- **Esforço**: M (múltiplos campos em session-setup + AgentContext)

---

## BUG-08: ~~`session.setModel()` vs `rpc.model.switchTo()` — possível divergência~~ → RECLASSIFICADO

- **Tipo**: ~~MISALIGNMENT~~ → **DEBT** (baixo) | **Severidade**: ~~MÉDIO~~ → BAIXO
- **Localização**: `src/copilot/sdk/rpc/session.js` e `src/copilot/sdk/rpc.js`
- **Reclassificação**: Investigação confirmou que **todos os call sites de negócio** (`session-messaging.js`, `always-alive.js`) usam `session.setModel()` via `wrapper.js`. `modelSwitchTo()` / `rpc.model.switchTo()` só existe na facade `rpc.js` como API alternativa não consumida. Não há divergência prática.
- **Ação futura** (DEBT): Documentar que a facade `rpc.model.switchTo()` é alternativa de baixo nível; `session.setModel()` deve ser preferido.
- **Esforço**: P (documentação)

---

## BUG-09: `SectionTransformFn` callbacks — suporte declarado mas não testado

- **Tipo**: DEBT | **Severidade**: BAIXO
- **Localização**: `src/copilot/sdk/session/system-message.js`
- **Descrição**: O typedef `SectionTransformFn` é importado e declarado no módulo, mas não há testes ou exemplos de uso com callbacks de transformação de seção. O build de system message via `customize` mode não usa `SectionTransformFn`.
- **Correção**: Adicionar teste de integração para `SectionTransformFn`. Documentar que é suportado.
- **Esforço**: P

---

## BUG-10: ~~`InfiniteSession` defaults divergem do SDK~~ → ✅ CORRIGIDO

- **Tipo**: ~~MISALIGNMENT~~ → **CORRIGIDO** | **Severidade**: ~~BAIXO~~ → N/A
- **Localização**: `src/copilot/sdk/session/lifecycle.js:buildInfiniteSessionConfig()`
- **Correção aplicada**: Substituído hardcoded `0.75` por `INFINITE_SESSION_DEFAULTS.BACKGROUND_COMPACTION_THRESHOLD` (0.8). Import de `INFINITE_SESSION_DEFAULTS` adicionado.
- **Esforço**: Realizado

---

## BUG-11: `catch-all.js` handler pode mascarar erros em eventos

- **Tipo**: ~~DEBT~~ → **FALSO POSITIVO** | **Severidade**: N/A
- **Localização**: `src/copilot/agent/session/event-handlers/catch-all.js`
- **Descrição original**: O catch-all handler captura TODOS os eventos para logging. Se um handler específico falhar com exceção, o catch-all continua processando normalmente — o erro do handler específico pode ser silenciado.
- **Análise**: `wireCatchAll()` registra um `session.on()` que APENAS loga eventos desconhecidos (não presentes em `KNOWN_SDK_EVENTS`). Não captura erros de outros handlers, não intercepta exceções, não mascara nada. A descrição original estava incorreta.
- **Status**: FALSO POSITIVO — nenhuma ação necessária

---

## Sumário

| Tipo               | Contagem | Severidade Alta | Severidade Média   | Severidade Baixa                          |
| ------------------ | -------- | --------------- | ------------------ | ----------------------------------------- |
| ✅ CORRIGIDO        | 3        | 0               | 1 (BUG-03)         | 2 (BUG-06, BUG-10)                        |
| FALSO POSITIVO     | 2        | 0               | 0                  | 2 (BUG-01, BUG-11)                        |
| BUG→DEBT           | 3        | 0               | 0                  | 3 (BUG-02→I, BUG-04→refactor, BUG-08→doc) |
| DEAD CODE          | 1        | 1 (BUG-05)      | 0                  | 0                                         |
| DEBT               | 2        | 0               | 1 (BUG-07 parcial) | 1 (BUG-09 teste)                          |
| **TOTAL (ativos)** | **3**    | **1**           | **1**              | **1**                                     |

**Status**: BUG-03, BUG-06, BUG-10 corrigidos (A1). BUG-07 quase completo (falta só `provider`). BUG-04, BUG-08 reclassificados DEBT. BUG-01, BUG-11 falsos positivos. BUG-09 testes adicionados. Restam 3 itens ativos.
**Ação prioritária**: BUG-05 (experimental RPC dead code) → Faixa D. BUG-07 restante (`provider` → ProviderConfig) → Faixa C.
