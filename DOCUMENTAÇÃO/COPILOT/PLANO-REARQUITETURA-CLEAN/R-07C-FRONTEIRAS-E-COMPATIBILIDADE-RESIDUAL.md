# R-07C — Fronteiras por Camada e Compatibilidade Residual

**Programa**: P0 / Faixa A **Data-base**: 2026-04-16 **Status**: canônico para governança de imports
e shims

---

## 1. Propósito

Este documento fecha duas pendências da Faixa A:

1. transformar “fronteiras de camada” em regras explícitas de import e dependência;
2. registrar a compatibilidade residual que continua viva, distinguindo o que é transitório
   rastreado do que já virou dívida prioritária.

---

## 2. Modelo de camadas do ciclo clean

| Camada              | Módulos centrais                                                                      | Papel                                                                     |
| ------------------- | ------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| Runtime truth       | `agent/`, `conversation-hub/`, `channel/`, `sdk/`                                     | runtime, sessão, diálogo, transporte e wrapper do vendor SDK              |
| Shared presentation | `presentation/`                                                                       | SSOT de projections/handlers compartilhados entre `server/` e `terminal/` |
| Remote presentation | `server/`                                                                             | API HTTP/SSE/Socket e presentation remota                                 |
| Local UX            | `terminal/`                                                                           | REPL, comandos, renderização, estado local e streaming local              |
| Domain policy       | `tools/`, `hooks/`, `event-handlers/`, `config/`                                      | políticas, tools, handlers de domínio, builders/config runtime            |
| Cross-cutting/core  | `core/`, `events/`, `observability/`, `infra/`, `types/`, `bridges/`, `db/`, `audit/` | contratos, eventos, telemetria, recursos técnicos e integrações           |

---

## 3. Regras de fronteira por camada

## 3.1 Regras fortes

1. `server/` **não importa** `terminal/` diretamente.
   - baseline atual: **0 imports estruturais diretos**.
2. `presentation/` **não importa** `server/` nem `terminal/`.
   - ela é SSOT compartilhada, não adapter de uma das bordas.
3. `sdk/` **não é dono** de sessão ativa, replay ou registry de sessão.
   - esses ownerships devem migrar para camadas de orquestração adequadas.
4. `terminal/` pode consumir `agent/`, `conversation-hub/`, `channel/` e SDK quando isso for
   **interface operacional real da LLM-B**.
   - isso é compatível com a arquitetura-alvo; não é violação por si só.
5. `observability/` não deve ser atalho para business logic.
   - projections, tracking e métricas sim; ownership de fluxo de negócio não.

## 3.2 Regras de atenção

1. imports diretos de `sdk/`, `agent/` e `observability/` devem cair ao longo do roadmap, porque
   eles são hoje os principais sinais de transversalidade excessiva;
2. `core/` só deve hospedar contratos/utilidades centrais, não virar nova gaveta genérica;
3. `presentation/` deve crescer por extração de SSOTs compartilhadas, não por dumping de lógica de
   borda sem critério;
4. `terminal/commands` e `terminal/handlers` devem se mover para wiring explícito e adapters finos,
   não para novos singletons implícitos.

---

## 4. Registro canônico de compatibilidade residual

## 4.1 Categoria A — deprecados priorizados

| Artefato                               | Status           | Programa de saída | Observação                                         |
| -------------------------------------- | ---------------- | ----------------- | -------------------------------------------------- |
| `src/copilot/sdk/config.js`            | deprecado        | P2 + P6           | wrapper antigo frente a `config/session-config`    |
| `src/copilot/config/system-prompt.js`  | deprecado/facade | P5 + P6           | facade backward compat frente ao submódulo modular |
| `src/copilot/events/create-emitter.js` | deprecado        | P3 + P6           | deve ceder lugar ao uso direto de `EventEmitter`   |
| export legado em `tools/index.js`      | deprecado        | P5 + P6           | preferir `getAllTools()`                           |

## 4.2 Categoria B — shims residuais do `agent/`

