# Auditoria Ampla — `CopilotClient` (`@github/copilot-sdk` 0.3.0)

> Arquivo-fonte inicial desta auditoria: `node_modules/@github/copilot-sdk/dist/client.d.ts`
>
> Fontes adicionais confrontadas:
>
> - `node_modules/@github/copilot-sdk/dist/types.d.ts`
> - `https://github.com/github/copilot-sdk/blob/main/nodejs/README.md`
> - `src/copilot/sdk/session/**`
> - `src/copilot/server/routes/sdk/**`
> - `src/copilot/boot/**`

---

## 1. Objetivo

Esta auditoria verifica se a camada local de wrapper/fachada cobre **de forma completa, canônica e arquiteturalmente coerente** a superfície disponibilizada pela classe `CopilotClient` do SDK instalado.

O critério usado aqui não é “tem algo parecido em algum ponto do código”.

O critério é:

1. a capability existe no SDK instalado;
2. o repositório a expõe de forma usável na sua superfície local;
3. a implementação segue a trilha canônica (`sdk/session` → `sdk` root → adapters/rotas/runtime), sem reabrir caminhos paralelos desnecessários;
4. a ausência, se existir, está explicitamente classificada como **full / partial / missing / not-applicable**.

---

## 2. Observação importante sobre a fonte de verdade

Durante a auditoria foi identificado um drift entre a documentação pública do README e os typings instalados no workspace.

### Drift confirmado

- o README público menciona `copilotHome?: string` no construtor;
- o pacote instalado neste workspace (`dist/types.d.ts` + `dist/client.d.ts`) **não** expõe esse campo em `CopilotClientOptions`.

### Decisão canônica

Para esta execução contínua, a fonte de verdade passa a ser:

1. **o pacote instalado no workspace**;
2. depois o README oficial, usado como confirmação e contexto;
3. nunca o contrário.

Portanto, `copilotHome` **não** entra como gap local a ser implementado nesta rodada, porque ele não faz parte do contrato tipado instalado que o repositório está consumindo.

---

## 3. Matriz de paridade — métodos da classe `CopilotClient`

| Método / superfície do SDK | Estado local antes desta rodada          | Estado após esta rodada                            | Veredito                  | Owner local                                          |
| -------------------------- | ---------------------------------------- | -------------------------------------------------- | ------------------------- | ---------------------------------------------------- |
| `start()`                  | coberto implicitamente por `getClient()` | `startClient()` explícito + `getClient()`          | **full**                  | `src/copilot/sdk/session/client.js`                  |
| `stop()`                   | existente                                | mantido                                            | **full**                  | `src/copilot/sdk/session/client.js`                  |
| `forceStop()`              | existente                                | mantido                                            | **full**                  | `src/copilot/sdk/session/client.js`                  |
| `createSession()`          | existente                                | mantido                                            | **full**                  | `src/copilot/sdk/session/client.js` + `lifecycle.js` |
| `resumeSession()`          | existente                                | mantido                                            | **full**                  | `src/copilot/sdk/session/client.js` + `lifecycle.js` |
| `getState()`               | existente                                | mantido                                            | **full**                  | `src/copilot/sdk/session/client.js`                  |
| `ping()`                   | existente                                | mantido                                            | **full**                  | `src/copilot/sdk/session/client.js`                  |
| `getStatus()`              | existente                                | mantido                                            | **full**                  | `src/copilot/sdk/session/client.js`                  |
| `getAuthStatus()`          | existente                                | mantido                                            | **full**                  | `src/copilot/sdk/session/client.js`                  |
| `listModels()`             | existente                                | mantido                                            | **full**                  | `src/copilot/sdk/session/client.js`                  |
| `getLastSessionId()`       | existente                                | mantido                                            | **full**                  | `src/copilot/sdk/session/client.js`                  |
| `deleteSession()`          | existente                                | mantido                                            | **full**                  | `src/copilot/sdk/session/client.js`                  |
| `listSessions()`           | existente                                | mantido                                            | **full**                  | `src/copilot/sdk/session/client.js`                  |
| `getSessionMetadata()`     | ausente como fachada dedicada            | `getClientSessionMetadata()` + fallback compatível | **full**                  | `src/copilot/sdk/session/client.js`                  |
| `getForegroundSessionId()` | existente                                | mantido                                            | **full**                  | `src/copilot/sdk/session/client.js`                  |
| `setForegroundSessionId()` | existente                                | mantido                                            | **full**                  | `src/copilot/sdk/session/client.js`                  |
| `on(eventType, handler)`   | helper existente via `client-events.js`  | mantido                                            | **full via helper layer** | `src/copilot/sdk/session/client-events.js`           |
| `on(handler)`              | helper existente via `client-events.js`  | mantido                                            | **full via helper layer** | `src/copilot/sdk/session/client-events.js`           |
| `rpc` getter               | existente                                | mantido                                            | **full**                  | `src/copilot/sdk/session/client.js`                  |

### Observação sobre lifecycle `.on(...)`

A superfície local não replica literalmente `client.on(...)` em `CopilotClientManager`, mas a capability está **completamente coberta** por:

