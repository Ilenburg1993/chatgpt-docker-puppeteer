# 39 — Bloco B / W13 — Recovery por `SdkErrorKind` no boundary SDK

**Status**: checkpoint executado **Última atualização**: 2026-04-27 **Escopo desta etapa**:
introduzir política canônica de recovery por `SdkErrorKind` no boundary SDK, com integração real ao
`sdk/session/client.js` e ao `CircuitBreaker` já existente.

---

## 1. Objetivo desta subonda

O W13 do roadmap não pede apenas “mais uma classificação de erro”. Ele pede que a classificação de
erro do SDK passe a **governar comportamento operacional real**.

Nesta subonda, isso foi materializado em três níveis:

1. **policy canônica** de recovery por `SdkErrorKind` em `sdk/errors.js`;
2. **API operacional explícita** no `CircuitBreaker` (`guard`, `recordSuccess`, `recordFailure`);
3. **integração real** no singleton client (`sdk/session/client.js`) para `client.connect`.

---

## 2. Transformações aplicadas

### 2.1 `sdk/errors.js`

Foi introduzida a função:

- `getSdkRecoveryPolicy(error, scope = 'connection')`

Ela produz uma política estável com:

- `retryable`
- `allowReconnect`
- `tripCircuit`
- `resetCircuit`
- `backoffMs`
- `reason`

Decisões centrais:

- `rate_limit` → não retria, não abre circuito, reseta circuito
- `quota_exhausted` → não retria, não reconecta, não abre circuito
- `auth` → não abre circuito local, pois não representa indisponibilidade do transporte
- `network` / `timeout` → transitórios, com backoff e alimentação do circuit breaker
- `unknown` em escopo de conexão → tratado conservadoramente como transitório

### 2.2 `core/circuit-breaker.js`

O breaker ganhou uma surface operacional explícita:

- `guard()`
- `recordSuccess()`
- `recordFailure()`

Isso permite separar:

- **o momento de guarda** do circuito,
- **a decisão sobre o que conta como falha relevante** para abrir o circuito.

Essa separação era necessária para que `auth/quota/rate_limit` não contaminassem o breaker de
conexão local.

### 2.3 `sdk/session/client.js`

`getClient()` passou a incorporar:

- guard explícito do breaker;
- retry curto para falhas transitórias de conexão;
- backoff por policy derivada do `SdkErrorKind`;
- reset do breaker para falhas não estruturais de transporte (`auth`, `quota`, `rate_limit`);
- emissão de métricas L1 para `client.connect`.

### 2.4 `agent/facades/agent-sdk-access.js`

A policy também foi promovida à fronteira canônica do runtime:

- `getAgentSdkRecoveryPolicy(error, scope)`

Com isso, `agent/` passa a consumir a semântica de recovery do SDK via façade/barrel, sem reabrir
deep-imports de L1.

---

## 3. Resultado arquitetural

Antes desta onda:

- existia classificação de erro;
- existia breaker declarado;
- mas **não existia contrato explícito entre os dois**.

Depois desta onda:

- a taxonomia de erro do SDK passou a governar recovery real;
- o client singleton deixou de tratar toda falha como equivalente;
- o breaker local foi reclassificado como **owner de indisponibilidade de transporte**, não de
  quota/auth do vendor.

---

## 4. Validação focada desta subonda

Cobertura adicionada/expandida em:

- `tests/unit/copilot/test_core_circuit_breaker.spec.js`
- `tests/unit/copilot/sdk/test_sdk_client.spec.js`
- `tests/unit/copilot/test_agent_sdk_access.spec.js`

Aspectos validados:

- controle manual do breaker via `guard/recordSuccess/recordFailure`;
- `auth` não abre o circuito de conexão;
- falha transitória (`ECONNREFUSED`) usa retry curto e ainda converge para sucesso;
- `client.connect` emite métricas L1.

---

## 5. Leitura do roadmap após esta subonda

O W13 deixa de ser apenas item planejado e passa a estar **iniciado de forma concreta**.

O que ainda falta para considerar o eixo de recovery mais maduro:

1. ampliar a política para outros pontos de integração viva do SDK além de `client.connect`;
2. decidir se haverá projeções públicas de `SdkRecoveryPolicy` em `agent/` e `presentation/`;
3. integrar esse mesmo raciocínio a `session.resume`, `session.create` e flows de reconnect do
   runtime vivo.

---

## 6. Conclusão

Esta foi a primeira onda em que `SdkErrorKind` deixou de ser apenas semântica descritiva e passou a
ser **semântica executável de recovery** dentro do boundary SDK.
