# Auditoria Técnica — `src/copilot/sdk/` Wrapper Layer

**Data:** 2026-04-28 **SDK Auditado:** `@github/copilot-sdk` (Public Preview — Node.js/TypeScript)
**Referência oficial:** `github/copilot-sdk/nodejs/README.md` + npm package docs **Escopo:** Gaps de
cobertura de API, erros de contrato, vícios arquiteturais, débito técnico, segurança e roadmap para
Estado da Arte

---

## Sumário Executivo

O wrapper `src/copilot/sdk/` é uma obra de engenharia considerável — ~40 arquivos, ~120 exports
públicos, cobertura de telemetria, circuit breaker, DI, feature flags e model selection. Contudo, a
comparação sistemática com o SDK oficial revela **36 gaps e vulnerabilidades** distribuídos em cinco
categorias: **API não coberta**, **contratos de tipo incorretos**, **vícios arquiteturais**,
**segurança/robustez** e **débito de manutenção**. A arquitetura atual tem fundações sólidas mas
precisa de uma refatoração estrutural para atingir o Estado da Arte.

> **Status de validação factual (2026-04-29):** esta auditoria foi revalidada contra o código atual
> e contra o pacote realmente instalado em `node_modules/@github/copilot-sdk`. Parte importante dos
> achados originais já foi resolvida; alguns itens eram verdadeiros à época, mas hoje são **falsos
> positivos históricos**; e um subconjunto permanece como **dívida arquitetural real**.

### 0.1 Matriz factual resumida de validação

| Grupo                                                | Situação atual                            | Observações                                                                                                      |
| ---------------------------------------------------- | ----------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `onElicitationRequest`                               | ✅ Resolvido                              | `SessionCreateOptions`/`SessionResumeOptions` + `buildSessionConfig()` já cobrem o campo                         |
| `commands` em `SessionConfig`                        | ✅ Resolvido                              | Create/resume já propagam `commands`                                                                             |
| `modelCapabilities`                                  | ✅ Resolvido                              | Create/resume já propagam override                                                                               |
| Attachment helpers                                   | ✅ Resolvido                              | Existem `blobAttachment`, `fileAttachment` e aliases `createBlobAttachment`, `createFileAttachment`              |
| `watchCapabilities` / `waitForElicitationCapability` | ✅ Resolvido                              | Implementados em `sdk/session/capabilities.js`                                                                   |
| `capabilities.changed` em `SESSION_EVENTS`           | ✅ Resolvido                              | Constante canônica já adicionada                                                                                 |
| `withSession()` / resource management                | ✅ Resolvido                              | Implementado em `session/client-facade.js`                                                                       |
| `custom.js` top-level await                          | ✅ Resolvido                              | Substituído por `initCustomTools()` / carregamento explícito                                                     |
| `httpRequest` com HTTPS                              | ✅ Resolvido                              | Suporte a `http:` e `https:`                                                                                     |
| `env_read` expondo `HOME`/`PATH`                     | ✅ Resolvido                              | Removidos da allowlist                                                                                           |
| `math_eval` sem limite/regex frágil                  | ✅ Resolvido                              | Limite de tamanho + regex endurecida                                                                             |
| `clearModelsCache()` após stop                       | ✅ Resolvido                              | `stopClient()` e `forceStopClient()` já limpam cache                                                             |
| `PermissionRequestResult` kinds                      | ✅ Validado como falso positivo histórico | O SDK instalado usa `approve-once/reject` para o handler; `approved/denied-*` pertencem a `permission.completed` |
| `buildSessionConfig` deprecada sem substituto        | ✅ Falso positivo histórico               | `src/copilot/config/session-config.js` existe e expõe `SessionConfigBuilder`                                     |
| `known-models` incompleto para Claude 4.5            | 🟡 Parcialmente resolvido                 | `claude-sonnet-4-5` já existia; `claude-opus-4-5` e `claude-haiku-4-5` adicionados nesta rodada                  |
| `ExperimentalRpcNamespace` permissivo                | 🟡 Parcialmente resolvido                 | Tipagem endurecida para `Promise<unknown>` + métodos opcionais; wrappers ainda usam casts                        |
| Singleton `_client`                                  | 🔶 Aberto                                 | Dívida arquitetural real; ainda singleton                                                                        |
| `ModelRegistry`/`ModelSelector` singleton            | 🔶 Aberto                                 | Dívida arquitetural real                                                                                         |
| acoplamento `lifecycle -> models`                    | 🔶 Aberto                                 | Ainda existe em `createSession()` para resolver `model='auto'`                                                   |
| `buildCustomTools()` via module var                  | 🔶 Aberto                                 | Ainda depende de `setCustomToolsBuilder()`                                                                       |
| DI container real                                    | 🔶 Aberto                                 | Continua parcial/por variáveis de módulo                                                                         |

---

## Índice

