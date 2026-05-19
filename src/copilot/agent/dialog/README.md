# agent/dialog/

**Camada**: L4 — dialog loop vivo do `AlwaysAliveAgent`.

Este diretório coordena turnos, `ask_user`, watchdog, retomada, boot do loop e persistência auxiliar
de resultados. A regra local é: ao abrir a pasta, os arquivos primários devem ser identificáveis sem
ler todos os módulos.

## Como ler este diretório

1. Comece por `index.js` para a superfície pública.
2. Use `module-map.js` para o inventário executável de papéis, tiers e arquivos.
3. Leia primeiro os módulos `primary`: `controllers/agent-dialog-controller.js`,
   `orchestrators/loop-manager.js` e `executors/turn-executor.js`.
4. Depois desça para os módulos `secondary` por papel: `boot`, `policy`, `state`, `wiring` e
   `watchdog`.
5. Trate `seams/` como detalhes internos extraídos de caminhos quentes.

## Mapa atual de papéis

| Papel          | Arquivos                                                                                                                                  |
| -------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `entrypoint`   | `index.js`, `module-map.js`                                                                                                               |
| `controller`   | `controllers/agent-dialog-controller.js`                                                                                                  |
| `orchestrator` | `orchestrators/loop-manager.js`                                                                                                           |
| `executor`     | `executors/turn-executor.js`                                                                                                              |
| `boot`         | `boot/loop-boot-runner.js`, `boot/loop-boot-circuit.js`, `boot/loop-runtime-kit.js`                                                       |
| `policy`       | `policies/compaction-policy.js`, `policies/resume-policy.js`, `policies/model-fallback.js`                                                |
| `state`        | `state/state-machine.js`, `state/pending-question-shadow.js`, `state/cost-ledger.js`, `state/backpressure.js`                             |
| `wiring`       | `wiring/event-wiring.js`, `wiring/user-input-handler.js`                                                                                  |
| `watchdog`     | `watchdogs/watchdog.js`, `watchdogs/watchdog-supervisor.js`                                                                               |
| `seam`         | `seams/turn-execution-context.js`, `seams/turn-output-collector.js`, `seams/turn-input-validation.js`, `seams/turn-result-persistence.js` |

## Situação física atual

O boot, as policies, o state local, o wiring, os watchdogs e o trio primário já vivem em subpastas
semânticas. Os shims de raiz foram removidos após a migração dos consumers para owners reais; a raiz
mantém apenas `index.js` e `module-map.js`.

## Situação física alvo

A migração final deve convergir para:

| Pasta futura     | Conteúdo esperado                              |
| ---------------- | ---------------------------------------------- |
| `controllers/`   | adapters internos de entrada do dialog         |
| `orchestrators/` | coordenação de fluxo vivo                      |
| `executors/`     | execução de turnos e comandos                  |
| `boot/`          | handshake, circuit breaker e kits de boot      |
| `policies/`      | regras puras de decisão                        |
| `state/`         | máquinas, ledgers e estado auxiliar local      |
| `wiring/`        | ligação de eventos e handlers                  |
| `watchdogs/`     | watchdogs e supervisores                       |
| `seams/`         | módulos internos extraídos de arquivos quentes |

Novos arquivos de raiz não devem ser usados para compatibilidade. Quando uma transição exigir
compatibilidade temporária, ela precisa ser curta, registrada no roadmap e removida na mesma onda de
migração.

## Regra para novos arquivos

Todo novo arquivo em `agent/dialog/` precisa:

- aparecer em `module-map.js`;
- declarar um papel arquitetural único;
- ser exportado por `index.js` apenas se fizer parte da superfície pública;
- preferir uma subpasta semântica quando a migração física estiver ativa;
- evitar criar um novo orquestrador raiz sem atualização do roadmap.
