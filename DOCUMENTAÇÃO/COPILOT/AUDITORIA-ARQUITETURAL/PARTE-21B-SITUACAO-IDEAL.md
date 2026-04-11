# PARTE-21B — Situação Ideal: Arquitetura Target v2 para Vastos Upgrades

**Data**: 2026-04-12 | **Status**: Canônico | **Versão**: 2.0
**Scope**: Arquitetura ideal de `src/copilot` — preparação para upgrades de larga escala
**Referência**: PARTE-21A (situação atual), PARTE-20B (ideal v1)

---

## 1. Resumo Executivo

Este documento define a **arquitetura target v2** do `src/copilot`, projetada não apenas para
resolver os 9 problemas identificados na PARTE-21A, mas para **preparar o terreno para upgrades
de larga escala** que incluem:

- Suporte a múltiplos agentes simultâneos
- Plugin architecture para tools e bridges
- Migração incremental para TypeScript
- Observable-first event handling
- Persistent state com event sourcing
- API federation e GraphQL gateway
- Horizontal scaling do worker pool

A arquitetura ideal v2 é descrita em **4 dimensões**: (1) Topologia de módulos, (2) Padrões de
comunicação, (3) Gestão de estado, e (4) Infraestrutura de qualidade.

---

## 2. Dimensão 1 — Topologia de Módulos

### 2.1 Hierarquia Ideal (refinada)

```
L7  applications/        — Entry points: main, cli, worker
L6  terminal/            — REPL LLM-B (mantido, mas slim)
L5  api/                 — HTTP/WS/SSE (routing only)
L4  services/            — [NOVO] Facades de caso de uso (orquestração)
L4  agent/               — AlwaysAlive + session + dialog
L4  conversation-hub/    — Hub multi-sessão
L4  channel/             — Transporte LLM
L3  hooks/               — Permissões/lifecycle
L3  tools/               — Tool definitions (declarativo)
L3  plugins/             — [NOVO] Plugin registry + loader
L3  bridges/             — Adaptadores externos
L2  config/              — Configuração (read-only)
L2  observability/       — Logging/métricas/traces
L1  sdk/                 — Wrapper SDK (pure wrapper)
L1  audit/               — Auditoria
L0  core/                — Utilitários puros (ZERO deps externas)
L0  db/                  — Persistência
L0  types/               — [NOVO] Shared type definitions
```

#### Mudanças em relação ao estado atual:

| Mudança                        | Motivação                                                |
| ------------------------------ | -------------------------------------------------------- |
| `L7 applications/` (novo)      | Separar entry points de lógica; múltiplos consumers      |
| `L4 services/` (novo)          | Decompor api/ mega-aggregator em facades por caso de uso |
| `L3 plugins/` (novo)           | Extensibilidade de tools e bridges sem tocar no core     |
| `L0 types/` (novo)             | Shared typedefs sem dependência de módulo runtime        |
| `core/` com **ZERO** fan-out   | Eliminar re-export para config/env                       |
| `sdk/` com **ZERO** re-exports | Eliminar re-exports de hooks e config                    |

### 2.2 Princípios de Topologia

1. **Leaf Purity**: L0 modules (`core`, `db`, `types`) NUNCA importam de camadas superiores
2. **Barrel-first**: Cross-module imports obrigatoriamente via barrel (exceção: `logger` com allow-list)
3. **Unidirectional flow**: Camada N só importa de N-1 ou inferior, NUNCA de N+1
4. **Single barrel entry**: Cada módulo expõe exatamente 1 barrel (`index.js`)
5. **No re-exports cross-module**: Barrels só exportam conteúdo do próprio módulo
6. **Fan-out limit**: Nenhum módulo deve ter fan-out > 8 (sem camada services/, atualmente api/ tem 11)

### 2.3 Estado Ideal por Módulo

