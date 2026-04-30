# agent/lifecycle/

**Camada**: L4 — ciclo de vida do `AlwaysAliveAgent`.

Este diretório coordena start, stop, setup de sessão, reconexão, teardown e estado persistido do
agent. Ele também contém um entrypoint compatível legado (`entry.js`), mas o boot canônico fica em
`src/copilot/bootstrap.js` e `src/copilot/terminal/bootstrap.js`.

## Como ler este diretório

1. Comece por `index.js` para a superfície pública.
2. Use `module-map.js` para o inventário executável de papéis, tiers e arquivos.
3. Leia primeiro `orchestrators/agent-lifecycle.js`, que é o orquestrador primário.
4. Depois desça por papel: `process-host`, `setup`, `policy`, `teardown` e `state`.
5. Trate `state-file-io.js` como detalhe interno de filesystem, não como owner semântico de estado.

## Mapa atual de papéis

| Papel          | Arquivos                                      |
| -------------- | --------------------------------------------- |
| `entrypoint`   | `index.js`, `module-map.js`                   |
| `orchestrator` | `orchestrators/agent-lifecycle.js`            |
| `compat-entry` | `entrypoints/entry.js`                        |
| `process-host` | `process-host/runtime-host.js`                |
| `setup`        | `setup/session-setup.js`                      |
| `policy`       | `policies/reconnect-policy.js`                |
| `teardown`     | `teardown/runtime-teardown.js`                |
| `state`        | `state/state-io.js`, `state/state-file-io.js` |

## Situação física atual

A W114 aplicou a migração física sem shims persistentes. A raiz do diretório fica reservada a
navegação e superfície pública:

```text
agent/lifecycle/
  README.md
  index.js
  module-map.js
  orchestrators/
  entrypoints/
  process-host/
  setup/
  policies/
  teardown/
  state/
```

Qualquer arquivo funcional novo na raiz deve ser tratado como regressão arquitetural ou ter
justificativa explícita no `module-map.js` e no roadmap.

## Regra para novos arquivos

Todo novo arquivo em `agent/lifecycle/` precisa:

- aparecer em `module-map.js`;
- declarar um papel arquitetural único;
- ser exportado por `index.js` apenas se fizer parte da superfície pública;
- evitar misturar orquestração de lifecycle com I/O cru ou bordas de processo.
