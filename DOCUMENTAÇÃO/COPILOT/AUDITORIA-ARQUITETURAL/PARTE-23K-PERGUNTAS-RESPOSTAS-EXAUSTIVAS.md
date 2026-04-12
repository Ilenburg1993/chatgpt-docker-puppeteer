# PARTE-23K — Perguntas e Respostas Exaustivas

**Data**: 2026-04-12 | **Status**: Canônico | **Versão**: 1.0
**Scope**: Todas as dúvidas arquiteturais levantadas e respondidas durante auditoria profunda
**Precedente**: PARTE-23G (situação atual), PARTE-23H (situação ideal)

---

## Seção A: EventBus e Eventos

### A1: Por que existem 4 sistemas de eventos paralelos?
**R**: Evolução orgânica. `core/events.js` era o original (AGENT_EVENTS). `types/events.js` foi criado para tipagem JSDoc. `conversation-hub/events.js` foi adicionado como HUB_EVENTS locais. `events/index.js` foi o consolidador planejado na PARTE-22. O problema é que a migração para events/ nunca foi completada — apenas 5 arquivos importam de events/.

### A2: bridgeEmitter funciona? Por que só 2/8 emitters usam?
**R**: Funciona perfeitamente. `bridgeEmitter(emitter, bus, eventMap)` em `core/event-bus.js:273` registra handlers `.on()` no emitter local e faz `bus.emit()` no EventBus central. Retorna função de unbind. Já é usado por always-alive.js (7 events → EventBus) e hub.js (5 events → EventBus). Os outros 6 emitters não usam porque a implementação foi adicionada na PARTE-22 e a adoção não foi expandida. Não há razão técnica — é momentum de projeto.

### A3: Se bridgeEmitter já existe, por que a PARTE-23B propôs criar `core/event-bus-bridge.js`?
**R**: Erro de auditoria na versão 1. O helper já existe IN-LINE no event-bus.js. A proposta da PARTE-23B é redundante. A ação correta é EXPANDIR o uso do bridgeEmitter existente (de 2/8 para 8/8), não criar novo módulo.

### A4: EventBus emite mas ninguém escuta cross-module?
**R**: Correto. Os 12 eventos bridged são emitidos no EventBus, mas nenhum módulo faz `eventBus.on('agent:ready', handler)` em outro layer. Observability escuta diretamente via `agent.on('ready', ...)`. Isso significa que o EventBus é um beco sem saída — emite data que ninguém consome. A ação é migrar observability para consumir via EventBus (Fase 2D).

### A5: Qual é a diferença entre BaseEmitter e EventBus?
**R**: `BaseEmitter` = `EventEmitter` do Node.js (alias puro, 0 lógica adicionada). Cada módulo que `extends BaseEmitter` tem seu próprio event bus local. `EventBus` é o barramento central (1 instância singleton) com namespace, wildcards e middleware. O pattern ideal: emitters locais para internal state, bridgeEmitter para propagar cross-module via EventBus.

### A6: Devemos eliminar BaseEmitter?
**R**: Não imediatamente. Muitos módulos usam `.emit()` e `.on()` internamente para comunicação intra-módulo. Isso é correto. O que precisa mudar é: (1) eventos cross-module devem passar pelo EventBus via bridge, (2) módulos que SÓ emitem para fora (hooks/bus.js) poderiam usar EventBus diretamente.

### A7: Os namespaces do EventBus ('agent:*', 'session:*') funcionam?
**R**: Sim. `event-bus.js` suporta wildcards: `bus.on('agent:*', handler)` captura `agent:ready`, `agent:stopped`, etc. O middleware pipeline também funciona por namespace. Mas ninguém usa wildcards em produção — todos os `.on()` são para eventos específicos.

---

## Seção B: DI Container

### B1: Por que 41 tokens definidos mas só 12 registrados?
**R**: `di-tokens.js` foi criado de forma aspiracional durante a PARTE-22. Define tokens para todo o sistema (AGENT_STATE, DIALOG_ENGINE, HUB_SESSION_STORE, etc.) mas a maioria dos módulos não foi migrada para DI. Os módulos ainda usam imports diretos. Os 12 registrados foram os primeiros (loggers, EVENT_BUS, terminal agents).

