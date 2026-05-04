# 101 — Matriz de fluxos canônicos vs paralelos (`src/copilot`)

**Data:** 2026-05-01 **Objetivo:** classificar todas as rotas de execução por criticidade de
convergência para o canônico.

---

## 1) Critérios de classificação

- **C (Canônico):** fluxo recomendado e SSOT atual.
- **PC (Paralelo Controlado):** fluxo alternativo permitido por compatibilidade/operacional.
- **PR (Paralelo de Risco):** fluxo alternativo com potencial de drift/duplicação semântica.

Pontuação:

- **Impacto (I):** 1–5
- **Risco de drift (D):** 1–5
- **Prioridade (P):** `I * D`

---

## 2) Matriz consolidada

| Domínio           | Fluxo                                               | Classe |   I |   D |   P | Evidência principal                               | Ação recomendada                               |
| ----------------- | --------------------------------------------------- | -----: | --: | --: | --: | ------------------------------------------------- | ---------------------------------------------- |
| Boot              | `terminal/bootstrap.js -> bootCopilot`              |      C |   5 |   1 |   5 | `boot/contract.js`                                | manter como único owner executável             |
| Boot              | nenhum entrypoint compat residual                   |      — |   0 |   0 |   0 | `boot/contract.js`, `terminal/bootstrap.js`       | removido — manter bloqueio contratual          |
| Boot/PM2          | nenhum paralelo residual                            |      — |   0 |   0 |   0 | `boot/contract.js`                                | removido — apenas `llm-b-terminal` permanece   |
| DI wiring         | setters explícitos de composição                    |     PC |   1 |   2 |   2 | `runtime-wiring.js`, `observability/bootstrap.js` | migrar consumers restantes para DI pura        |
| Runtime           | `agent/runtime-registry.js` + default runtime       |      C |   5 |   2 |  10 | `agent/runtime-registry.js`                       | ampliar cobertura multi-runtime                |
| Runtime selection | fallback para runtime default                       |     PR |   4 |   4 |  16 | `presentation/agent-runtime.js`                   | tornar fallback explícito em todas as bordas   |
| SDK boundary      | `sdk/*` + `event-handlers/*`                        |      C |   5 |   1 |   5 | `sdk/README.md`, `event-handlers/README.md`       | preservar soberania vanilla                    |
| Agent facade      | `agent-sdk-access.js` + `facades/sdk/*`             |      C |   5 |   2 |  10 | `agent/facades/README.md`                         | manter entrypoint único público                |
| Server SDK routes | composição por `sdk/deps.js`                        |      C |   5 |   2 |  10 | `server/routes/sdk/README.md`                     | endurecer contratos anti-import direto         |
| Server            | nenhum shim HTTP residual                           |      — |   0 |   0 |   0 | `server/routes/presentation-route.js`             | removido — adapter canônico único              |
| Logging           | stdout/stderr como sink operacional implícito       |     PR |   4 |   4 |  16 | `observability/logger.js`                         | tornar logger resiliente a TTY quebrado        |
| Terminal frontend | gateways + projections                              |      C |   5 |   1 |   5 | `terminal/frontend/index.js`, `README.md`         | manter padrão explícito                        |
| Terminal events   | adapters dedicados                                  |      C |   4 |   2 |   8 | `event-adapters.js`                               | ampliar cobertura de eventos sem fallback      |
| Terminal events   | `agent-sse-passthrough.js`                          |     PC |   2 |   3 |   6 | `terminal/module-map.js`, `event-adapter-events`  | migrar allowlist residual para adapters/ignore |
| Dialog transport  | `frontend/gateways/dialog.js -> #copilot/channel`   |      C |   4 |   2 |   8 | `gateway/dialog.js`                               | manter isolamento nesse gateway                |
| Timeline dual     | histórico `llmBridgeClient` vs histórico SDK sessão |     PR |   4 |   4 |  16 | `gateway/dialog.js`, `agent/session/history`      | unificar narrativa no plano de estado/projeção |
| Observability     | EventBus bridge coverage                            |      C |   4 |   2 |   8 | `events/catalog.md`, runtime event bridge         | manter mapeamento declarativo                  |
| Conversation Hub  | store/orchestrator/socket                           |      C |   4 |   2 |   8 | `conversation-hub/README.md`                      | separar ainda mais domínio x protocolo         |

---

## 3) Top 7 paralelos prioritários

1. **Fallback de runtime default implícito** (`P=16`)
2. **Timeline dual channel-history vs sdk-history** (`P=16`)
3. **stdout/stderr como sink operacional implícito** (`P=16`)
4. **Setters explícitos no runtime wiring** (`P=2`)

---

## 4) Estratégia de convergência por tipo

### 4.1 PC (paralelo controlado)

- manter por janela limitada;
- exigir telemetria de uso;
- definir gatilho de remoção (sunset);
- bloquear criação de novos consumidores.

### 4.2 PR (paralelo de risco)

- tratar como dívida de arquitetura, não como conveniência;
- criar contrato de governança específico;
- migrar consumidores para fluxo canônico por ondas curtas;
- remover caminho paralelo após validação de regressão.

---

## 5) Meta operacional

**Meta 2.1:** reduzir os paralelos `PR` para zero e manter apenas `PC` estritamente necessários, com
sunset explícito. Na prática, isso agora significa fechar principalmente: fallback implícito de
runtime, timeline dual e o residual de passthrough SSE ainda sem adapter dedicado.
