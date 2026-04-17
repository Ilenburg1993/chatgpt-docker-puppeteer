# M-03A — Auditoria Arquitetural Geral de `src/copilot/agent`

**Data**: 2026-04-15
**Versão**: 1.9
**Escopo**: Snapshot arquitetural do subsistema `src/copilot/agent/` após os cortes incrementais de `L2.1`, `L2.3`, `K1a`, `K3`, `K4`, `K5`, `K5b`, `K6`, `K7` e `K8`
**Relacionamento**: documento complementar de `M-03-FASE-AGENT-REFACTOR.md`

> **Nota de sucessão clean (2026-04-15)**: este documento permanece como auditoria complementar da
> linha `M-03`, mas a nova referência canônica para a próxima rodada ampla de planejamento do
> `agent/` é a série
> [`../PLANO-REARQUITETURA-CLEAN/README.md`](../PLANO-REARQUITETURA-CLEAN/README.md), sobretudo os
> documentos `R-03`, `R-04`, `R-05`, `R-06` e `R-08`.

---

## 1. Propósito

Este documento consolida a **auditoria arquitetural atual do módulo `agent/`**, separando com clareza:

- o que o plano original previa;
- o que já foi realmente executado no baseline vivo;
- quais hotspots continuam dominando o custo estrutural;
- qual deve ser a **arquitetura-alvo revisada**;
- e qual é a **ordem ótima das próximas ondas** de execução.

Ele existe para evitar que a evolução de `M-03` continue sendo guiada por um snapshot já superado.

---

## 2. Snapshot atual do módulo `agent/`

### 2.1 Métricas verificadas em 2026-04-15

| Métrica                                |                           Valor |
| -------------------------------------- | ------------------------------: |
| Arquivos `.js` em `src/copilot/agent/` |                              62 |
| Diretórios internos                    |                               8 |
| Linhas totais                          |                           8.248 |
| Maior arquivo                          |        `always-alive.js` (638L) |
| Segundo maior arquivo                  | `dialog/loop-manager.js` (631L) |
| Terceiro maior arquivo                 |       `agent-context.js` (431L) |

### 2.2 Totais por subárvore

| Subárvore                 | Linhas | Leitura arquitetural                                                       |
| ------------------------- | -----: | -------------------------------------------------------------------------- |
| `session/`                |  1.975 | Hotspot principal de boot, wiring, snapshot e lifecycle de sessão          |
| `dialog/`                 |  1.902 | Subsistema consistente, porém denso, já relativamente modular              |
| `lifecycle/`              |  1.299 | Núcleo operacional do start/stop/reconnect; ainda com bastante coordenação |
| `infra/`                  |    411 | Já está relativamente enxuto                                               |
| `messaging/`              |    376 | Melhorou bastante após a canonicalização de fila/executor                  |
| `facades/`                |    191 | Saudável                                                                   |
| `state/`                  |     82 | Saudável                                                                   |
| `session/event-handlers/` |    104 | Apenas dívida de compatibilidade residual                                  |

### 2.3 Top hotspots por arquivo

| Arquivo                        | Linhas | Diagnóstico                                                             |
| ------------------------------ | -----: | ----------------------------------------------------------------------- |
| `always-alive.js`              |    638 | Fachada pública segue pesada, agora também hospedando o health formal   |
| `dialog/loop-manager.js`       |    631 | Grande, mas com fronteiras internas melhores do que o resto do módulo   |
| `agent-context.js`             |    431 | Núcleo de estado agora particionado, mas ainda com rollout de consumers |
| `background-tasks.js`          |    133 | Novo tracker central para fire-and-forget; base correta para K4         |
| `health-check.js`              |     97 | Snapshot operacional canônico do runtime; base correta para K7          |
| `dialog/turn-executor.js`      |    391 | Contrato de diálogo isolado; **não deve** ser fundido com a fila        |
| `agent-messaging.js`           |    370 | Camada canônica da fila; aumento de LoC é intencional e justificado     |
| `lifecycle/agent-lifecycle.js` |    405 | Coordenação central de start/stop/reconnect ainda densa                 |

---

## 3. O que já foi realmente resolvido

### 3.1 Ganhos estruturais já confirmados

