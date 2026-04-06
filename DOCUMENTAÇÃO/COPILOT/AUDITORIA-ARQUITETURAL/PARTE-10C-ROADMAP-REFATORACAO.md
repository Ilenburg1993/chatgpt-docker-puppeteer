# PARTE-10C — Roadmap de Refatoração: `src/copilot/agent/`

**Data**: 2026-03-15 | **Atualizado**: 2026-07-20 (pós-execução R1–R8 + auditoria ampla)
**Referência**: PARTE-10A (diagnóstico) + PARTE-10B (ideal) **Estratégia**: Fases incrementais, cada
uma independentemente testável

---

## Princípio de Execução

Cada fase:

1. Cria estrutura de diretório (se necessário)
2. Move/renomeia arquivos com `git mv`
3. Atualiza imports internos
4. Atualiza imports externos (consumidores fora de agent/)
5. Atualiza barrel exports
6. Roda `npm run lint` + `npm run test:unit`
7. Commit atômico

---

## Fase R1: Tipos Centralizados + Eliminar Circular Deps

**Objetivo**: Criar `types.js`, eliminar importações circulares de tipos via
`import('./always-alive.js')`.

### R1.1 — Criar `agent/types.js`

- Extrair de `always-alive.js`: `AgentStatus`, `AgentStatusSnapshot`, `PendingQuestion`, `AgentTask`
- Extrair de `agent-contract.js`: `IAlwaysAliveAgent`
- O `agent-contract.js` será reduzido a re-export (deprecated) ou removido

### R1.2 — Atualizar imports dos consumidores de tipos

- `status-snapshot.js`: `import('./always-alive.js').X` → `import('./types.js').X`
- `dialog-loop-manager.js`: idem
- `session-event-wirer.js`: idem

### R1.3 — Remover `agent-contract.js` (agora vazio)

- Se for puro typedef, conteúdo migra 100% para `types.js`

**Teste**: `npm run lint && npm run test:unit` **Commit**:
`refactor(agent): R1 — centralizar typedefs em types.js`

---

## Fase R2: Subdiretório `dialog/`

**Objetivo**: Agrupar os 5 arquivos dialog-\* em `agent/dialog/`.

### R2.1 — Criar `agent/dialog/`

- `git mv dialog-loop-manager.js dialog/loop-manager.js`
- `git mv dialog-turn-executor.js dialog/turn-executor.js`
- `git mv dialog-protocol.js dialog/protocol.js`
- `git mv dialog-watchdog.js dialog/watchdog.js`

### R2.2 — Absorver `dialog-loop-wirer.js` em `dialog/loop-manager.js`

- Copiar o corpo de `wireDialogLoopEvents()` como método estático ou função exportada de
  `loop-manager.js`
- Remover `dialog-loop-wirer.js`
- Atualizar `always-alive.js` para importar de `'./dialog/loop-manager.js'`

### R2.3 — Criar `dialog/index.js` (sub-barrel)

```js
export { DialogLoopManager, wireDialogLoopEvents } from './loop-manager.js';
export { DialogProtocol, ... } from './protocol.js';
export { executeTurnImpl, ... } from './turn-executor.js';
export { DialogWatchdog, WATCHDOG_THRESHOLDS } from './watchdog.js';
```

### R2.4 — Atualizar imports

- `always-alive.js`: `'./dialog-loop-manager.js'` → `'./dialog/loop-manager.js'`
- `always-alive.js`: `'./dialog-loop-wirer.js'` → removido (absorvido)
- `always-alive.js`: `'./dialog-protocol.js'` → `'./dialog/protocol.js'`
- `always-alive.js`: `'./dialog-watchdog.js'` → `'./dialog/watchdog.js'`
- `index.js` raiz: atualizar para importar de `'./dialog/index.js'`
- Consumidores externos que importem diretamente (verificar grep)

**Teste**: `npm run lint && npm run test:unit` **Commit**:
`refactor(agent): R2 — criar subdiretório dialog/`

---

## Fase R3: Subdiretório `session/`

**Objetivo**: Agrupar os 6 arquivos session-\* em `agent/session/`.

### R3.1 — Mover arquivos

- `git mv session-initializer.js session/initializer.js`
- `git mv session-event-wirer.js session/event-wirer.js`
- `git mv session-keepalive.js session/keepalive.js`
- `git mv session-cleanup.js session/cleanup.js`
- `git mv session-rotation.js session/rotation.js`
- `git mv session-snapshot.js session/snapshot.js`

### R3.2 — Criar `session/index.js` (sub-barrel)

### R3.3 — Atualizar imports (always-alive.js + index.js raiz + consumidores externos)

**Teste**: `npm run lint && npm run test:unit` **Commit**:
`refactor(agent): R3 — criar subdiretório session/`

---

## Fase R4: Subdiretório `queue/`

**Objetivo**: Agrupar message-queue.js + task-executor.js.

### R4.1 — Mover arquivos

- `git mv message-queue.js queue/message-queue.js`
- `git mv task-executor.js queue/task-executor.js`

### R4.2 — Criar `queue/index.js`

### R4.3 — Atualizar imports

**Teste**: `npm run lint && npm run test:unit` **Commit**:
`refactor(agent): R4 — criar subdiretório queue/`

---

## Fase R5: Subdiretórios `resilience/`, `security/`, `tools/`, `features/`

### R5.1 — `resilience/`

- `git mv reconnect-policy.js resilience/reconnect-policy.js`
- `git mv state-io.js resilience/state-io.js`
- Criar `resilience/index.js`

### R5.2 — `security/`

- `git mv permission-controller.js security/permission-controller.js`
- `git mv tool-audit-logger.js security/tool-audit-logger.js`
- Criar `security/index.js`

### R5.3 — `tools/` (cuidado: nome pode conflitar com `src/copilot/tools/`)

- Renomear para `agent-tools/` para evitar confusão? Ou manter `tools/` pois está dentro de `agent/`
- `git mv tools-bootstrap.js tools/bootstrap.js`
- Criar `tools/index.js`

### R5.4 — `features/`

- `git mv webhook-manager.js features/webhook-manager.js`
- `git mv handoff-manager.js features/handoff-manager.js`
- `git mv status-snapshot.js features/status-snapshot.js`
- Criar `features/index.js`

