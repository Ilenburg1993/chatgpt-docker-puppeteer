# 33 — Bloco B: W10 — Propagação de Session Auth e SessionFs em Lifecycle/Config

**Status**: transformação efetiva em progresso **Última atualização**: 2026-04-27 **Escopo desta
etapa**: registrar a segunda subonda do Bloco B, focada em impedir que capabilities recém-promovidas
fiquem presas apenas ao builder declarativo.

---

## 1. Objetivo desta subonda

Após a onda inicial do documento 32, dois riscos permaneceram claros:

1. `gitHubToken` por sessão existir no builder, mas não ser propagado pelos wrappers reais de
   lifecycle;
2. `createSessionFsHandler` existir no builder, mas continuar sem caminho efetivo até
   `createSession()` / `resumeSession()`.

Esta subonda atacou exatamente esse problema.

---

## 2. Transformações executadas

## 2.1 `sdk/session/lifecycle.js`

### Mudanças aplicadas

- `SessionCreateOptions` passou a documentar explicitamente:
  - `gitHubToken`
  - `createSessionFsHandler`
- `SessionResumeOptions` passou a documentar explicitamente:
  - `gitHubToken`
  - `createSessionFsHandler`
- o builder interno `buildSessionConfig(opts, mode)` agora propaga:
  - `gitHubToken`
  - `createSessionFsHandler` tanto no caminho de `createSession` quanto no de `resumeSession`.

### Efeito arquitetural

Isso reduz um smell importante:

> capability declarada, tipada e builderizada, mas ainda sem owner operacional nos wrappers reais.

Com essa mudança, `sdk/session/lifecycle.js` deixa de rebaixar silenciosamente duas capabilities
relevantes do SDK 0.3.x.

---

## 2.2 `sdk/config.js`

### Mudanças aplicadas

Embora a implementação já preservasse fields arbitrários por merge, a subonda adicionou teste
explícito cobrindo:

- `gitHubToken`
- `createSessionFsHandler`

### Efeito arquitetural

Isso transforma um comportamento implícito em contrato observado.

Em arquitetura revolucionária, isso é importante porque evita que uma futura “limpeza” do merge
elimine capabilities novas por acidente.

---

## 3. Testes adicionados/expandidos

### `tests/unit/copilot/sdk/test_sdk_session_core_lifecycle.spec.js`

Novos cenários:

- `createSession()` propaga `gitHubToken` e `createSessionFsHandler`;
- `resumeSession()` propaga `gitHubToken` e `createSessionFsHandler`.

### `tests/unit/copilot/sdk/test_sdk_config.spec.js`

Novo cenário:

- `buildSessionConfig()` preserva `gitHubToken` e `createSessionFsHandler` no merge canônico.

---

## 4. Validação executada

### Lote focado ampliado

- `tests/unit/copilot/sdk/test_sdk_session_core_lifecycle.spec.js`
- `tests/unit/copilot/sdk/test_sdk_config.spec.js`
- `tests/unit/copilot/sdk/test_sdk_permissions.spec.js`
- `tests/unit/copilot/sdk/test_sdk_provider.spec.js`
- `tests/unit/copilot/config/test_faixa_c_session_config_builder.spec.js`

Resultado:

- **131/131 testes verdes** no lote focado ampliado.

### Qualidade local

- `npm run typecheck:node` ✅
- `npm run lint` ✅
- `npm run format:check` ✅

---

## 5. Ganho arquitetural desta subonda

O ganho principal foi reduzir a distância entre três níveis que frequentemente divergem em sistemas
densos:

1. **o contrato oficial do vendor SDK**;
2. **a surface declarativa local** (`SessionConfigBuilder`);
3. **a surface operacional real** (`sdk/session/lifecycle.js`).

Antes da subonda, a capability já existia no contrato e no builder, mas não estava assegurada no
wrapper de lifecycle.

Depois da subonda, o caminho ficou:

`types` → `builder` → `config merge` → `lifecycle wrapper` → `client.createSession/resumeSession`

---

## 6. O que ainda falta depois desta etapa

Mesmo com a propagação concluída, o Bloco B ainda não fecha:

1. promoção arquitetural plena de `sessionFs` como capability de runtime, e não apenas de contrato;
2. wiring e ownership explícitos da infraestrutura de SessionFs no boot/runtime real;
3. definição se haverá observabilidade específica de SessionFs;
4. ADR final de session-scoped auth + session-scoped filesystem.

---

## 7. Próximo alvo recomendado

Se a transformação continuar imediatamente dentro do P1, o alvo mais limpo agora é:

### eixo `sessionFs`

- localizar se já existe substrate técnico no runtime para SessionFs;
- decidir owner entre `sdk/`, `boot/`, `infra/` e runtime host;
- criar a primeira integração real ou, ao menos, os contracts executáveis de soberania.

Em paralelo, um alvo secundário útil é:

### `sdk/config.js` e `sdk/session/lifecycle.js`

- revisar imports diretos de `approveAll` e outros pontos de consistência interna do boundary SDK;
- decidir se vale consolidar ainda mais a semântica de config/lifecycle para reduzir drift futuro.
