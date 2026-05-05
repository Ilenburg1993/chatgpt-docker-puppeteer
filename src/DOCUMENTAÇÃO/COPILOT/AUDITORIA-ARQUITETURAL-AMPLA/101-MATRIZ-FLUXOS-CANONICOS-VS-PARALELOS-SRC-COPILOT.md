# 101 — Matriz de fluxos canônicos vs paralelos (`src/copilot`)

**Data:** 2026-05-01 **Atualização:** 2026-05-04 **Objetivo:** classificar todas as rotas de
execução por criticidade de convergência para o canônico.

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

| Domínio           | Fluxo                                               | Classe |   I |   D |   P | Evidência principal                               | Ação recomendada                                |
| ----------------- | --------------------------------------------------- | -----: | --: | --: | --: | ------------------------------------------------- | ----------------------------------------------- |
| Boot              | `terminal/bootstrap.js -> bootCopilot`              |      C |   5 |   1 |   5 | `boot/contract.js`                                | manter como único owner executável              |
| Boot              | nenhum entrypoint compat residual                   |      — |   0 |   0 |   0 | `boot/contract.js`, `terminal/bootstrap.js`       | removido — manter bloqueio contratual           |
| Boot/PM2          | nenhum paralelo residual                            |      — |   0 |   0 |   0 | `boot/contract.js`                                | removido — apenas `llm-b-terminal` permanece    |
| DI wiring         | setters explícitos de composição                    |     PC |   1 |   2 |   2 | `runtime-wiring.js`, `observability/bootstrap.js` | migrar consumers restantes para DI pura         |
| Runtime           | `agent/runtime-registry.js` + default runtime       |      C |   5 |   2 |  10 | `agent/runtime-registry.js`                       | ampliar cobertura multi-runtime                 |
| Runtime selection | fallback informativo em projections de leitura      |     PC |   2 |   2 |   4 | `runtime-status/health/overview`                  | manter metadata explícita e warning             |
| Runtime selection | runtime explícito inexistente em rotas operacionais |      C |   5 |   1 |   5 | `server/routes/sdk/*`, `runtime-*`                | manter `AGENT_RUNTIME_NOT_FOUND` contratual     |
| SDK boundary      | `sdk/*` + `event-handlers/*`                        |      C |   5 |   1 |   5 | `sdk/README.md`, `event-handlers/README.md`       | preservar soberania vanilla                     |
| Agent facade      | `agent-sdk-access.js` + `facades/sdk/*`             |      C |   5 |   2 |  10 | `agent/facades/README.md`                         | manter entrypoint único público                 |
| Server SDK routes | composição por `sdk/deps.js`                        |      C |   5 |   2 |  10 | `server/routes/sdk/README.md`                     | endurecer contratos anti-import direto          |
| Server            | nenhum shim HTTP residual                           |      — |   0 |   0 |   0 | `server/routes/presentation-route.js`             | removido — adapter canônico único               |
| Logging           | stdout/stderr resiliente a TTY quebrado             |      C |   4 |   1 |   4 | `observability/logger.js`                         | manter sink como detalhe operacional            |
| Terminal frontend | gateways + projections                              |      C |   5 |   1 |   5 | `terminal/frontend/index.js`, `README.md`         | manter padrão explícito                         |
| Terminal events   | adapters dedicados                                  |      C |   4 |   2 |   8 | `event-adapters.js`                               | ampliar cobertura de eventos sem fallback       |
| Terminal events   | `agent-sse-passthrough.js`                          |     PC |   2 |   3 |   6 | `terminal/module-map.js`, `event-adapter-events`  | migrar allowlist residual para adapters/ignore  |
| Dialog transport  | `frontend/gateways/dialog.js -> #copilot/channel`   |      C |   4 |   2 |   8 | `gateway/dialog.js`                               | manter isolamento nesse gateway                 |
| Timeline dual     | cauda viva `llmBridgeClient` materializada no Hub   |      C |   5 |   1 |   5 | `frontend/projections/timeline.js`                | manter contratos e telemetria                   |
| Observability     | EventBus bridge coverage                            |      C |   4 |   2 |   8 | `events/catalog.md`, runtime event bridge         | manter mapeamento declarativo                   |
| Conversation Hub  | store/orchestrator/socket                           |      C |   4 |   2 |   8 | `conversation-hub/README.md`                      | separar ainda mais domínio x protocolo          |
| System prompt     | `append` estático + config declarativa              |      C |   4 |   1 |   4 | `config/system-prompt/builders.js`                | manter como default seguro                      |
| System prompt     | auto-reload por `SectionTransformFn`                |      C |   5 |   2 |  10 | `config/system-prompt/live-builders.js`           | ampliar observabilidade de revisão              |
| System prompt     | status/introspection (`status.js` + sources RPC)    |      C |   4 |   1 |   4 | `config/system-prompt/status.js`                  | manter como superfície única de troubleshooting |
| System prompt     | binding/freshness persistidos no runtime            |      C |   5 |   1 |   5 | `agent/state`, `runtime-overview`, `status.js`    | propagar por health/config/status/metrics       |
| Inject            | histórico canônico correlacionado a digest/frescor  |      C |   4 |   1 |   4 | `presentation/agent-control.js`, `runtime-ui-*`   | manter diagnóstico unido ao fluxo de inject     |
| Inject            | timeout policy única em `core/` + watchdog-only     |      C |   5 |   1 |   5 | `core/dialog-timeout-policy.js`, `channel/inject` | evitar reabrir algoritmos paralelos             |
| Inject            | diagnósticos por fase e filtro por runtime          |      C |   4 |   1 |   4 | `runtime-dialog.js`, `runtime-ui-state-store.js`  | manter troubleshooting canônico em `/metrics`   |
| System prompt     | `replace` em sessão viva                            |     PR |   4 |   4 |  16 | limitação do SDK (`systemMessage` sem live set)   | restringir a uso explícito; favorecer resume    |
| Barrels           | `index.js` com lógica operacional                   |     PR |   3 |   4 |  12 | `config/index.js`, `system-prompt/index.js`       | migrar para barrels puros 2.1                   |

