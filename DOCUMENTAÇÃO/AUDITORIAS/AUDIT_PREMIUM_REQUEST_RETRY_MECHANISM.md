# Investigação: Mecanismo de Retry sem Consumo de Premium Requests

**Data**: 2026-07-10  
**Status**: RASCUNHO — proposta de upgrades  
**Autor**: GitHub Copilot (LLM-A)  
**Contexto**: `@github/copilot-sdk v0.2.0`, `Node.js 24 ESM`

---

## 1. Fenômeno Observado

No VS Code Copilot Chat (interface do LLM-A), quando ocorre um erro (network, rate-limit de modelo,
timeout, etc.), aparece uma caixinha com a mensagem de erro e o botão **"Tentar novamente"** (retry).
Ao pressionar esse botão:

- A mesma mensagem é **reenviada** ao modelo
- **Nenhum Premium Request é consumido**
- Isso se repete indefinidamente até a requisição ser bem-sucedida
- **Persiste após reinicialização do PC** — ao retomar a conversa, se ainda há um turno com erro
  pendente, o botão volta a aparecer e o comportamento se mantém

A consequência prática: é possível ficar vários dias sem consumir PRs se os erros continuam (seja
por quota temporariamente esgotada de um modelo específico, network instável, etc.).

---

## 2. Hipótese Central: `session.resume` vs `session.send`

### 2.1 Como funciona o billing no SDK

Ao analisar os tipos `@github/copilot-sdk/dist/generated/session-events.d.ts`, identificamos que
**o billing ocorre no evento `assistant.usage`**, que é emitido dentro de um ciclo
`assistant.turn_start` → (tool calls) → `assistant.turn_end`. O event `assistant.usage` contém
campos como:

```ts
{
  type: "assistant.usage",       // ephemeral: true — não persistido no log
  data: {
    model: string,
    inputTokens?: number,
    outputTokens?: number,
    cost?: number,               // multiplicador de billing
    quotaSnapshots?: { ... },    // snapshots de quota CAPI por tipo
    copilotUsage?: { ... },      // dados de billing detalhados
  }
}
```

**Conclusão**: um PR é consumido quando o LLM backend processa a requisição e retorna o evento
`assistant.usage`. Se a requisição **nunca chega ao LLM backend** (erro de rede, rate-limit no proxy,
timeout antes do processamento), o `assistant.usage` não é emitido e **nenhum PR é cobrado**.

### 2.2 Diferença entre `createSession` e `resumeSession`

O SDK diferencia claramente:

- **`client.createSession(config)`** → cria nova sessão no servidor CLI; **gera novo `sessionId`**
- **`client.resumeSession(sessionId, config)`** → reconecta a uma sessão existente;  
  **reutiliza o contexto e histórico** sem novo "session.start" de billing

O evento `session.resume` contém:
```ts
{
  type: "session.resume",
  data: {
    resumeTime: string,       // quando foi retomada
    totalEventCount: number,  // total de eventos persistidos na sessão
    selectedModel?: string,   // modelo ativo no momento da retomada
  }
}
```

**Fundamental**: ao retomar uma sessão com `resumeSession`, o histórico é preservado no servidor.
O LLM recebe todo o contexto anterior sem que o cliente precise enviar novamente — mas isso
**não reprocessa** a requisição com falha.

### 2.3 O mecanismo do "Tentar novamente" no VS Code

Com base na investigação, o fluxo provável é:

```
1. Usuário envia mensagem → session.send()          [PR AINDA NÃO CONTADO]
2. Erro ocorre antes do LLM processar               [assistant.usage NÃO emitido]
3. VS Code detecta o erro e exibe "Tentar novamente"
4. Usuário clica → session.send() da MESMA mensagem [mesma sessão ativa]
                   OU client.resumeSession() + session.send()
5. LLM processa com sucesso                         [PR CONTADO NESTE PONTO]
```

A chave é que **o mesmo `sessionId` é reutilizado** com o histórico intacto. O VS Code não cria
uma nova sessão — ele retoma a existente e reenvía a mensagem que não foi processada.

### 2.4 Hook `onErrorOccurred`

O SDK expõe o hook `onErrorOccurred` que pode controlar automaticamente o retry:

```ts
interface ErrorOccurredHookOutput {
  suppressOutput?: boolean;         // esconde mensagem de erro para o usuário
  errorHandling?: "retry" | "skip" | "abort";  // decide o que fazer
  retryCount?: number;              // quantas vezes tentar
  userNotification?: string;        // mensagem customizada
}
```

**Insight**: com `errorHandling: "retry"` e `retryCount: N`, o SDK pode **automaticamente** fazer
N tentativas sem intervenção do usuário — e sem cobrar PRs se o LLM não chegou a processar.

---

## 3. Estado Atual do Nosso Agente

### 3.1 Como nossa sessão é gerenciada hoje

```
src/copilot/agent/
├── session-manager.js   → persiste sessionId em disco (STATE_FILE)
├── always-alive.js      → chama resumeOrCreate() ao iniciar
└── lib/session.js       → resumeOrCreate() decide entre resume e create
```

**Fluxo atual** (em `resumeOrCreate`):
1. Lê `sessionId` do disco via `readState()`
2. Se existe → tenta `client.resumeSession(sessionId, opts)`
3. Se falha → cai para `client.createSession(opts)` → **NOVO sessionId, sem histórico**
4. Novo sessionId é gravado em disco

**Problema**: quando o PC reinicia e o agente sobe novamente, `resumeOrCreate()` tenta retomar
a sessão. Se o servidor CLI ainda tiver a sessão ativa, funciona. Mas em vários cenários a sessão
pode ter expirado ou o CLI pode estar reiniciando também.

### 3.2 O que acontece com os PRs hoje

- Cada `session.send()` que chega ao modelo = 1 PR potencial
- Se o agente crashed e cria nova sessão → **não consome PR no create**, só no próximo send
- Se o dialog loop envia "READY:" a cada ciclo via `ask_user` → isso **NÃO consome PRs**
  (ask_user é uma ferramenta local, não um LLM call novo)
- O PR é consumido quando `session.send({ prompt: message })` retorna um `assistant.usage` event

### 3.3 Gaps identificados

| Gap | Descrição | Impacto |
|-----|-----------|---------|
| **GAP-PR-01** | `onErrorOccurred` hook não configurado nos nossos sessions | Sem auto-retry no SDK |
| **GAP-PR-02** | Falha em `resumeSession` → `createSession` imediato (sem espera) | Pode desperdiçar sessão válida |
| **GAP-PR-03** | Sem detecção do tipo de erro (rate-limit vs fatal vs network) | Retry cego vs retry seletivo |
| **GAP-PR-04** | `assistant.usage` não é escutado/logado | Sem visibilidade de billing real-time |
| **GAP-PR-05** | Sem backoff em reconexões ao CLI server | Pode criar múltiplas sessões em burst |
| **GAP-PR-06** | Nenhum mecanismo para "solicitar retry" ao usuário via API HTTP | Sem equivalente do botão VS Code |
| **GAP-PR-07** | Sem persistência do `pendingTurn` (mensagem que falhou) | Perda de contexto após crash |

---

## 4. Como Atingir o Mesmo Comportamento (Retry sem PR)

### 4.1 Estratégia: Capturar falhas antes do LLM processar

Para emular o comportamento do "Tentar novamente" sem consumir PR, precisamos identificar quando
o erro ocorreu **antes** do processamento LLM:

```
Errros que NÃO consomem PR (se ocorrem antes do LLM processar):
  - ECONNREFUSED, ECONNRESET, ETIMEDOUT (rede)
  - HTTP 429 (rate-limit — dependendo do gateway)
  - HTTP 503 (serviço indisponível)
  - Timeout do próprio cliente SDK
  - CLI server caiu/reiniciou

Erros que JÁ consumiram PR (LLM processou mas houve problema depois):
  - Erro no parsing da resposta (raro)
  - Tool execution error APÓS assistant.usage emitido
  - Context window exceeded (o modelo processou mas recusou)
```

### 4.2 Hook `onErrorOccurred` — implementação proposta

Em `src/copilot/lib/session.js`, adicionar ao `buildSessionConfig()`:

