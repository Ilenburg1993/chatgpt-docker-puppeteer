# 91 — Bloco N / W109: taxonomia de organização física em `agent/dialog`

**Data:** 2026-04-30 **Escopo:** `src/copilot/agent/dialog/` **Status:** checkpoint inicial
executável da F9

---

## 1) Problema validado

O diretório `src/copilot/agent/dialog/` estava funcional, mas pouco legível estruturalmente. Ao
abrir a pasta, arquivos com papéis muito diferentes apareciam no mesmo nível:

- `agent-dialog-controller.js`, `loop-manager.js` e `turn-executor.js` são o eixo primário;
- `loop-boot-runner.js`, `loop-boot-circuit.js` e `loop-runtime-kit.js` são boot/runtime support;
- `compaction-policy.js`, `resume-policy.js` e `model-fallback.js` são policies;
- `state-machine.js`, `cost-ledger.js`, `backpressure.js` e `pending-question-shadow.js` são estado;
- `event-wiring.js`, `user-input-handler.js`, `watchdog.js` e `watchdog-supervisor.js` são wiring e
  supervisão;
- `seams/*` são detalhes internos extraídos do caminho de turno.

Essa mistura não é apenas estética. Ela cria três riscos reais:

1. novos arquivos podem ser adicionados sem papel arquitetural explícito;
2. revisões confundem orquestração primária com suporte secundário;
3. uma futura migração física para subpastas pode quebrar consumers se for feita sem inventário
   executável.

---

## 2) Decisão arquitetural W109

A W109 introduz um passo intermediário obrigatório antes de mover arquivos fisicamente:

1. `README.md` local para navegação humana;
2. `module-map.js` local para inventário executável de papéis, tiers e public/private;
3. contrato unitário que compara o mapa com a árvore real e impede arquivos órfãos.

O objetivo é reduzir anarquia sem criar uma quebra ampla de imports no mesmo movimento.

---

## 3) Taxonomia aplicada ao dialog

| Papel          | Significado                                                        |
| -------------- | ------------------------------------------------------------------ |
| `entrypoint`   | superfície pública ou inventário canônico do diretório             |
| `controller`   | adapter interno que conecta o runtime do agent ao subsistema       |
| `orchestrator` | coordenação de ciclo vivo e sequência de fluxo                     |
| `executor`     | unidade que executa turnos ou ações efetivas                       |
| `boot`         | boot, handshake, circuit breaker e kit de runtime                  |
| `policy`       | regras puras de decisão, fallback ou retomada                      |
| `state`        | máquinas, ledgers e estado auxiliar local                          |
| `wiring`       | ligação de eventos/listeners e handlers de entrada                 |
| `watchdog`     | supervisão temporal/operacional                                    |
| `seam`         | detalhe interno extraído de caminho quente, não superfície pública |

Tiers:

- `primary`: primeiro nível de leitura e ownership;
- `secondary`: suporte com papel explícito;
- `internal`: detalhe de implementação, normalmente não exportado publicamente.

---

## 4) Situação atual após W109

Arquivos adicionados:

- `src/copilot/agent/dialog/README.md`;
- `src/copilot/agent/dialog/module-map.js`;
- `tests/unit/copilot/contracts/test_module_layout_governance.spec.js`.

Movimento físico inicial já aplicado:

- `src/copilot/agent/dialog/boot/loop-boot-runner.js`;
- `src/copilot/agent/dialog/boot/loop-boot-circuit.js`;
- `src/copilot/agent/dialog/boot/loop-runtime-kit.js`;
- `src/copilot/agent/dialog/controllers/agent-dialog-controller.js`;
- `src/copilot/agent/dialog/orchestrators/loop-manager.js`;
- `src/copilot/agent/dialog/executors/turn-executor.js`;
- `src/copilot/agent/dialog/policies/{compaction-policy,resume-policy,model-fallback}.js`;
- `src/copilot/agent/dialog/state/{state-machine,pending-question-shadow,cost-ledger,backpressure}.js`;
- `src/copilot/agent/dialog/wiring/{event-wiring,user-input-handler}.js`;
- `src/copilot/agent/dialog/watchdogs/{watchdog,watchdog-supervisor}.js`;
- shims temporários de raiz removidos após migração dos consumers para os owners reais.

Exports adicionados ao sub-barrel:

- `DIALOG_MODULE_LAYOUT`;
- `getDialogModuleDescriptor()`;
- `getDialogModuleRole()`;
- `listDialogModulesByRole()`.

Também foi atualizado o contrato histórico de migração do SDK para reconhecer que
`waitForAgentSdkEvent` saiu de `loop-manager.js` e foi para o seam de boot `loop-boot-runner.js`.

---

## 5) Situação ideal para a próxima onda

O estado alvo de `agent/dialog` é:

```text
agent/dialog/
  README.md
  index.js
  module-map.js
  controllers/
  orchestrators/
  executors/
  boot/
  policies/
  state/
  wiring/
  watchdogs/
  seams/
```

Critério para avançar: cada movimento físico deve preservar imports externos por shims temporários
ou atualização controlada de consumers, com teste de regressão para impedir arquivo órfão.

---

## 6) Roadmap local

1. W109.1 — mapa executável e README local: concluído neste checkpoint.
2. W109.2 — contrato anti-órfão para `agent/dialog`: concluído neste checkpoint.
3. W111.1 — mover boot para `boot/` com shims temporários: concluído; shims removidos.
4. W111.2 — mover policies/state/wiring/watchdogs para subpastas semânticas: iniciado neste
   checkpoint.
5. W111.3 — mover controller/orchestrator/executor para suas subpastas finais: iniciado neste
   checkpoint.
6. W112.1 — migrar imports internos para caminhos finais: iniciado, com contrato anti-import de
   shims no código de produção.
7. W112.2 — migrar testes para `index.js`/`module-map.js` quando o teste não precisar validar
   compatibilidade legada.
8. W116 — remover shims e congelar baseline física final: concluído para `agent/dialog`.

---

## 7) Critérios objetivos de conclusão

- nenhum arquivo JS em `agent/dialog` existe sem entrada em `module-map.js`;
- `README.md` documenta todos os papéis declarados;
- `index.js` exporta apenas superfície pública e inventários canônicos;
- cada subpasta futura tem no máximo um tipo de responsabilidade;
- orquestradores primários são visíveis sem leitura de todos os arquivos;
- shims temporários foram removidos e a raiz ficou restrita a `index.js` e `module-map.js`.