- `alwaysAliveAgent` deixou de ser eager e passou a operar via `getAgent()` + proxy compatível;
- o bridge com `EventBus` deixou de ser um mapa inline gigante e passou a usar mapas declarativos;
- `AgentContext` deixou de ser inteiramente plano e agora já expõe seis subestados nomeados com accessors compatíveis;
- `state/agent-state.js` e `facades/agent-model-config.js` já começaram a consumir os subestados diretamente;
- `session-setup.js`, `agent-messaging.js`, `agent-dialog-controller.js` e `agent-session-ops.js` já entraram no lote seguro de migração para subestados (`K1b`);
- `agent-lifecycle.js` e getters públicos selecionados de `always-alive.js` também já avançaram para leitura direta
   dos subestados, reduzindo a dependência dos accessors compatíveis no runtime principal;
- `background-tasks.js` agora existe e o primeiro lote de integrações já cobre writes/syncs assíncronos em
   `agent-lifecycle`, `session-setup`, `user-input-handler`, `agent-messaging`, `boot-steps` e `loop-manager`;
- o shutdown do agente agora drena explicitamente as background tasks pendentes com `drain(5000)`;
- `health-check.js` agora existe e consolidou o snapshot formal de client/session/dialog/queue/io;
- `AlwaysAliveAgent` já expõe `getHealthSnapshot()`, e as rotas `GET /health/agent` e `GET /health` passaram a reaproveitar a mesma fonte;
- o wiring lazy do bridge saiu de `always-alive.js` e passou para `agent/event-bridge-wiring.js`;
- `boot-wiring.js` deixou de concentrar toda a implementação do boot e passou a atuar como runner/compositor;
- `boot-steps.js` agora concentra a maior parte da implementação real das etapas do boot;
- a cadeia de fila foi simplificada:
  - `processQueue()` agora é canônico em `agent-messaging.js`;
  - `executeTask()` agora é canônico em `agent-messaging.js`;
  - `queue-processor.js` e `infra/task-executor.js` viraram shims de compatibilidade;
- os handlers reais do SDK saíram do coração de `agent/session/` e foram para `src/copilot/event-handlers/`;
- `performBootWiring()` agora opera como **pipeline nomeado**, em vez de bloco monolítico implícito.

### 3.2 Leitura importante

O módulo `agent/` **não está estagnado**; ele já saiu do estado de “god module inteiramente amorfo”.
O problema agora é diferente: há uma base de decomposição já iniciada, mas ainda **incompleta** e com dívida de
compatibilidade concentrada em poucos hotspots.

---

## 4. Drift entre o plano original e a situação real

### 4.1 Onde o plano original ainda acerta

- `K1` continua sendo o maior destravador estrutural: a fundação do contexto particionado já existe, mas a migração de
   consumers ainda está incompleta;
- `K5` e `K6` realmente eram alvos corretos, e sua execução incremental provou isso;
- o alvo de reduzir `agent/` abaixo de 5k linhas continua válido como métrica de saúde.

### 4.2 Onde o plano original já ficou defasado

1. **`task-executor.js` não deve ser merged com `turn-executor.js`**
   A auditoria mostrou que isso misturaria dois eixos distintos:
   - fila de mensagens do agente;
   - turno de diálogo do `DialogLoopManager`.

2. **A cobertura de testes do agent não mora só em `tests/unit/copilot/agent/`**
   O plano original subestima a cobertura já existente porque parte relevante dos testes vive em:
   - `tests/unit/copilot/test_agent_context.spec.js`
   - `tests/unit/copilot/test_agent_messaging.spec.js`
   - `tests/unit/copilot/test_agent_lifecycle.spec.js`
   - `tests/unit/copilot/test_always_alive_*`
   - `tests/unit/copilot/test_loop_manager.spec.js`

3. **`K5` e `K6` já não são backlog puro**
   Ambos já entraram em código; o roadmap precisa tratá-los como ondas em progresso, não como tarefas ainda virgens.

4. **A próxima redução líquida de LoC não virá só de mover mapa ou runner**
   Para cair de verdade, o módulo precisa agora atacar:
   - estado compartilhado (`K1`);
   - política central de erro (`K3`);
   - extração adicional de wiring/steps (`K5b`, `K6b`);
   - remoção posterior dos shims.