### R5.5 — Atualizar todos os imports

**Teste**: `npm run lint && npm run test:unit` **Commit**:
`refactor(agent): R5 — criar subdiretórios resilience, security, tools, features`

---

## Fase R6: Refatorar `index.js` (Barrel Raiz)

**Objetivo**: Substituir 30+ exports flat por sub-barrel imports estruturados.

### R6.1 — Reescrever `index.js`

```js
// agent/index.js — barrel estruturado
export { AlwaysAliveAgent, alwaysAliveAgent, getAgent } from './always-alive.js';
export {
  AGENT_EVENTS,
  DIALOG_LOOP_EVENTS,
  HIGH_FREQUENCY_EVENTS,
  PR_CONSUMING_EVENTS,
} from './events.js';
export * from './types.js';
export * from './dialog/index.js';
export * from './session/index.js';
export * from './queue/index.js';
export * from './resilience/index.js';
export * from './security/index.js';
export * from './tools/index.js';
export * from './features/index.js';
```

### R6.2 — Verificar que exports públicos são preservados (sem remoções)

**Teste**: `npm run lint && npm run test:unit` **Commit**:
`refactor(agent): R6 — barrel raiz estruturado`

---

## Fase R7: Slim Down `always-alive.js`

**Objetivo**: Reduzir de 1605 → ~400-500 linhas. A fase mais delicada.

### R7.1 — Extrair método `#initializeSystems()`

Mover blocos de inicialização de subsistemas de `start()` para um método dedicado.

### R7.2 — Extrair método `#wireAllEvents()`

Consolidar a wiring de eventos da sessão + dialog em um único ponto.

### R7.3 — Delegação explícita para subsistemas

Substituir código inline por chamadas a subsistemas já existentes.

### R7.4 — Mover typedefs restantes para `types.js`

Qualquer typedef que esteja em `always-alive.js` e seja importado por outros módulos.

### R7.5 — Cleanup de código morto e comentários obsoletos

Remover TODOs resolvidos, comentários de fases anteriores (F42, BUG-XX) que já foram implementados.

**Teste**: `npm run lint && npm run test:unit && npm run test:integration` **Commit**:
`refactor(agent): R7 — slim down always-alive.js`

---

## Fase R8: Verificação Final e Documentação

### R8.1 — Rodar suite completa

```bash
npm run lint
npm run format:check
npm run test:unit
npm run test:integration (se disponível)
```

### R8.2 — Atualizar documentação

- Atualizar `DOCUMENTAÇÃO/COPILOT/AUDITORIA-ARQUITETURAL/` com resultado final
- Atualizar referências internas se necessário

### R8.3 — Commit final + Push

- `refactor(agent): R8 — verificação final e documentação`
- `git push`

---

## Resumo de Fases

| Fase | Descrição                 | Risco | Arquivos Afetados |
| ---- | ------------------------- | ----- | ----------------- |
| R1   | Tipos centralizados       | BAIXO | 4-5               |
| R2   | Subdiretório dialog/      | MÉDIO | 6 + imports       |
| R3   | Subdiretório session/     | MÉDIO | 7 + imports       |
| R4   | Subdiretório queue/       | BAIXO | 3 + imports       |
| R5   | Subdiretórios restantes   | BAIXO | 7 + imports       |
| R6   | Barrel raiz               | BAIXO | 1                 |
| R7   | Slim down always-alive.js | ALTO  | 1 (mas crítico)   |
| R8   | Verificação + docs        | BAIXO | 2-3               |

**Tempo estimado total**: Fases R1-R6 são mecânicas (move + import updates). R7 é a fase mais
delicada pois modifica o god object.

**Ordem de dependência**: R1 → R2 → R3 → R4 → R5 → R6 → R7 → R8 (sequencial)

---

# EXECUÇÃO REALIZADA (2026-07-20)

## Estado Final das Fases R1–R8

As fases originais foram ajustadas durante a execução para melhor aderência ao código real:

| Fase | Descrição Original                            | Descrição Executada                                     | Status           | Commit                  |
| ---- | --------------------------------------------- | ------------------------------------------------------- | ---------------- | ----------------------- |
| R1   | Tipos centralizados                           | Criar types.js, remover agent-contract.js               | ✅               | `7756e2ec`              |
| R2   | Subdiretório dialog/                          | 5 arquivos + absorver wirer em loop-manager             | ✅               | `03f7a23f`              |
| R3   | Subdiretório session/                         | 6 arquivos + sub-barrel                                 | ✅               | `47f2465e` + `4a2c1684` |
| R4   | ~~queue/~~ lifecycle/                         | entry.js, reconnect-policy, state-io                    | ✅               | `4f069b26` + `f47609ac` |
| R5   | ~~resilience+security+tools+features~~ infra/ | 8 arquivos consolidados                                 | ✅               | `ea0d7718` + `5d3db79a` |
| R6   | ~~Barrel raiz~~ Análise God Object            | Avaliação: always-alive.js já delega corretamente       | ✅ (sem mudança) | —                       |
| R7   | ~~Slim down~~ Limpeza JSDoc                   | Corrigir @module/@see em 22 arquivos, remover fantasmas | ✅               | `1f56fe44`              |
| R8   | Verificação + push                            | 51 testes OK, push origin/main                          | ✅               | pushed                  |

### Decisões Arquiteturais Tomadas

1. **R4-R5 foram consolidados diferentemente do planejado**: Em vez de queue/, resilience/,
   security/, tools/ e features/ (5 subdirs), criamos lifecycle/ (3 arquivos de ciclo de vida) e
   infra/ (8 arquivos de infraestrutura). Menos fragmentação, mais coesão.

2. **R6 — always-alive.js NÃO foi decomposto**: Após análise aprofundada, o God Object de 1605
   linhas já delega corretamente para os módulos extraídos. O que resta são wirings (connection de
   subsistemas), que é o papel legítimo de um orquestrador. Decomposição forçada criaria acoplamento
   artificial via callbacks/injeção de ~20 campos privados sem ganho real.

3. **Arquivos fantasma removidos**: dialog-loop-manager.js, session-event-wirer.js,
   status-snapshot.js existiam como cópias desatualizadas na raiz e foram excluídos.

