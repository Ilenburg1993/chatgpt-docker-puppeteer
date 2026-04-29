# 54 — Mapeamento: cleanup defensivo de sessões e boundary canônico de `provider`

**Data:** 2026-04-29 **Escopo:** `agent/session/cleanup.js`, `agent/facades/agent-sdk-access.js`,
`server/routes/sdk/session-crud.js`, `config/session-config.js`, `sdk/session/provider.js`.

---

## 1. Objetivo desta subonda

Esta subonda fecha dois gaps de integração que permaneciam abertos entre runtime vivo, bordas HTTP e
boundary do SDK:

1. **cleanup agressivo demais** no boot do agent, com risco de deletar sessões que ainda deveriam
   ser preservadas em fluxos paralelos;
2. **validação inconsistente de `provider`** entre builder declarativo, rotas HTTP e wrappers do
   SDK.

A meta foi endurecer esses eixos sem introduzir novos owners concorrentes.

---

## 2. Problema A — cleanup de sessões stale sem política defensiva suficiente

`cleanupStaleSessions()` já preservava a sessão atual (`currentSessionId`), mas isso ainda deixava
uma área cinzenta:

- sessões em foreground no SDK;
- última sessão referenciada pelo client;
- seeds explícitos informados pelo caller.

Em cenários com fluxos paralelos (terminal, rotas SDK, foreground switching), uma limpeza baseada
apenas em `currentSessionId` era defensiva demais para o agent, mas ainda pouco conservadora para o
ecossistema mais amplo do runtime.

---

## 3. Correção aplicada — protected session set

Foi introduzida na façade `agent-sdk-access.js` a operação:

- `listAgentSdkProtectedSessionIdsByClient(client, seedIds?)`

Ela consolida a lista canônica de IDs protegidos por cleanup, combinando:

- seeds fornecidos pelo caller;
- `client.getForegroundSessionId()`;
- `client.getLastSessionId()`.

`cleanupStaleSessions()` agora passa a operar sobre um `protectedIdSet`, e não apenas sobre um único
`currentSessionId`.

### Efeito arquitetural

- `cleanup.js` continua owner da política de remoção de sessões stale;
- `agent-sdk-access.js` passa a ser owner da descoberta de IDs protegidos no boundary do SDK;
- `boot-steps` continua apenas decidindo **quando** acionar a limpeza.

---

## 4. Problema B — validação de `provider` espalhada/incompleta

O boundary do SDK já possuía `validateProviderConfig()`, mas havia assimetria:

- o builder declarativo aceitava `provider` sem normalização explícita;
- as rotas HTTP aceitavam `provider` como `unknown` e repassavam o valor cru ao SDK manager;
- a semântica de normalização (por exemplo, trimming de `baseUrl`) não estava congelada na borda.

---

## 5. Correção aplicada — validação canônica em todos os pontos de entrada

### 5.1 Builder declarativo

`SessionConfigBuilder.provider()` agora valida/normaliza via `validateProviderConfig()` exposto por
`sdk-config-port.js`.

### 5.2 Rotas HTTP SDK

`server/routes/sdk/session-crud.js` agora usa:

- `normalizeRouteProvider(routeDeps, provider, res)`

com `routeDeps.sdkSession.validateProviderConfig(...)` antes de montar o payload de
`createClientSession()`/`resumeClientSession()`.

### 5.3 Contracto de deps das rotas

`server/routes/sdk/deps.js` passou a expor `validateProviderConfig` como parte da superfície
canônica de `sdkSession` consumida pelas rotas.

---

## 6. Regra arquitetural consolidada

A regra geral deste eixo fica:

> **`provider` é validado e normalizado exclusivamente pelo boundary SDK, e todas as bordas (builder
> declarativo, rotas HTTP, consumers do agent) devem delegar a esse boundary em vez de reconstruir
> regras locais.**

E, no eixo de limpeza:

> **o runtime pode decidir quando limpar sessões stale, mas a definição de quais sessões estão
> protegidas deve ser enriquecida pelo próprio boundary SDK, não por heurística incompleta do
> caller.**

---

## 7. Testes de regressão desta subonda

Foram adicionadas/expandidas regressões para garantir:

- `cleanupStaleSessions()` preserva foreground/last-session;
- `SessionConfigBuilder.provider()` normaliza e rejeita configs inválidos;
- `POST /sessions` e `POST /sessions/:id/resume` rejeitam `provider` inválido antes de tocar o SDK;
- as rotas repassam `provider` normalizado ao manager do SDK.

---

## 8. Como isso se encaixa no plano geral

Esta subonda avança simultaneamente:

### P1 — Soberania do boundary SDK

- reforça `validateProviderConfig()` como SSOT de `provider`;
- remove validações ad hoc em builders/bordas.

### P2 — Purificação do runtime `agent/`

- torna a limpeza stale mais segura frente a fluxos paralelos;
- reduz o risco de o runtime vivo interferir destrutivamente em outras superfícies do ecossistema.

### Waves afetadas

- **W15** — endurecimento de `sdk/session/provider.js` e consumers;
- **W17/W18** — clarificação de ownership e redução de heurísticas locais;
- **W23** — separação mais limpa entre boot/runtime/SDK boundary.

---

## 9. Resultado líquido

Depois desta subonda:

- o cleanup do agent ficou mais conservador e menos propenso a deletar sessões ainda protegidas;
- o `provider` passou a ter uma fronteira de validação verdadeiramente canônica;
- builder, rotas HTTP e manager do SDK agora convergem para a mesma semântica.