| Artefato                                                  | Status             | Programa de saída | Observação                                                      |
| --------------------------------------------------------- | ------------------ | ----------------- | --------------------------------------------------------------- |
| `src/copilot/agent/queue-processor.js`                    | compat shim        | P1/B5             | lógica canônica já vive em `agent/messaging/agent-messaging.js` |
| `src/copilot/agent/infra/task-executor.js`                | compat shim        | P1/B5             | barrel `infra/index.js` já não depende dele                     |
| `src/copilot/agent/session/event-handlers/*`              | compat shim        | P1/B5             | camada canônica já vive em `#copilot/event-handlers/*`          |
| `src/copilot/agent/session/initializer.js` re-exports     | compat transitória | P1/B2/B5          | ainda usado como ponte de rollout                               |
| `src/copilot/agent/dialog/watchdog.js` re-export          | compat transitória | P1/B5             | remover quando consumidores convergirem                         |
| `src/copilot/agent/lifecycle/state-io.js` shims síncronos | compat operacional | P1/C3             | não remover sem contrato explícito de I/O                       |

## 4.3 Categoria C — adapters canônicos transitórios de P4

> Estes artefatos **não são bug**. Eles são adapters finos transitórios enquanto `presentation/`
> consolida a SSOT das bordas.

| Artefato                              | Status                  | Programa de saída | Observação                                         |
| ------------------------------------- | ----------------------- | ----------------- | -------------------------------------------------- |
| `terminal/handlers/system-config.js`  | adapter fino            | P4/F5             | SSOT já vive em `presentation/system-config.js`    |
| `terminal/handlers/dialog.js`         | adapter fino            | P4/F5             | SSOT já vive em `presentation/conversation-hub.js` |
| `terminal/dialog/sse.js`              | adapter fino            | P4/F5             | SSOT já vive em `presentation/realtime.js`         |
| `terminal/rate-limiter-state.js`      | adapter fino            | P4/F5             | SSOT já vive em `presentation/realtime.js`         |
| `terminal/handlers/system-metrics.js` | adapter fino            | P4/F5             | SSOT já vive em `presentation/system-metrics.js`   |
| `terminal/handlers/agent.js`          | adapter fino            | P4/F5             | SSOT já vive em `presentation/agent-control.js`    |
| `terminal/dialog.js`                  | shim de compatibilidade | P4/F5             | re-export do submódulo `dialog/`                   |

## 4.4 Categoria D — helpers de compatibilidade de borda

| Artefato                                                           | Status                | Programa de saída | Observação                                                                       |
| ------------------------------------------------------------------ | --------------------- | ----------------- | -------------------------------------------------------------------------------- |
| `server/routes/agent-health.js` e `getAgentHealthSnapshotCompat()` | compat controlada     | P1/P4/P6          | aceitar enquanto coexistirem instâncias sem `getHealthSnapshot()` uniforme       |
| `server/middleware/rate-limiter-state.js`                          | re-export transitório | P4                | serve como bridge de compatibilidade após extração de `presentation/realtime.js` |
| aliases/retrocompat em rotas SDK                                   | compat localizada     | P2/P4/P6          | manter apenas onde houver consumidor real e contrato documentado                 |

---

## 5. Critério de classificação da compatibilidade residual

### 5.1 Manter temporariamente

Só quando o artefato:

- protege rollout incremental entre SSOT antiga e nova;
- tem programa e fase de saída claros;
- já está documentado neste registro;
- não volta a criar ownership difuso.

### 5.2 Migrar imediatamente

Quando o artefato:

- mantém consumidor novo preso a caminho legado;
- mascara SSOT já consolidada;
- continua atraindo imports por conveniência.

### 5.3 Remover assim que seguro

Quando o artefato:

- já não tem consumidores materiais;
- só existe por inércia histórica;
- ou já tem suite dedicada provando re-export/compatibilidade transitória.

---

## 6. Regras operacionais para novas mudanças

1. não criar novo shim sem declarar:
   - SSOT nova;
   - consumidores legados afetados;
   - programa/fase de saída;
   - suite de prova mínima.
2. não usar adapters transitórios como nova fonte canônica em documentação ou imports novos;
3. toda compatibilidade residual nova deve entrar neste registro no mesmo checkpoint da mudança;
4. compatibilidade residual sem dono e sem fase de saída deve ser tratada como dívida, não como
   design.

---

## 7. Saída esperada desta governança

Ao final das próximas ondas:

- o repositório deve ter menos compatibilidade residual, não mais compatibilidade “bonita”;
- `presentation/` deve ficar estável como SSOT de borda, com menos adapters transitórios no
  terminal;
- P1 e P6 devem encerrar o grosso dos shims legados do `agent/`;
- deprecateds ativos devem cair continuamente, em vez de apenas mudarem de lugar.
