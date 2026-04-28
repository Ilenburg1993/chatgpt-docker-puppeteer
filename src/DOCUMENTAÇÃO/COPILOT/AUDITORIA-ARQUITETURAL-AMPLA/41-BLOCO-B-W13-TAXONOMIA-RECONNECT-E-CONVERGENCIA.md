# 41 — Bloco B / W13 — Taxonomia de reconnect, complementaridade e convergência

**Status**: checkpoint executado **Última atualização**: 2026-04-27 **Escopo desta etapa**:
distinguir os sistemas de reconnect/retry já existentes em `src/copilot/`, identificar duplicações
reais e registrar a convergência aplicada nesta onda.

---

## 1. Problema investigado

Ao avançar o W13, surgiu uma dúvida arquitetural central:

> o reconnect recém-introduzido no boundary SDK está duplicando o reconnect já existente no runtime
> do agent?

A resposta, após investigação do código vivo, é:

- **não são a mesma coisa**;
- mas havia **zonas reais de duplicação heurística**;
- e essas zonas precisavam ser convergidas para impedir drift entre camadas.

---

## 2. Taxonomia dos sistemas de reconnect/retry encontrados

## 2.1 Recovery no boundary SDK (`sdk/`)

Arquivos centrais:

- `sdk/errors.js`
- `sdk/session/client.js`
- `sdk/session/lifecycle.js`

Função:

- classificar falhas do vendor (`SdkErrorKind`);
- decidir retry/backoff/reconnect local de baixo nível;
- governar circuit breaker de conexão;
- governar lifecycle básico (`session.create` / `session.resume`).

Esse reconnect é de **nível vanilla / transporte + lifecycle básico do SDK**.

## 2.2 Reconnect do runtime vivo (`agent/lifecycle/reconnect-policy.js`)

Arquivo central:

- `agent/lifecycle/reconnect-policy.js`

Função:

- reconstruir sessão ativa viva após falha durante processamento;
- recriar client quando necessário;
- reinicializar sessão via `initSession()`;
- reaplicar boot wiring da sessão reconectada;
- notificar dialog loop e host.

Esse reconnect é de **nível runtime vivo**, não de baixo nível do SDK.

## 2.3 Keepalive (`agent/session/keepalive.js`)

Função:

- evitar que a sessão expire por idle timeout;
- preferir `client.ping()` (0 PR);
- usar fallback `session.send()` quando necessário.

Isto **não é reconnect**. É **prevenção de expiração**.

## 2.4 Retry de boot do dialog loop (`terminal/dialog/engine.js`)

Função:

- tentar iniciar o loop humano do terminal quando o runtime ainda está subindo;
- evitar restart automático em cenários onde a policy SDK bloqueia reconnect.

Isto **não é reconnect de sessão viva**. É **retry de borda humana / boot UX**.

## 2.5 Auto-reconnect MCP

Eixo:

- `agent/session/boot-steps.js`
- `agent/ports/mcp-port.js`

Função:

- recuperar bridges/tooling MCP externos.

Isto é **reconnect de adapter externo**, não reconnect do SDK nem da sessão viva.

## 2.6 Retry em `channel/*`

Arquivos:

- `channel/inject.js`
- `channel/client.js`

Função:

- retry de transporte/edge protocol (`busy`, `503`, `timeout`, `ECONNRESET`).

Isto é **retry de borda/transporte**, não reconnect do runtime do agent.

---

## 3. Onde havia duplicação real

As duplicações mais relevantes eram:

### 3.1 Heurística de bloqueio de reconnect

- `sdk/` já sabia que `auth`, `rate_limit` e `quota_exhausted` não devem disparar reconnect;
- `agent/error-policy.js` só bloqueava explicitamente `rate_limit`/`quota`;
- `terminal/dialog/engine.js` também só bloqueava explicitamente `quota/rate_limit`.

Resultado: `auth` podia ser tratado de forma inconsistente entre camadas.

### 3.2 Backoff semântico

- `sdk/errors.js` já tinha `backoffMs` por `SdkRecoveryPolicy`;
- `agent/lifecycle/reconnect-policy.js` mantinha backoff próprio sem considerar esse floor.