| Módulo              | Fan-in | Fan-out | Estabilidade | Barrels    | Deep imports | Singletons |
| ------------------- | ------ | ------- | ------------ | ---------- | ------------ | ---------- |
| `core/`             | 13     | **0**   | **1.00**     | Only       | 0            | 0          |
| `types/`            | 14     | 0       | 1.00         | Only       | 0            | 0          |
| `db/`               | 3      | 1       | 0.75         | Only       | 0            | DI         |
| `audit/`            | 6      | 2       | 0.75         | Only       | 0            | DI         |
| `sdk/`              | 10     | **2**   | **0.83**     | Only       | 0            | DI         |
| `config/`           | 11     | 2       | 0.85         | Only       | 0            | 0          |
| `observability/`    | 10     | 3       | 0.77         | Allow-list | ≤5           | DI         |
| `hooks/`            | 4      | 4       | 0.50         | Only       | 0            | 0          |
| `tools/`            | 3      | 5       | 0.38         | Only       | 0            | 0          |
| `plugins/`          | 2      | 3       | 0.40         | Only       | 0            | DI         |
| `bridges/`          | 2      | 4       | 0.33         | Only       | 0            | 0          |
| `channel/`          | 2      | 3       | 0.40         | Only       | 0            | DI         |
| `conversation-hub/` | 2      | 4       | 0.33         | Only       | 0            | DI         |
| `agent/`            | 2      | 6       | 0.25         | Only       | 0            | DI         |
| `services/`         | 2      | 7       | 0.22         | Only       | 0            | 0          |
| `api/`              | 1      | **4**   | 0.20         | Only       | 0            | 0          |
| `terminal/`         | 0      | 6       | 0.00         | Only       | 0            | DI         |

---

## 3. Dimensão 2 — Padrões de Comunicação

### 3.1 De: EventEmitter Ad-hoc → Para: Observable Event Bus

**Estado atual**: 70 arquivos com EventEmitter local, sem bus centralizado.

**Estado ideal**: Sistema baseado em **Observable Event Bus** com 3 camadas:

```
┌───────────────────────────────────────────────────┐
│  Application Event Bus (cross-module)              │
│  ┌─────────────────────────────────────────────┐  │
│  │  Domain Event Bus (intra-module)             │  │
│  │  ┌───────────────────────────────────────┐  │  │
│  │  │  Component Events (local emitter)      │  │  │
│  │  └───────────────────────────────────────┘  │  │
│  └─────────────────────────────────────────────┘  │
└───────────────────────────────────────────────────┘
```

#### Camada 1: Component Events (manter)
- EventEmitter local dentro de classes (ex: `AlwaysAliveAgent extends EventEmitter`)
- Sem mudança — é correto para eventos internos da classe

#### Camada 2: Domain Event Bus (novo)
- Um EventBus por módulo (`hooks/bus.js` já existe como exemplo)
- Para comunicação intra-módulo sem acoplamento de referência direta
- Pattern: `domainBus.emit('tool:registered', { name, schema })`

#### Camada 3: Application Event Bus (novo)
- Bus centralizado em `core/event-bus.js` para eventos cross-module
- Typed events com schemas definidos em `types/events.d.ts`
- Wildcards e namespaces: `agent:*`, `session:start`, `tool:invoke`
- Integração com NERV bus externo via bridge (bridges/nerv-bridge já existe)

#### Benefícios:
1. Desacopla módulos — comunicação via eventos em vez de imports diretos
2. Observabilidade integrada — cada evento é automaticamente logged/traced
3. Testabilidade — mocking do bus em vez de módulos inteiros
4. Extensibilidade — plugins podem subscribe a eventos sem importar módulos

### 3.2 De: Setter DI → Para: DI Container Lightweight

**Estado atual**: 22 setters + 3 bootstraps com naming inconsistente.

**Estado ideal**: DI Container minimalista baseado em tokens.

```js
// core/di.js — Container DI lightweight (~100 LoC)
import { createToken, createContainer } from '#copilot/core/di';

// Definir tokens em types/di-tokens.js
export const LOGGER = createToken('LOGGER');
export const DB = createToken('DB');
export const SDK_CLIENT = createToken('SDK_CLIENT');
export const AUDIT_BUS = createToken('AUDIT_BUS');

// Registrar no bootstrap
const container = createContainer();
container.register(LOGGER, () => createLogger());
container.register(DB, () => createDb(), { singleton: true });

// Consumir
const logger = container.resolve(LOGGER);
```

**Princípios**:
1. **Sem decorators** — JavaScript puro, sem compilação
2. **Singleton por configuração** — `{ singleton: true }` em vez de `let X = null`
3. **Lifecycle management** — `container.dispose()` para cleanup ordenado
4. **Testável** — `container.fork()` para child containers em testes
5. **Typed** — JSDoc com generics para type-safety de tokens
6. **Não obrigatório** — Módulos leaf (core, types) não usam DI

#### Migração incremental:
1. Criar `core/di.js` com container mínimo
2. Definir tokens para os 22 setters existentes
3. Migrar um setter por PR para `container.register()`
4. Remover setter quando último consumidor migrado

### 3.3 De: Deep Imports → Para: Barrel-First com Allow-List

**Estado atual**: 233 deep imports (72%).

**Estado ideal**: ≤20% deep imports, com allow-list explícita para exceções.

**Estratégia de migração via ESLint rule**:

