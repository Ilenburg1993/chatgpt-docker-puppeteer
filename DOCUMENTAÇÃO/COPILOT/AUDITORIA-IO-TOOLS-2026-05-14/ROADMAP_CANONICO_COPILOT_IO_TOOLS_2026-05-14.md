# Roadmap Canônico de Execução — `src/copilot/infra` + `src/copilot/tools`

## Princípios

- Entrega por **faixas**, **fases** e **subfases** com gate técnico explícito.
- Cada subfase fecha com validação em cache:
  - `typecheck strict` (escopo `src/copilot`)
  - `lint` (escopo `src/copilot`)
  - `test unit` (escopo `src/copilot`)

---

## Faixa 0 — Estabilização imediata (P0)

### Fase 0.1 — Concurrency + segurança básica de I/O

#### Subfase 0.1.1
- Corrigir mutex de `todo/store` (`withStore`) para serialização canônica.
- Corrigir cleanup de stream/readline em `read-chunks`.
- Endurecer `runPipeline` para erros/timeout (destroy de stdio + stop coordenado).

#### Subfase 0.1.2
- Endurecer `safeEnv` (sem TTL cache + regex ampliada).
- Normalizar Unicode no blocklist shell.
- Filtrar tokens curtos no FTS query sanitization.
- Validar `filePath` com `null-byte` em APIs críticas do `io-engine`.

**Gate 0.1:** typecheck/lint/test unit de `src/copilot`.

### Fase 0.2 — Segurança de superfície de entrada

#### Subfase 0.2.1
- Limite de payload em `SseReplayBuffer`.
- Limite de tamanho para query em `web_search`.
- Sanitização/limite de `context` em `request_user_input`.

#### Subfase 0.2.2
- Segurança de metadata JSON no index (`safeMeta`, byte-budget, fallback para circular).
- Revisão `lockfile` para TOCTOU/symlink safety.

**Gate 0.2:** typecheck/lint/test unit + smoke de SSE/web/hook tools.

---

## Faixa 1 — Robustez operacional (P1)

### Fase 1.1 — Observabilidade resiliente

#### Subfase 1.1.1
- `io-health` com safe wrappers (`index/parser/cache`) para snapshot sempre retornável.
- Eventos de progresso em `io-index-sqlite` durante `indexDirectory`.

#### Subfase 1.1.2
- Histograma de latência I/O e exposição em health snapshot.
- `stream-hub.broadcast` defensivo (erro de cliente não interrompe fanout).

**Gate 1.1:** validação + benchmark curto de regressão.

### Fase 1.2 — Backpressure e prioridade

#### Subfase 1.2.1
- `AsyncQueue` com prioridade (alta/média/baixa).
- `EventFanout` com emissão desacoplada (não bloqueante).

#### Subfase 1.2.2
- Circuit breaker em `io-cache-l2-registry` para falha recorrente de init.

**Gate 1.2:** validação + teste de carga local controlada.

---

## Faixa 2 — Refatoração estrutural (P2)

### Fase 2.1 — Decomposição do `io-engine`

#### Subfase 2.1.1
- Extrair `read/write/mutate/search/meta` mantendo API pública estável.

#### Subfase 2.1.2
- Remover duplicações de fingerprint/hash e consolidar contrato compartilhado.

**Gate 2.1:** sem regressão funcional + contratos de retorno testados.

### Fase 2.2 — `io-index` writer/reader split

#### Subfase 2.2.1
- Separar escrita e consulta em módulos distintos.

#### Subfase 2.2.2
- Ajustar registry e health para nova topologia.

**Gate 2.2:** cobertura de busca/símbolos/indexação.

---

## Faixa 3 — Evolução Node 24+/SDK (P3)

### Fase 3.1 — Runtime modern patterns

#### Subfase 3.1.1
- `AsyncLocalStorage` para contexto de trace/io-lock reentrância.
- Timeouts com `AbortSignal.timeout` quando aplicável.

#### Subfase 3.1.2
- Explorar adoção progressiva de APIs modernas (`timerify`, streams, etc.) com benchmark.

### Fase 3.2 — SDK alignment final

#### Subfase 3.2.1
- Integrar permission mode com RPC de permissions por sessão.

#### Subfase 3.2.2
- Consolidar documentação de opções de sessão (incluindo `copilotHome` quando aplicável).

**Gate 3.x:** validação full + checklist de compatibilidade.

---

## Sequenciamento recomendado

1. Concluir Faixa 0 inteira.
2. Executar Faixa 1 com foco em observabilidade e resiliência.
3. Só então entrar nas refatorações profundas de Faixa 2.
4. Faixa 3 como modernização orientada por métrica/benefício.
