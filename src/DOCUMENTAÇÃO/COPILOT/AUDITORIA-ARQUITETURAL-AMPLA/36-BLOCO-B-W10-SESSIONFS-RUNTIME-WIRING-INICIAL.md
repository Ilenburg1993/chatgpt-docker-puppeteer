# 36 — Bloco B: W10 — Wiring Inicial de `sessionFs` no Runtime Real

**Status**: checkpoint de transformação efetiva **Última atualização**: 2026-04-27

---

## 1. Objetivo desta subonda

Promover `sessionFs` de “capability descrita em contrato” para “capability com wiring real mínimo”
no runtime de `src/copilot/`.

---

## 2. Decisão de owner

Foi adotada a seguinte distribuição de responsabilidade:

- `boot/session-fs.js`
  - owner da leitura canônica de env/paths/defaults de SessionFs;
- `sdk/session/session-fs.js`
  - owner do provider local, da tradução da config de boot para surface L1 e do handler por sessão;
- `sdk/session/client-options.js`
  - owner da promoção client-level (`sessionFs`, `sessionIdleTimeoutSeconds`);
- `agent/session/initializer.js`
  - consumer do handler configurado, propagando-o para a sessão viva criada/retomada.

---

## 3. Transformações aplicadas

### 3.1 Camada de boot

Criado `boot/session-fs.js` com:

- defaults canônicos;
- env keys dedicadas;
- resolução de storage root;
- leitura consolidada da config de SessionFs.

### 3.2 Camada SDK

Criado `sdk/session/session-fs.js` com:

- provider local baseado em `node:fs/promises`;
- proteção contra path traversal;
- handler por sessão (`createWorkspaceSessionFsHandler()`);
- promotion helpers:
  - `buildConfiguredClientSessionFsConfig()`
  - `getConfiguredSessionIdleTimeoutSeconds()`
  - `getConfiguredSessionFsHandler()`

### 3.3 Client-level wiring

`sdk/session/client-options.js` agora consome a config de SessionFs e a inclui automaticamente em
`buildCopilotClientOptionsFromEnv()` quando habilitada.

### 3.4 Session-level wiring

`agent/session/initializer.js` agora injeta `createSessionFsHandler` configurado no fluxo de
`initOrResumeSession()`.

---

## 4. Estado alcançado

Após esta subonda, `sessionFs` passa a existir de forma coerente em quatro níveis:

1. contrato de boot;
2. contract surface L1 do SDK wrapper;
3. client options reais;
4. sessão viva do agent.

Ainda não é a forma final da capability, mas já deixou de ser apenas lacuna ou placeholder.

---

## 5. Próximos passos

Os próximos cortes ideais no eixo `sessionFs` são:

1. observabilidade específica das operações de SessionFs, se o volume justificar;
2. decisão se a capability ficará sempre local/Node ou se ganhará adapters adicionais;
3. eventual gate estrutural específico para soberania do owner SessionFs;
4. ADR final do boundary SDK consolidando a capability.