```js
hooks: {
    onErrorOccurred: (input, { sessionId }) => {
        const { error, errorContext, recoverable } = input;

        // Erros de rede/disponibilidade → retry automático sem contar PR
        if (recoverable && errorContext === 'model_call') {
            log('WARN', `[session] onErrorOccurred: ${error} — retry automático (recoverable)`);
            return {
                errorHandling: 'retry',
                retryCount: 3,    // máx 3 tentativas antes de abort
                userNotification: `Erro temporário (${error}), tentando novamente...`,
            };
        }

        // Erros não-recuperáveis → abort sem contar
        return { errorHandling: 'abort' };
    },
    ...opts.hooks,   // composição com hooks externos
}
```

### 4.3 Persistência do turno pendente (`pendingTurn`)

Para sobreviver a reinicializações do PC, precisamos persistir a mensagem que estava sendo
processada quando o agente morreu:

**Em `session-manager.js`** — adicionar ao `AliveAgentState`:
```js
/** @property {string} [pendingTurnMessage] - Última mensagem enviada ao LLM (pode precisar de retry) */
/** @property {number} [pendingTurnTs] - Timestamp do envio (0 = sem turno pendente) */
/** @property {boolean} [pendingTurnConsumedPR] - Se o PR já foi contabilizado para este turno */
```

**Em `always-alive.js`** — em `#executeDialogTurn()`:
```js
// ANTES do session.send():
await writeStateAsync({ pendingTurnMessage: message, pendingTurnTs: Date.now(), pendingTurnConsumedPR: false });

// NO evento 'assistant.usage' (dentro do session.on handler):
await writeStateAsync({ pendingTurnConsumedPR: true });

// NO evento 'assistant.turn_end' (turno concluído):
await writeStateAsync({ pendingTurnMessage: '', pendingTurnTs: 0, pendingTurnConsumedPR: false });
```

### 4.4 Detecção de `assistant.usage` para flag `consumedPR`

O evento `assistant.usage` é emitido via `session.on(handler)`. Podemos interceptá-lo:

**Em `always-alive.js`** — no setup do session event handler:
```js
this.#unsubSession = session.on((event) => {
    if (event.type === 'assistant.usage') {
        // PR foi consumido — atualizar flag
        const { model, cost, quotaSnapshots } = event.data;
        writeStateAsync({ pendingTurnConsumedPR: true }).catch(...);
        this.emit('session.usage', { model, cost, quotaSnapshots });
        log('INFO', `[AlwaysAlive] assistant.usage: model=${model}, cost=${cost ?? 0}`);
    }
    // ... outros eventos
});
```

### 4.5 Retry após reinicialização do PC

**Em `always-alive.js`** — no `#initialize()` após `resumeOrCreate()`:

```js
// Verificar se havia turno pendente ao reiniciar
const state = readState();
if (state?.pendingTurnMessage && state.pendingTurnTs && !state.pendingTurnConsumedPR) {
    const pendingAge = Date.now() - state.pendingTurnTs;
    // Só reenviar se o turno é recente (< 12h) e o PR não foi consumido
    if (pendingAge < 12 * 60 * 60 * 1000) {
        log('INFO', `[AlwaysAlive] Detectado turno pendente (${Math.round(pendingAge/1000)}s atrás) sem PR consumido — reenfileirando.`);
        // Aguardar o dialog loop ficar ready e então reenviar
        this.once('dialog.ready', () => {
            this.sendDialogTurn(state.pendingTurnMessage).catch(e =>
                log('WARN', `[AlwaysAlive] Retry de turno pendente falhou: ${e.message}`)
            );
        });
    }
}
```

### 4.6 Modelo fallback em caso de rate-limit

Quando um modelo específico retorna rate-limit (HTTP 429), podemos fazer fallback automático:

**Em `entry.js`** — configurar múltiplos modelos prioritários:
```js
const MODELS_PRIORITY = [
    process.env.COPILOT_MODEL ?? 'claude-sonnet-4-5',
    'gpt-4.1',
    'gpt-4o',
];
```

