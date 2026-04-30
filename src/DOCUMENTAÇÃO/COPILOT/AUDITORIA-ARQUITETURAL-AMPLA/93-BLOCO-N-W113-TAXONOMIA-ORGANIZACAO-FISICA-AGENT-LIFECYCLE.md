# 93 — Bloco N / W113: taxonomia de organização física em `agent/lifecycle`

**Data:** 2026-04-30 **Escopo:** `src/copilot/agent/lifecycle/` **Status:** checkpoint inicial
executável da W113

---

## 1) Problema validado

`src/copilot/agent/lifecycle/` mistura no mesmo nível:

- `agent-lifecycle.js`, o orquestrador primário de start/stop/initSession;
- `entry.js`, entrypoint compatível legado;
- `runtime-host.js`, borda de processo/IPC/sinais/shutdown/preflight;
- `session-setup.js`, montagem da configuração SDK;
- `reconnect-policy.js`, política de reconexão;
- `runtime-teardown.js`, helpers de rollback/cleanup;
- `state-io.js` e `state-file-io.js`, API semântica e I/O cru de estado persistido.

A árvore é pequena, mas sensível: sem papéis explícitos é fácil misturar boot, processo, estado e
orquestração no mesmo arquivo.

---

## 2) Decisão arquitetural W113

Foi aplicada a mesma regra de `dialog` e `session`:

1. `README.md` local para navegação humana;
2. `module-map.js` local para inventário executável;
3. contrato unitário que garante cobertura completa e documentação dos papéis.

Nenhum arquivo foi movido nesta onda; a etapa atual prepara a reorganização física futura.

---

## 3) Taxonomia aplicada ao lifecycle

| Papel          | Significado                                               |
| -------------- | --------------------------------------------------------- |
| `entrypoint`   | superfície pública ou inventário canônico do diretório    |
| `orchestrator` | fluxo primário de start/stop/initSession                  |
| `compat-entry` | entrypoint compatível legado, não boot canônico principal |
| `process-host` | borda de processo: sinais, IPC, shutdown host e preflight |
| `setup`        | montagem da configuração SDK e dependências de sessão     |
| `policy`       | decisões puras de reconexão/recovery                      |
| `teardown`     | rollback e limpeza de recursos do runtime                 |
| `state`        | estado persistido semântico e I/O físico associado        |

---

## 4) Arquivos adicionados

- `src/copilot/agent/lifecycle/README.md`;
- `src/copilot/agent/lifecycle/module-map.js`;
- ampliação de `tests/unit/copilot/contracts/test_module_layout_governance.spec.js`.

Exports adicionados ao sub-barrel:

- `LIFECYCLE_MODULE_LAYOUT`;
- `getLifecycleModuleDescriptor()`;
- `getLifecycleModuleRole()`;
- `listLifecycleModulesByRole()`.

---

## 5) Roadmap local

1. W113.8 — mapa executável e README local: concluído neste checkpoint.
2. W113.9 — contrato anti-órfão para `agent/lifecycle`: concluído neste checkpoint.
3. W113.10 — mover `agent-lifecycle.js` para `orchestrators/` com shim temporário.
4. W113.11 — mover `runtime-host.js` para `process-host/` e `session-setup.js` para `setup/`.
5. W113.12 — mover `reconnect-policy.js`, `runtime-teardown.js`, `state-*` para subpastas finais.
6. W113.13 — migrar imports internos e adicionar contrato anti-import de shims.

---

## 6) Critérios objetivos de conclusão

- nenhum arquivo JS em `agent/lifecycle` existe sem entrada em `module-map.js`;
- `README.md` documenta todos os papéis declarados;
- `index.js` exporta apenas superfície pública e inventários canônicos;
- `state-file-io.js` continua subordinado à API semântica `state-io.js`;
- `entry.js` permanece identificado como compat, não como boot canônico.