- `onLifecycleEvent(...)`
- `onAllLifecycleEvents(...)`
- `onLifecycleEvents(...)`
- acesso direto ao client real quando o adapter precisa disso (`/agent/stream`, por exemplo)

Minha conclusão é: isso já era **funcionalmente full**, embora com uma ergonomia helper-based em vez de method-alias 1:1.

---

## 4. Matriz de paridade — `CopilotClientOptions`

| Opção do SDK instalado           | Estado local antes desta rodada                     | Estado após esta rodada                        | Veredito |
| -------------------------------- | --------------------------------------------------- | ---------------------------------------------- | -------- |
| `cliPath`                        | coberto                                             | mantido                                        | **full** |
| `cliArgs`                        | coberto                                             | mantido                                        | **full** |
| `cwd`                            | sem método explícito; só via `merge()`/env indireto | método `cwd()` + leitura explícita de env      | **full** |
| `port`                           | coberto                                             | mantido                                        | **full** |
| `useStdio`                       | coberto                                             | mantido                                        | **full** |
| `isChildProcess`                 | tipado no SSOT, mas sem builder/env explícitos      | método `isChildProcess()` + env                | **full** |
| `cliUrl`                         | coberto                                             | mantido                                        | **full** |
| `logLevel`                       | coberto                                             | mantido                                        | **full** |
| `autoStart`                      | coberto                                             | mantido                                        | **full** |
| `autoRestart` (deprecated/no-op) | não exposto explicitamente                          | método `autoRestart()` + env como pass-through | **full** |
| `env`                            | coberto                                             | mantido                                        | **full** |
| `gitHubToken`                    | coberto                                             | mantido                                        | **full** |
| `useLoggedInUser`                | coberto                                             | mantido                                        | **full** |
| `onListModels`                   | coberto                                             | mantido                                        | **full** |
| `telemetry`                      | coberto                                             | mantido                                        | **full** |
| `onGetTraceContext`              | coberto                                             | mantido                                        | **full** |
| `sessionFs`                      | coberto                                             | mantido                                        | **full** |
| `sessionIdleTimeoutSeconds`      | coberto                                             | mantido                                        | **full** |

---

## 5. Achados específicos desta rodada

### CLIENT-001 — metadata de sessão dedicada estava faltando na fachada local

O SDK já expunha `getSessionMetadata(sessionId)`, mas a fachada local só oferecia:

- `listAllClientSessions(filter?)`
- e alguns consumidores faziam `find(...)` em memória.

Isso era funcional, mas não era paridade full do `CopilotClient` nem a forma canônica de lookup.

**Correção aplicada:**

- `startClient()` e `getClientSessionMetadata()` adicionados a `sdk/session/client.js`
- reexportados por `sdk/session/index.js` e `sdk/index.js`
- `GET /sessions/:id` passou a usar o lookup dedicado
- fallback compatível para `listSessions()` foi preservado para mocks/implementações antigas

### CLIENT-002 — builder de options estava incompleto

O `ClientOptionsBuilder` já cobria o grosso do contrato, mas ainda tinha uma lacuna de ergonomia e completude para:

- `cwd`
- `isChildProcess`
- `autoRestart`

**Correção aplicada:**

- novos métodos fluentes no builder
- suporte explícito no parsing de env
- cobertura de testes adicionada

### CLIENT-003 — documentação/SSOT do provider estava imprecisa

Havia um comentário afirmando que `provider?: ProviderConfig` era campo de `CopilotClientOptions`, quando na prática ele pertence a `SessionConfig`/`ResumeSessionConfig`.

**Correção aplicada:** comentário corrigido.

### CLIENT-004 — o contrato de boot não rastreava `client.getSessionMetadata`

O baseline declarativo do boot já reconhecia várias capacidades do client, mas ainda não incluía o lookup dedicado de metadata.

**Correção aplicada:** baseline e surface validation foram atualizados.

---

## 6. Situação ideal

A situação ideal para a camada local de `CopilotClient` é:

1. paridade explícita com o contrato tipado realmente instalado;
2. façade local oferecendo nomes suficientemente claros para o runtime do projeto;
3. rotas e projections usando os métodos dedicados do SDK quando eles existem, sem downgrade para scans lineares desnecessários;
4. helpers locais documentando claramente quando cobrem uma API por abstração equivalente, em vez de fingir inexistência ou duplicar tudo dogmaticamente.

---

## 7. Veredito final

### Antes desta rodada

A implementação local do `CopilotClient` estava **forte, porém não totalmente full**.

O runtime já cobria quase todo o contrato, mas ainda havia:

- um gap real em `getSessionMetadata()`;
- incompletude objetiva no `ClientOptionsBuilder`;
- drift documental entre README, SSOT local e comentários de implementação.

### Após esta rodada

Minha avaliação final é:

- **métodos do `client.d.ts`: full**;
- **options do `client.d.ts`: full**;
- **surface lifecycle do client: full via helper layer**;
- **drift README vs pacote instalado: documentado e neutralizado pela política de fonte de verdade local**.

O próximo passo coerente não é mais “fechar buracos do `CopilotClient`”, e sim voltar ao roadmap principal do terminal/agent com essa camada agora estabilizada e explicitamente auditada.
