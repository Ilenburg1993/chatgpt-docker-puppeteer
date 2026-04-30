# 69 — Bloco K / W85: hotspot map profundo de `src/copilot/agent` (com evidência factual)

**Data:** 2026-04-30 **Escopo:** `src/copilot/agent/**` **Objetivo da onda W85:** sair de percepção
qualitativa e entrar em priorização quantitativa de hotspots para guiar W86/W87.

---

## 1) Método executado nesta onda

Foi criado e executado o analisador canônico:

- `scripts/analyze-copilot-hotspots.mjs`

Comando usado na rodada:

- `node scripts/analyze-copilot-hotspots.mjs --root src/copilot --focus agent --top 30 --json-out /tmp/hotspots-agent-w85.json`

Métricas base da execução:

- arquivos JS escaneados: **530**
- arestas: **1337**
- módulos: **25**
- foco: `agent`

---

## 2) Top hotspots (foco `agent`) — leitura consolidada

## 2.1 Top score arquitetural

| Rank | Arquivo                              | Score | Fan-out | Fan-in | Cross-module pressure |
| ---: | ------------------------------------ | ----: | ------: | -----: | --------------------: |
|    1 | `agent/ports/logging-port.js`        |    64 |       0 |     32 |                     0 |
|    2 | `agent/lifecycle/agent-lifecycle.js` |    47 |      18 |      1 |                     3 |
|    3 | `agent/dialog/loop-manager.js`       |    47 |      16 |      3 |                     3 |
|    4 | `agent/session/boot-steps.js`        |    37 |      13 |      1 |                     3 |
|    5 | `agent/facades/index.js`             |    36 |      17 |      1 |                     0 |
|    6 | `agent/agent-runtime-surface.js`     |    36 |      16 |      2 |                     0 |
|    7 | `agent/lifecycle/state-io.js`        |    33 |       5 |      7 |                     3 |
|    8 | `agent/ports/hook-port.js`           |    33 |       5 |      4 |                     5 |
|    9 | `agent/context-factories.js`         |    32 |      12 |      1 |                     2 |
|   10 | `agent/index.js`                     |    31 |      14 |      0 |                     1 |

## 2.2 Top fan-out (risco de orquestrador denso)

- `agent/lifecycle/agent-lifecycle.js` (18)
- `agent/facades/index.js` (17)
- `agent/dialog/loop-manager.js` (16)
- `agent/agent-runtime-surface.js` (16)
- `agent/index.js` (14)
- `agent/session/boot-steps.js` (13)

## 2.3 Top fan-in (risco de choke point)

- `agent/ports/logging-port.js` (32)
- `agent/facades/agent-sdk-access.js` (13)
- `agent/ports/metrics-port.js` (12)
- `agent/error-policy.js` (10)
- `agent/ports/tracing-port.js` (10)
- `agent/lifecycle/state-io.js` (7)

## 2.4 Top pressão cross-module

- `agent/ports/hook-port.js` (5)
- `agent/lifecycle/agent-lifecycle.js` (3)
- `agent/dialog/loop-manager.js` (3)
- `agent/session/boot-steps.js` (3)
- `agent/lifecycle/state-io.js` (3)
- `agent/lifecycle/entry.js` (3)
- `agent/session/snapshot.js` (3)

---

## 3) Diagnóstico arquitetural da W85

### C1 — Hotspots de coordenação continuam concentrados

Arquivos de lifecycle/dialog/boot concentram fan-out alto, sinalizando que ainda há fronteiras
semânticas a extrair para reduzir efeito “orquestrador-gigante”.

### C2 — Ports de observabilidade são hubs de entrada

`logging-port.js`, `metrics-port.js`, `tracing-port.js` estão com fan-in alto (esperado em parte),
porém precisam governança para não virarem acoplamento estrutural rígido.

### C3 — `state-io` ainda é nó sensível

Mesmo após evoluções recentes, `agent/lifecycle/state-io.js` aparece com score alto e pressão
cross-module: indício de dívida remanescente no eixo de persistência semântica.

### C4 — Barrel `facades/index.js` está muito carregado

Alto fan-out do barrel indica conveniência alta, mas também potencial de esconder fronteiras por
agregação excessiva.

---

## 4) Decisões para continuidade imediata (W86/W87)

## 4.1 Alvos primários (cirurgia)

1. `agent/lifecycle/agent-lifecycle.js`
2. `agent/dialog/loop-manager.js`
3. `agent/session/boot-steps.js`
4. `agent/lifecycle/state-io.js`

## 4.2 Alvos secundários (descompressão controlada)

1. `agent/agent-runtime-surface.js`
2. `agent/context-factories.js`
3. `agent/facades/index.js` (governança de export e segmentação)

## 4.3 Critério de priorização (próximas PRs/ondas)

Ordem por risco arquitetural:

1. alto fan-out + alta pressão cross-module;
2. alto fan-in em módulo sem ownership estrito;
3. barrel/hub com dependência indireta ampla.

---

## 5) Entregáveis exigidos da W86 (derivados da W85)

- extração de seams semânticos em lifecycle/dialog/boot (com owners explícitos);
- redução de arestas dos quatro hotspots primários;
- contratos de não-regressão para evitar reintrodução de acoplamento;
- atualização do scorecard de hotspots após cada subonda.

---

## 6) Resultado da W85

A onda W85 está **concluída com evidência factual** e já destrava execução profunda das próximas
transformações do Bloco K.