**Em `always-alive.js`** — no handler `onErrorOccurred` ou em `#tryReconnect()`:
```js
// Se erro for rate-limit (HTTP 429), tentar próximo modelo na fila
if (error.includes('429') || error.includes('rate_limit')) {
    const nextModel = getNextModelFallback(this.#model);
    if (nextModel) {
        log('WARN', `[AlwaysAlive] Rate-limit em ${this.#model} → fallback para ${nextModel}`);
        this.#model = nextModel;
        // Recriar sessão com modelo alternativo
        await this.#initialize();
        return true;   // recuperado
    }
}
```

---

## 5. Proposta de Novos Issues / Implementações

### Issue RF-PR-01 — Hook `onErrorOccurred` com retry automático

**Prioridade**: 🔴 Alta  
**Arquivo**: `src/copilot/lib/session.js`  
**Esforço**: Pequeno (1-2h)

Adicionar `hooks.onErrorOccurred` em `buildSessionConfig()` para retry automático em erros
recuperáveis (`model_call` + `recoverable: true`).

**Benefício**: O SDK faz retry internamente antes de propagar o erro para o agente — exatamente
como o botão "Tentar novamente" do VS Code, mas **automático e sem PR** se o LLM não processou.

---

### Issue RF-PR-02 — Persistência de `pendingTurnMessage` e flag `pendingTurnConsumedPR`

**Prioridade**: 🟡 Média  
**Arquivo**: `src/copilot/agent/session-manager.js` + `always-alive.js`  
**Esforço**: Médio (3-4h)

Adicionar ao `AliveAgentState`:
- `pendingTurnMessage?: string` — mensagem do último turno enviado
- `pendingTurnTs?: number` — timestamp do último send
- `pendingTurnConsumedPR?: boolean` — se `assistant.usage` já foi emitido para este turno

Gravar antes de enviar, atualizar ao receber `assistant.usage`, limpar ao receber `assistant.turn_end`.

**Benefício**: Após reinicialização, o agente sabe se havia um turno pendente sem PR consumido
e pode reenfileirá-lo automaticamente.

---

### Issue RF-PR-03 — Escuta de `assistant.usage` para métricas de billing real-time

**Prioridade**: 🟡 Média  
**Arquivo**: `src/copilot/agent/always-alive.js`  
**Esforço**: Pequeno (1h)

No handler `session.on(event)`, interceptar `event.type === 'assistant.usage'` e:
1. Emitir `this.emit('session.usage', { model, cost, quotaSnapshots })`
2. Gravar `pendingTurnConsumedPR: true` em disco via `writeStateAsync`
3. Log do custo para `#telemetry` via `recordToolCall`

**Benefício**: Visibilidade de billing real-time; permite detectar quando quota está se esgotando
e ajustar estratégia (fallback de modelo, etc.).

---

### Issue RF-PR-04 — Endpoint HTTP `/quota` para monitoramento de PRs restantes

**Prioridade**: 🟢 Baixa  
**Arquivo**: `src/copilot/server/` (novo endpoint)  
**Esforço**: Pequeno (1-2h)

Criar endpoint `GET /quota` que retorna:
```json
{
  "premium_interactions": {
    "entitlementRequests": 300,
    "usedRequests": 45,
    "remainingPercentage": 0.85,
    "resetDate": "2026-08-01"
  },
  "lastUsageTs": 1720000000000,
  "pendingTurn": {
    "active": false,
    "consumedPR": false
  }
}
```

Usando `client.rpc.account.getQuota()` (disponível na SDK via `session.rpc`).

**Benefício**: Dashboard externo pode monitorar PRs restantes sem entrar na interface VS Code.

---

### Issue RF-PR-05 — Fallback automático de modelo em rate-limit

**Prioridade**: 🟢 Baixa  
**Arquivo**: `src/copilot/agent/always-alive.js` + `entry.js`  
**Esforço**: Médio (3-4h)

Configurar lista de modelos fallback em `COPILOT_MODEL_FALLBACKS` e implementar troca automática
quando o modelo primário retornar rate-limit (HTTP 429). A troca persiste até o modelo primário
ser restaurado (verificação a cada N minutos via `listModels()`).

**Benefício**: Operação contínua sem PRs desperdiçados mesmo quando um modelo específico está
sobrecarregado.

---

### Issue RF-PR-06 — `disableResume: true` como flag de emergência

**Prioridade**: 🟢 Baixa  
**Arquivo**: `src/copilot/lib/session.js`  
**Esforço**: Trivial (30min)

