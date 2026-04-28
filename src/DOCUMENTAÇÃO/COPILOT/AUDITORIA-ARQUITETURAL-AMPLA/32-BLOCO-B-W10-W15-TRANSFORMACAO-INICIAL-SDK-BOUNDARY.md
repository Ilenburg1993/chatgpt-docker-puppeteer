# 32 — Bloco B: W10–W15 — Transformação Inicial do SDK Boundary

**Status**: transformação efetiva iniciada **Última atualização**: 2026-04-27 **Escopo desta
etapa**: registrar a primeira onda concreta de código do Bloco B, após o inventário de capabilities
pendentes do SDK.

---

## 1. Objetivo desta onda

O documento 31 encerrou a fase de inventário do Bloco B. Esta etapa marca a passagem do diagnóstico
para a transformação efetiva.

Os objetivos desta primeira onda foram:

1. endurecer superfícies vanilla ainda frágeis em `sdk/session/permissions.js`;
2. endurecer a surface de BYOK em `sdk/session/provider.js`;
3. reduzir um gap concreto de promoção de capability em `config/session-config.js`;
4. sincronizar testes e SSOT de tipos com o novo estado real.

---

## 2. Transformações executadas

## 2.1 `sdk/session/permissions.js`

### Mudanças aplicadas

- introduzido tratamento explícito de falha em `onRequest` com normalização para `SdkOperationError`
  via `toSdkOperationError()`;
- `onRequest` agora recebe explicitamente `invocation` na tipagem local do wrapper;
- adicionado suporte a decisões custom booleanas (`true` / `false`) e `'deny'`, com normalização
  para `PermissionRequestResult`;
- adicionada validação fail-fast para:
  - `allowTools`
  - `denyTools`
  - `denyKinds`
  - `denyPatterns`
- logging reforçado com `sessionId`, `kind` e `toolName`.

### Efeito arquitetural

Essa mudança não reabre a fronteira `hooks/` → `sdk/`, mas reduz o desnível semântico entre:

- a policy layer de `hooks/permission-handler.js`;
- e o wrapper vanilla-friendly em `sdk/session/permissions.js`.

Resultado: a superfície L1 ficou mais robusta sem absorver governança de policy que continua
pertencendo a `hooks/`.

---

## 2.2 `sdk/session/provider.js`

### Mudanças aplicadas

- `ProviderConfig` local passou a incluir `headers`;
- validação agora cobre:
  - `baseUrl` absoluto;
  - protocolo `http`/`https`;
  - `apiKey` não-vazia quando fornecida;
  - `bearerToken` não-vazio quando fornecido;
  - `azure.apiVersion` não-vazio quando fornecido;
  - `headers` como objeto plano de strings;
- `validateProviderConfig()` agora canonicaliza `type: 'openai'` quando ausente;
- providers `openai`, `azure` e `anthropic` passaram a aceitar `headers`;
- `wireApi` passou a ser rejeitado explicitamente para `anthropic`;
- `azureProvider()` passou a emitir warning quando `baseUrl` inclui path não-trivial, alinhando a
  surface local ao guidance oficial do SDK.

### Efeito arquitetural

O módulo `sdk/session/provider.js` saiu do estado de “helper funcional, porém raso” para uma surface
mais alinhada à responsabilidade de owner do vanilla boundary para BYOK.

Ainda não fecha todo o programa P1, mas reduz a distância entre:

- contrato do SDK;
- validação local;
- semântica arquitetural documentada.

---

## 2.3 `config/session-config.js`

### Mudanças aplicadas

- adicionado método fluent `.gitHubToken(token)` no `SessionConfigBuilder`;
- adicionado método fluent `.createSessionFsHandler(handler)` no `SessionConfigBuilder`;
- `sdk/types.js` foi expandido para tipar:
  - `SessionFsProvider`
  - `CreateSessionFsHandler`
  - `ProviderConfig.headers`

### Efeito arquitetural

Essa mudança ataca diretamente um dos gaps mapeados no documento 31:

- session-level `gitHubToken` deixa de ser apenas capability prevista no SDK e passa a existir como
  builder explícito no plano declarativo local;
- `createSessionFsHandler` deixa de ser contrato silencioso e passa a ter surface declarativa mínima
  no builder.

Isso **não significa que `sessionFs` esteja plenamente promovido**. Significa apenas que a lacuna
foi reduzida e a capability entrou explicitamente na superfície local de configuração.

---

## 3. Testes expandidos

Foram ampliados os seguintes testes:

- `tests/unit/copilot/sdk/test_sdk_permissions.spec.js`
- `tests/unit/copilot/sdk/test_sdk_provider.spec.js`
- `tests/unit/copilot/config/test_faixa_c_session_config_builder.spec.js`

### Cobertura nova introduzida

#### Permissions

- normalização de retornos booleanos de `onRequest`;
- passagem explícita de `invocation` ao callback custom;
- falha em `onRequest` convertida em `SdkOperationError`;
- validação de arrays de allow/deny.

#### Provider

- `headers` em OpenAI/Azure/Anthropic;
- `type` default para configs genéricos;
- rejeição de `wireApi` para Anthropic;
- validação de `headers` e `apiKey`.

#### SessionConfigBuilder

- `gitHubToken()`;
- `createSessionFsHandler()`.

---

## 4. Validação executada nesta onda

### Testes focados

- `tests/unit/copilot/sdk/test_sdk_permissions.spec.js`
- `tests/unit/copilot/sdk/test_sdk_provider.spec.js`
- `tests/unit/copilot/config/test_faixa_c_session_config_builder.spec.js`

Resultado:

- **103/103 testes verdes** no lote focado.

### Qualidade local

- `npm run typecheck:node` ✅
- `npm run lint` ✅

### Formatação

- pendências de Prettier identificadas no pacote documental foram normalizadas após esta onda.

---

## 5. O que esta onda ainda NÃO resolve

Esta primeira subonda do Bloco B ainda não fecha:

1. a promoção completa de `sessionFs` como capability arquitetural madura;
2. a integração de `createSessionFsHandler` com wiring real de runtime/boot;
3. o hardening profundo de `sdk/session/lifecycle.js` e `sdk/config.js` à luz dessas novas
   capabilities;
4. recovery por `SdkErrorKind`;
5. a ADR final da fronteira SDK.

---

## 6. Próximas ondas recomendadas do Bloco B

### W10 complementar

- revisar `sdk/session/lifecycle.js` para garantir passagem explícita de:
  - `gitHubToken`
  - `createSessionFsHandler`
  - demais fields sensíveis do SDK 0.3.x

### W14 complementar

- avaliar se `sdk/session/permissions.js` deve emitir métricas L1 para decisões de permissão ou se
  isso deve permanecer exclusivamente no domínio de policy (`hooks/` + `audit/`).

### W15 complementar

- decidir se `sdk/session/provider.js` deve permanecer apenas como builder/validator ou se merece
  surface adicional de capability health e provider diagnostics.

### W9 residual

- atacar o gap estrutural restante de `sessionFs`/`createSessionFsHandler` em runtime wiring real.

---

## 7. Síntese desta etapa

Esta foi a primeira onda em que o Bloco B deixou de ser apenas inventário e passou a ser
transformação concreta.

O ganho principal não foi “mais features”. Foi:

- aumentar a robustez do boundary SDK;
- reduzir drift entre o contrato do SDK e a surface local;
- trazer capabilities sensíveis para a superfície declarativa canônica;
- preparar o terreno para as próximas ondas do programa P1.
