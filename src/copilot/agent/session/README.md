# agent/session/

**Camada**: L4 — sessão SDK persistente do `AlwaysAliveAgent`.

Este diretório inicializa, retoma, mantém, observa, sincroniza e encerra a sessão SDK usada pelo
agent. A regra local é parecida com `agent/dialog`: ao abrir a pasta, precisa ficar claro quais
arquivos são primários, quais são steps de boot, e quais são suporte secundário.

## Como ler este diretório

1. Comece por `index.js` para a superfície pública.
2. Use `module-map.js` para o inventário executável de papéis, tiers e arquivos.
3. Leia primeiro os módulos `primary`: `initializer.js` e `boot-wiring.js`.
4. Depois desça por papel: `boot`, `lifecycle`, `wiring`, `history`, `context` e `state`.
5. Trate `snapshot-store.js` e os substeps de boot como detalhes internos, mesmo quando usados por
   módulos públicos do subsistema.

## Mapa atual de papéis

| Papel         | Arquivos                                                                                                     |
| ------------- | ------------------------------------------------------------------------------------------------------------ |
| `entrypoint`  | `index.js`, `module-map.js`                                                                                  |
| `initializer` | `initializer.js`                                                                                             |
| `boot`        | `boot-wiring.js`, `boot-steps.js`, `boot-session-prep.js`, `boot-dialog-recovery.js`, `boot-runtime-bind.js` |
| `lifecycle`   | `keepalive.js`, `cleanup.js`, `rotation.js`                                                                  |
| `wiring`      | `event-wirer.js`                                                                                             |
| `history`     | `history-sync.js`                                                                                            |
| `context`     | `hook-context.js`                                                                                            |
| `state`       | `ownership.js`, `snapshot.js`, `snapshot-store.js`                                                           |

## Situação física atual

O diretório ainda está plano. Isso é aceitável como checkpoint porque o `module-map.js` agora torna
explícita a responsabilidade de cada arquivo e impede novas adições órfãs. A próxima onda pode mover
as famílias para subpastas semânticas com shims temporários, seguindo a estratégia já validada em
`agent/dialog`.

## Situação física alvo

A migração final deve convergir para:

```text
agent/session/
  README.md
  index.js
  module-map.js
  boot/
  lifecycle/
  wiring/
  history/
  context/
  state/
```

Durante a migração física, arquivos de raiz podem permanecer como shims temporários, mas cada shim
deve estar registrado no roadmap, no mapa local e em contrato de remoção.

## Regra para novos arquivos

Todo novo arquivo em `agent/session/` precisa:

- aparecer em `module-map.js`;
- declarar um papel arquitetural único;
- ser exportado por `index.js` apenas se fizer parte da superfície pública;
- preferir uma subpasta semântica quando a migração física estiver ativa;
- evitar misturar boot, lifecycle, state e context no mesmo módulo.
