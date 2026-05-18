# Roadmap de Execução — Pós-Validação da Auditoria Externa

**Documento associado:** `DOCUMENTAÇÃO/COPILOT/AUDITORIA-EXTERNA/# Auditoria Técnica — Copilot SDK 0.3 - CLAUDE SONNET - externa.md`
**Estado inicial:** validação concluída + execução já iniciada nesta rodada.

---

## Princípios de execução

1. **Severidade primeiro** (Crítico > Alto > Médio > Baixo).
2. **Correções de comportamento antes de refactors estéticos**.
3. **Mudanças pequenas e verificáveis por lote**.
4. **Compatibilidade operacional** (evitar regressão de runtime e APIs internas).
5. **Cobertura total**: todos os itens validados serão tratados (correção, ajuste, documentação ou decisão explícita).

---

## Fase 0 — Baseline e Quick Wins (concluída nesta rodada)

### Subfase 0.1 — Correções críticas imediatas
- [x] BUG-01, BUG-02, BUG-03.

### Subfase 0.2 — Correções altas de baixo risco
- [x] BUG-05, BUG-06, BUG-07, BUG-08, BUG-09, BUG-10.

### Subfase 0.3 — Hardening rápido adicional
- [x] BUG-18.
- [x] GAP-12 (via extensão de `get_agent_info`).

---

## Fase 1 — Estabilização Crítica (Sprint atual)

### Subfase 1.1 — Concurrency/consistência de índice
- [x] **GAP-01**: lock de `indexDirectory` por `rootPath` com `withIoResourceLock`.
- [x] Revisar comportamento em chamadas paralelas (scope + manual build) com coalescência de in-flight builds por assinatura de diretório/opções no registry.

### Subfase 1.2 — Limites duros de escopo/scan
- [x] **GAP-02** (parcial): hard cap efetivo aplicado no `warmFromDirectory` via `maxFiles` enforce.
- [x] **GAP-14**: hard cap absoluto em `io-scanner`.
- [x] **GAP-02** (complemento): hard cap também no fluxo de index build completo.

### Subfase 1.3 — Store de TODO escalável
- [x] **BUG-04**: `readStore` serializado com mutex compartilhado de persistência.
- [x] **GAP-03**: criar leitura paginada SQL/cursor para evitar full-load em memória.

### Entregáveis Fase 1
- patches em `io-index-sqlite.js`, `io-session-scope.js`, `io-scanner.js`, `tools/todo/store.js`.
- documento de decisão técnica para lock/paginação.

---

## Fase 2 — Ferramentas Web/Search/Shell (Sprint seguinte)

### Subfase 2.1 — Web tools
- [x] **GAP-05**: `web_fetch_local` com `method` seguro (`GET/POST/PUT/PATCH`) + `body`/`headers` com policy.
- [x] **UPG-03**: migrar timeout para `AbortSignal.timeout()` (aplicado no `web_fetch_local`).

### Subfase 2.2 — Search observability e resiliência
- [x] **GAP-09**: adicionar `indexFallback` + `indexFallbackReason` no retorno de search.
- [x] **GAP-15**: mensagem orientativa quando `grep` também indisponível.

### Subfase 2.3 — Shell hardening
- [x] **GAP-13**: bloquear `history`, `declare -p`, `typeset` (ou sanitizar retorno).
- [x] **BUG-15** (parcial): alinhar detecção semântica de subshell para telemetria/UX.

---

## Fase 3 — Performance e Ciclo de Vida (Médio prazo)

### Subfase 3.1 — Parser e invalidation bus
- [x] **GAP-07** (parcial): timeout/guard defensivo para Babel parse (line guard + parse budget + telemetria).
- [x] **GAP-08**: debounce/batch por path no invalidation bus.
- [x] **GAP-07** (complemento): parse off-main-thread (worker_threads) para eliminar bloqueio no event loop.

### Subfase 3.2 — Sessão/escopo
- [x] **GAP-10**: limite de escopos ativos + eviction LRU.
- [x] **GAP-11**: `AbortController` para warmPromise em `closeScope`.

### Subfase 3.3 — Cache/L2 health
- [x] **GAP-06**: evento explícito de circuit-open e destaque em health.
- [x] Revisão de métricas operacionais de L2 (estado derivado `l2State` no health snapshot).

---

## Fase 4 — Upgrades Node 24 + SDK 0.3 (contínuo)

### Subfase 4.1 — APIs modernas com ganho direto
- [x] **UPG-01**: `Promise.withResolvers()` (núcleo de `io-locks`; fila segue em backlog técnico).
- [x] **UPG-04**: `Error.isError()` e normalização cross-realm em boundaries críticas (núcleo + sdk/presentation + infra/runtime + terminal + SDK telemetry/tooling, com expansão incremental contínua).
- [x] **UPG-03**: consolidar `AbortSignal.timeout()` nos pontos críticos (web tools + tasks + webhooks + core/retry; restante segue em sweep incremental).
- [x] **UPG-02** (parcial): núcleo de locks pronto para `await using` via lease disposable (`Symbol.asyncDispose`) + `run()` contextual, já expandido para leases multi-recurso e fluxos `copy/move`.