1. [Gaps de API — Funcionalidades Não Ofertadas](#1-gaps-de-api)
2. [Erros de Contrato de Tipo](#2-erros-de-contrato-de-tipo)
3. [Vícios Arquiteturais](#3-vícios-arquiteturais)
4. [Segurança e Robustez](#4-segurança-e-robustez)
5. [Débito de Manutenção](#5-débito-de-manutenção)
6. [Matriz de Severidade](#6-matriz-de-severidade)
7. [Nova Arquitetura Proposta](#7-nova-arquitetura-proposta)
8. [Roadmap para Estado da Arte](#8-roadmap)

---

## 1. Gaps de API

### 1.1 `onElicitationRequest` ausente em `SessionCreateOptions` e `SessionResumeOptions` 🔴 CRÍTICO

**Localização:** `session/lifecycle.js` — `SessionCreateOptions` typedef (linha ~75) e
`buildSessionConfig()` (linha ~200)

O SDK oficial expõe `onElicitationRequest?: ElicitationHandler` como campo de primeira classe em
`createSession()`. Quando fornecido, o SDK envia `requestElicitation: true` no payload de
create/resume, ativando `session.capabilities.ui.elicitation` e roteando eventos
`elicitation.requested` para o handler do cliente.

**Problema:** O typedef `SessionCreateOptions` e `buildSessionConfig()` no `lifecycle.js` **não
incluem `onElicitationRequest`**. Isso impede completamente que o projeto se registre como
_elicitation provider_ — um dos casos de uso centrais do SDK para UI interativa em sessões
multi-cliente.

O `session/ui.js` tem wrappers para _consumir_ elicitation (via `session.ui.*`), mas isso é distinto
de _fornecer_ o handler que permite à sessão advertir a capability.

**Correção necessária:**

```js
// SessionCreateOptions — adicionar:
/**
 * @property {import('@github/copilot-sdk').ElicitationHandler} [onElicitationRequest] Handler de elicitation. Quando
 *   fornecido, registra este cliente como elicitation provider. Habilita session.capabilities.ui.elicitation = true.
 */

// buildSessionConfig() — adicionar no branch 'create' e 'resume':
if (co.onElicitationRequest !== undefined) cfg.onElicitationRequest = co.onElicitationRequest;
```

---

### 1.2 `commands` ausente em `SessionCreateOptions` 🔴 CRÍTICO

**Localização:** `session/lifecycle.js`

O SDK suporta `commands?: CommandDefinition[]` em `SessionConfig`. Permite registrar slash commands
(`/deploy`, `/review`) roteáveis pelo TUI. O typedef `CommandDefinition` **existe** em `types.js`,
mas o campo nunca é passado pelo `buildSessionConfig()` e não está em `SessionCreateOptions`.

**Impacto:** Nenhum consumidor do wrapper pode registrar slash commands sem bypassar a camada SDK e
usar o SDK diretamente — violando o princípio arquitetural do próprio `README.md`.

---

### 1.3 Blob Attachments sem helper dedicado 🟡 MÉDIO

**Localização:** `session/wrapper.js` — `sendSession()` / `sendSessionAndWait()`

O SDK suporta:

```js
await session.send({
  prompt: 'Analise este screenshot',
  attachments: [{ type: 'blob', data: base64Data, mimeType: 'image/png' }],
});
```

O `MessageOptions` passa por inteiro para o SDK (correto), mas não há:

1. Nenhuma função helper `createBlobAttachment(base64, mimeType)`
2. Nenhuma função helper `createFileAttachment(path, displayName?)`
3. Documentação nos wrappers `sendSession`/`sendSessionAndWait` sobre o campo `attachments`

Consumidores precisam conhecer a interface do SDK bruto para usar attachments.

---

### 1.4 `modelCapabilities` override ausente 🟡 MÉDIO

**Localização:** `session/lifecycle.js`

O SDK suporta `modelCapabilities?: ModelCapabilitiesOverride` em `SessionConfig` para sobrescrever
capabilities do modelo em runtime. Não mapeado em `SessionCreateOptions`.

---

### 1.5 `Symbol.asyncDispose` não documentado como padrão idiomático 🟢 BAIXO

**Localização:** `session/wrapper.js`

O SDK suporta `await using session = await client.createSession(...)` (TC39 Explicit Resource
Management). O wrapper tem `disposeSession()` que chama `session[Symbol.asyncDispose]()`, mas:

1. Não há JSDoc mostrando o padrão `await using`
2. `quickSession()` e `quickResume()` em `client-facade.js` não retornam um objeto com
   `Symbol.asyncDispose`
3. Nenhum helper `withSession(opts, fn)` que execute o padrão de resource management automaticamente

---

### 1.6 `capabilities.changed` event ausente em `SESSION_EVENTS` 🟡 MÉDIO

**Localização:** `constants.js` — `SESSION_EVENTS`

O SDK emite `capabilities.changed` quando elicitation providers se conectam/desconectam. O evento
não está no mapa `SESSION_EVENTS`, tornando impossível usar a constante para subscrevê-lo de forma
type-safe. O `sdk/session/ui.js` menciona que capabilities atualizam automaticamente, mas não há
hook reativo exposto.

---

### 1.7 `session.capabilities` — ausência de listener reativo 🟡 MÉDIO

**Localização:** `session/ui.js`

O SDK atualiza `session.capabilities` automaticamente via eventos `capabilities.changed`. Não há
utilitário no wrapper para:

- Observar mudanças reativas em capabilities
- Aguardar que elicitation se torne disponível (`waitForElicitationCapability(session, timeoutMs)`)

---

### 1.8 `SectionTransformFn` sem utilitário exposto 🟢 BAIXO

**Localização:** `session/system-message.js`

O SDK suporta `action: SectionTransformFn` em `SectionOverride`, onde a ação é uma função
`(currentContent: string) => string | Promise<string>`. O `sectionOverride()` aceita
`SectionOverrideAction` no tipo mas não tem exemplo ou helper para o caso de função de transformação
dinâmica.

---

### 1.9 `client.getState()` nunca retorna `'not_started'` na vida real 🟢 BAIXO

**Localização:** `session/client.js` — `getClientState()`

Retorna `'not_started'` quando `_client === null`. O tipo `ConnectionState` do SDK não inclui
`'not_started'`. A função retorna `ConnectionState | 'not_started'` mas o tipo de retorno declarado
não reflete isso — potencial incompatibilidade de tipo em consumidores que esperam
`ConnectionState`.

---

### 1.10 `session.log` RPC — ausência de wrapper de alto nível 🟢 BAIXO

**Localização:** `rpc/session.js` — `sessionLog()`

Existe e está correto, mas `session.log` não está exposto via `createSessionRpcFacade` com tipagem
completa dos níveis. O `LogResult` está mapeado como `{ eventId: string }` no `rpc.js` mas como
`{ logId?: string }` no `types.js` — inconsistência.

---

## 2. Erros de Contrato de Tipo

### 2.1 `PermissionRequestResult` kinds desatualizados 🔴 CRÍTICO

**Localização:** `session/permissions.js` — funções `approved()` e `denied()`

```js
// CÓDIGO ATUAL — INCORRETO:
function approved() {
  return { kind: 'approve-once' };
}
function denied() {
  return { kind: 'reject' };
}
```

O SDK oficial (Public Preview) documenta os seguintes `kind` válidos:

| Kind (SDK oficial)                                          | Significado                         |
| ----------------------------------------------------------- | ----------------------------------- |
| `"approved"`                                                | Aprovar a tool                      |
| `"denied-interactively-by-user"`                            | Usuário negou explicitamente        |
| `"denied-no-approval-rule-and-could-not-request-from-user"` | Sem regra de aprovação              |
| `"denied-by-rules"`                                         | Negado por política                 |
| `"denied-by-content-exclusion-policy"`                      | Exclusão de conteúdo                |
| `"no-result"`                                               | Sem resultado (apenas protocolo v1) |

Os valores `'approve-once'` e `'reject'` são de uma versão anterior do SDK. Se o CLI estiver em
protocolo v2, o handler atual pode estar gerando respostas inválidas silenciosamente.

**Impacto:** TODAS as decisões de permissão do projeto estão potencialmente incorretas em runtime.
Isso é o bug mais crítico encontrado.

---

### 2.2 `LogResult` inconsistente entre módulos 🟡 MÉDIO

**Localização:** `rpc.js` vs `types.js`

- Em `rpc.js`: `@typedef {{ eventId: string }} LogResult`
- Em `types.js`: `@typedef {{ logId?: string; [k: string]: unknown }} LogResult`

Dois typedefs com nomes iguais e shapes diferentes para o mesmo conceito. O `rpc/session.js` usa
`@typedef {{ eventId: string }} LogResult` internamente.

---

### 2.3 `SessionCreateOptions.gitHubToken` vs `CopilotClientOptions.githubToken` 🟡 MÉDIO

**Localização:** `session/lifecycle.js` vs `session/client-options.js`

- `SessionCreateOptions` usa `gitHubToken` (camelCase com H maiúsculo)
- `CopilotClientOptions` usa `gitHubToken` (OK)
- `ClientOptionsBuilder.githubToken()` usa `gitHubToken` internamente mas o método se chama
  `githubToken` (inconsistência na API pública)

---

### 2.4 `ModeGetResult` e `ModeSetResult` com tipos redundantes 🟢 BAIXO

**Localização:** `rpc/session.js` vs `rpc.js`

```js
// rpc/session.js:
@typedef {{ mode: 'interactive' | 'plan' | 'autopilot' }} ModeGetResult
@typedef {{ mode: 'interactive' | 'plan' | 'autopilot' }} ModeSetResult

// rpc.js (barrel):
@typedef {{ mode: SessionMode }} ModeResult  // terceiro typedef diferente
```

Três representações do mesmo conceito. O `createSessionRpcFacade` expõe `ModeResult` mas os RPCs
individuais retornam `ModeGetResult`/`ModeSetResult` — os consumers precisam saber qual typedef
usar.

---

### 2.5 `ModelCurrentResult` com campo `modelId?: string` (opcional) deveria ser obrigatório 🟢 BAIXO

**Localização:** `rpc/session.js`, `rpc.js`

O RPC `model.getCurrent()` sempre retorna um `modelId` quando a sessão está ativa. Tipar como
opcional força consumers a fazer null-check desnecessário.

---

### 2.6 `ExperimentalRpcNamespace` — typedef demasiado permissivo 🟡 MÉDIO

**Localização:** `types.js`

```js
@typedef {object} ExperimentalRpcNamespace
@property {(params?: Record<string, unknown>) => Promise<any>} start
@property {(params?: Record<string, unknown>) => Promise<any>} list
// ... todos os métodos têm o mesmo tipo permissivo
```

Todos os métodos retornam `Promise<any>` e recebem `Record<string, unknown>`. Isso elimina
completamente o valor da tipagem nos wrappers experimentais, que fazem casts desnecessários.

---

### 2.7 `PermissionHandler` — campo `kind` de `PermissionRequest` incompleto 🟡 MÉDIO

**Localização:** `session/permissions.js` — `PermissionHandlerConfig`

O campo `denyKinds` aceita `PermissionRequest['kind'][]`. O SDK agora documenta os kinds: `"shell"`,
`"write"`, `"read"`, `"mcp"`, `"custom-tool"`, `"url"`, `"memory"`, `"hook"`.

Os kinds `"memory"` e `"hook"` são novos e não estão documentados no comentário JSDoc de
`createPermissionHandler`. Consumidores não saberão que podem negar operações de memória e hooks via
`denyKinds`.

---

### 2.8 `buildSessionConfig` em `config.js` usa `@deprecated` mas permanece como SSOT 🟡 MÉDIO

**Localização:** `config.js`

A função está marcada como `@deprecated` apontando para
`SessionConfigBuilder de '#copilot/config/session-config'` que **não existe** (foi removido por
violação L1→L2 segundo os comentários). O código deprecado é ainda importado e chamado em
`lifecycle.js`. Deprecar sem substituto é pior que não deprecar.

---

## 3. Vícios Arquiteturais

### 3.1 Top-level `await` em módulo ESM de produção 🔴 CRÍTICO

**Localização:** `tools/custom.js` — linha final:

```js
// F51: Carrega ao inicializar o módulo (async)
await loadCustomToolsAsync();
```

**Problema:** Top-level await em módulos ESM:

1. **Bloqueia todo o grafo de importação** até a Promise resolver — qualquer módulo que importe
   `custom.js` aguarda I/O de disco antes de executar
2. **Impede tree-shaking** — o módulo tem side-effect declarado implicitamente
3. **Falha silenciosa** — erros de I/O no boot são swallowed (ver `logSwallowed`)
4. **Impossibilita testes unitários** sem mock do sistema de arquivos antes do import

**Solução:** Remover o top-level await. Expor uma função `initCustomTools()` explícita chamada pelo
bootstrap, similar ao padrão já usado em `state.js`.

---

### 3.2 Singleton `_client` em `client.js` impede multi-instância 🟡 MÉDIO

**Localização:** `session/client.js`

```js
let _client = null;
```

O singleton de módulo impede:

- Testes paralelos sem isolamento (necessita `_resetClientState()` entre suites)
- Múltiplos clientes conectados a diferentes CLI URLs no mesmo processo
- Injeção de dependência real (o `_injectClientForTest` é um workaround frágil)

**Solução proposta:** Extrair para uma classe `CopilotClientManager` injetável. O singleton pode ser
mantido como conveniência mas não deve ser a única opção.

---

### 3.3 `ModelRegistry` singleton impossibilita multi-contexto 🟡 MÉDIO

**Localização:** `models/registry.js`

```js
const modelRegistry = new ModelRegistry();
const modelStatsTracker = new ModelStatsTracker();
const modelSelector = new ModelSelector(modelRegistry, modelStatsTracker);
const autoDowngradeDetector = new AutoDowngradeDetector(modelStatsTracker, modelSelector);
```

Singletons de módulo para estado mutável (`ModelStatsTracker` acumula métricas em Map privado). Em
ambientes multi-tenant ou de teste, os stats de um contexto contaminam outro. O `reset()` existe mas
não é chamado automaticamente.

---

### 3.4 `_modelsCache` global em `models/helpers.js` não respeita o ciclo de vida do client 🟡 MÉDIO

**Localização:** `models/helpers.js`

```js
let _modelsCache = null;
```

O cache de modelos persiste mesmo após `stopClient()`. Se o usuário troca de conta ou de CLI URL, o
cache serve modelos da sessão anterior. `clearModelsCache()` existe mas `stopClient()` não a chama.

---

### 3.5 Acoplamento de `lifecycle.js` com `models/helpers.js` viola separação de camadas 🟡 MÉDIO

**Localização:** `session/lifecycle.js` — `createSession()`

```js
import { listModels, resolveModelIdAuto } from '../models/index.js';
// ...
const availableModels = await listModels();
model = await resolveModelIdAuto(availableModels, 'auto', 'gpt-5-mini');
```

`lifecycle.js` chama `listModels()` que faz I/O de rede para resolver `model: 'auto'`. Isso acopla o
lifecycle de sessão com a camada de gerenciamento de modelos. Se `listModels()` falhar (ex: CLI
offline), `createSession()` falha antes mesmo de tentar criar a sessão.

**Problema adicional:** `getClient()` é chamado dentro de `listModels()` via `session/client.js`,
criando uma dependência circular potencial:
`lifecycle.js → models/helpers.js → session/client.js → session/lifecycle.js`.

---

### 3.6 `buildCustomTools()` tem injeção de dependência frágil via module-level var 🟡 MÉDIO

**Localização:** `tools/custom.js`

```js
let _buildTool = null;

export function setCustomToolsBuilder(fn) {
  if (typeof fn === 'function') _buildTool = fn;
}
```

O padrão "injetar antes de usar ou retornar lista vazia" é opaco. Se o bootstrap esquecer de chamar
`setCustomToolsBuilder`, o sistema falha silenciosamente (retorna `[]` com WARN). Não há validação
de que a injeção ocorreu antes de `buildCustomTools()` ser chamado.

---

### 3.7 `createPermissionHandler` — complexidade ciclomática elevada 🟢 BAIXO

**Localização:** `session/permissions.js`

A função tem 7 caminhos de decisão aninhados com múltiplos early returns. Deveria ser decomposta em
um pipeline de avaliação (`evaluate(request, invocation): PermissionRequestResult`) com steps
isolados.

---

### 3.8 `rpc/session.js` e `rpc/ops.js` duplicam `assertSession` 🟢 BAIXO

Ambos definem:

```js
function assertSession(session, caller) {
    if (!session || typeof session !== 'object' || !('rpc' in session)) { ... }
}
```

Idêntico em quatro arquivos diferentes (`rpc/session.js`, `rpc/ops.js`, `rpc/experimental.js`,
`rpc.js`). Violação DRY. Deveria estar em `rpc/_guards.js` ou similar.

---

### 3.9 `event-helpers.js` não usa `AbortSignal` como fonte primária de timeout 🟢 BAIXO

**Localização:** `event-helpers.js`

`waitForEvent` implementa timeout via `setTimeout` + AbortSignal como opções separadas. No Node.js
18+, `AbortSignal.timeout(ms)` simplifica isso. O código atual é correto mas mais verboso que
necessário para consumidores modernos.

---

### 3.10 Ausência de `Container` de DI — tokens `SDK_LOGGER` e `TOOLS_BUILDER` são rudimentares 🟡 MÉDIO

**Localização:** `di-tokens.js`

Os dois tokens DI criados (`SDK_LOGGER`, `TOOLS_BUILDER`) são definições parciais sem container. A
injeção acontece via variáveis de módulo mutáveis (`setSdkLogger`, `setCustomToolsBuilder`), não via
um sistema de DI real. Isso impede:

- Escopo de dependências por request/session
- Lazy initialization controlada
- Reset limpo em testes

---

## 4. Segurança e Robustez

### 4.1 `BUILTIN_HANDLER_MAP` — `env_read` expõe PATH e HOME 🟡 MÉDIO

**Localização:** `tools/custom.js`

```js
const ENV_ALLOWLIST = new Set([
    'NODE_ENV', 'COPILOT_WORKING_DIRECTORY', 'COPILOT_DB_PATH',
    'TZ', 'LANG', 'HOME', 'HOSTNAME', 'PATH', ...
]);
```

`HOME` e `PATH` são vetores de reconhecimento em ataques de prompt injection. Um agente malicioso
que controla o input do modelo pode solicitar `env_read({ key: 'HOME' })` para mapear o filesystem
do usuário. Esses valores deveriam estar na denylist, não na allowlist.

---

### 4.2 `math_eval` em `BUILTIN_HANDLER_MAP` — regex pode ser contornado 🟡 MÉDIO

**Localização:** `tools/custom.js`

```js
const m = /^(-?\d+(?:\.\d+)?)\s*([+\-*/])\s*(-?\d+(?:\.\d+)?)$/.exec(expr);
```

A expressão regular usa `[+\-*/]` sem anchor de escape em contexto de classe de caractere. Embora a
intenção seja correta, `\-` no meio de uma classe de caractere é interpretado como literal `-` em
alguns engines. Melhor usar `[+\-\*/]` explicitamente ou `[-+*/]` (com `-` no início/fim). Também:
não há limite de tamanho da string de entrada — um input muito longo causará backtracking
exponencial.

---

### 4.3 `httpRequest` sem suporte HTTPS 🔴 CRÍTICO (para uso produtivo)

**Localização:** `http-request.js`

```js
import http from 'node:http';
```

O helper suporta apenas `http://`. Se um endpoint interno migrar para HTTPS (ex: CLI com TLS), o
helper falhará. O comentário diz "Helper HTTP genérico para chamadas internas (loopback)" mas não há
validação que o URL seja loopback de fato — um URL arbitrário `http://` pode ser passado por um
consumidor não-cuidadoso.

---

### 4.4 `resolvePersistentConfigFile` sem validação de path traversal 🟡 MÉDIO

**Localização:** `persistent-paths.js` → `tools/state.js`, `tools/custom.js`

Os caminhos `custom-tools.json` e `tools-config.json` são construídos via
`resolvePersistentConfigFile(name)`. Se o `name` vier de input externo e contiver `../`, o arquivo
poderia ser escrito fora do diretório configurado. A `session-fs.js` já tem proteção
`normalizeRelativeSegments` — deveria ser reutilizada aqui.

---

### 4.5 Circuit breaker `sdkConnectionCircuitBreaker` é exportado como mutável 🟡 MÉDIO

**Localização:** `session/client.js`

```js
export const sdkConnectionCircuitBreaker = new CircuitBreaker('sdk-connection', { ... });
```

Exportar a instância do circuit breaker permite que consumidores a manipulem externamente
(`sdkConnectionCircuitBreaker.reset()`, `sdkConnectionCircuitBreaker.recordFailure()`). Isso viola o
encapsulamento — o estado do breaker deve ser opaco para os consumidores.

---

### 4.6 `createPermissionHandler` com `onRequest` pode vazar exceções do handler externo 🟡 MÉDIO

**Localização:** `session/permissions.js`

```js
const custom = await onRequest(request, invocation);
```

Se `onRequest` lançar, o erro é capturado e relançado via `toSdkOperationError`. Mas o SDK pode
interpretar uma exceção no `onPermissionRequest` de formas inesperadas — potencialmente bloqueando a
sessão. Seria mais seguro retornar `denied()` em caso de exceção, com logging, em vez de propagar.

---

## 5. Débito de Manutenção

### 5.1 `buildSessionConfig` em `config.js` deprecada sem substituto real 🔴 CRÍTICO

**Localização:** `config.js`

A deprecação aponta para `SessionConfigBuilder de '#copilot/config/session-config'` que foi
removido. O arquivo tem comentários `// Cf. PARTE-21C Faixa H: eliminação de violações L1→L2` mas
não documenta onde o substituto real existe. Todo o código que usa `buildSessionConfig` do barrel
`#copilot/sdk` está usando API deprecada.

---

### 5.2 `DEFAULT_MODEL = 'gpt-5-mini'` com `reasoningEffort = HIGH` é default silencioso 🟡 MÉDIO

**Localização:** `session/lifecycle.js` — `createSession()`

```js
if (!reasoningEffort && model === 'gpt-5-mini') {
  reasoningEffort = REASONING_EFFORTS.HIGH;
}
```

Aplicar `reasoningEffort: 'high'` silenciosamente quando o modelo é `gpt-5-mini` é um comportamento
não-documentado que aumenta custo por token para todos os usuários que usam o modelo padrão. Este
"default canônico" deveria ser explicitamente documentado ou configurável.

---

### 5.3 `known-models.js` tem `claude-sonnet-4` mas SDK usa `claude-sonnet-4.5` 🟡 MÉDIO

**Localização:** `models/known-models.js`

```js
{ id: 'claude-sonnet-4', aliases: ['claude-sonnet', 'sonnet'] }
```

O modelo atual documentado pelo GitHub é `claude-sonnet-4.5` (conforme mencionado no README do SDK).
O catálogo estático está desatualizado e não inclui modelos recentes como `gpt-5`, `o4-mini` (estão
presentes), mas falta `claude-sonnet-4.5`, `claude-opus-4.5`, etc.

---

### 5.4 `autoDowngradeDetector` nunca é chamado no código do wrapper 🟢 BAIXO

**Localização:** `models/registry.js`

O `autoDowngradeDetector` é instanciado como singleton e exportado, mas não há nenhum ponto no
código que chame `autoDowngradeDetector.evaluate()`. É funcionalidade morta que ocupa memória e
documentação sem efeito real.

---

### 5.5 `compactionCompact` e `compactionCompactTyped` — duplicação 🟢 BAIXO

**Localização:** `rpc/ops.js`

Ambas as funções têm implementação quase idêntica:

- `compactionCompact` — com instrumentação de métricas (em `ops.js`)
- `compactionCompactTyped` — sem instrumentação (no mesmo arquivo)

A diferença é apenas a instrumentação. Deveriam ser uma só função com o parâmetro opcional.

---

### 5.6 Imports duplicados de `@github/copilot-sdk` diretos fora da wrapper layer 🟡 MÉDIO

**Localização:** `session/lifecycle.js`, `session/permissions.js`, `session/client.js`

```js
import { CopilotClient, approveAll } from '@github/copilot-sdk';
```

Três arquivos dentro de `sdk/` importam `@github/copilot-sdk` diretamente em vez de usar re-exports
internos. Isso é necessário pelo design (são a wrapper layer), mas cria pontos de acoplamento
desnecessários quando o SDK muda.

---

### 5.7 Ausência de testes de contrato na wrapper layer 🟡 MÉDIO

Nenhum arquivo de teste foi observado no escopo (`src/copilot/sdk/`). A wrapper layer deveria ter:

- Testes de contrato dos builders (`appendSystemMessage`, `replaceSystemMessage`,
  `customizeSystemMessage`)
- Testes de contrato dos permission handlers
- Testes de integração mock para `createSession`/`resumeSession`
- Testes de regressão para os `kind` de `PermissionRequestResult`

---

## 6. Matriz de Severidade

| #   | Issue                                               | Severidade | Impacto em Produção                          | Esforço |
| --- | --------------------------------------------------- | ---------- | -------------------------------------------- | ------- |
| 2.1 | `PermissionRequestResult` kinds desatualizados      | 🔴 CRÍTICO | Todas as permissões potencialmente inválidas | Pequeno |
| 1.1 | `onElicitationRequest` ausente                      | 🔴 CRÍTICO | Elicitation provider impossível              | Médio   |
| 1.2 | `commands` ausente                                  | 🔴 CRÍTICO | Slash commands inacessíveis                  | Pequeno |
| 3.1 | Top-level await em `custom.js`                      | 🔴 CRÍTICO | Boot bloqueante, testes impossíveis          | Médio   |
| 5.1 | `buildSessionConfig` deprecada sem substituto       | 🔴 CRÍTICO | Todo código usa API deprecada                | Grande  |
| 4.3 | `httpRequest` sem HTTPS                             | 🔴 CRÍTICO | Falha total em prod com TLS                  | Pequeno |
| 3.5 | `lifecycle.js` ↔ `models` acoplamento circular      | 🟡 MÉDIO   | Race condition no boot                       | Médio   |
| 3.2 | Singleton `_client` impede multi-instância          | 🟡 MÉDIO   | Impossibilidade de multi-tenant              | Grande  |
| 2.7 | `PermissionHandler` kinds `memory`/`hook` ausentes  | 🟡 MÉDIO   | Security gap                                 | Pequeno |
| 4.1 | `env_read` expõe `HOME`/`PATH`                      | 🟡 MÉDIO   | Information disclosure                       | Pequeno |
| 3.4 | `_modelsCache` sobrevive a `stopClient()`           | 🟡 MÉDIO   | Dados obsoletos após reconexão               | Pequeno |
| 1.6 | `capabilities.changed` faltando em `SESSION_EVENTS` | 🟡 MÉDIO   | Listener impossível por constante            | Pequeno |
| 2.8 | `@deprecated` sem substituto funcional              | 🟡 MÉDIO   | Confusão de API para consumers               | Grande  |

---

## 7. Nova Arquitetura Proposta

A arquitetura proposta mantém a identidade do módulo como L1 wrapper, mas resolve os problemas
estruturais através de cinco princípios:

```
src/copilot/sdk/
├── core/                          # NOVO — fundamentos transversais
│   ├── guards.ts                  # assertSession, assertClient centralizados
│   ├── errors.ts                  # SdkOperationError + classifySdkError (existente, migrar)
│   ├── logger.ts                  # proxy de logger (existente, manter)
│   └── metrics.ts                 # operation metrics (existente, manter)
│
├── client/                        # REFATORADO — lifecycle do client
│   ├── manager.ts                 # CopilotClientManager (classe, não singleton)
│   ├── circuit-breaker.ts         # sdkConnectionCircuitBreaker (encapsulado)
│   ├── options.ts                 # ClientOptionsBuilder (existente, manter)
│   └── singleton.ts               # getInstance() — singleton via factory, não module-var
│
├── session/                       # REFATORADO — lifecycle da sessão
│   ├── create.ts                  # createSession com suporte a todos os campos
│   ├── resume.ts                  # resumeSession
│   ├── config-builder.ts          # NOVO SessionConfigBuilder (substitui buildSessionConfig)
│   ├── attachment-helpers.ts      # NOVO createBlobAttachment, createFileAttachment
│   ├── resource-management.ts     # NOVO withSession(), await using helpers
│   ├── capabilities.ts            # NOVO watchCapabilities(), waitForElicitation()
│   └── wrapper.ts                 # sendSession, setModel, etc. (existente, manter)
│
├── permissions/                   # REFATORADO — pipeline de permissões
│   ├── handler.ts                 # createPermissionHandler refatorado
│   ├── kinds.ts                   # NOVO — enum PermissionKind com todos os valores
│   ├── results.ts                 # NOVO — factory functions com kinds corretos
│   └── pipeline.ts                # NOVO — PermissionEvaluationPipeline
│
├── tools/                         # REFATORADO
│   ├── core.ts                    # defineTool, createTool (existente)
│   ├── registry.ts                # ToolRegistry (existente, manter)
│   ├── custom.ts                  # REFATORADO — sem top-level await
│   ├── state.ts                   # ToolsConfig (existente)
│   └── attachment-validator.ts   # NOVO — validação de attachments
│
├── models/                        # REFATORADO
│   ├── catalog.ts                 # known-models atualizado (claude-sonnet-4.5, etc.)
│   ├── registry.ts                # ModelRegistry como classe injetável
│   ├── selector.ts                # ModelSelector
│   ├── stats.ts                   # ModelStatsTracker
│   ├── helpers.ts                 # funções puras (existente)
│   └── cache.ts                   # NOVO — ModelCache com TTL configurável e invalidação
│
├── rpc/                           # REFATORADO
│   ├── session.ts                 # session RPCs (existente)
│   ├── ops.ts                     # ops RPCs (existente)
│   ├── server.ts                  # server RPCs (existente)
│   ├── experimental.ts            # experimental RPCs (existente)
│   └── facade.ts                  # createSessionRpcFacade (existente)
│
├── events/                        # REFATORADO
│   ├── constants.ts               # SESSION_EVENTS com capabilities.changed
│   ├── subscription.ts            # onSessionEvent, onSessionEvents (existente)
│   └── typed-bus.ts               # NOVO — TypedEventBus<SessionEvent>
│
├── telemetry/                     # (existente, manter)
│   ├── tracing.ts
│   ├── health.ts
│   ├── quota-monitor.ts
│   └── operation-metrics.ts
│
├── http/                          # REFATORADO
│   └── request.ts                 # httpRequest com suporte HTTP + HTTPS
│
├── types.ts                       # SSOT de tipos (existente, expandir)
├── constants.ts                   # constantes (existente, expandir)
└── index.ts                       # barrel principal (existente, manter)
```

### 7.1 `SessionConfigBuilder` — substituto para `buildSessionConfig`

```typescript
// session/config-builder.ts — API proposta
export class SessionConfigBuilder {
    private config: Partial<SessionConfig> = {};

    model(id: string): this { this.config.model = id; return this; }
    reasoningEffort(e: ReasoningEffort): this { ... }
    tools(tools: Tool[]): this { ... }
    systemMessage(sm: SystemMessageConfig): this { ... }
    infiniteSessions(opts: InfiniteSessionConfig): this { ... }
    permissions(handler: PermissionHandler): this { ... }
    elicitation(handler: ElicitationHandler): this { ... }  // NOVO
    commands(cmds: CommandDefinition[]): this { ... }        // NOVO
    modelCapabilities(override: ModelCapabilitiesOverride): this { ... } // NOVO
    provider(cfg: ProviderConfig): this { ... }
    hooks(h: SessionHooks): this { ... }

    build(): SessionConfig { ... }

    // Factory methods
    static defaults(): SessionConfigBuilder { ... }
    static fromEnv(): SessionConfigBuilder { ... }
}

// Uso:
const config = SessionConfigBuilder
    .defaults()
    .model('gpt-5')
    .permissions(approveAll)
    .elicitation(myElicitationHandler)
    .commands([deployCmd])
    .build();
```

### 7.2 `PermissionResults` corrigidos

```typescript
// permissions/results.ts
export const PermissionResults = {
  approved: (): PermissionRequestResult => ({ kind: 'approved' }),
  deniedByUser: (): PermissionRequestResult => ({ kind: 'denied-interactively-by-user' }),
  deniedByRules: (): PermissionRequestResult => ({ kind: 'denied-by-rules' }),
  deniedNoRule: (): PermissionRequestResult => ({
    kind: 'denied-no-approval-rule-and-could-not-request-from-user',
  }),
  deniedContentPolicy: (): PermissionRequestResult => ({
    kind: 'denied-by-content-exclusion-policy',
  }),
} as const;
```

### 7.3 Attachment helpers

```typescript
// session/attachment-helpers.ts
export function createBlobAttachment(data: string, mimeType: string, name?: string) {
  return { type: 'blob' as const, data, mimeType, ...(name ? { displayName: name } : {}) };
}

export function createFileAttachment(path: string, displayName?: string) {
  return { type: 'file' as const, path, ...(displayName ? { displayName } : {}) };
}

// Uso:
await sendSession(session, {
  prompt: 'Analise este screenshot',
  attachments: [createBlobAttachment(base64, 'image/png')],
});
```

### 7.4 Resource Management Pattern

```typescript
// session/resource-management.ts
export async function withSession<T>(
  opts: SessionCreateOptions,
  fn: (session: CopilotSession) => Promise<T>,
): Promise<T> {
  const { session } = await quickSession(opts);
  try {
    return await fn(session);
  } finally {
    await disconnectSessionSafe(session).catch(() => {});
  }
}
```

### 7.5 Capabilities Watcher

```typescript
// session/capabilities.ts
export function watchCapabilities(
  session: CopilotSession,
  onChange: (caps: SessionCapabilities) => void,
): () => void {
  return onSessionEvent(session, 'capabilities.changed', () => {
    onChange(session.capabilities);
  });
}

export function waitForElicitationCapability(
  session: CopilotSession,
  timeoutMs = 5000,
): Promise<boolean> {
  if (session.capabilities.ui?.elicitation) return Promise.resolve(true);
  return waitForEvent(session as any, 'capabilities.changed', { timeoutMs })
    .then(() => session.capabilities.ui?.elicitation === true)
    .catch(() => false);
}
```

---

## 8. Roadmap

### Milestone M-01 — Correções Críticas de Contrato (1–2 semanas)

**Prioridade:** Produção bloqueante

1. **[M01-01]** Corrigir `PermissionRequestResult` kinds em `permissions.ts`
   - Substituir `approve-once` → `approved`
   - Substituir `reject` → `denied-interactively-by-user`
   - Adicionar factory functions em `permissions/results.ts`
   - Adicionar testes de regressão

2. **[M01-02]** Adicionar `onElicitationRequest` em `SessionCreateOptions` e `SessionResumeOptions`
   - Mapear em `buildSessionConfig()` para ambos os branches (create/resume)
   - Adicionar typedef e JSDoc

3. **[M01-03]** Adicionar `commands` em `SessionCreateOptions` e `SessionResumeOptions`
   - Mapear `CommandDefinition[]` no `buildSessionConfig()`

4. **[M01-04]** Corrigir `httpRequest` para suportar HTTPS
   - Usar `https` module para URLs `https://`
   - Adicionar validação de protocol

5. **[M01-05]** Adicionar `capabilities.changed` em `SESSION_EVENTS`

6. **[M01-06]** Adicionar kinds `memory` e `hook` ao JSDoc de `createPermissionHandler`

---

### Milestone M-02 — Refatoração de Segurança e Robustez (2–3 semanas)

1. **[M02-01]** Remover top-level await de `tools/custom.js`
   - Expor `initCustomTools()` e chamar no bootstrap

2. **[M02-02]** Remover `HOME` e `PATH` da allowlist de `env_read`
   - Mover para denylist implícita ou remover da allowlist

3. **[M02-03]** Encapsular `sdkConnectionCircuitBreaker` — não exportar instância

4. **[M02-04]** Chamar `clearModelsCache()` dentro de `stopClient()`

5. **[M02-05]** Adicionar limit de tamanho em `math_eval` regex input

6. **[M02-06]** Centralizar `assertSession` / `assertClient` em `core/guards.ts`

7. **[M02-07]** `createPermissionHandler` — retornar `denied()` em vez de propagar exceção de
   `onRequest`

---

### Milestone M-03 — API Completeness (3–4 semanas)

1. **[M03-01]** Implementar `SessionConfigBuilder` como substituto de `buildSessionConfig`
   - Manter `buildSessionConfig` com deprecation pointing real para M-04

2. **[M03-02]** Implementar helpers de attachment
   - `createBlobAttachment(data, mimeType, name?)`
   - `createFileAttachment(path, displayName?)`
   - Documentar em `sendSession`/`sendSessionAndWait`

3. **[M03-03]** Implementar `withSession(opts, fn)` em `session/resource-management.ts`

4. **[M03-04]** Implementar `watchCapabilities` e `waitForElicitationCapability`

5. **[M03-05]** Adicionar `modelCapabilities` em `SessionCreateOptions`

6. **[M03-06]** Atualizar `known-models.js` com catálogo atual
   - Adicionar `claude-sonnet-4.5`, `claude-opus-4.5`, `claude-haiku-4.5`
   - Adicionar script de sync automático com `client.listModels()`

7. **[M03-07]** Expor `SectionTransformFn` como helper e exemplo

---

### Milestone M-04 — Refatoração Arquitetural (4–6 semanas)

1. **[M04-01]** Extrair `CopilotClientManager` — classe injetável substituindo singleton
   - Manter `getClient()` como convenience wrapper
   - Deprecar `_injectClientForTest` e `_resetClientState`

2. **[M04-02]** Tornar `ModelRegistry`, `ModelStatsTracker`, `ModelSelector` injetáveis
   - Manter singletons como default mas expor factory

3. **[M04-03]** Resolver acoplamento `lifecycle.js ↔ models/helpers.js`
   - Extrair resolução de modelo para `session/model-resolver.ts`
   - Injetar via parâmetro opcional em `createSession`

4. **[M04-04]** Remover `buildSessionConfig` deprecated de `config.js`
   - Substituir todos os usos por `SessionConfigBuilder`

5. **[M04-05]** Implementar `TypedEventBus<SessionEvent>` em `events/typed-bus.ts`

6. **[M04-06]** Adicionar `ModelCache` com TTL configurável e invalidação explícita

7. **[M04-07]** Corrigir `LogResult` — unificar em um único typedef

---

### Milestone M-05 — Estado da Arte: Observabilidade e Developer Experience (6–8 semanas)

1. **[M05-01]** SDK OpenTelemetry span propagation completo
   - Wrapar `createSession`/`resumeSession` em spans automáticos
   - Propagar trace context para todas as operações RPC

2. **[M05-02]** `SessionConfigBuilder` com profiles configuráveis
   - `.readOnly()`, `.fullAccess()`, `.diagnostic()`, `.alwaysAlive()`

3. **[M05-03]** Geração automática de catálogo de modelos
   - Script `scripts/update-known-models.ts` que chama `listModels()` e atualiza `known-models.ts`

4. **[M05-04]** Type-safe event subscription com generics completos
   - `onSessionEvent<T extends SessionEventType>(session, T, handler: TypedHandler<T>)`

5. **[M05-05]** Suporte completo a `await using`
   - `quickSession()` retorna objeto com `[Symbol.asyncDispose]`
   - Expor `createManagedSession()` que implementa `AsyncDisposable`

6. **[M05-06]** Documentação inline completa com exemplos executáveis
   - Cada função exportada com `@example` funcional
   - JSDoc para todos os campos de `SessionCreateOptions`

7. **[M05-07]** Suite de testes de contrato
   - Testes para todos os builders
   - Testes de integração com CLI mockado
   - Cobertura mínima de 80% no `sdk/`

---

## Apêndice A — Checklist de Gaps vs SDK Oficial

| Feature SDK                               | Status Wrapper | Localização do Gap  |
| ----------------------------------------- | -------------- | ------------------- |
| `onElicitationRequest` em `createSession` | ❌ AUSENTE     | `lifecycle.js`      |
| `commands` em `createSession`             | ❌ AUSENTE     | `lifecycle.js`      |
| `modelCapabilities` override              | ❌ AUSENTE     | `lifecycle.js`      |
| Blob attachments helper                   | ❌ AUSENTE     | `wrapper.js`        |
| `await using` pattern                     | ⚠️ PARCIAL     | `wrapper.js`        |
| `capabilities.changed` event              | ❌ AUSENTE     | `constants.js`      |
| `withSession()` helper                    | ❌ AUSENTE     | —                   |
| `watchCapabilities()`                     | ❌ AUSENTE     | —                   |
| `approved` result kind                    | ❌ ERRADO      | `permissions.js`    |
| `denied-*` result kinds                   | ❌ ERRADO      | `permissions.js`    |
| `memory` permission kind                  | ⚠️ UNDOC       | `permissions.js`    |
| `hook` permission kind                    | ⚠️ UNDOC       | `permissions.js`    |
| `SectionTransformFn` example              | ⚠️ UNDOC       | `system-message.js` |
| HTTPS in `httpRequest`                    | ❌ AUSENTE     | `http-request.js`   |
| `capabilities.ui?.elicitation` watcher    | ❌ AUSENTE     | `session/ui.js`     |
| `SessionConfigBuilder` fluent API         | ❌ AUSENTE     | —                   |
| Attachment type helpers                   | ❌ AUSENTE     | —                   |
| `claude-sonnet-4.5` in catalog            | ❌ AUSENTE     | `known-models.js`   |
| `compactionCompact` unificada             | ⚠️ DUPLICADO   | `rpc/ops.js`        |
| `assertSession` centralizado              | ⚠️ DUPLICADO   | múltiplos arquivos  |
| `clearModelsCache` on `stopClient`        | ❌ AUSENTE     | `client.js`         |
| `forceStop()` tipagem                     | ⚠️ CAST        | `client.js`         |

---

## Apêndice B — Exemplos de Código "Estado da Arte"

### B.1 Uso completo com `SessionConfigBuilder`

```javascript
import {
  SessionConfigBuilder,
  createBlobAttachment,
  withSession,
  approveAll,
  PermissionResults,
} from '#copilot/sdk';

// Configuração fluente, type-safe, completa
const config = SessionConfigBuilder.defaults()
  .model('claude-sonnet-4.5')
  .reasoningEffort('high')
  .permissions((req) => {
    if (req.kind === 'shell') return PermissionResults.deniedByUser();
    if (req.kind === 'memory') return PermissionResults.approved();
    return PermissionResults.approved();
  })
  .elicitation(async (ctx) => ({
    action: 'accept',
    content: { confirmed: true },
  }))
  .commands([
    {
      name: 'deploy',
      description: 'Deploy para produção',
      handler: async ({ args }) => {
        /* ... */
      },
    },
  ])
  .hooks({
    onPreToolUse: async (input) => ({
      permissionDecision: 'allow',
      additionalContext: `Contexto: ${process.cwd()}`,
    }),
  })
  .build();

// Resource management automático
await withSession(config, async (session) => {
  // Envio com blob attachment
  const screenshot = await captureScreen(); // base64
  const response = await sendSessionAndWait(session, {
    prompt: 'O que está errado nesta tela?',
    attachments: [createBlobAttachment(screenshot, 'image/png')],
  });
  console.log(response?.data.content);
});
```

### B.2 Monitoring reativo de capabilities

```javascript
import { quickSession, watchCapabilities, waitForElicitationCapability } from '#copilot/sdk';

const { session } = await quickSession({ model: 'gpt-5' });

// Observar mudanças dinâmicas
const stopWatching = watchCapabilities(session, (caps) => {
  console.log('Capabilities atualizadas:', caps);
});

// Aguardar até que elicitation esteja disponível
const hasElicitation = await waitForElicitationCapability(session, 10_000);
if (hasElicitation) {
  const ok = await session.ui.confirm('Continuar com deploy?');
}

stopWatching();
```

---

_Auditoria gerada em 2026-04-28. Referência: `@github/copilot-sdk` Public Preview — nodejs/README.md
(1029 linhas, 36.9 KB)._