```js
// .eslintrc — regra customizada
'no-restricted-imports': ['error', {
    patterns: [
        { group: ['#copilot/*/!(index)'], message: 'Use barrel import' }
    ]
}],
// Allow-list em eslint config
overrides: [
    {
        files: ['src/copilot/**/*.js'],
        rules: {
            'no-restricted-imports': ['error', {
                patterns: [{
                    group: ['#copilot/*/!(index)'],
                    except: ['#copilot/observability/logger']  // único allow-listed
                }]
            }]
        }
    }
]
```

---

## 4. Dimensão 3 — Gestão de Estado

### 4.1 De: Singletons Globais → Para: Managed State

**Estado atual**: ~30 singletons `let X = null` com lifecycle implícita.

**Estado ideal**: Estado gerenciado por DI container com lifecycle explícita.

#### Categorização dos singletons atuais:

| Categoria         | Exemplos                             | Solução ideal                       |
| ----------------- | ------------------------------------ | ----------------------------------- |
| **DB Connection** | `copilotDb`                          | DI singleton com dispose()          |
| **Clients**       | `_client`, `_agent`                  | DI singleton com health check       |
| **Caches**        | `_modelsCache`, `_aliases`           | Cache com TTL + invalidation        |
| **Flags/State**   | `_busy`, `_planMode`, `shuttingDown` | State machine finita (FSM)          |
| **Buffers**       | `globalAuditBuffer`                  | Ring buffer com flush + persistence |
| **Timers**        | `_reflectionTimer`                   | Timer manager com cleanup           |
| **Mutexes**       | `_sendTurnMutex`                     | Mutex pool com timeout              |

### 4.2 Proposta: Terminal como State Machine

`terminal/state.js` tem 8+ variáveis de estado global. Isso é candidato clássico para FSM:

```js
// terminal/state-machine.js
const STATES = {
    IDLE: 'idle',
    BUSY: 'busy',
    PLAN_MODE: 'plan',
    REFLECTION: 'reflection',
    SHUTDOWN: 'shutdown'
};

const TRANSITIONS = {
    [STATES.IDLE]: ['busy', 'plan', 'shutdown'],
    [STATES.BUSY]: ['idle', 'reflection'],
    [STATES.PLAN_MODE]: ['idle', 'busy'],
    [STATES.REFLECTION]: ['idle', 'busy'],
    [STATES.SHUTDOWN]: [] // terminal
};
```

**Benefícios**:
1. Impossível estados inválidos (`busy + planMode + reflection` simultâneos)
2. Observável — cada transição pode gerar evento
3. Testável — verificar transições em vez de combinações booleanas

### 4.3 Proposta: Event Sourcing para Audit Pipeline

`audit/pipeline.js` usa `globalAuditBuffer` (ring buffer em memória). Proposta:

```
EventSource: auditBus.emit('audit:entry', { ... })
      ↓
Ring Buffer (hot, in-memory, current behavior)
      ↓
Projection A: SQLite (persistent, queryable)
Projection B: SSE stream (real-time, observability)
Projection C: File rotation (archival, compliance)
```

**Benefício**: Audit data fica imutável e replayable. Múltiplos consumers sem acoplamento.

---

## 5. Dimensão 4 — Infraestrutura de Qualidade

### 5.1 CI Gates Target

| Gate                          | Status atual | Prioridade | Implementação               |
| ----------------------------- | ------------ | ---------- | --------------------------- |
| Layer violations (full regex) | ⚠️ Incompleto | P0         | Expandir regex + re-exports |
| File size (código ativo)      | ✅            | —          | Manter                      |
| Barrel contracts              | ✅ 6/6        | P1         | Expandir para 20+ testes    |
| Barrel bypass ratio           | 🔴 Inexiste   | P1         | Script + threshold 80%      |
| Deep import allow-list        | 🔴 Inexiste   | P1         | ESLint rule customizada     |
| Singleton count               | 🔴 Inexiste   | P2         | Script contagem + threshold |
| DI setter consistency         | 🔴 Inexiste   | P2         | Naming convention check     |
| Fan-out threshold             | 🔴 Inexiste   | P2         | Max 8 deps por módulo       |
| EventEmitter census           | 🔴 Inexiste   | P3         | Script contagem + trending  |
| Re-export cross-module        | 🔴 Inexiste   | P0         | Script zero-tolerance       |
| Circular dependency detection | ✅ (madge)    | P1         | CI integration automática   |

### 5.2 Testes de Contrato (expansão)

**Atuais**: 6 testes verificando exports dos barrels.

**Target**: 20+ testes cobrindo:

| Grupo                 | Qtd target | O que testa                               |
| --------------------- | ---------- | ----------------------------------------- |
| Barrel exports        | 6 (atual)  | Exports existem e são funções/classes     |
| Barrel completeness   | 6          | Barrel exporta todas as APIs públicas     |
| No-cross-layer export | 4          | Nenhum barrel exporta de camada superior  |
| DI token existence    | 4          | Todos tokens DI têm registro no container |
| Event schema validity | 4          | Eventos cross-module têm schema definido  |
| Module independence   | 6          | Módulos L0 não importam de L1+            |

### 5.3 Métricas de Saúde Automáticas (Dashboard)

Proposta: script `scripts/arch-health.mjs` gerando JSON de métricas:

```json
{
    "timestamp": "2026-04-12T10:00:00Z",
    "barrel_usage_ratio": 0.23,
    "deep_import_count": 233,
    "singleton_count": 30,
    "max_fan_out": 11,
    "layer_violations": 4,
    "files_over_400loc": 25,
    "emitter_files": 70,
    "di_setters": 22,
    "health_score": "C+ (62/100)"
}
```

---

## 6. Preparação para Vastos Upgrades

### 6.1 Multi-Agent Support

**Requisito futuro**: Múltiplos agentes simultâneos (LLM-A, LLM-B, LLM-C...) com sessões
independentes.

**O que impede hoje**:
- Singletons globais (`copilotDb`, `_client`, `copilotNamespace`) — 1 instância = 1 agent
- Estado global mutável (`_busy`, `_rl`) — racing conditions
- Bootstrap acoplado (`entry.js` assume single-agent)

**O que a arquitetura ideal resolve**:
- DI container com `fork()` → cada agent recebe child container isolado
- FSM de estado → cada agent tem FSM independente
- EventBus com namespaces → `agent-1:session:start`, `agent-2:session:start`

### 6.2 Plugin Architecture

**Requisito futuro**: Adicionar tools, bridges e hooks via plugins externos sem alterar código core.

**O que impede hoje**:
- Tools são definidos estaticamente em `tools/*.js` e registrados em `bootstrapTools()`
- Bridges são hard-wired em imports diretos
- Hooks dependem de factory patterns fixos

**O que a arquitetura ideal resolve**:
- `plugins/` module com registry pattern:
  ```js
  pluginRegistry.register('tools', myCustomTool);
  pluginRegistry.register('bridges', myCustomBridge);
  ```
- Tool discovery via filesystem (`plugins/tools/*.js`) ou config
- Bridge discovery análogo
- Hook extension via middleware chain

### 6.3 TypeScript Migration Path

**Requisito futuro**: Migração incremental para TypeScript para type-safety compile-time.

**O que impede hoje**:
- 287 arquivos .js com JSDoc — migração big-bang é inviável
- Deep imports criam 233 pontos de acoplamento a paths `.js` específicos
- Singletons e estado global dificultam inferência de tipos

**O que a arquitetura ideal resolve**:
- Barrel-first reduz pontos de acoplamento a 14 (1 barrel per module)
- `types/` module concentra type definitions → primeiro módulo .ts
- DI container typed → generics garantem type-safety de injection
- Migração bottom-up: `types/` → `core/` → `db/` → `config/` → ... → `terminal/`

### 6.4 Horizontal Scaling

**Requisito futuro**: Worker pool para processamento paralelo de tools, bridges e audit.

**O que impede hoje**:
- Estado in-memory com singletons — não transferível entre workers
- EventEmitter local — não cross-process
- DB singleton sem connection pool

**O que a arquitetura ideal resolve**:
- DI com managed state → state pode ser serialized para workers
- EventBus com adapter de transporte → Redis/IPC para multi-process
- DB com connection pool → `core/db-pool.js`

### 6.5 API Federation / GraphQL

**Requisito futuro**: API unificada com schema typed, substituindo REST endpoints ad-hoc.

**O que impede hoje**:
- `api/` com 11 deps diretos → cada route handler importa de everywhere
- Sem camada de serviço → controllers fazem lógica de negócio
- Sem schema formal de API

**O que a arquitetura ideal resolve**:
- `services/` como facades por caso de uso → `SessionService`, `ToolService`, `AgentService`
- `api/` apenas faz routing → delega para services
- Schema GraphQL baseado nos tipos de `types/` + resolvers delegando para `services/`

### 6.6 Observable-First Architecture

**Requisito futuro**: Observabilidade end-to-end com traces distribuídos, métricas structuradas
e alertas automáticos.