### Subfase 4.2 — Streaming e orquestração SDK
- [x] **UPG-08**: filtrar sub-agent delta por `agentId` ou desligar include (aplicado via default off).
- [x] **UPG-07**: consolidar governança `excludedTools` vs toggle runtime.
- [x] **UPG-09**: política explícita de `enableConfigDiscovery` por ambiente.

### Subfase 4.3 — Upgrades oportunísticos
- [x] **UPG-11**: `Object.groupBy` em pontos de alto valor (infra/tools module-map).
- [x] **UPG-10**: `structuredClone` em ponto de alto ROI (runtime transaction).
- [x] **UPG-12** (parcial): polling/waits canônicos migrados para `registerInterval`/`cancelTimer` + `sleepMs` em módulos críticos, com enforcement em ESLint.
- [x] **UPG-13**: `Array.fromAsync` aplicado em coletores de stream textuais e snapshots binários.
- [x] **UPG-14**: `ReadableStream.from` exposto via `readTextChunksStream` para consumo web-native.
- [x] **UPG-15**: hardening de testes web (undici v7) — cobertura inicial aplicada; follow-up opcional para fallback runtime.

---

## Fase 5 — Itens de baixo impacto / consistência semântica

- [x] **BUG-12**: scorecard runtime com detecção de drift de módulos.
- [x] **BUG-14**: resolução de imports com cache de `fsStat` + paralelização por import.
- [x] **BUG-16**: normalização explícita de prioridade no AsyncQueue (buckets dinâmicos).
- [x] **BUG-17**: alternativa assíncrona para `releaseLock` (`releaseLockAsync`) mantendo compatibilidade.
- [x] **BUG-19**: consolidar contrato de `countLines` por domínio.

---

## Critérios de pronto por fase

- Cada subfase deve encerrar com:
  1. patches aplicados,
  2. validação local mínima do escopo alterado,
  3. atualização da documentação da auditoria,
  4. decisão explícita para qualquer item adiado.

## Critérios de conclusão do roadmap (Definition of Done)

O roadmap só pode ser encerrado quando **todas** as condições abaixo estiverem satisfeitas:

1. **Sem pendências críticas/altas ativas**
  - nenhum item classificado como Crítico ou Alto permanece aberto sem correção, rollback documentado ou decisão explícita de obsolescência.

2. **Itens médios/baixos com destino explícito**
  - todo item remanescente precisa estar em uma destas situações:
    - corrigido,
    - formalmente adiado com justificativa técnica,
    - refutado com evidência,
    - ou fora de escopo do ciclo atual com owner e próximo passo definidos.

3. **UPG-13/14 resolvidos por decisão, não por silêncio**
  - para `Array.fromAsync` e `ReadableStream.from`, deve existir uma decisão registrada e uma execução correspondente para cada ponto mapeado:
    - aplicado em um piloto seguro com validação,
    - ou aplicado em transformação ampla com testes de regressão,
    - ou, somente se a implementação for estruturalmente inviável, refatorado em alternativa equivalente documentada.

4. **Gates verdes no escopo alterado**
  - typecheck estrito, lint e suíte de testes afetada precisam permanecer verdes após a última rodada de mudanças.

5. **Documentação canônica alinhada**
  - roadmap, validação forense e documento-base precisam apontar para o mesmo estado final, sem divergência de contagem, severidade ou prioridade.

6. **Próximas ondas descritas**
  - a fase posterior deve ficar organizada em ondas/fases, com foco, risco e critério de saída definidos.

7. **Sem bypass operacional**
  - nenhum encerramento pode depender de suposição implícita; toda pendência precisa ter evidência, status e decisão.

---

## Rastreamento de status (fonte de verdade)

- Matriz técnica detalhada: `VALIDACAO-FORENSE-AUDITORIA-EXTERNA-2026-05-17.md`
- Documento-base externo: `# Auditoria Técnica — Copilot SDK 0.3 - CLAUDE SONNET - externa.md`
+
---

## Próxima execução contínua (imediata)

1. Continuar expansão residual de **UPG-12** nos pontos de polling restantes que ainda não migraram para fluxo orientado a eventos (além da canonização já feita com `sleepMs`), com foco explícito no ecossistema do dialog loop.
2. Continuar expansão residual de **UPG-02** onde ainda existirem locks manuais, com a mesma estratégia já validada.
3. Continuar sweep incremental de **UPG-04/UPG-03** em boundaries residuais de erro/timeout, sem deixar conversões pela metade.

## Condição prática para avançar à conclusão

Antes de declarar o roadmap encerrado, deve existir uma revisão final com três respostas objetivas:

- **O que ainda está aberto?** Lista curta e classificada por prioridade.
- **Por que ainda está aberto?** Justificativa técnica ou de escopo.
- **Qual é a ação final?** Corrigir agora, adiar com dono, ou refutar com evidência.

Nesta rodada, a regra operacional é mais forte: **se for factível implementar, implementa-se**. Não usar critério de baixo ROI para encerrar trabalho; apenas para priorização interna da ordem de execução.

Se alguma dessas respostas não puder ser escrita sem ambiguidade, o roadmap **não** está pronto para conclusão.