---

## Estrutura Final de `src/copilot/agent/`

```
agent/                          (6840 linhas, 29 arquivos)
├── always-alive.js             (1605) — Orquestrador principal
├── events.js                   (171)  — Constantes de eventos
├── index.js                    (55)   — Barrel raiz
├── types.js                    (122)  — Typedefs centralizados
├── dialog/                     (1344) — Diálogo contínuo com LLM
│   ├── index.js                (17)
│   ├── loop-manager.js         (665)  — DialogLoopManager + wireDialogLoopEvents
│   ├── protocol.js             (115)  — Protocolo READY/REPLY/STOPPED
│   ├── turn-executor.js        (358)  — Execução de turnos
│   └── watchdog.js             (189)  — Monitor de inatividade
├── session/                    (1530) — Gestão de sessão SDK
│   ├── index.js                (18)
│   ├── initializer.js          (378)  — Init/resume de sessão
│   ├── event-wirer.js          (587)  — Wiring de eventos SDK
│   ├── keepalive.js            (155)  — Ping keepalive
│   ├── cleanup.js              (96)   — Limpeza de sessões stale
│   ├── rotation.js             (81)   — Política de rotação
│   └── snapshot.js             (215)  — Save/load/prune de snapshots
├── lifecycle/                  (544)  — Ciclo de vida do processo
│   ├── index.js                (9)
│   ├── entry.js                (163)  — Entry point PM2
│   ├── reconnect-policy.js     (133)  — Backoff exponencial
│   └── state-io.js             (239)  — Persistência com cache/mutex
└── infra/                      (1469) — Infraestrutura de suporte
    ├── index.js                (15)
    ├── message-queue.js        (212)  — Fila com AbortSignal
    ├── permission-controller.js(154)  — Controle de permissão runtime
    ├── webhook-manager.js      (319)  — Webhooks com proteção SSRF
    ├── tool-audit-logger.js    (190)  — Logging de auditoria
    ├── tools-bootstrap.js      (131)  — Registro de tools por categoria
    ├── handoff-manager.js      (157)  — Transferência entre agentes
    ├── status-snapshot.js      (101)  — Builder de snapshot de status
    └── task-executor.js        (190)  — Execução de tarefa com retry
```

---

# ANÁLISE AMPLA: agent/ vs src/copilot/ (Auditoria de Fronteiras)

## Mapa de Responsabilidades de `src/copilot/`

