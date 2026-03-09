# Relatorio Tecnico - Heap Dump do Projeto

- Data da avaliacao: 2026-03-07
- Artefato analisado: `Heap.20260215.120710.47066.0.001.heapprofile`
- Tipo de artefato: V8 Sampling Heap Profile (`--heap-prof`), nao e heap snapshot completo
- Escopo de codigo revisado: `src/driver/factory.js`, `src/driver/targets/ChatGPTDriver.js`,
  `src/kernel/execution_engine/execution_engine.js`,
  `src/server/api/controllers/dashboard_events.js`, `src/orchestrator/memory_store.js`,
  `src/kernel/observation_store/observation_store.js`

## 1) Resumo executivo

1. O perfil atual nao aponta leak claro no momento da captura; o consumo amostrado esta
   majoritariamente em bootstrap/import de modulos (Node interno + node_modules).
2. O arquivo analisado parece ter sido coletado em fase de boot/encerramento (stack com `boot` em
   `src/main.js` e `exit` de `node:internal/process/per_thread`).
3. Mesmo sem leak evidente nesse dump, ha riscos reais de crescimento de memoria em runtime longo,
   principalmente no `ObservationStore` (retencao sem limite efetivo no bootstrap atual).
4. Existem melhorias de higiene de memoria e observabilidade que devem ser aplicadas para prevenir
   OOM e facilitar triagem futura.

## 2) Metodologia

1. Parse estrutural do `.heapprofile` e agregacao por `selfSize`, URL e funcao.
2. Segmentacao de memoria amostrada por origem:

- `node:*`
- `node_modules`
- `src/` do projeto
- outros

3. Correlacao dos stacks dominantes com os modulos do projeto.
4. Auditoria estatica dos pontos com maior risco de retencao (Maps/Sets, timers, observers, filas de
   espera, payload retention).

## 3) Resultados quantitativos do heap profile

### 3.1 Distribuicao geral (self sampled size)

- Total amostrado: **35.77 MB** (`37,512,600` bytes)
- `node_internal`: **22.19 MB** (62.03%)
- `node_modules`: **11.33 MB** (31.66%)
- `project_src`: **0.66 MB** (1.84%)
- `project_other`: **0.01 MB** (0.04%)
- `other`: **1.59 MB** (4.44%)

### 3.2 Principais alocadores por URL

1. `node_modules/zod/v4/classic/schemas.js` -> 5.89 MB
2. `node:internal/encoding` -> 5.21 MB
3. `node:fs` -> 3.76 MB
4. `node:internal/modules/cjs/loader` -> 3.18 MB
5. `node:internal/modules/esm/utils` -> 2.41 MB
6. `node:internal/process/per_thread` -> 1.92 MB

### 3.3 Evidencia de contexto de boot

- Top node: `exit` em `node:internal/process/per_thread`
- Stacks de carga ESM/CJS e compilacao de schema (`zod`) dominam o perfil
- Funcoes relevantes do projeto aparecem com baixa massa relativa (startup path)

## 4) Leitura por arquivo do projeto (foco do pedido)

### 4.1 `src/kernel/execution_engine/execution_engine.js`

- Massa no dump: ~1 KB (irrelevante neste perfil)
- Risco observado: churn por copia/sort em loop de ciclo:
  - `const sorted = [...observations].sort(...)` em `execution_engine.js:267`
- Impacto: mais pressao de heap/GC sob alta cardinalidade de observacoes (nao leak direto).

### 4.2 `src/driver/factory.js`

- Massa no dump: ~23 KB (baixa no perfil atual)
- Riscos reais identificados:

1. Timer de auto-destruicao de driver temporario sem rastreamento para cancelamento manual:

- `setTimeout` em `factory.js:894`
- Se muitos temporarios forem criados, acumula timers/closures por ate 5 min.

2. Fila de waiters nao drenada explicitamente no shutdown:

- map de waiters em `factory.js:217`
- limpeza atual: `this._waiters.clear()` em `factory.js:1476`
- timers de waiters podem continuar vivos ate timeout.

### 4.3 `src/driver/targets/ChatGPTDriver.js`

- Massa no dump: ~7.5 KB (baixa no perfil atual)
- Risco de retencao/computacao residual:

1. `MutationObserver` de watchdog eh criado em `waitForCompletion`:

- criacao: `ChatGPTDriver.js:437-444`
- cleanup robusto apenas no `destroy()` (`ChatGPTDriver.js:807+`)
- recomendacao: cleanup em `finally` da propria `waitForCompletion`, para nao manter observer ativo
  entre ciclos.

### 4.4 `src/server/api/controllers/dashboard_events.js`

- Massa no dump: 0 bytes (nao apareceu na captura)
- Nao ha indicio de leak aqui no dump.
- Otimizacao sugerida: payload parsing opcional/paginacao por campos quando volume crescer (reduz
  pico de alocacao por request).

### 4.5 `src/orchestrator/memory_store.js`

- Massa no dump: ~5.3 KB (baixa no perfil atual)
- Ja possui limite (`maxSize`) e eviction.
- Melhorias de eficiencia (nao leak critico):

1. `getPatternsByType` faz `find` O(n) para cada id (`memory_store.js:147-150`)
2. Eviction ordena array inteiro (`memory_store.js:202`) a cada overflow

### 4.6 `src/kernel/observation_store/observation_store.js` (principal risco)

