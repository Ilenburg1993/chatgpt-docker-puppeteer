# agent/session/

**Camada**: L4 — sessão SDK persistente do `AlwaysAliveAgent`.

Este diretório inicializa, retoma, mantém, observa, sincroniza e encerra a sessão SDK usada pelo
agent. A regra local é parecida com `agent/dialog`: ao abrir a pasta, precisa ficar claro quais
arquivos são primários, quais são steps de boot, e quais são suporte secundário.

## Como ler este diretório

1. Comece por `index.js` para a superfície pública.
2. Use `module-map.js` para o inventário executável de papéis, tiers e arquivos.
3. Leia primeiro os módulos `primary`: `initializers/initializer.js` e `boot/boot-wiring.js`.
4. Depois desça por papel: `boot`, `commands`, `lifecycle`, `wiring`, `history`, `context` e
   `state`.
5. Trate `snapshot-store.js` e os substeps de boot como detalhes internos, mesmo quando usados por
   módulos públicos do subsistema.

## Mapa atual de papéis

| Papel         | Arquivos                                                                                                                              |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `entrypoint`  | `index.js`, `module-map.js`                                                                                                           |
| `initializer` | `initializers/initializer.js`                                                                                                         |
| `boot`        | `boot/boot-wiring.js`, `boot/boot-steps.js`, `boot/boot-session-prep.js`, `boot/boot-dialog-recovery.js`, `boot/boot-runtime-bind.js` |
| `commands`    | `commands/index.js`, `commands/terminal-sdk-command-definitions.js`                                                                   |
| `lifecycle`   | `lifecycle/keepalive.js`, `lifecycle/cleanup.js`, `lifecycle/rotation.js`                                                             |
| `wiring`      | `wiring/event-wirer.js`                                                                                                               |
| `history`     | `history/history-sync.js`                                                                                                             |
| `context`     | `context/hook-context.js`                                                                                                             |
| `state`       | `state/ownership.js`, `state/snapshot.js`, `state/snapshot-store.js`                                                                  |

## Situação física atual

A W113 migrou os owners reais para subpastas semânticas e não deixou shims de raiz. A raiz do
diretório fica reservada a navegação e superfície pública:

```text
agent/session/
  README.md
  index.js
  module-map.js
  boot/
  commands/
  context/
  history/
  initializers/
  lifecycle/
  state/
  wiring/
```

Qualquer novo arquivo funcional criado diretamente na raiz precisa ser tratado como regressão
arquitetural ou ter justificativa explícita no `module-map.js` e no roadmap.

## Regra para novos arquivos

Todo novo arquivo em `agent/session/` precisa:

- aparecer em `module-map.js`;
- declarar um papel arquitetural único;
- ser exportado por `index.js` apenas se fizer parte da superfície pública;
- preferir uma subpasta semântica quando a migração física estiver ativa;
- evitar misturar boot, lifecycle, state e context no mesmo módulo.