---

## 3) Paralelos prioritários remanescentes

1. **Passthrough SSE residual sem adapter dedicado** (`P=6`, PC com sunset)
2. **Fallback informativo de runtime default em projections de leitura** (`P=4`, PC com metadata)
3. **`replace` em sessão viva no system prompt** (`P=16`, PR por limitação do SDK)
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
sunset explícito. Após a rodada de 2026-05-04, runtime explícito inválido deixou de ser fallback nas
rotas operacionais/SDK e passou a falhar com `AGENT_RUNTIME_NOT_FOUND`; a E3 também fechou a
timeline dual com sync lazy, retry, TTL e telemetria. O que resta como paralelo transversal é
diminuir o residual de passthrough SSE ainda sem adapter dedicado e convergir a borda de system
prompt para auto-reload total, reconhecendo que o único residual técnico forte é `replace` em sessão
viva sem RPC nativa do SDK. A introspecção canônica (`readSystemPromptStatus`, `/sdk prompt`,
`/api/sdk/agent/system-prompt`) agora reduz o troubleshooting a uma cadeia única
`config -> presentation -> adapters`, eliminando inspeções ad hoc do prompt em bordas distintas. A
onda seguinte também promoveu `systemPromptBinding` / `systemPromptFreshness` para
`runtime-overview`, `/health`, `/config`, `/status` e `/metrics`, além de correlacionar o último
`/inject` com digest/frescor do prompt na cadeia canônica
`agent-control -> runtime-ui-state -> metrics/status`. Na rodada de 2026-05-05, a auditoria profunda
do `/inject` também eliminou o drift entre a policy de timeout do canal e das bordas HTTP/terminal,
centralizando a regra em `core/dialog-timeout-policy.js`. O fluxo agora aceita watchdog-only
(`timeout=0/null`) de ponta a ponta, persiste diagnósticos por fase
(`preflight/context/attachments/dialog`) e filtra o último inject por `runtimeId`, evitando que o
troubleshooting multi-runtime mostre a telemetria do runtime errado.