### B2: Vale a pena ter DI neste projeto?
**R**: Sim, para 3 fins: (1) substituir singletons `let=null` que dificultam testes (não injetáveis), (2) lifecycle management (dispose), (3) composição declarativa (composition-root). A questão não é "deve existir?" mas "deve ser adotado mais amplamente" (atualmente 2.4% dos tokens são resolvidos).

### B3: Por que EVENT_BUS é o único token efetivamente resolvido?
**R**: Porque services (session-service, etc.) precisam de EventBus para emitir eventos e não podem importar diretamente (circular dependency). DI é a solução natural. Outros módulos não têm esse problema (importam diretamente sem circular deps), então não sentiram necessidade de DI.

### B4: Os 12 tokens nunca resolvidos devem ser removidos?
**R**: Classificar em 3 grupos: (a) tokens para módulos que serão migrados para DI → manter, (b) tokens para módulos que não precisam de DI → remover, (c) tokens aspiracionais sem plano concreto → remover. Estimativa: ~8 para manter, ~4 para remover.

### B5: Container.fork() é usado em algum lugar?
**R**: Não. `fork()` cria um child container com escopo isolado. Seria útil para: (1) request-scoped DI (cada request tem seu container), (2) testes (fork + override). Mas nenhum código usa. É feature disponível mas não adotada.

---

## Seção C: Retries e Resiliência

### C1: Por que bridges ignoram core/retry.js?
**R**: `core/retry.js` (85 LoC) foi adicionado após as bridges serem escritas. `mcp-tool-bridge.js` tem retry ad-hoc com backoff customizado (linhas 97-154) que ficou hard-coded. `nerv-bridge.js` tem retry implícito via reconexão manual. Ninguém voltou para padronizar.

### C2: core/retry.js é suficiente para os use cases das bridges?
**R**: Sim. Oferece: `maxAttempts`, `baseDelayMs`, `maxDelayMs`, `jitter` (true/false), `signal` (AbortSignal para cancel), `shouldRetry(error, attempt)` callback, `onRetry(error, attempt, delayMs)` callback. O retry ad-hoc do mcp-bridge usa um subset dessas features. A migração é direta.

### C3: E o circuit breaker?
**R**: `core/circuit-breaker.js` (135 LoC) tem: `new CircuitBreaker({ threshold, timeout, halfOpenRetries })`. States: Closed → (failures≥threshold) → Open → (timeout) → Half-Open → (success) → Closed. `mcp-tool-bridge` parece ter circuit breaker ad-hoc. Precisa verificar se usa a classe de core/ ou reimplementa.

### C4: Devemos compor retry + circuit breaker?
**R**: Pattern recomendado:
```js
const cb = new CircuitBreaker({ threshold: 3, timeout: 30000 });
const result = await withRetry(
    () => cb.execute(() => mcpCall()), 
    { maxAttempts: 3, shouldRetry: (err) => !(err instanceof CircuitOpenError) }
);
```
Retry de fora, circuit breaker de dentro. Se CB abre, retry para (CircuitOpenError exclui retry).

### C5: Existe retry para SDK calls?
**R**: `agent/lifecycle/entry.js` usa `withRetry()` para `copilotClient.init()`. É a única adoção real. SDK calls subsequentes (sendMessage, etc.) não têm retry formal.

---

## Seção D: Testes

### D1: 299/320 tests falham por causa de 1 linha faltante?
**R**: Sim. `ReferenceError: test is not defined`. No Node.js ≥24 com ESM, `node --test file.mjs` não injeta globals. Precisa de `import { test } from 'node:test'`. Os 21 files que têm esse import passam (incluindo 33/33 subtests do event-bus).

### D2: Após fixar o import, todos passam?
**R**: Não. Estimativa: 50-60% passarão. Os restantes terão: (a) imports quebrados (módulos renomeados na PARTE-22), (b) mocks obsoletos (APIs changed), (c) erros de lógica em testes antigos.

### D3: Qual a melhor estratégia para fixar?
**R**: Script automático para inserir o import (Phase T1). Depois rodar e categorizar falhas residuais por tipo. Priorizar fixes por módulo: core/ primeiro (mais importante), depois services/, events/, agent/.

### D4: node --test funciona com ESM neste projeto?
**R**: Sim. O projeto é `"type": "module"` e usa `--strip-types` flag para TypeScript-in-JSDoc. `node --strip-types --test tests/unit/copilot/test_core_event_bus.spec.js` → 33/33 pass.