---

## 5. Diagnóstico arquitetural atual

### 5.1 Ponto mais crítico: rollout do `AgentContext` particionado

O maior bloqueio estrutural restante não é mais a fila nem o bridge de eventos. O `AgentContext`
já atravessou o lote seguro, `agent-lifecycle.js` e parte da fachada pública, mas ainda precisa
converter essa migração em fechamento de fronteiras mais rígidas. Hoje o contexto continua:

- altamente mutável;
- compartilhado por muitos subsistemas;
- particionado no armazenamento interno, porém ainda com muitos pontos de compatibilidade explícita;
- dependente de accessors de compatibilidade para preservar rollout seguro.

O próximo ganho real virá menos de “começar `K1b`” e mais de **expandir/fechar `K4`** e consolidar as frentes transversais que
o novo contexto já destravou: `background-tasks.js`, `health-check.js` e, depois, a remoção da compatibilidade residual.

### 5.2 Ponto mais caro em coordenação: `session/`

`session/` é hoje a subárvore mais pesada do módulo. O ganho recente em `boot-wiring` foi bom, mas ainda há muito custo
 de coordenação em:

- boot + recovery;
- snapshot;
- initializer;
- hook-context;
- keepalive.

### 5.3 Ponto mais caro em fan-in: `always-alive.js`

Mesmo menor do que antes, `always-alive.js` ainda é o grande ponto de convergência pública do módulo. Hoje ele faz bem o
papel de fachada, mas ainda concentra:

- singleton lazy;
- API pública;
- wiring lazy do bridge do EventBus.

O próximo refinamento natural já não é mais o wiring do bridge (isso foi resolvido em `event-bridge-wiring.js`), e sim
tirar de `always-alive.js` e `lifecycle/` as responsabilidades transversais de fire-and-forget/health formal.

### 5.4 Dívida residual de compatibilidade

Ainda existem três bolsões claros de dívida temporária:

- `session/event-handlers/` (shims)
- `queue-processor.js` (shim)
- `infra/task-executor.js` (shim)

Eles estão aceitáveis **neste estágio**, mas não podem virar estado permanente.

---

## 6. Situação ideal revisada para `src/copilot/agent/`

### 6.1 Metas estruturais realistas

| Área                     | Situação atual     | Target revisado                                         |
| ------------------------ | ------------------ | ------------------------------------------------------- |
| `always-alive.js`        | 638L               | 300–450L                                                |
| `agent-context.js`       | 419L particionados | subestados nomeados + compat getters temporários        |
| `session/boot-wiring.js` | 494L               | runner fino + steps em módulo(s) dedicado(s)            |
| `event-bridge-map.js`    | declarativo        | manter + extrair `event-bridge-wiring.js`               |
| shims                    | 3 bolsões          | eliminar após convergência dos callers                  |
| testes                   | dispersos          | manter dispersos, mas com tracker explícito por subfase |

### 6.2 Arquitetura-alvo revisada

```text
agent/
├── always-alive.js             # fachada pública + singleton lazy (mínimo possível)
├── agent-context.js            # estado particionado, com compat temporária
├── error-policy.js             # classificação retry/fatal/ignore
├── event-bridge-map.js         # mapa declarativo
├── event-bridge-wiring.js      # wiring lazy agent/dialog/handoff → EventBus
├── background-tasks.js         # tracker de fire-and-forget
├── health-check.js             # health formal do agente
├── dialog/                     # domínio do loop de diálogo
├── lifecycle/                  # start/stop/reconnect
├── messaging/                  # fila e envio ao SDK
├── session/
│   ├── boot-wiring.js          # runner fino
│   └── boot-steps*.js          # etapas isoladas do boot
└── state/                      # snapshots e diagnósticos
```

---

## 7. Roadmap revisado por ondas

### Onda A — já executada incrementalmente

- `L2.1` — handlers reais movidos para `src/copilot/event-handlers/`
- `K8` — singleton lazy + proxy compatível
- `L2.3a` — `processQueue()` canônico em `agent-messaging.js`
- `L2.3b` — `executeTask()` canônico em `agent-messaging.js`
- `K5a` — pipeline nomeado de boot
- `K6a` — mapa declarativo do bridge do EventBus

