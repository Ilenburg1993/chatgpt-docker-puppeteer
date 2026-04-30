# agent/lifecycle/

**Camada**: L4 — ciclo de vida do `AlwaysAliveAgent`.

Este diretório coordena start, stop, setup de sessão, reconexão, teardown e estado persistido do
agent. Ele também contém um entrypoint compatível legado (`entry.js`), mas o boot canônico fica em
`src/copilot/bootstrap.js` e `src/copilot/terminal/bootstrap.js`.

## Como ler este diretório

1. Comece por `index.js` para a superfície pública.
2. Use `module-map.js` para o inventário executável de papéis, tiers e arquivos.
3. Leia primeiro `agent-lifecycle.js`, que é o orquestrador primário.
4. Depois desça por papel: `process-host`, `setup`, `policy`, `teardown` e `state`.
5. Trate `state-file-io.js` como detalhe interno de filesystem, não como owner semântico de estado.

## Mapa atual de papéis

| Papel          | Arquivos                          |
| -------------- | --------------------------------- |
| `entrypoint`   | `index.js`, `module-map.js`       |
| `orchestrator` | `agent-lifecycle.js`              |
| `compat-entry` | `entry.js`                        |
| `process-host` | `runtime-host.js`                 |
| `setup`        | `session-setup.js`                |
| `policy`       | `reconnect-policy.js`             |
| `teardown`     | `runtime-teardown.js`             |
| `state`        | `state-io.js`, `state-file-io.js` |

## Situação física atual

O diretório ainda está plano. O mapa local torna explícito que `agent-lifecycle.js` é o owner
primário, enquanto `runtime-host.js`, `session-setup.js`, `runtime-teardown.js` e o par de estado
são suporte especializado.

## Situação física alvo

A migração final deve convergir para:

```text
agent/lifecycle/
  README.md
  index.js
  module-map.js
  orchestrators/
  process-host/
  setup/
  policies/
  teardown/
  state/
```

Movimentos físicos futuros devem usar shims temporários e contrato anti-import semelhante ao já
adotado em `agent/dialog`.

## Regra para novos arquivos

Todo novo arquivo em `agent/lifecycle/` precisa:

- aparecer em `module-map.js`;
- declarar um papel arquitetural único;
- ser exportado por `index.js` apenas se fizer parte da superfície pública;
- evitar misturar orquestração de lifecycle com I/O cru ou bordas de processo.