### D5: Por que `node:test` e não vitest/jest?
**R**: Decisão arquitetural do projeto: zero dependencies externas para teste. `node:test` é built-in desde Node 18. Alinhado com ESM nativo. Não precisa de bundler ou transformer.

---

## Seção E: Shutdown e Lifecycle

### E1: O shutdown é priority-based. Precisa de upgrade?
**R**: Não. `core/shutdown.js` já implementa: named handlers com priority numérica (10=agent, 20=bridges, 30=DB, 40=terminal, 50=cleanup). A PARTE-23F/23C propunha "criar ShutdownRegistry com prioridades" — essa proposta é REDUNDANTE. O que falta é: registrar mais handlers (3/8 → 8/8), não reescrever o sistema.

### E2: Por que só 3 handlers registrados?
**R**: Pelo mesmo motivo que DI tem baixa adoção: momentum. entry.js registra 2 (agent session + SDK client), timer-registry.js registra 1 (auto-cleanup). Os 5 restantes (nerv, mcp, db, eventbus, terminal) fazem cleanup ad-hoc nos seus próprios módulos.

### E3: O shutdown funciona se nem todos estão registrados?
**R**: Parcialmente. `runShutdown()` executa os 3 handlers registrados por prioridade corretamente. Mas nerv-bridge desconecta no seu `process.on('beforeExit')` customizado (não via runShutdown), mcp-bridge desconecta no `finally` de um try/catch, etc. O resultado é: shutdown parcialmente ordenado, parcialmente caótico.

### E4: Qual o risco de shutdown parcial?
**R**: (1) DB close pode acontecer ANTES de agent drain → perda de mensagens, (2) EventBus dispose antes de bridges → bridges tentam emitir em bus morto, (3) Terminal server close antes de agent → client vê disconnect abrupto. Tudo isso é resolvido registrando handlers com prioridades corretas.

---

## Seção F: Bootstrap e Wiring

### F1: Por que registrations estão em 3 arquivos?
**R**: Evolução orgânica: `observability/bootstrap.js` foi o primeiro (registra loggers + EVENT_BUS), `entry.js` adicionou o seu (AUDIT_BUS), `terminal/index.js` adicionou os seus (HUB, agents). Não houve refactoring para consolidar.

### F2: CompositionRoot resolve o problema?
**R**: Sim. 1 arquivo que centraliza TODOS os `container.register()` calls, com fases declarativas. entry.js e terminal/ passam a ser consumers do container (chamam `resolve()`), não providers.

### F3: main.js (2173 LoC) precisa mudar?
**R**: Não neste escopo. main.js é o bootstrap do sistema legado (NERV, BrowserPool, KERNEL, missions). O copilot/ é um subsistema que main.js inicia. A separação está correta — são mundos diferentes.

### F4: A ordem de boot importa?
**R**: Sim, muito. Atualmente implícita:
1. observability/bootstrap.js → registra EVENT_BUS (singleton, lazy)
2. entry.js → cria CopilotClient, registra AUDIT_BUS, configura shutdown
3. terminal/index.js → resolve HUB, agents

Se (2) roda antes de (1), EVENT_BUS não existe e bridges falham silenciosamente (`try/catch` swallows `bus not available`). CompositionRoot com fases explícitas elimina esse risco.

---

## Seção G: God Files e Refactoring

### G1: 24 god files (>350 LoC) — ignore ou fix?
**R**: Ignorar neste escopo (conforme diretriz do usuário). A PARTE-22 já endereçou o pior (C1 refactor). Os 24 restantes serão abordados via "natural refactoring" — quando um god file for editado para uma feature, splittar nesse momento.

### G2: services/index.js tem re-exports bypass. É grave?
**R**: Sim. `export { alwaysAliveAgent } from '#copilot/agent'` no barrel permite que consumidores de services/ acessem módulos internos sem saber que estão bypassando layers. Fix: remover esses re-exports e forçar consumers a usar services/ facades.

---

## Seção H: Bridges

### H1: nerv-bridge.js tem 5 singletons — é problema?
**R**: Sim. `_agent`, `_nerv`, `_inboundUnsub`, `_beforeStopRegistered`, `_pendingReadyHandler` são `let` module-level. Não podem ser mockados em testes (sem DI injection). Não suportam fork/reset. Devem migrar para DI singleton tokens.