| Módulo                | Linhas | Arquivos | Responsabilidade Principal                        |
| --------------------- | ------ | -------- | ------------------------------------------------- |
| **agent/**            | 6.840  | 29       | Orquestrador principal, ciclo de vida do agente   |
| **terminal/**         | 7.279  | 23       | REPL interativo, handlers de comandos             |
| **tools/**            | 6.094  | 22       | Ferramentas SDK (file, git, shell, todo, etc.)    |
| **observability/**    | 4.453  | 10       | Métricas, telemetria, OpenTelemetry, logging      |
| **hooks/**            | 3.634  | 19       | Hooks SDK (pre/post tool, lifecycle, audit)       |
| **lib/**              | 2.581  | 13       | Utilitários compartilhados, registry, session lib |
| **bridges/**          | 2.330  | 10       | MCP, NERV, Git, GitHub bridges                    |
| **conversation-hub/** | 2.305  | 6        | Hub de conversação multi-sessão, SQLite store     |
| **routes/**           | 1.629  | 7        | Express routers HTTP (agent, sessions, webhooks)  |
| **config/**           | 1.587  | 9        | Configuração (models, prompts, MCP, tools)        |
| **channel/**          | 1.354  | 3        | Canal browser → backend via inject                |
| **api/**              | 1.289  | 9        | HTTP bridge, SSE, event fanout                    |
| **types/**            | 522    | 3        | Tipos SDK, structured messages                    |
| **db/**               | 382    | 2        | SQLite wrapper + migrations                       |
| **core/**             | 192    | 3        | Constantes, erros base                            |

## Análise de Fronteiras: O que está no lugar certo vs. deslocado

### ✅ Correto (sem mudança necessária)

1. **dialog/ ↔ always-alive.js**: DialogLoopManager é corretamente um subsistema do agent. Decisão
   mantida.
2. **session/ ↔ always-alive.js**: Toda lógica de sessão SDK é específica do agent. Correto.
3. **lifecycle/ ↔ agent**: entry.js, reconnect-policy, state-io são ciclo de vida do agent. Correto.
4. **tools/ ↔ agent/infra/tools-bootstrap.js**: tools/ define as ferramentas, tools-bootstrap.js as
   registra. Direção: agent → tools (unidirecional). Correto.
5. **hooks/ ↔ agent**: agent/always-alive.js usa hooks/ para wiring. Direção: agent → hooks
   (unidirecional). Correto.
6. **observability/ ↔ agent**: agent importa métricas/telemetria. Direção correta.
7. **routes/ → agent**: routes importam alwaysAliveAgent para construir endpoints. Padrão de acesso
   correto.

### ⚠️ Atenção (oportunidades de melhoria, baixa prioridade)

1. **tool-audit-logger.js (agent/infra/)**: Constrói `buildAuditingPermissionHandler()` que é
   mencionada em `hooks/audit.js`. Semanticamente, auditoria de ferramentas pertence mais a `hooks/`
   que a `agent/infra/`. Porém, o import físico é agent → hooks (correto), e a menção em
   hooks/audit.js é apenas JSDoc. **Manter como está.**

2. **core/constants.js importa agent/events.js**: `constants.js` re-exporta `AGENT_EVENTS` de
   `agent/events.js`. Isso cria uma dependência `core → agent`, que quebra a hierarquia (core
   deveria ser base). **Candidato a R9**: mover os event constants para `core/constants.js` ou
   `core/events.js` e inverter a dependência.

3. **Barrel index.js (agent/)**: Exporta ~40 símbolos individualmente de cada sub-barrel. Poderia
   usar `export * from './dialog/index.js'` etc. **Candidato a R10**: simplificar barrel.

### ❌ Problemas Identificados

1. **`core/constants.js` → `agent/events.js` (dependência invertida)**:

   ```
   src/copilot/core/constants.js importa '../agent/events.js'
   ```

   `core/` é a camada base do sistema. Não deveria depender de `agent/`. As constantes de eventos
   deveriam fluir de core → agent, não o contrário.

2. **always-alive.js tipo: 1605 linhas remanescentes**: Embora a decomposição forçada não seja
   recomendada (R6), o método `start()` sozinho tem ~225 linhas de wiring. Uma extração leve de
   configuração/wiring poderia reduzir para ~1200-1300 linhas sem perda de encapsulamento.

---

# NOVAS FASES DE REFATORAÇÃO (R9–R12)

## Fase R9: Inverter Dependência core/ ← agent/ (AGENT_EVENTS)

**Objetivo**: Eliminar a dependência `core/constants.js → agent/events.js`.

### R9.1 — Mover constantes de eventos para `core/`

- Copiar `AGENT_EVENTS`, `DIALOG_LOOP_EVENTS`, `HIGH_FREQUENCY_EVENTS`, `PR_CONSUMING_EVENTS` de
  `agent/events.js` para `core/agent-events.js`
- `agent/events.js` passa a re-exportar de `core/agent-events.js`
- `core/constants.js` importa de `./agent-events.js` (local, sem dependência de agent/)

### R9.2 — Atualizar consumidores

- Todos que importam de `agent/events.js` continuam funcionando (re-export preservado)
- `core/constants.js` muda import de `'../agent/events.js'` para `'./agent-events.js'`

**Teste**: lint + typecheck + testes copilot **Commit**:
`refactor(core): R9 — mover event constants para core/, inverter dependência`

---

## Fase R10: Simplificar Barrel `agent/index.js`

**Objetivo**: Substituir ~40 exports nominais por re-exports via sub-barrels.

### R10.1 — Reescrever `agent/index.js`

```js
export { AlwaysAliveAgent, alwaysAliveAgent, getAgent } from './always-alive.js';
export {
  AGENT_EVENTS,
  DIALOG_LOOP_EVENTS,
  HIGH_FREQUENCY_EVENTS,
  PR_CONSUMING_EVENTS,
} from './events.js';
export * from './types.js';
export * from './dialog/index.js';
export * from './session/index.js';
export * from './lifecycle/index.js';
export * from './infra/index.js';
```

### R10.2 — Completar sub-barrels

- Verificar que `lifecycle/index.js` e `infra/index.js` exportam TODOS os símbolos públicos
- Adicionar exports faltantes se necessário

**Teste**: lint + typecheck + testes copilot **Commit**:
`refactor(agent): R10 — simplificar barrel com sub-barrel re-exports`

---

## Fase R11: Extração Leve de `start()` e `stop()`

**Objetivo**: Reduzir always-alive.js de ~1605 para ~1200-1300 linhas.

**Abordagem**: Não decompor a classe — extrair funções helpers puras chamadas por
`start()`/`stop()`.

### R11.1 — Extrair `lifecycle/boot-wiring.js`

Função `wireBootSystems(agent, session, ...)` que concentra o wiring de:

- session event subscribers
- agent event observer
- MCP auto-reconnect
- keepalive
- metrics timer
- handoff wiring

### R11.2 — Extrair `lifecycle/shutdown-sequence.js`

Função `executeShutdown(agent, ...)` que concentra a sequência de:

- Dialog loop cleanup
- Snapshot auto-save
- State persistence
- Timer/keepalive cleanup
- Queue drain
- Session disconnect

### R11.3 — Always-alive.js delega para as novas funções

`start()` e `stop()` passam a ser linhas de orquestração + chamadas às funções extraídas.

**Teste**: lint + typecheck + testes completos **Commit**:
`refactor(agent): R11 — extrair boot-wiring e shutdown-sequence`

---

## Fase R12: Verificação Final e Push

### R12.1 — Testes completos

```bash
npm run lint && npm run format:check && npm run test:unit
```

### R12.2 — Atualizar documentação

- Atualizar PARTE-10A/10B/10C com estado final

### R12.3 — Push

```bash
git push origin main
```

---

## Resumo de Fases (Atualizado)

| Fase | Descrição                    | Risco | Status           |
| ---- | ---------------------------- | ----- | ---------------- |
| R1   | Tipos centralizados          | BAIXO | ✅               |
| R2   | Subdiretório dialog/         | MÉDIO | ✅               |
| R3   | Subdiretório session/        | MÉDIO | ✅               |
| R4   | Subdiretório lifecycle/      | BAIXO | ✅               |
| R5   | Subdiretório infra/          | BAIXO | ✅               |
| R6   | Análise God Object           | —     | ✅ (sem mudança) |
| R7   | Limpeza JSDoc/@module/@see   | BAIXO | ✅               |
| R8   | Push final R1-R7             | BAIXO | ✅               |
| R9   | Inverter dep core ← agent    | BAIXO | ✅               |
| R10  | Simplificar barrel index.js  | BAIXO | ✅               |
| R11  | Extrair boot-wiring/shutdown | MÉDIO | ✅ (sem mudança) |
| R12  | Verificação final + push     | BAIXO | ✅               |

**Ordem de dependência**: R9 e R10 são independentes. R11 depende de R10 (barrel limpo). R12 é
sempre última.

---

# EXECUÇÃO REALIZADA (2026-07-20)

## Estado Final das Fases R1–R8

As fases originais foram ajustadas durante a execução para melhor aderência ao código real:

| Fase | Descrição Original                            | Descrição Executada                                     | Status           | Commit                  |
| ---- | --------------------------------------------- | ------------------------------------------------------- | ---------------- | ----------------------- |
| R1   | Tipos centralizados                           | Criar types.js, remover agent-contract.js               | ✅               | `7756e2ec`              |
| R2   | Subdiretório dialog/                          | 5 arquivos + absorver wirer em loop-manager             | ✅               | `03f7a23f`              |
| R3   | Subdiretório session/                         | 6 arquivos + sub-barrel                                 | ✅               | `47f2465e` + `4a2c1684` |
| R4   | ~~queue/~~ lifecycle/                         | entry.js, reconnect-policy, state-io                    | ✅               | `4f069b26` + `f47609ac` |
| R5   | ~~resilience+security+tools+features~~ infra/ | 8 arquivos consolidados                                 | ✅               | `ea0d7718` + `5d3db79a` |
| R6   | ~~Barrel raiz~~ Análise God Object            | Avaliação: always-alive.js já delega corretamente       | ✅ (sem mudança) | —                       |
| R7   | ~~Slim down~~ Limpeza JSDoc                   | Corrigir @module/@see em 22 arquivos, remover fantasmas | ✅               | `1f56fe44`              |
| R8   | Verificação + push                            | 51 testes OK, push origin/main                          | ✅               | pushed                  |

### Decisões Arquiteturais Tomadas

1. **R4-R5 foram consolidados diferentemente do planejado**: Em vez de queue/, resilience/,
   security/, tools/ e features/ (5 subdirs), criamos lifecycle/ (3 arquivos de ciclo de vida) e
   infra/ (8 arquivos de infraestrutura). Menos fragmentação, mais coesão.

2. **R6 — always-alive.js NÃO foi decomposto**: Após análise aprofundada, o God Object de 1605
   linhas já delega corretamente para os módulos extraídos. O que resta são wirings (connection de
   subsistemas), que é o papel legítimo de um orquestrador. Decomposição forçada criaria acoplamento
   artificial via callbacks/injeção de ~20 campos privados sem ganho real.

3. **Arquivos fantasma removidos**: dialog-loop-manager.js, session-event-wirer.js,
   status-snapshot.js existiam como cópias desatualizadas na raiz e foram excluídos.

---

## Estrutura Final de `src/copilot/agent/`

```
agent/                          (6840 linhas, 29 arquivos)
├── always-alive.js             (1605) — Orquestrador principal
├── events.js                   (171)  — Constantes de eventos
├── index.js                    (55)   — Barrel raiz
├── types.js                    (122)  — Typedefs centralizados
├── dialog/                     (1344) — Diálogo contínuo com LLM
│   ├── index.js                (17)
│   ├── loop-manager.js         (665)  — DialogLoopManager + wireDialogLoopEvents
│   ├── protocol.js             (115)  — Protocolo READY/REPLY/STOPPED
│   ├── turn-executor.js        (358)  — Execução de turnos
│   └── watchdog.js             (189)  — Monitor de inatividade
├── session/                    (1530) — Gestão de sessão SDK
│   ├── index.js                (18)
│   ├── initializer.js          (378)  — Init/resume de sessão
│   ├── event-wirer.js          (587)  — Wiring de eventos SDK
│   ├── keepalive.js            (155)  — Ping keepalive
│   ├── cleanup.js              (96)   — Limpeza de sessões stale
│   ├── rotation.js             (81)   — Política de rotação
│   └── snapshot.js             (215)  — Save/load/prune de snapshots
├── lifecycle/                  (544)  — Ciclo de vida do processo
│   ├── index.js                (9)
│   ├── entry.js                (163)  — Entry point PM2
│   ├── reconnect-policy.js     (133)  — Backoff exponencial
│   └── state-io.js             (239)  — Persistência com cache/mutex
└── infra/                      (1469) — Infraestrutura de suporte
    ├── index.js                (15)
    ├── message-queue.js        (212)  — Fila com AbortSignal
    ├── permission-controller.js(154)  — Controle de permissão runtime
    ├── webhook-manager.js      (319)  — Webhooks com proteção SSRF
    ├── tool-audit-logger.js    (190)  — Logging de auditoria
    ├── tools-bootstrap.js      (131)  — Registro de tools por categoria
    ├── handoff-manager.js      (157)  — Transferência entre agentes
    ├── status-snapshot.js      (101)  — Builder de snapshot de status
    └── task-executor.js        (190)  — Execução de tarefa com retry
```

---

# ANÁLISE AMPLA: agent/ vs src/copilot/ (Auditoria de Fronteiras)

## Mapa de Responsabilidades de `src/copilot/`

| Módulo                | Linhas | Arquivos | Responsabilidade Principal                        |
| --------------------- | ------ | -------- | ------------------------------------------------- |
| **agent/**            | 6.840  | 29       | Orquestrador principal, ciclo de vida do agente   |
| **terminal/**         | 7.279  | 23       | REPL interativo, handlers de comandos             |
| **tools/**            | 6.094  | 22       | Ferramentas SDK (file, git, shell, todo, etc.)    |
| **observability/**    | 4.453  | 10       | Métricas, telemetria, OpenTelemetry, logging      |
| **hooks/**            | 3.634  | 19       | Hooks SDK (pre/post tool, lifecycle, audit)       |
| **lib/**              | 2.581  | 13       | Utilitários compartilhados, registry, session lib |
| **bridges/**          | 2.330  | 10       | MCP, NERV, Git, GitHub bridges                    |
| **conversation-hub/** | 2.305  | 6        | Hub de conversação multi-sessão, SQLite store     |
| **routes/**           | 1.629  | 7        | Express routers HTTP (agent, sessions, webhooks)  |
| **config/**           | 1.587  | 9        | Configuração (models, prompts, MCP, tools)        |
| **channel/**          | 1.354  | 3        | Canal browser → backend via inject                |
| **api/**              | 1.289  | 9        | HTTP bridge, SSE, event fanout                    |
| **types/**            | 522    | 3        | Tipos SDK, structured messages                    |
| **db/**               | 382    | 2        | SQLite wrapper + migrations                       |
| **core/**             | 192    | 3        | Constantes, erros base                            |

## Análise de Fronteiras: O que está no lugar certo vs. deslocado

### ✅ Correto (sem mudança necessária)

1. **dialog/ ↔ always-alive.js**: DialogLoopManager é corretamente um subsistema do agent. Decisão
   mantida.
2. **session/ ↔ always-alive.js**: Toda lógica de sessão SDK é específica do agent. Correto.
3. **lifecycle/ ↔ agent**: entry.js, reconnect-policy, state-io são ciclo de vida do agent. Correto.
4. **tools/ ↔ agent/infra/tools-bootstrap.js**: tools/ define as ferramentas, tools-bootstrap.js as
   registra. Direção: agent → tools (unidirecional). Correto.
5. **hooks/ ↔ agent**: agent/always-alive.js usa hooks/ para wiring. Direção: agent → hooks
   (unidirecional). Correto.
6. **observability/ ↔ agent**: agent importa métricas/telemetria. Direção correta.
7. **routes/ → agent**: routes importam alwaysAliveAgent para construir endpoints. Padrão de acesso
   correto.

### ⚠️ Atenção (oportunidades de melhoria, baixa prioridade)

1. **tool-audit-logger.js (agent/infra/)**: Constrói `buildAuditingPermissionHandler()` que é
   mencionada em `hooks/audit.js`. Semanticamente, auditoria de ferramentas pertence mais a `hooks/`
   que a `agent/infra/`. Porém, o import físico é agent → hooks (correto), e a menção em
   hooks/audit.js é apenas JSDoc. **Manter como está.**

2. **core/constants.js importa agent/events.js**: `constants.js` re-exporta `AGENT_EVENTS` de
   `agent/events.js`. Isso cria uma dependência `core → agent`, que quebra a hierarquia (core
   deveria ser base). **Candidato a R9**: mover os event constants para `core/constants.js` ou
   `core/events.js` e inverter a dependência.

3. **Barrel index.js (agent/)**: Exporta ~40 símbolos individualmente de cada sub-barrel. Poderia
   usar `export * from './dialog/index.js'` etc. **Candidato a R10**: simplificar barrel.

### ❌ Problemas Identificados

1. **`core/constants.js` → `agent/events.js` (dependência invertida)**:

   ```
   src/copilot/core/constants.js importa '../agent/events.js'
   ```

   `core/` é a camada base do sistema. Não deveria depender de `agent/`. As constantes de eventos
   deveriam fluir de core → agent, não o contrário.

2. **always-alive.js tipo: 1605 linhas remanescentes**: Embora a decomposição forçada não seja
   recomendada (R6), o método `start()` sozinho tem ~225 linhas de wiring. Uma extração leve de
   configuração/wiring poderia reduzir para ~1200-1300 linhas sem perda de encapsulamento.

---

# NOVAS FASES DE REFATORAÇÃO (R9–R12)

## Fase R9: Inverter Dependência core/ ← agent/ (AGENT_EVENTS)

**Objetivo**: Eliminar a dependência `core/constants.js → agent/events.js`.

### R9.1 — Mover constantes de eventos para `core/`

- Copiar `AGENT_EVENTS`, `DIALOG_LOOP_EVENTS`, `HIGH_FREQUENCY_EVENTS`, `PR_CONSUMING_EVENTS` de
  `agent/events.js` para `core/agent-events.js`
- `agent/events.js` passa a re-exportar de `core/agent-events.js`
- `core/constants.js` importa de `./agent-events.js` (local, sem dependência de agent/)

### R9.2 — Atualizar consumidores

- Todos que importam de `agent/events.js` continuam funcionando (re-export preservado)
- `core/constants.js` muda import de `'../agent/events.js'` para `'./agent-events.js'`

**Teste**: lint + typecheck + testes copilot **Commit**:
`refactor(core): R9 — mover event constants para core/, inverter dependência`

---

## Fase R10: Simplificar Barrel `agent/index.js`

**Objetivo**: Substituir ~40 exports nominais por re-exports via sub-barrels.

### R10.1 — Reescrever `agent/index.js`

```js
export { AlwaysAliveAgent, alwaysAliveAgent, getAgent } from './always-alive.js';
export {
  AGENT_EVENTS,
  DIALOG_LOOP_EVENTS,
  HIGH_FREQUENCY_EVENTS,
  PR_CONSUMING_EVENTS,
} from './events.js';
export * from './types.js';
export * from './dialog/index.js';
export * from './session/index.js';
export * from './lifecycle/index.js';
export * from './infra/index.js';
```

### R10.2 — Completar sub-barrels

- Verificar que `lifecycle/index.js` e `infra/index.js` exportam TODOS os símbolos públicos
- Adicionar exports faltantes se necessário

**Teste**: lint + typecheck + testes copilot **Commit**:
`refactor(agent): R10 — simplificar barrel com sub-barrel re-exports`

---

## Fase R11: Extração Leve de `start()` e `stop()`

**Objetivo**: Reduzir always-alive.js de ~1605 para ~1200-1300 linhas.

**Abordagem**: Não decompor a classe — extrair funções helpers puras chamadas por
`start()`/`stop()`.

### R11.1 — Extrair `lifecycle/boot-wiring.js`

Função `wireBootSystems(agent, session, ...)` que concentra o wiring de:

- session event subscribers
- agent event observer
- MCP auto-reconnect
- keepalive
- metrics timer
- handoff wiring

### R11.2 — Extrair `lifecycle/shutdown-sequence.js`

Função `executeShutdown(agent, ...)` que concentra a sequência de:

- Dialog loop cleanup
- Snapshot auto-save
- State persistence
- Timer/keepalive cleanup
- Queue drain
- Session disconnect

### R11.3 — Always-alive.js delega para as novas funções

`start()` e `stop()` passam a ser linhas de orquestração + chamadas às funções extraídas.

**Teste**: lint + typecheck + testes completos **Commit**:
`refactor(agent): R11 — extrair boot-wiring e shutdown-sequence`

---

## Fase R12: Verificação Final e Push

### R12.1 — Testes completos

```bash
npm run lint && npm run format:check && npm run test:unit
```

### R12.2 — Atualizar documentação

- Atualizar PARTE-10A/10B/10C com estado final

### R12.3 — Push

```bash
git push origin main
```

### Resultado R9–R12 (2026-07-20)

| Fase | Commit        | Nota                                                                                                                                                                      |
| ---- | ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R9   | `e6d44eb4`    | core/agent-events.js criado; agent/events.js → re-export; core/constants.js importa local                                                                                 |
| R10  | `92c0ac35`    | agent/index.js reescrito com `export * from` sub-barrels                                                                                                                  |
| R11  | —             | Análise concluiu que start()/stop() acessam ~16 campos privados cada. Extração criaria API surface frágil sem ganho real. Decisão: manter como está (mesma lógica de R6). |
| R12  | (este commit) | Testes ✓, lint ✓, typecheck ✓, push ✓                                                                                                                                     |

---

## Fase R13: Import Hygiene — Redirecionar Deep Imports para Barrel (2026-07-21)

### Problemas Identificados

1. **17 imports diretos** de `../agent/always-alive.js` em terminal/, routes/, api/, bridges/ —
   todos bypassando o barrel `agent/index.js`
2. **3 deep imports** em terminal/ para subdiretórios internos de agent/:
   - `terminal/commands/session.js` → `../../agent/session/snapshot.js`
   - `terminal/handlers-system.js` → `../agent/session/initializer.js`
   - `terminal/index.js` → `../agent/infra/tools-bootstrap.js`
3. **Re-exports mortos** em `session/initializer.js` (linha 33):
   `export { clearState, readState, writeState, writeStateAsync }` — nenhum consumidor externo usava
   estes re-exports

### R13.1 — Remover re-exports mortos de session/initializer.js

Removeu-se o bloco de re-export de state-io.js em initializer.js (3 linhas).

### R13.2 — Redirecionar terminal/index.js para barrel

`configureHookTools, setHub, setPermissionAgent` agora importados de `../agent/index.js` junto com
`alwaysAliveAgent`, eliminando 2 imports separados.

### R13.3 — Redirecionar terminal/commands/session.js para barrel

`createSnapshot, listSnapshots, loadSnapshot, saveSnapshot` + `alwaysAliveAgent` agora importados de
`../../agent/index.js`.

### R13.4 — Redirecionar terminal/handlers-system.js para barrel

`alwaysAliveAgent` + `setBackgroundCompactionThreshold` consolidados em import único do barrel.

### R13.5–R13.6 — Redirecionar todos os demais always-alive.js diretos

14 arquivos em terminal/, routes/, api/, bridges/ redirecionados para `../agent/index.js`.

### Resultado R13

| Métrica            | Antes | Depois |
| ------------------ | ----- | ------ |
| Deep imports       | 3     | 0      |
| Imports diretos    | 17    | 0      |
| Re-exports mortos  | 1     | 0      |
| Arquivos alterados | —     | 19     |

**Commit**: `105d2555` — refactor(agent): R13 — redirecionar imports para barrel e remover
re-exports legado

---

## Fase R14: Corrigir Headers e Annotations Stale (2026-07-21)

### Problemas Identificados

- `@module copilot/always-alive` → deveria ser `copilot/agent/always-alive`
- **10 headers de arquivo** com path antigo pré-R2/R5 (ex: `dialog-loop-manager.js` em vez de
  `dialog/loop-manager.js`)

### R14.1 — Fix @module em always-alive.js

`@module copilot/always-alive` → `@module copilot/agent/always-alive`

### R14.2 — Fix headers em 10 arquivos

dialog/loop-manager.js, dialog/protocol.js, dialog/turn-executor.js, session/event-wirer.js,
session/rotation.js, infra/handoff-manager.js, infra/message-queue.js,
infra/permission-controller.js, infra/status-snapshot.js, infra/tool-audit-logger.js

**Commit**: `84224a0e` — docs(agent): R14 — corrigir headers de arquivo e @module stale
pós-reestruturação

---

## Fase R15: Centralizar process.env em config.js (2026-07-21)

### Problemas Identificados

~35 usos diretos de `process.env[...]` espalhados por 14 arquivos em agent/, cada um com parsing
inline e defaults duplicados. Sem ponto central para documentar, validar ou testar configuração.

### R15.1 — Criar src/copilot/agent/config.js

Módulo centralizado com ~30 constantes exportadas, organizadas por subsistema:

- Dialog Loop: `DIALOG_QUEUE_MAX`, `BOOT_TIMEOUT_MS`, `WATCHDOG_INTERVAL_MS`, `WATCHDOG_STALL_MS`
- Session: `HOOK_CONTEXT_MAX_BYTES`, `SESSION_MAX_AGE_MS`, `WORKING_DIRECTORY`
- Rotation: `ROTATION_MAX_UTIL`, `ROTATION_MAX_AGE_MS`, `ROTATION_MAX_COMPACTIONS`,
  `ROTATION_MAX_TURNS`
- Keepalive: `KEEPALIVE_INTERVAL_MS`, `KEEPALIVE_IDLE_THRESHOLD_MS`
- Snapshots/State: `SNAPSHOT_DIR`, `MAX_SNAPSHOTS`, `STATE_FILE`
- Lifecycle: `RESTART_DELAY_MS`, `COPILOT_MODEL`, `COPILOT_REASONING_EFFORT`
- Agent core: `MESSAGES_CACHE_TTL_MS`, `MAX_LISTENERS`, `MCP_RECONNECT_MS`, `METRICS_INTERVAL_MS`,
  `STATUS_SNAPSHOT_TTL_MS`
- Task/Webhooks: `MAX_TASK_RETRIES`, `TASK_TIMEOUT_MS`, `WEBHOOK_TIMEOUT_MS`, etc.
- Audit/Permission: `TOOL_AUDIT_LOG`, `TOOL_AUDIT_MAX_LOG_BYTES`, `PERMISSION_MODE`,
  `STARVATION_THRESHOLD_MS`

### R15.2–R15.14 — Atualizar 14 módulos

Todos os arquivos de agent/ agora importam de `./config.js` (ou `../config.js`).

**Exceções (mantidas inline por razão justificada):**

- `NODE_ENV` — idioma universal do Node.js
- `WEBHOOK_ALLOW_PRIVATE_HOSTS` — check de segurança SSRF inline
- `COPILOT_HIGH_RISK_TOOLS` — extensão da lista de ferramentas de alto risco
- `AGENT_DENY_SHELL_TOOLS` — deny list de segurança

### Resultado R15

| Métrica                          | Antes | Depois |
| -------------------------------- | ----- | ------ |
| process.env no agent/ (excl.4)   | ~35   | 0      |
| Módulo de configuração           | 0     | 1      |
| Arquivos com defaults duplicados | 14    | 0      |
| Constantes centralizadas         | 0     | ~30    |

**Commit**: `d7ce3520` — refactor(agent): R15 — centralizar process.env em config.js

---

## Resumo Geral R1–R15

| Fase | Tipo        | Escopo                          | Resultado                             |
| ---- | ----------- | ------------------------------- | ------------------------------------- |
| R1   | Refatoração | types.js centralização          | Eliminação de circular deps           |
| R2   | Refatoração | dialog/ subdiretório            | 5 arquivos extraídos                  |
| R3   | Refatoração | session/ subdiretório           | 7 arquivos extraídos                  |
| R4   | Refatoração | lifecycle/ subdiretório         | 4 arquivos extraídos                  |
| R5   | Refatoração | infra/ subdiretório             | 8 arquivos extraídos                  |
| R6   | Análise     | Decomposição always-alive.js    | Skip (orchestrator pattern correto)   |
| R7   | Docs        | JSDoc + orphan cleanup          | @module/@see + 3 orphans removidos    |
| R8   | Operação    | Push                            | origin/main atualizado                |
| R9   | Refatoração | Inversão dependência core→agent | core/agent-events.js canônico         |
| R10  | Refatoração | Barrel simplificação            | export \* from sub-barrels            |
| R11  | Análise     | start()/stop() extraction       | Skip (same as R6)                     |
| R12  | Docs        | Documentação + push             | PARTE-10C atualizada                  |
| R13  | Refatoração | Import hygiene                  | 19 imports → barrel, 1 dead re-export |
| R14  | Docs        | Headers/annotations stale       | 11 headers corrigidos                 |
| R15  | Refatoração | Config centralização            | config.js com ~30 constantes          |

---

## Fase R17: Magic Numbers → Named Constants (2026-07-21)

### Problemas Identificados

~14 magic numbers espalhados por 6 arquivos: thresholds de utilização de contexto (`0.8`, `0.95`),
timeout de 24h para dialog loop, delays de boot recovery, shutdown timeouts.

### R17.1 — Adicionar constantes ao config.js

Novas constantes:

- `CONTEXT_UTIL_BLOCK_THRESHOLD` (0.95) — bloqueio de dialog loop
- `CONTEXT_UTIL_WARN_THRESHOLD` (0.8) — warning de utilização
- `LONG_TASK_TIMEOUT_MS` (24h) — timeout de tarefas de longa duração
- `BOOT_RECOVERY_DELAY_MS` (5s) — delay de boot recovery
- `SHUTDOWN_TIMEOUT_MS` (10s) — timeout padrão de shutdown
- `STOP_BOOT_WAIT_MS` (15s) — espera de boot durante stop()
- `DRAIN_WRITES_TIMEOUT_MS` (3s) — timeout de drain de writes
- `PING_TIMEOUT_MS` (5s) — timeout de ping CLI
- `RESUME_QUESTION_WAIT_MS` (5s) — espera de question.pending no resume

### R17.2 — Substituir em 6 arquivos

always-alive.js, loop-manager.js, event-wirer.js, entry.js, state-io.js

### Resultado R17

| Métrica             | Antes | Depois                              |
| ------------------- | ----- | ----------------------------------- |
| Magic numbers       | ~14   | 1 (0.8 no watchdog — multiplicador) |
| Constantes nomeadas | ~30   | ~39                                 |

**Commit**: `cf429dd9` — refactor(agent): R17 — substituir magic numbers por constantes nomeadas

---

## Fase R18: DRY writeStateAsync fire-and-forget (2026-07-21)

### Problemas Identificados

11 ocorrências do padrão boilerplate:

```js
writeStateAsync({ key: value }).catch((e) => log('WARN', `[Tag] writeState key: ${e.message}`));
```

Código repetitivo, propenso a inconsistências na mensagem de log.

### R18.1 — Criar persistState(data, tag) em state-io.js

```js
export function persistState(data, tag) {
  writeStateAsync(data).catch((e) => log('WARN', `${tag}: ${e.message}`));
}
```

### R18.2 — Substituir 11 fire-and-forget calls

- `always-alive.js`: 4 substituições
- `dialog/loop-manager.js`: 5 substituições
- `dialog/turn-executor.js`: 1 substituição
- `session/event-wirer.js`: 1 substituição

**Mantidos intactos**: 4 `await writeStateAsync().catch()` (padrão diferente — aguardam resultado).

### Resultado R18

| Métrica                           | Antes | Depois           |
| --------------------------------- | ----- | ---------------- |
| Boilerplate writeStateAsync.catch | 11    | 0                |
| Helper centralizado               | 0     | 1 (persistState) |
| Linhas de código removidas (net)  | -     | -3               |

**Commit**: `d4d931e6` — refactor(agent): R18 — DRY writeStateAsync fire-and-forget via
persistState()

---

## Resumo Geral R1–R18

| Fase | Tipo        | Escopo                          | Resultado                             |
| ---- | ----------- | ------------------------------- | ------------------------------------- |
| R1   | Refatoração | types.js centralização          | Eliminação de circular deps           |
| R2   | Refatoração | dialog/ subdiretório            | 5 arquivos extraídos                  |
| R3   | Refatoração | session/ subdiretório           | 7 arquivos extraídos                  |
| R4   | Refatoração | lifecycle/ subdiretório         | 4 arquivos extraídos                  |
| R5   | Refatoração | infra/ subdiretório             | 8 arquivos extraídos                  |
| R6   | Análise     | Decomposição always-alive.js    | Skip (orchestrator pattern correto)   |
| R7   | Docs        | JSDoc + orphan cleanup          | @module/@see + 3 orphans removidos    |
| R8   | Operação    | Push                            | origin/main atualizado                |
| R9   | Refatoração | Inversão dependência core→agent | core/agent-events.js canônico         |
| R10  | Refatoração | Barrel simplificação            | export \* from sub-barrels            |
| R11  | Análise     | start()/stop() extraction       | Skip (same as R6)                     |
| R12  | Docs        | Documentação + push             | PARTE-10C atualizada                  |
| R13  | Refatoração | Import hygiene                  | 19 imports → barrel, 1 dead re-export |
| R14  | Docs        | Headers/annotations stale       | 11 headers corrigidos                 |
| R15  | Refatoração | Config centralização            | config.js com ~30 constantes          |
| R16  | Docs        | Documentação R13–R15            | PARTE-10A/B/C atualizados             |
| R17  | Refatoração | Magic numbers → constants       | 9 constantes nomeadas adicionadas     |
| R18  | Refatoração | DRY writeStateAsync             | persistState() helper, 11 call sites  |