### Onda B — recomendação imediata (executada incrementalmente)

1. **`K3` — Error Policy centralizada**
   Criar `agent/error-policy.js` e plugar em:
   - `messaging/agent-messaging.js`
   - `lifecycle/reconnect-policy.js`
   - pontos com abort/fatal/retry ad-hoc

   **Status atual**: iniciado incrementalmente em 2026-04-15 com `error-policy.js` + integração em
   `agent-messaging.js` e `reconnect-policy.js`.

2. **`K1a` — AgentContext Partitioning leve**
   Introduzir subestados nomeados sem migração total de todos os consumers de uma vez.

   **Status atual**: iniciado incrementalmente em 2026-04-15 com `agent-context.js` particionado,
   accessors compatíveis e primeiros consumers migrados (`agent-state.js` e `agent-model-config.js`).

3. **`K5b` — extração real das steps de boot**
   Mover etapas de `boot-wiring.js` para módulo(s) dedicado(s), deixando o runner fino de verdade.

   **Status atual**: iniciado incrementalmente em 2026-04-15 com `boot-wiring.js` reduzido para **263L**,
   `boot-steps.js` criado com **321L**, e validação focada/regressiva de **83/83** testes verdes.

4. **`K6b` — extrair `event-bridge-wiring.js`**
   Tirar o bridge lazy do corpo de `always-alive.js`.

   **Status atual**: iniciado incrementalmente em 2026-04-15 com `event-bridge-wiring.js`, `always-alive.js` agora em
   638L e validação focada de **21/21** testes verdes.

### Onda C — consolidação intermediária

5. **`K4` — Background Task Tracker**
   **Status atual**: iniciado incrementalmente com `background-tasks.js`, `track()` em pontos centrais e
   `drain(5000)` no shutdown.
6. **`K7` — Health Check Formal**
   **Status atual**: entregue incrementalmente com `health-check.js`, `getHealthSnapshot()` e rotas públicas/privadas
   alinhadas ao snapshot canônico.
7. **limpeza residual da compatibilidade de `K1b`**

### Onda D — fechamento da fase

8. remover shims residuais
9. zerar `agent/session/event-handlers/`
10. revalidar meta de LoC do módulo
11. executar regressão ampla (`lint` + `test:unit` + suites relevantes)

---

## 8. Decisões arquiteturais recomendadas

1. **Não fundir fila com diálogo**
   `turn-executor.js` permanece no domínio do diálogo.

2. **Aceitar shims como estratégia transitória**
   Desde que explicitamente rastreados e com plano de remoção.

3. **Priorizar extrações de coordenação antes de micro-otimizações de LoC**
   A redução líquida virá depois da redução de acoplamento.

4. **Tratar cobertura de testes por subfase, não por pasta**
   O módulo já tem cobertura relevante fora de `tests/unit/copilot/agent/`.

---

## 9. Próximo corte executável recomendado

**Recomendação principal**: continuar em `K4` agora, com `K7` já estabelecido como base operacional.

Motivos:

- aproveita o fato de `K1b` já ter atravessado o runtime principal (`session-setup`, `messaging`, `dialog`, `ops`, `lifecycle` e parte da fachada);
- reduz acoplamento transversal entre `always-alive`, `lifecycle`, `session` e qualquer lógica fire-and-forget hoje difusa;
- o lote 1 já está verde, e com `K7` estabelecido o próximo passo natural é expandir a integração de `K4` antes de apertar a limpeza residual;
- abre caminho para a limpeza residual de compatibilidade sem reintroduzir coordenação escondida.

---

## 10. Conclusão

O `agent/` já saiu do estágio de refatoração “cego” e entrou em um estágio de **evolução dirigida por arquitetura**.

O trabalho agora não é mais descobrir por onde começar; é **seguir a ordem certa**:

1. política de erro,
2. contexto particionado,
3. wiring/boot ainda mais finos,
4. remoção das dívidas temporárias.

Esse documento passa a ser a referência complementar para qualquer continuação séria de `M-03`.