**O que impede hoje**:
- Logger importado diretamente por 134 arquivos → sem contexto de trace
- Métricas ad-hoc em `observability/metrics.js` → não standardizadas
- Sem correlation ID propagado entre módulos

**O que a arquitetura ideal resolve**:
- Contexto de observabilidade injetado via DI → `container.resolve(TRACE_CONTEXT)`
- Correlation ID propagado automaticamente pelo EventBus
- Métricas como first-class citizens com schema definido em `types/metrics.d.ts`
- OpenTelemetry compatible spans

---

## 7. Mapa de Migração Ideal (visão de alto nível)

### 7.1 Ondas de Migração

```
Wave 0  (imediata)    CI fix + violações
                      ↓
Wave 1  (curto-prazo) Barrel enforcement + deep import migration
                      ↓
Wave 2  (médio-prazo) DI container + singleton elimination + types/
                      ↓
Wave 3  (longo-prazo) EventBus + services/ + plugins/ + FSM
                      ↓
Wave 4  (futuro)      TS migration + multi-agent + horizontal scaling
```

### 7.2 Métricas de Progresso por Wave

| Wave | Health Score Target | Barrel Ratio | Singletons | Layer Violations | Deep Imports |
| ---- | ------------------- | ------------ | ---------- | ---------------- | ------------ |
| 0    | D (40/100)          | 23%          | 30         | 0 (CI fix)       | 233          |
| 1    | C+ (55/100)         | **80%**      | 30         | 0                | **≤50**      |
| 2    | B (70/100)          | 80%          | **≤10**    | 0                | ≤50          |
| 3    | B+ (80/100)         | 90%          | ≤5 (DI)    | 0                | ≤20          |
| 4    | A (90/100)          | 95%+         | 0          | 0                | allow-list   |

---

## 8. Comparação: Baseline → Atual → Ideal

> **Nota pós-execução (2026-04-12)**: Faixas H–N executadas. "Baseline" = pré-Faixa H.
> "Atual" = pós-Faixa N (`6ebaa575`). Detalhes em PARTE-21F.

| Aspecto                     | Baseline (21A)    | Atual (pós-N)      | Ideal              | Gap restante |
| --------------------------- | ----------------- | ------------------- | ------------------ | ------------ |
| **Módulos**                 | 14                | **17** ✅            | 17                 | 0            |
| **Layer violations (CI)**   | 4 ocultas         | **0** ✅             | 0                  | 0            |
| **Barrel coverage**         | 23%               | **100%** ✅          | ≥90%               | Atingido     |
| **Deep imports**            | 233               | **165** ⚠️           | ≤50                | -115         |
| **Singletons (contados)**   | ~30               | **73** 🔴            | ≤10                | -63*         |
| **EventEmitter refs**       | 70                | **72** ⚠️            | ≤30 + bus          | -42          |
| **DI pattern**              | 22 ad-hoc setters | **13 tokens + 9 wired** ⚠️ | DI container | -14 setters  |
| **CI gates**                | 2                 | **5+** ⚠️            | 10+                | -5           |
| **Contract tests**          | 6                 | **108** ✅           | 20+                | Atingido     |
| **Fan-out max**             | 11 (api/)         | **19** (terminal) 🔴 | ≤8                 | -11          |
| **Files >400 LoC (raw)**    | 25                | **18** ⚠️            | ≤5                 | -13          |
| **Plugin architecture**     | Inexiste          | **Plugin registry** ✅| Plugin registry    | 0            |
| **TypeScript readiness**    | JSDoc only        | **types/ + JSDoc** ⚠️ | types/ .ts         | Conversão    |
| **Multi-agent support**     | 1 agent only      | **1 + DI fork prep** | N agents via DI    | Futuro       |
| **Health score**            | D (35/100)        | **D (65/100)** ⚠️    | A (90/100)         | +25pts       |

*\* 73 singletons contados inclui ~40 `let log =` e ~12 regex vars. Reais: ~15-20.*

---

## 9. Conclusão

A arquitetura ideal v2 permanece como norte. As Faixas H–N resolveram **4 dos 9 problemas
completamente** e avançaram parcialmente os outros 5. Os gaps principais são:

1. **Deep imports** — 134 são logger (aceitáveis com allow-list), 31 reais
2. **Fan-out terminal/** — root node, parcialmente justificável (extract facades)
3. **Singleton refinement** — script precisa distinguir `let log` de state global
4. **DI setters** — 14 restantes para migrar

Próximas Waves: W4 (Deep Cleanup), W5 (Arquitetura Avançada), W6 (TypeScript).
Ver PARTE-21C (roadmap) e PARTE-21F (status pós-execução) para detalhes.