Expor `disableResume? boolean` como opção em `SessionResumeOptions`. Quando `true`, usar
`client.resumeSession(id, { disableResume: true })` para reconectar sem emitir `session.resume`
— útil quando queremos ignorar side-effects do resume mas manter o contexto.

**Benefício**: Evita re-execução de hooks `onSessionStart` indesejados em reconexões silenciosas.

---

## 6. Roadmap Proposto

| ID | Prioridade | Item | Arquivo(s) | Esforço |
|----|-----------|------|------------|---------|
| RF-PR-01 | 🔴 Alta | `onErrorOccurred` hook com retry automático | `lib/session.js` | Pequeno |
| RF-PR-02 | 🟡 Média | Persistência `pendingTurnMessage` + `consumedPR` | `session-manager.js` + `always-alive.js` | Médio |
| RF-PR-03 | 🟡 Média | Escuta `assistant.usage` para billing real-time | `always-alive.js` | Pequeno |
| RF-PR-04 | 🟢 Baixa | Endpoint `GET /quota` | `server/` | Pequeno |
| RF-PR-05 | 🟢 Baixa | Fallback automático de modelo em rate-limit | `always-alive.js` + `entry.js` | Médio |
| RF-PR-06 | 🟢 Baixa | `disableResume: true` como flag de emergência | `lib/session.js` | Trivial |

**Ordem recomendada de implementação:**
1. RF-PR-01 (menor esforço, maior impacto — retry automático sem PR)
2. RF-PR-03 (visibilidade de billing)
3. RF-PR-02 (persistência para sobreviver a reboot)
4. RF-PR-04, RF-PR-05, RF-PR-06 (polimento)

---

## 7. Análise do SDK: Campos Relevantes

### 7.1 Evento `assistant.usage` (billing trigger)

```ts
{
  type: "assistant.usage",
  ephemeral: true,              // NÃO persistido no log de sessão
  data: {
    model: string,              // modelo que processou
    inputTokens?: number,
    outputTokens?: number,
    cost?: number,              // multiplicador de billing
    quotaSnapshots?: {
      [quotaType: string]: {
        isUnlimitedEntitlement: boolean,
        entitlementRequests: number,
        usedRequests: number,
        usageAllowedWithExhaustedQuota: boolean,
        overage: number,
        remainingPercentage: number,  // 0.0 a 1.0
        resetDate?: string,
      }
    },
    copilotUsage?: { tokenDetails: [...] },
    initiator?: string,         // "sub-agent" se não for user-initiated
  }
}
```

### 7.2 Hook `onErrorOccurred` (controle de retry)

```ts
interface ErrorOccurredHookInput {
  error: string;
  errorContext: "model_call" | "tool_execution" | "system" | "user_input";
  recoverable: boolean;
  sessionId: string;
}

interface ErrorOccurredHookOutput {
  suppressOutput?: boolean;
  errorHandling?: "retry" | "skip" | "abort";
  retryCount?: number;
  userNotification?: string;
}
```

### 7.3 `AccountGetQuotaResult` (monitoramento)

```ts
interface AccountGetQuotaResult {
  quotaSnapshots: {
    [k: string]: {          // ex: "premium_interactions", "chat"
      entitlementRequests: number,
      usedRequests: number,
      remainingPercentage: number,
      overage: number,
      overageAllowedWithExhaustedQuota: boolean,
      resetDate?: string,
    }
  }
}
```

---

## 8. Conclusão

O "Tentar novamente" sem PR no VS Code funciona porque:

1. **O `sessionId` é preservado** — a sessão não é recriada, o histórico fica intacto
2. **O billing ocorre apenas quando `assistant.usage` é emitido** — se o erro aconteceu antes
   do LLM processar, nenhum PR foi cobrado
3. **O retry reusa o contexto existente** — tecnicamente é um `session.send()` na mesma sessão

Para emular isso no nosso agente:
- **Imediato**: implementar `onErrorOccurred` com retry automático (RF-PR-01)
- **Médio prazo**: persistir `pendingTurnMessage` para retry após reboot (RF-PR-02)
- **Observabilidade**: escutar `assistant.usage` para saber exatamente quando PRs são consumidos (RF-PR-03)