Resultado: reconnect do runtime podia divergir da intenção semântica do boundary SDK.

### 3.3 Lifecycle paralelo no singleton client

- `sdk/session/lifecycle.js` ganhou recovery próprio;
- `sdk/session/client.js` ainda tinha create/resume paralelos.

Resultado: dois owners parciais para o lifecycle de sessão.

---

## 4. Transformações aplicadas nesta convergência

## 4.1 `agent/error-policy.js`

Agora a classificação fatal do agent deriva também da policy canônica do SDK:

- se a policy do SDK diz que a falha é conhecida e não deve reconnectar, `classifyAgentError()`
  retorna `fatal`.

Consequência:

- `auth` deixa de cair por conveniência no bucket `retry`.

## 4.2 `agent/lifecycle/reconnect-policy.js`

Agora o reconnect do runtime vivo:

- bloqueia a tentativa quando a policy SDK já diz que reconnect não deve ocorrer;
- usa `SdkRecoveryPolicy.backoffMs` como floor do delay do runtime.

Consequência:

- o runtime continua dono da reconstrução da sessão viva,
- mas a elegibilidade e o piso de backoff passam a respeitar o boundary SDK.

## 4.3 `terminal/dialog/engine.js`

Agora o retry do boot do dialog loop usa `getSdkRecoveryPolicy(err, 'session')` em vez de só
`isSdkQuotaOrRateLimitError(err)`.

Consequência:

- `auth` também bloqueia retry de borda humana quando apropriado;
- a UX do terminal deixa de manter uma heurística paralela incompleta.

## 4.4 `sdk/session/client.js`

Já nesta mesma onda complementar, `createClientSession()` e `resumeClientSession()` passaram a
reusar as wrappers canônicas de lifecycle.

Consequência:

- menos duplicação no L1;
- menos risco de divergência entre singleton client e wrappers públicos.

---

## 5. Leitura arquitetural resultante

O sistema fica mais claro quando descrito assim:

- **SDK boundary** decide se uma falha é retryable/reconnectable em nível vanilla;
- **Agent runtime** decide como reconstruir a sessão viva quando reconnect é permitido;
- **Keepalive** previne expiração, não reconecta;
- **Terminal dialog engine** administra retry de boot/UX da borda humana;
- **MCP auto-reconnect** recupera bridges externas;
- **Channel retry** recupera transporte de edge.

Em outras palavras:

> havia múltiplos sistemas legítimos, mas alguns deles compartilham a mesma semântica-base de
> elegibilidade para reconnect. Essa semântica-base agora foi parcialmente convergida para o SDK.

---

## 6. O que ainda permanece separado por design

Mesmo após a convergência, estas separações continuam corretas:

1. `sdk/` **não** deve virar owner de restart do dialog loop ou de boot wiring do agent;
2. `agent/` **não** deve reclassificar erros do vendor sem passar pela policy do SDK;
3. `terminal/` **não** deve reinventar política do vendor quando basta consultar a do SDK;
4. `keepalive` **não** deve ser confundido com reconnect;
5. reconnect de MCP **não** deve ser misturado com reconnect da sessão viva.

---

## 7. Próximos passos sugeridos

Os próximos cortes coerentes depois desta convergência são:

1. projetar no runtime/observability um status mais explícito de reconnect bloqueado por policy;
2. avaliar se `channel/*` deve consumir parte da taxonomia do SDK ou continuar completamente
   independente por ser transporte de borda;
3. revisar se existem mais callsites em `agent/` e `terminal/` que ainda classificam
   `auth/quota/rate_limit` por heurísticas locais incompletas.

---

## 8. Conclusão

O sistema de reconnect em `src/copilot/` não era um bloco único; era uma família de mecanismos em
níveis diferentes.

O problema real não era “ter reconnect demais”, mas sim:

- heurísticas-base parcialmente duplicadas;
- alguns owners corretos convivendo com heurísticas locais incompletas.

Esta onda não elimina a pluralidade de mecanismos — o que seria errado —, mas passa a alinhá-los em
torno de uma **semântica canônica de elegibilidade de reconnect** vinda do boundary SDK.