### H2: mcp-tool-bridge.js tem retry ad-hoc — quão diferente do core/retry.js?
**R**: Funcionalidade similar: backoff exponencial com ceiling. O ad-hoc não tem: jitter, abort signal, onRetry callback. A migração para core/retry.js é direta — adicionar 2-3 opções.

### H3: Bridges devem ser plugins?
**R**: Sim, no futuro (Fase 5A). `plugins/builtin/mcp-plugin.js` encapsularia todo o wiring: retry, circuit breaker, shutdown handler, health check. Atualmente: wiring espalhado.

---

## Seção I: Observability

### I1: config/ ↔ observability/ ciclo é perigoso?
**R**: Funciona por acidente — Node ESM resolve circular imports se as exports referenciadas estão disponíveis no momento do acesso (lazy). Mas é frágil: qualquer mudança na ordem de import pode quebrá-lo. Fix: config/ usa DI token LOGGER em vez de import direto.

### I2: Duplicate process handlers (entry.js + error-tracker) — qual remover?
**R**: Remover de entry.js. `error-tracker.js` tem `registerGlobalHandlers()` que é mais completo (ring buffer de erros, categorização). entry.js registra handlers redundantes que fazem `log + trackError` — a mesma coisa que error-tracker já faz.

### I3: 368 try/catch blocks — é muito?
**R**: Para 320 arquivos, ~1.15 try/catch por arquivo é razoável. O problema não é quantidade, é qualidade: alguns catches são vazios (swallow silencioso), outros logam mas não propagam. Audit: grep `catch {}` ou `catch (e) {}` para encontrar swallows silenciosos.

---

## Seção J: Feature Flags

### J1: sdk/feature-flags.js é suficiente para o sistema?
**R**: Para SDK features, sim. Para features do sistema (plugins, new services, experimental bridges), não. É SDK-scoped (`@copilotkit/sdk`), não system-scoped. Para V1, pode ser reutilizado. Para V2, criar `core/feature-flags.js` com runtime toggle via config.

### J2: Existe env var override?
**R**: Sim. `COPILOT_EXPERIMENTAL_<NAME>=true|false` override a flag em runtime. Funciona para qualquer flag registrada.

### J3: Feature flags em runtime (sem restart)?
**R**: Não existe hot-reload. Flag é lida uma vez no boot. Para mudar, precisa restart. Future: integrar com config-service + EventBus para hot-reload.

---

## Seção K: Performance e Escalabilidade

### K1: EventBus é bottle neck potencial?
**R**: Não com volumes atuais. `event-bus.js` é síncrono (handlers chamados via `for...of` loop). Para <1000 events/sec é OK. Para volumes maiores, considerar async dispatch ou worker threads.

### K2: LRU cache (core/cache.js) é eficiente?
**R**: Sim. `Map` com TTL e eviction determinística. Sem memory leak (entries expiradas são cleanup). Stats (hits/misses) permitem tuning.

### K3: Mutex (core/mutex.js) tem deadlock risk?
**R**: Não. É promise-chain based: cada `lock()` appenda promise na chain. `withMutex(name, fn)` garante release mesmo com throw. Não há wait-for-graph, então deadlock entre 2 mutexes é impossível (single-chain).

---

## Seção L: Arquitetura Futura

### L1: AsyncLocalStorage vale o esforço?
**R**: Sim, para request-id tracing. Sem request context, é impossível correlacionar logs de um mesmo request entre API → services → agent → bridges. Overhead: desprezível (ALS é otimizado no V8).

### L2: Rate limiter centralizado é necessário?
**R**: Sim. `channel/inject.js` e `orchestrator.js` usam delays ad-hoc com setTimeout. Session abuse (user sends 100 messages/sec) não é limitado. Token bucket em core/ resolveria.

### L3: CI pipeline é prioridade?
**R**: Média. Sem CI, mudanças são validadas manualmente (lint + test). Com CI, garantia automática. Mas requer tests passando primeiro (Fase 0A).

### L4: Devemos manter o health-check calibrado (97/100)?
**R**: Sim para comparação baseline, mas adicionar score honest side-by-side. O calibrado serve como progression tracker (subiu de X para Y). O honest serve como reality check.
