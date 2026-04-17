# Módulo Prioritário — `observability/`

## 1. Por que este módulo foi eleito prioritário

Entre todos os módulos de `src/copilot`, `observability/` é o melhor candidato para a próxima transformação estrutural profunda porque concentra três sinais fortes ao mesmo tempo:

1. **centralidade transversal extrema** — `cross -> observability = 91`;
2. **massa estrutural relevante** — `33 arquivos / 5.893 linhas`;
3. **papel ainda impreciso** entre coleta, reação, health, erro e leitura operacional.

Em termos práticos: se esse módulo continuar difuso, ele continuará contaminando a arquitetura do restante do sistema.

## 2. Anatomia atual do módulo

### Áreas internas observadas

- raiz do módulo:
  - `bootstrap.js`
  - `event-collector.js`
  - `agent-event-observer.js`
  - `error-tracker.js`
  - `error-alerting.js`
  - `metrics.js`
  - `snapshots.js`
  - `event-catalog.js`
  - `tool-stats.js`
  - `logger.js`
  - `otel.js`
- `collectors/`
- `observers/`
- `bus-actions/`

### Leitura estrutural

Hoje o módulo contém, ao mesmo tempo:

- infraestrutura de log;
- coleta de eventos do SDK;
- observação de eventos do agente;
- subscribers do EventBus;
- projeções de health indiretas;
- tracking de erro;
- métricas e snapshots.

Isso é poderoso, mas também perigoso: se tudo isso convive sem um owner interno claro, `observability/` vira um “macro-balde” arquitetural.

## 3. Problemas específicos encontrados

### 3.1 Duplicação de runtime de observação do EventBus

Há sinais de sobreposição entre:

- `event-bus-observers.js`
- `bus-actions/log-observer.js`
- `bus-actions/metrics-collector.js`
- `bus-actions/health-updater.js`
- `bus-actions/activity-tracker.js`
- `bus-actions/error-alerter.js`
- `bus-actions/correlation-tracer.js`

O ponto mais crítico é que `event-bus-observers.js` e `log-observer.js` fazem versões diferentes do mesmo tipo de papel: “observar e registrar eventos do EventBus”.

### 3.2 Health de observability não está claramente fechado como domínio próprio

Existe health do agente, registry agregado e health derivado de eventos — mas `observability/` ainda não está plenamente representado no registry como módulo com runtime próprio.

### 3.3 Mistura de camadas internas

`collectors`, `observers` e `bus-actions` apontam para uma decomposição correta, mas ainda incompleta:

- collector = ingestão
- observer = observação de fonte específica
- bus-action = reação observacional do EventBus

Hoje essa distinção ainda não está imposta pela arquitetura pública do módulo.

## 4. Arquitetura ideal específica para `observability/`

### 4.1 Papéis desejados

#### `logger.js`
- logging puro

#### `metrics.js`
- store e summary de métricas

#### `error-tracker.js` / `error-alerting.js`
- tracking e alerting de erro

#### `event-collector.js` + `collectors/*`
- ingestão de eventos do SDK

#### `agent-event-observer.js` + `observers/*`
- observação de eventos do runtime/agente

#### `event-bus-runtime.js` (novo owner canônico)
- composição única do runtime observacional do EventBus
- agregando:
  - log observer
  - metrics collector
  - activity tracker
  - health updater
  - correlation tracer
  - error alerter

#### `bootstrap.js`
- único ponto de wiring do módulo

### 4.2 Regra de fronteira interna

- `collectors/*` não devem arbitrar health global;
- `observers/*` não devem virar pipeline genérica do EventBus;
- `bus-actions/*` não devem ficar órfãos e sem owner;
- `bootstrap.js` deve acoplar apenas **um runtime canônico** do EventBus.

## 5. Critérios de sucesso específicos do módulo

### Critério O1 — owner do EventBus

Deve existir **um lugar único** responsável por anexar `observability/` ao EventBus.

### Critério O2 — compatibilidade controlada

APIs legadas como `event-bus-observers.js` podem sobreviver temporariamente, mas apenas como shim/adapter fino para o runtime canônico.

### Critério O3 — health observability explícito

`server/routes/health-registry.js` deve enxergar `observability/` como módulo próprio, com health derivado da sua runtime pipeline.

### Critério O4 — separação interna

Collector, observer e bus runtime devem permanecer semanticamente distintos.

### Critério O5 — testes de contrato

Deve existir teste cobrindo:

- criação do runtime canônico;
- atualização de métricas/health por eventos;
- detach limpo;
- integração de bootstrap/compat registry.

## 6. Transformações objetivas propostas

