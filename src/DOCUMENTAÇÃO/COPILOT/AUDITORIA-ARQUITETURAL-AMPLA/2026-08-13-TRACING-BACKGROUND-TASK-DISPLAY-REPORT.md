# Relatório — Tracing: frase de background task exibida após respostas

**Investigação sem mudanças de código**  
**Data**: 2026-08-13  
**Sessão**: 32337c6a-f7d0-4f48-9f77-9c67e62d5cdf  
**Escopo**: `src/copilot`

---

## 1. Pergunta operacional

Por que a frase **“Promote an authorized same-session route switch after dialog.turn_end”** aparece
para o operador depois das respostas?

---

## 2. Hipótese confirmada

É um **vazamento de detalhe interno de background task** para a superfície de atividade/eventos do
terminal.

- A string **não** vem do conteúdo da resposta da LLM-B.
- Ela nasce como `description` de uma **background task** registrada pelo agent no boundary do turno
  de diálogo.
- Depois, é consumida por caminhos do terminal que aceitam `label ?? description` como texto
  visível.

---

## 3. Origem canônica

**Arquivo**: `src/copilot/agent/lifecycle/model-gateway-turn-boundary.js`

- Função relevante: `wireAgentModelGatewayTurnBoundaryPromotion(...)`
- Evento gatilho: `dialog.turn_end`
- Registro da task:

```
ctx.trackBackgroundTask(task, {
  label: 'model-gateway.deferred-route-promotion',
  description: 'Promote an authorized same-session route switch after dialog.turn_end'
});
```

- A task executa promoção diferida de rota do Model Gateway **na mesma sessão SDK** após o fim do
  turno.
- O comportamento é intencional do ponto de vista de roteamento; o problema é a **exposição da
  descrição em UI operacional**.

---

## 4. Caminho de exibição para o operador

### 4.1 Tracker de background tasks

**Arquivo**: `src/copilot/agent/background-tasks.js`

- Método relevante: `track(task, meta = {})`
- Armazena `label` e `description` por task.
- Emite callback `onCompleted` com
  `{ label, description, status, error, durationMs, pendingCount, ts }`.
- Esse callback é a porta de saída estrutural para superfícies externas.

### 4.2 Evento/atividade do terminal

**Arquivo**: `src/copilot/terminal/events/sdk-session-events.js`

- Há handler `onSessionBackgroundTasksChanged` que registra atividade:

```
recordTerminalActivity('system', 'Tarefas em segundo plano do SDK', {
  detail: pluralPt(count, 'pendente', 'pendentes'),
  source: 'sdk',
  severity: count > 0 ? 'warn' : 'info',
  recordHistory: count > 0,
});
```

- Também há `onSessionTaskComplete`, que registra:

```
recordTerminalActivity('task', 'Tarefa em segundo plano concluída', {
  detail: summary || 'SDK sinalizou conclusão de tarefa',
  source: 'sdk',
});
```

- Emissões SSE correspondentes:
  - `session.background_tasks_changed`
  - `session.task_complete`

**Arquivo**: `src/copilot/terminal/commands/events.js`

- Função `summarizeBackgroundPayload(payload)` usa:

```
const label = humanEventMessage(payload['label'] ?? payload['description']);
```

Esse é um ponto onde a descrição da task pode aparecer diretamente no texto de evento exibido.

**Arquivo**: `src/copilot/terminal/commands/session.js`

- Renderiza `projection.activity.label` e `projection.activity.detail` em comandos de status da
  sessão.
- Portanto, se `activity` for preenchida a partir de eventos de background/task, a descrição interna
  pode aparecer no painel do operador.

### 4.3 Adapter/contratos do terminal

**Arquivo**: `src/copilot/terminal/events/event-adapter-events.js`

- `TERMINAL_EXPLICIT_AGENT_EVENTS` inclui:
  - `session.background_tasks_changed`
  - `session.task_complete`
  - `agent.background.completed`
  - `agent.background.idle`

Isso indica que essas superfícies são consideradas **first-class para o terminal** e, portanto, têm
alta probabilidade de se tornar visíveis ao operador por design.

---

## 5. Por que aparece após respostas

- O agendamento da promoção está amarrado a `dialog.turn_end`.
- Após cada turno em que a rota diferida é armada/completada, o `BackgroundTasks` notifica conclusão
  ou mudança de estado.
- O terminal recebe esse sinal e atualiza atividade/eventos.
- Em pelo menos um caminho visível, o texto usa `description` quando `label` não é suficiente,
  exibindo a frase exata.

---

## 6. Diagnóstico final

- **Causa raiz**: uso de `description` como texto humano visível em um fluxo que não distingue
  “detalhe operacional interno” de “evento voltado ao operador”.
- **Comportamento funcional**: correto. A promoção pós-turno é intencional.
- **Problema de UX**: a mensagem exibida é uma descrição interna em inglês, não uma status line
  humana em pt-BR.
- **Risco de ruído**: pode aparecer repetidamente após turnos, gerando sensação de loop/telemetria.

---

## 7. Achados estruturais relevantes

- `src/copilot/agent/background-tasks.js`: owner canônico de rastreamento; trata `description` como
  texto legível sem filtrar por público.
- `src/copilot/terminal/commands/events.js`: consome `label ?? description` sem sanitização.
- `src/copilot/terminal/events/sdk-session-events.js`: converte mudanças em atividade/SSE do
  terminal.
- `src/copilot/terminal/commands/session.js`: exibe atividade atual no status da sessão.

---

## 8. Recomendação de correção canônica

> Nenhuma alteração foi executada nesta investigação.

Para eliminar esse vazamento sem quebrar observabilidade:

1. Mudar a `description` dessa task específica para um rótulo interno semântico.
2. Manter `label` como chave estável.
3. Introduzir um mapeamento local de `label -> texto humano pt-BR` na superfície do terminal.
4. Fazer `summarizeBackgroundPayload` preferir o mapeamento humano em vez de `description` crua.
5. Garantir que `session.background_tasks_changed` continue informando apenas quantidade e estado,
   não descrição livre.

---

## 9. Arquivos auditados

- `src/copilot/agent/lifecycle/model-gateway-turn-boundary.js`
- `src/copilot/agent/background-tasks.js`
- `src/copilot/terminal/events/sdk-session-events.js`
- `src/copilot/terminal/commands/events.js`
- `src/copilot/terminal/commands/session.js`
- `src/copilot/terminal/events/event-adapter-events.js`
- `src/copilot/terminal/byok/deferred-route-promotion.js`
- `src/copilot/model-gateway/control-plane/deferred-route-promotion.js`
- `src/copilot/model-gateway/control-plane/deferred-route-operation.js`

---

## 10. Conclusão

A frase **é um detalhe interno** de uma background task de promoção de rota do Model Gateway,
exibida acidentalmente pelo terminal por meio de `label ?? description` em fluxos de
eventos/atividade. A causa está na ausência de separação entre “texto para humanos” e “texto para
telemetria/observabilidade”.