Mesmo com baixa massa no dump atual, este modulo tem **alto potencial de crescimento continuo** em
runtime:

1. Sem limite efetivo no bootstrap atual:

- construtor aceita `maxObservationsPerCorrelation = null` (`observation_store.js:67`)
- kernel cria store sem limite (`kernel.js:373`)

2. Duplicacao de payload por registro:

- guarda `payload` e `payloadSerialized` ao mesmo tempo (`observation_store.js:44-45`)
- em payloads grandes, custo de memoria pode dobrar por evento.

3. Indices que crescem sem purge completo:

- `seenMsgIds` em `observation_store.js:87`
- `purgeCorrelation` remove apenas `byCorrelation` (`observation_store.js:337-343`), sem limpar
  `seenMsgIds`
- `purgeOlderThan` tambem nao reconcilia `seenMsgIds` (`observation_store.js:357+`)

4. Custo de copia frequente:

- `getByCorrelation` retorna copia congelada (`observation_store.js:219`)
- sob alto throughput, aumenta churn de heap/GC.

## 5) Conclusao tecnica sobre o heap dump

- Este dump isolado indica **pico de bootstrap/import**, nao um leak comprovado em runtime
  estendido.
- O sistema esta com custo de inicializacao alto (especialmente `zod` e loader de modulos), mas isso
  por si so nao caracteriza leak.
- O risco de leak real esta mais relacionado a estruturas de retencao de longo prazo (especialmente
  `ObservationStore`) do que aos arquivos com maior peso neste dump.

## 6) Correcoes propostas (priorizadas)

## P0 (aplicar primeiro)

1. Limitar e podar `ObservationStore` por configuracao e por tempo

- Definir limite no bootstrap
  (`new ObservationStore({ telemetry, maxObservationsPerCorrelation: N })`)
- Adicionar limite global de correlacoes/observacoes
- Agendar `purgeOlderThan` periodico no lifecycle do kernel

2. Corrigir reconcilicao de indices no purge do `ObservationStore`

- Ao purgar correlacao/idade, remover `msgId`s associados de `seenMsgIds`
- Evitar crescimento infinito do Set

3. Evitar duplicacao de payload no `ObservationStore`

- Tornar `payloadSerialized` opcional por flag de debug
- Em modo normal, armazenar somente forma canonica minima (ou hash + metadados)

## P1

1. `DriverFactory`: drenar waiters no shutdown

- Cancelar timers pendentes
- Rejeitar promises em fila com erro controlado (`FACTORY_SHUTDOWN`)

2. `DriverFactory`: rastrear timers de `temporaryDrivers`

- Guardar `autoDestroyTimer` por instancia
- Cancelar timer quando o driver for destruido/descartado antes do TTL

3. `ChatGPTDriver`: cleanup do observer por ciclo

- Encapsular `waitForCompletion` com `try/finally`
- Em `finally`, desconectar `window.__wd_obs` e limpar `window.__wd_last_change`

## P2 (upgrades de performance e manutencao)

1. Reduzir custo de startup

- Lazy-load de schemas pesados (`task_schema_v5`) apenas no caminho que valida task
- Avaliar split de schema por funcionalidade

2. Otimizar `ExecutionEngine`

- Evitar `sort` completo de observacoes por tick quando nao necessario
- Possivel estrategia: manter ultimo timestamp por correlacao e varrer linearmente

3. Otimizar `MemoryStore`

- Substituir `find` repetido por indice `id -> pattern`
- Eviction incremental sem sort global completo

## 7) Melhorias de observabilidade/reproducao (essencial)

1. Coletar serie temporal, nao apenas dump unico

- T0 (boot), T+5m, T+15m, T+30m, sempre no mesmo workload

2. Complementar `heapprofile` com `heapsnapshot`

- `heapprofile` (sampling) mostra hotspots de alocacao
- `heapsnapshot` mostra caminhos de retencao (dominators)

3. Metricas de saude de memoria por subsistema

- `process.memoryUsage()` por intervalo
- contadores de tamanho: `byCorrelation.size`, `seenMsgIds.size`, `pool.size`, waiters
- alertas por slope (ex: crescimento continuo de heapUsed apos GC)

4. Gate operacional

- Threshold de crescimento continuo (MB/min) + restart controlado
- Budget de memoria por ambiente (dev/staging/prod)

## 8) Plano de validacao pos-correcao

1. Reexecutar cenario de leak por 30-60 min com carga estavel
2. Comparar slope de `heapUsed` apos GC (antes/depois)
3. Confirmar que:

- `ObservationStore` estabiliza (correlacoes/msgIds nao crescem indefinidamente)
- nao ha acumulacao de waiters/timers na factory
- `MutationObserver` nao permanece ativo entre tarefas

4. Publicar novo relatorio com diff de metricas

## 9) Comandos uteis para proxima rodada

```bash
# Perfil de heap por sampling (ja existente no projeto)
npm run debug:memory-leak

# Suite de runtime debug
npm run debug:runtime-suite

# Auditoria de performance
npm run audit:performance
```

---

## Parecer final

- **Status atual do dump analisado**: sem evidencia forte de leak ativo no momento da captura.
- **Risco estrutural de leak em runtime longo**: **alto** enquanto `ObservationStore` permanecer sem
  limites/purge completos no fluxo padrao do kernel.
- **Recomendacao**: executar correcoes P0 imediatamente e repetir coleta temporal para confirmacao
  estatistica.