### T-OBS-01
Criar `src/copilot/observability/event-bus-runtime.js` como owner único da composição observacional do EventBus.

### T-OBS-02
Migrar `bootstrapObservability()` para anexar esse runtime canônico, em vez de acoplar apenas `log-observer`.

### T-OBS-03
Reduzir `event-bus-observers.js` a compat shim, removendo sua autonomia arquitetural.

### T-OBS-04
Expor health/diagnostics do runtime de observability para o registry de módulos.

### T-OBS-05
Criar testes de contrato específicos para a nova arquitetura interna.

## 7. Primeiro corte escolhido para execução agora

O primeiro corte selecionado é:

> **T-OBS-01 + T-OBS-02 + T-OBS-03 + T-OBS-04 + T-OBS-05**

Isto é:

- criar o runtime canônico do EventBus dentro de `observability/`;
- ligar o bootstrap nele;
- degradar o legado para adapter;
- publicar health do módulo;
- e amarrar tudo com testes.

Esse corte foi escolhido porque reduz simultaneamente:

1. duplicação funcional;
2. ambiguidade de ownership;
3. fragmentação do wiring;
4. invisibilidade do health de `observability/`.

## 8. Estado após a execução do primeiro corte

O primeiro corte já foi materializado em código.

### Entregas realizadas

- surgiu `src/copilot/observability/event-bus-runtime.js` como owner canônico da runtime pipeline observacional do EventBus;
- `bootstrapObservability()` passou a anexar essa runtime diretamente;
- `event-bus-observers.js` foi reduzido a compat shim fino;
- `server/routes/health-registry.js` passou a registrar `observability` como módulo próprio no health registry;
- foram adicionados testes de comportamento e contrato para segurar essa arquitetura.

### Critérios O1–O5 após o corte

| Critério                            | Estado                        |
| ----------------------------------- | ----------------------------- |
| O1 — owner do EventBus              | **atingido neste corte**      |
| O2 — compatibilidade controlada     | **atingido neste corte**      |
| O3 — health observability explícito | **atingido neste corte**      |
| O4 — separação interna              | **atingido no segundo corte** |
| O5 — testes de contrato             | **atingido neste corte**      |

### Próxima etapa recomendada dentro do módulo

Depois deste corte, a próxima etapa mais útil em `observability/` é reduzir a sobreposição entre:

- `agent-event-observer.js`
- `collectors/*`
- leituras operacionais expostas via `presentation/system-metrics.js`

O objetivo passa a ser menos “criar owner” e mais “limpar a superfície restante”.
## 9. Segundo corte — T-OBS-06

### Motivação

Após o primeiro corte, o único artefato de tipo falso remanescente no módulo era o `dummyAgent` em
`agent-event-observer.js`:

```js
// ANTES (hacky — double cast)
const dummyAgent = /** @type {EventEmitter} */ (/** @type {unknown} */ ({}));
const ctx = { ..., agent: dummyAgent, on: busOn };
```

Em modo bus (`attachToBus()`), `agent` não existe — não há EventEmitter. O cast tornava a tipagem mentirosa.

### Alterações realizadas

#### `src/copilot/observability/observers/context.js`

- `ObserverContext.agent` alargado de `EventEmitter` para `EventEmitter | null`
- `ObserverContext.on` primeiro parâmetro alargado de `EventEmitter` para `EventEmitter | null`
- Documentação explícita dos dois modos: **emitter** (agent não-null) e **bus** (agent = null)

#### `src/copilot/observability/agent-event-observer.js`

- `_onEmitter()` recebe guard defensivo `if (!emitter) return;` para satisfazer tipo alargado
- `attachToBus()` elimina `dummyAgent` e passa `agent: null` — semanticamente correto
- Comentário inline explica que em modo bus o EventEmitter não existe

### Contrato adicionado

Novo test em `tests/unit/copilot/test_observability_runtime_contract.spec.js`:

> "agent-event-observer não usa dummyAgent em attachToBus (T-OBS-06)"

Verifica: ausência de `dummyAgent`, presença de `agent: null`, typedef com `EventEmitter | null`.

### Estado de O1–O5 após o segundo corte

| Critério                            | Estado                           |
| ----------------------------------- | -------------------------------- |
| O1 — owner do EventBus              | ✅ atingido no primeiro corte     |
| O2 — compatibilidade controlada     | ✅ atingido no primeiro corte     |
| O3 — health observability explícito | ✅ atingido no primeiro corte     |
| O4 — separação interna              | ✅ atingido no segundo corte      |
| O5 — testes de contrato             | ✅ atingido (7/7 testes passando) |
