# 98 — Situação ideal UX Terminal 2.1

**Data:** 2026-05-01  
**Escopo:** alvo arquitetural para `src/copilot/terminal`.

---

## 1) Princípio central

O terminal é a experiência humana do runtime contínuo. Ele deve ser excelente em:

- informar estado operacional;
- orientar ação rápida;
- reduzir ambiguidade durante falhas;
- renderizar turnos e eventos;
- aceitar comandos humanos;
- conectar-se a projections canônicas.

Ele não deve virar owner de:

- sessão SDK;
- estado vivo do agent;
- projections compartilhadas com server;
- política de modelo/fallback;
- persistência de conversa;
- semântica de eventos vanilla.

---

## 2) Topologia alvo

```text
terminal/
  README.md
  index.js                 # composition root fino
  bootstrap.js             # entrypoint executável
  module-map.js            # inventário + risco + scorecard
  boot/
    phases.js              # fases transacionais do terminal
    resources.js           # pinned/hub/http/listeners/timers
    shutdown.js            # rollback + handlers
  repl/
    repl.js                # lifecycle readline
    command-router.js      # tabela e dispatch
    banner.js              # banner/discoverability
    multiline.js           # input multiline
    input-parser.js        # /cmd, @path, texto comum
  commands/
    ...
  dialog/
    ...
  frontend/
    projections/
      status.js
      now.js
      metrics.js
      usage.js
      sdk-session.js
      runtime-topology.js
    runtime-gateway.js
  events/
    agent-runtime-events.js
    sdk-session-events.js
    task-stream-events.js
    sse-fallback.js
  state/
    activity-state.js
    rate-limiter-state.js
  stores/
    alias-store.js
  handlers/
    ...
```

Essa árvore não precisa acontecer em uma única onda. A regra é preservar compatibilidade pública e
remover shims rapidamente.

---

## 3) UX ideal

### Prompt

O prompt deve comunicar somente sinais úteis para decisão imediata:

- runtime/model/reasoning;
- loop ativo/inativo;
- modo SDK;
- fila;
- pergunta pendente;
- shadow expiring/expired;
- runtime fallback quando ocorrer.

Sinais densos devem ser controlados por presets de display.

### `/status`

Deve ser o relatório amplo:

- runtime selecionado;
- modelo configurado e modelo cobrado;
- mismatch e ação recomendada;
- lifecycle boot/shutdown;
- fila/pergunta/shadow;
- SDK mode/plan;
- quotas/usage resumidos;
- hub/session ids;
- links de próximos comandos.

### `/now`

Deve ser o snapshot curto de live-debug:

- runtime;
- status;
- loop;
- mode;
- queue;
- ask/shadow;
- mismatch;
- atividade atual.

### `/diagnose`

Deve ser triagem semi-automatizada:

- falhas recentes;
- recovery recomendado;
- health por camada;
- event adapters ativos;
- últimos erros do boot/dialog/SSE;
- próximos comandos sugeridos.

### `/display`

Deve ser uma policy de densidade:

- presets oficiais;
- overrides por toggle;
- persistência futura se necessário;
- documentação de tradeoff.

---

## 4) Arquitetura ideal por fronteira

| Fronteira              | Owner ideal                                          | Terminal consome como       |
| ---------------------- | ---------------------------------------------------- | --------------------------- |
| Agent status/control   | `presentation/runtime-*`                             | projection/gateway          |
| Dialog turns           | `presentation/runtime-dialog` + `terminal/dialog`    | gateway + render            |
| SDK mode/plan/usage    | `sdk` + `presentation`                               | projection                  |
| Conversation history   | `conversation-hub` + `presentation/conversation-hub` | projection/handler          |
| Human commands         | `terminal/commands`                                  | owner local                 |
| Readline UX            | `terminal/repl`                                      | owner local                 |
| SSE terminal           | `terminal/dialog/sse` + `presentation/realtime`      | owner local + contract      |
| Boot/shutdown terminal | `terminal/boot` + `core/shutdown`                    | owner local + core registry |

---

## 5) Critérios objetivos de pronto

1. `terminal/module-map.js` cobre raiz com `risk`, scorecard e contratos de tamanho.
2. Todo arquivo acima de 300 linhas é `hotspot`; acima de 220 é `watch` ou `hotspot`.
3. `frontend/llm-b-frontend.js` deixa de concentrar projections heterogêneas.
4. `frontend/llm-b-runtime.js` vira gateway menor ou composition de gateways.
5. `repl.js` deixa de conter catálogo de comandos e parser multiline.
6. `index.js` deixa de conter detalhes de recursos, mantendo apenas composição de fases.
7. `/display preset` possui testes e documentação de UX.
8. `/now`, `/status`, pós-turno e `/usage` exibem modelo configurado/cobrado com shape comum.
9. Pergunta pendente restaurada tem contrato de replay/dedupe.
10. O terminal continua passando em typecheck strict, lint e suíte Copilot.
