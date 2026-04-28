# 38 — Bloco B / W12: Métricas SDK projetadas no EventBus canônico

**Status**: checkpoint complementar do Bloco B **Última atualização**: 2026-04-27 **Escopo desta
etapa**: projetar `SdkOperationMetric` no `EventBus` canônico do runtime, sem quebrar a separação
entre a SDK Wrapper Layer (L1) e a camada de observabilidade (L2+).

---

## 1. Objetivo desta subonda

Até o checkpoint `37`, as métricas da SDK Wrapper Layer já eram materializadas corretamente em
`defaultMetrics`, mas ainda não existiam como sinal canônico do runtime observável.

Isso deixava uma assimetria:

1. o L1 emitia métrica;
2. a observabilidade convertia em counters/gauges;
3. mas o `EventBus` não recebia um evento canônico desse eixo.

Esta subonda fecha esse delta.

---

## 2. Transformações realizadas

## 2.1 Novo seam canônico: `observability/sdk-metric-bridge.js`

Foi criado um módulo dedicado para projetar `SdkOperationMetric` em dois destinos:

- `MetricsStore`
- `EventBus`

Esse módulo mantém fora de `sdk/` a decisão de como a métrica L1 vira sinal observável em runtime.

### Responsabilidades

- normalização de segmentos para nomes de métricas;
- materialização de contadores e gauges;
- emissão do evento canônico:
  - `sdk:operation:metric`

## 2.2 Bootstrap passa a usar o bridge canônico

`observability/bootstrap.js` deixou de ter a lógica inline de projeção de `SdkOperationMetric` e
passou a delegar ao bridge dedicado.

### Efeito arquitetural

O bootstrap continua como composition root, mas não é mais owner do algoritmo de projeção em si.

## 2.3 Runtime observável passa a enxergar a atividade do L1

`observability/bus-actions/activity-tracker.js` passou a rastrear:

- `sdk:operation:metric`

Com isso, atividade de wrappers do SDK agora aparece na telemetria de atividade do EventBus.

---

## 3. Estado alcançado

Após esta subonda, uma `SdkOperationMetric` crítica (por exemplo, de `sessionFs`, `session.ui.*`,
`rpc/*` ou `sendAndWait`) tem três materializações coerentes:

1. counters/gauges em `MetricsStore`;
2. sinal observável no `EventBus` (`sdk:operation:metric`);
3. presença no snapshot de activity/tracing do runtime observacional.

Isso aproxima a Fase 4 do roadmap do ponto em que o L1 deixa de ser apenas “instrumentado” e passa a
ser também **observável dentro da gramática runtime do sistema**.

---

## 4. Artefatos executáveis desta subonda

### Código

- `src/copilot/observability/sdk-metric-bridge.js`
- `src/copilot/observability/bootstrap.js`
- `src/copilot/observability/bus-actions/activity-tracker.js`

### Testes

- `tests/unit/copilot/observability/test_sdk_metric_bridge.spec.js`
- `tests/unit/copilot/test_observability_runtime_contract.spec.js`

---

## 5. Validação desta etapa

Validação escopada conforme o documento `35`:

- formatter apenas nos arquivos tocados;
- lint apenas nos arquivos JS/test tocados;
- `typecheck:strict:src.copilot`;
- lote focado de testes da subonda.

---

## 6. Conclusão desta subonda

O eixo de observabilidade do boundary SDK deixa de terminar em `defaultMetrics` e passa a penetrar
explicitamente o `EventBus` canônico.

Esse passo é pequeno do ponto de vista de LOC, mas estruturalmente importante:

> as métricas do L1 deixam de ser apenas contabilidade e passam a integrar a gramática observável do
> runtime.
