# 40 — Bloco B / W13 — Recovery no lifecycle e unificação do singleton session wrapper

**Status**: checkpoint executado **Última atualização**: 2026-04-27 **Escopo desta etapa**: estender
a política de recovery por `SdkErrorKind` de `client.connect` para `session.create`/`session.resume`
e reduzir duplicação em `sdk/session/client.js` por meio de reuso das wrappers canônicas de
lifecycle.

---

## 1. Objetivo desta subonda

O checkpoint anterior do W13 materializou recovery em `client.connect`, mas ainda deixava uma lacuna
importante:

- a conexão tinha semântica operacional guiada por `SdkErrorKind`;
- a criação/retomada de sessão ainda usava apenas normalização de erro;
- o singleton client mantinha um caminho paralelo de `createSession`/`resumeSession`.

Esta subonda fecha essa incoerência inicial.

---

## 2. Transformações aplicadas

### 2.1 `sdk/session/lifecycle.js`

Foi introduzido um runner interno de lifecycle com recovery curto:

- started/succeeded/failed metrics para:
  - `session.create`
  - `session.resume`
- retry curto para falhas transitórias de escopo `session`;
- reconnect best-effort via `client.start()` quando a policy permite;
- backoff guiado por `getSdkRecoveryPolicy(error, 'session')`.

Isso faz com que `session.create` e `session.resume` deixem de ser apenas wrappers com
`toSdkOperationError()` e passem a ser wrappers com semântica operacional explícita.

### 2.2 `sdk/session/client.js`

`createClientSession()` e `resumeClientSession()` deixaram de chamar `client.createSession()` e
`client.resumeSession()` diretamente.

Agora esses fluxos reutilizam:

- `createSession()`
- `resumeSession()`

de `sdk/session/lifecycle.js`, preservando:

- registro no registry de sessões ativas;
- logging local do singleton client;
- model metadata do registry.

Com isso, o singleton client deixa de ser um segundo owner de semântica de lifecycle.

---

## 3. Resultado arquitetural

Antes desta onda:

- recovery por `SdkErrorKind` existia em `client.connect`;
- `session.create`/`session.resume` tinham apenas normalização de erro;
- `sdk/session/client.js` duplicava parte do lifecycle.

Depois desta onda:

- `session.create` e `session.resume` também passam a responder a `SdkRecoveryPolicy`;
- o singleton client reutiliza as wrappers canônicas de lifecycle;
- o boundary SDK fica mais coerente: conexão e lifecycle já compartilham a mesma lógica base de
  recovery e observabilidade.

---

## 4. Validação focada desta subonda

Cobertura adicionada/expandida em:

- `tests/unit/copilot/sdk/test_sdk_session_core_lifecycle.spec.js`
- `tests/unit/copilot/sdk/test_sdk_client.spec.js`
- `tests/unit/copilot/sdk/test_sdk_session_registry_f26.spec.js`
- `tests/unit/copilot/test_lib_session.spec.js`

Aspectos validados:

- `session.create` aplica retry curto em falha transitória de rede;
- `session.resume` aplica retry curto em timeout e tenta reconnect best-effort;
- métricas `session.create`/`session.resume` são emitidas;
- `createClientSession()` herda a semântica de retry do lifecycle;
- contratos legados do módulo permanecem verdes.

---

## 5. Leitura do roadmap após esta subonda

O W13 já não está mais restrito a `client.connect`.

Neste ponto, o eixo de recovery já cobre:

- `client.connect`
- `session.create`
- `session.resume`
- singleton session wrappers que passaram a reutilizar lifecycle canônico

O gap remanescente passa a ser mais específico:

1. flows vivos adicionais de reconnect/recovery fora do lifecycle básico;
2. alinhamento fino com `permissions`/`provider` quando houver necessidade de retry/reconnect
   contextual;
3. eventual projeção pública mais explícita dessas decisões para observabilidade e runtime host.

---

## 6. Conclusão

Esta subonda consolida um passo importante da revolução arquitetural:

> o recovery por `SdkErrorKind` deixou de ser um comportamento isolado do client singleton e passou
> a estruturar também o lifecycle de sessão, reduzindo duplicação e reforçando o `sdk/` como owner
> operacional da semântica vanilla.
