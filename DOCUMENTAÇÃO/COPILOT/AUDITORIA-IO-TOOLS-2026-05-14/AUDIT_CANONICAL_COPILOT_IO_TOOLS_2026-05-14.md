# Auditoria Canônica — `src/copilot/infra` + `src/copilot/tools`

**Data:** 2026-05-14 **Base externa crítica:**
`DOCUMENTAÇÃO/COPILOT/AUDITORIA-IO-TOOLS-2026-05-14/AUDIT_EXT.md` **Escopo validado:**
`src/copilot/infra/**`, `src/copilot/tools/**` (com checagens transversais em `src/copilot/sdk/**`
quando necessário)

## Resultado executivo

- A auditoria externa é **majoritariamente correta** em direção técnica.
- Parte relevante dos itens já tinha mitigação parcial no repositório.
- Foi iniciada execução do roadmap com correções imediatas de Sprint 1 (ver
  `EXECUCAO_SPRINT1_2026-05-14.md`).

## Critério de classificação

- **Confirmado**: problema reproduzível/visível no código atual.
- **Parcial**: risco existe, mas não exatamente na forma descrita ou já mitigado em parte.
- **Não confirmado**: análise externa não bate com o estado atual.
- **Oportunidade**: melhoria arquitetural (não bug).

---

## 1) Validação item a item da auditoria externa

## 1.1 Bugs (CRITICAL/HIGH/MED)

| ID          | Status canônico                  | Observação                                                                                                    |
| ----------- | -------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| BUG-CRIT-01 | **Confirmado (corrigido)**       | `withStore` tinha serialização frágil; mutex refeito.                                                         |
| BUG-CRIT-02 | **Confirmado (corrigido junto)** | Coberto pela correção do mutex de `withStore`.                                                                |
| BUG-HIGH-01 | **Confirmado (corrigido)**       | `io-locks` agora usa contexto via `AsyncLocalStorage` para permitir reentrância segura no mesmo recurso.      |
| BUG-HIGH-02 | **Confirmado (corrigido)**       | `io-parser` ganhou lifecycle explícito do hook + `resetParserCacheForTest()` com unregister.                  |
| BUG-HIGH-03 | **Confirmado (corrigido)**       | `readTextLineChunks` sem cleanup robusto; adicionado `finally` com `rl.close()` e `stream.destroy()`.         |
| BUG-HIGH-04 | **Confirmado (corrigido)**       | `pruneMissingRows` agora filtra extensões no SQL (`json_each`) antes da materialização em memória.            |
| BUG-HIGH-05 | **Confirmado (corrigido)**       | `safeEnv` com cache TTL removido (recompute por chamada).                                                     |
| BUG-HIGH-06 | **Confirmado (corrigido)**       | `runPipeline` ganhou cleanup defensivo de stdio/processos em erro/timeout.                                    |
| BUG-MED-01  | **Confirmado (corrigido)**       | `buildSimpleTextDiff` agora consolida hunks sobrepostos/adjacentes e evita duplicação de contexto/cabeçalho.  |
| BUG-MED-02  | **Não confirmado**               | `last_accessed_ms` é atualizado por `stmtTouch`; hipótese externa superestimada.                              |
| BUG-MED-03  | **Confirmado (corrigido)**       | `web_fetch_local` agora bloqueia redirects para portas sensíveis (22/25/3306/5432/6379/8080/8443/9200/27017). |
| BUG-MED-04  | **Confirmado (corrigido)**       | `sanitizeFtsQuery` passou a descartar tokens com `< 2` chars.                                                 |

## 1.2 Segurança

| ID         | Status canônico            | Observação                                                                                                      |
| ---------- | -------------------------- | --------------------------------------------------------------------------------------------------------------- |
| SEC-GAP-01 | **Confirmado (corrigido)** | Guardas `null-byte`/path inválido estendidos em operações críticas e buscas (`io-engine` + scanner path guard). |
| SEC-GAP-02 | **Confirmado (corrigido)** | Blocklist agora normaliza comando em NFKC antes da validação.                                                   |
| SEC-GAP-03 | **Confirmado (corrigido)** | `SseReplayBuffer` passou a limitar tamanho do payload com truncamento defensivo.                                |
| SEC-GAP-04 | **Confirmado (corrigido)** | `web_search` agora limita/saneia query antes de montar URLs remotas.                                            |
| SEC-GAP-05 | **Confirmado (corrigido)** | `safeEnv` recebeu hardening adicional em `sensitiveExact` (AWS/NPM/GitHub App/Kube/Docker).                     |
| SEC-GAP-06 | **Confirmado (corrigido)** | `io-index-sqlite` passou a serializar metadata com `safeMetaJson` e byte-budget.                                |
| SEC-GAP-07 | **Oportunidade**           | Hardening TLS avançado (pinning/CT) é melhoria de defesa em profundidade.                                       |
| SEC-GAP-08 | **Parcial (mitigado)**     | `lockfile` ganhou hardening anti-symlink; risco TOCTOU residual requer abordagem `openat`.                      |
| SEC-GAP-09 | **Confirmado (corrigido)** | `request_user_input` agora saneia e limita `context` antes de compor `fullQuestion`.                            |

## 1.3 Funcionalidade / Observabilidade

| ID          | Status canônico            | Observação                                                                                |
| ----------- | -------------------------- | ----------------------------------------------------------------------------------------- |
| FUNC-GAP-01 | **Confirmado (corrigido)** | Prefetch agora propaga `AbortSignal` para `readBytes`/`readText` e snapshot subjacente.   |
| FUNC-GAP-02 | **Confirmado (corrigido)** | `io-health` agora usa safe wrappers para stats e mantém snapshot resiliente.              |
| FUNC-GAP-03 | **Confirmado (corrigido)** | `indexDirectory` agora emite `build.progress` a cada lote de 50 arquivos indexados.       |
| FUNC-GAP-04 | **Confirmado (corrigido)** | `AsyncQueue` agora suporta prioridade (alta/normal/baixa) mantendo concorrência limitada. |
| FUNC-GAP-05 | **Confirmado (corrigido)** | `EventFanout.publish` foi desacoplado via `setImmediate` para reduzir bloqueio síncrono.  |
| FUNC-GAP-06 | **Confirmado (corrigido)** | `io-cache-l2-registry` ganhou circuit breaker com cooldown progressivo.                   |
| FUNC-GAP-07 | **Confirmado (corrigido)** | `todo/store` agora saneia referências quebradas em `subtaskIds` e `parentId` na leitura.  |
| FUNC-GAP-08 | **Confirmado (corrigido)** | `io-observability` passou a coletar histogramas e `io-health` agora expõe `latency`.      |

## 1.4 Dívida técnica

| ID      | Status canônico                      | Observação                                                                                                         |
| ------- | ------------------------------------ | ------------------------------------------------------------------------------------------------------------------ |
| DEBT-01 | **Confirmado**                       | `io-engine.js` continua módulo grande/multiresponsabilidade.                                                       |
| DEBT-02 | **Confirmado (corrigido)**           | `bootstrap` migrou para `ToolGroupConfig[]` tipado, removendo pares fracos `[tools, opts]`.                        |
| DEBT-03 | **Confirmado (corrigido)**           | Comparação de fingerprint unificada em helper compartilhado (`shared/fingerprint-match`) e adotada em cache/index. |
| DEBT-04 | **Confirmado**                       | Limite estrutural de tipagem via JSDoc em handlers complexos.                                                      |
| DEBT-05 | **Confirmado (corrigido)**           | `_warmPromise` saiu da estrutura interna de scope; warm-up agora é gerido em registry dedicado.                    |
| DEBT-06 | **Parcial (melhorado)**              | `readTextLineChunks` passou a aceitar `AbortSignal` com erro explícito de cancelamento.                            |
| DEBT-07 | **Confirmado (corrigido)**           | Backoff e timeout de webhooks passaram a usar timers com `unref()`.                                                |
| DEBT-08 | **Confirmado (corrigido)**           | `normalizeWritePayload` agora retorna `Buffer` único, removendo alocação dupla de payload.                         |
| DEBT-09 | **Confirmado (corrigido)**           | Prefetch migrou de worker pool manual para `p-limit` com concorrência controlada.                                  |
| DEBT-10 | **Parcial (melhorado)**              | Além do `tail.finally`, `io-locks` agora aplica sweep periódico com `unref()` para higiene extra de `tails`.       |
| DEBT-11 | **Parcial (melhorado)**              | `module-map` passou a explicitar dependências cruzadas no resumo de `webhooks.js` (#copilot/config/core).          |
| DEBT-12 | **Parcial (melhorado)**              | Recursão de diretórios no scanner simplificada (sem segunda passada via `mapInBatches`).                           |
| DEBT-13 | **Confirmado (corrigido)**           | Testes de contrato adicionados para `readBytes`/`readText`/`writeFileAtomic` no `io-engine`.                       |
| DEBT-14 | **Confirmado (corrigido)**           | `stream-hub.broadcast` agora isola erro por cliente e remove conexões quebradas.                                   |
| DEBT-15 | **Confirmado (corrigido)**           | `io-parser` agora mantém sentinel `unavailable`, evitando tentativas repetidas.                                    |
| DEBT-16 | **Não confirmado (já centralizado)** | `todo-write-tools` e `crud-tools` consomem utilitários compartilhados de `store.js` (`now`/`sanitize`).            |
| DEBT-17 | **Confirmado (corrigido)**           | Limite de mensagem do hub passou a ser configurável via `COPILOT_HUB_MAX_MSG_CHARS`.                               |
| DEBT-18 | **Confirmado (corrigido)**           | Budget de busca agora é lazy (`getIoSearchBudget()`), evitando acoplamento ao load inicial.                        |

## 1.5 Modernização Node.js 24+

Todos os itens MOD-01..MOD-15 foram classificados como **Oportunidade** (não bugs obrigatórios).
Priorização deve seguir risco/impacto operacional e maturidade de runtime.

## 1.6 Alinhamento SDK 0.3.0

| ID         | Status canônico                            | Observação                                                                                                    |
| ---------- | ------------------------------------------ | ------------------------------------------------------------------------------------------------------------- |
| SDK-GAP-01 | **Parcial**                                | API RPC de permissions existe no repo, mas acoplamento em `permission-tools` ainda pode ser melhor integrado. |
| SDK-GAP-02 | **Parcial**                                | Tipagem por evento existe em áreas do SDK; uniformização não está completa no runtime inteiro.                |
| SDK-GAP-03 | **Parcial**                                | `approve-for-session` já aparece em fluxo terminal/SDK; uso pode ser expandido para policy tools.             |
| SDK-GAP-04 | **Parcial**                                | Opções avançadas existem no ecossistema; falta documentação operacional consolidada.                          |
| SDK-GAP-05 | **Não confirmado (já mitigado em partes)** | Há uso de `Symbol.asyncDispose` em trechos do SDK/runtime.                                                    |

## 1.7 Propostas arquiteturais (ARCH-01..ARCH-06)

Classificadas como **direção válida** para roadmap evolutivo. Priorização recomendada após
estabilização da Sprint 1+2 (bugs e segurança).

---

## 2) Situação ideal alvo (Target State)

1. **Confiabilidade de concorrência**: locks/mutexes reentrantes e previsíveis.
2. **Segurança por padrão**: saneamento rigoroso de input/path/env/query + limites de payload.
3. **Observabilidade operacional**: progressos intermediários e latência por operação com snapshots
   resilientes.
4. **I/O modular**: engine quebrada em submódulos com contratos estáveis.
5. **SDK alignment completo**: políticas de permission e sessão sincronizadas com RPC nativo.

---

## 3) Estado atual da execução

- Sprint 1 concluída com validação técnica em cache (typecheck/lint/test unit).
- Sprint 2 avançada com novo lote concluído (segurança, observabilidade, fila/prioridade e
  resiliência operacional).
- Coerência documental reforçada: roadmap atualizado com matriz explícita Atual ↔ Ideal para
  orientar a transformação ampla.
- Drift de defaults ilimitados reduzido: file-tools e web-search agora operam com defaults
  altos/finitos e paginação por padrão.
- Transformação ampla iniciada no eixo de modularização: `io-prefetch` foi desacoplado de leituras
  via `io-engine` e migrou para portas baixas `io/fs/*` com priming canônico de cache L1.
- Qualidade de patch/diff elevada: `io/patch/text-diff` ganhou merge de hunks próximos com testes de
  regressão para evitar duplicação de contexto.
- Modularização incremental de busca aplicada: `searchText` e `searchWorkspaceSymbols` foram
  extraídas de `io-engine` para `infra/io/search/text-search.js`, mantendo assinatura pública
  estável e gates verdes.
- Nova extração da F1.2 aplicada: mutações com lock (`delete/remove/copy/move/patch`) migradas para
  `infra/io/fs/locked-mutations.js`, com `io-engine` atuando como facade de compatibilidade.
- Nova extração da F1.2 aplicada: escritas lockadas (`write/create-or-replace/append/mkdir`)
  migradas para `infra/io/fs/locked-writes.js`, reduzindo o `io-engine` sem quebrar contratos
  públicos.
- Nova extração da F1.2 aplicada: `diffText` movido para `infra/io/patch/text-diff-service.js`,
  mantendo assinatura pública do `io-engine` via delegação.
- Nova extração da F1.2 aplicada: bloco de leitura/metadata
  (`readBytes/readText/readLines/readTextChunks/statPath`) movido para
  `infra/io/fs/read-services.js`, com `io-engine` mantendo API estável por delegação.
- Hardening de consistência aplicado: validação de path (`assertValidIoFilePath`) centralizada em
  `infra/policy/path-resource.js` e adotada nos módulos de facade/leitura/escrita/mutação.
- Redução adicional da facade aplicada: `io-engine.diffText` passou para alias direto de
  `infra/io/patch/text-diff-service`, removendo wrapper residual no engine.
- Boundary barrel-first ampliado: `sdk/session/session-fs.js` migrou imports diretos de
  `io-engine`/`io-scanner` para `#copilot/infra/public/io`.
- Facade pública de IO reduzida: `infra/public/io.js` agora reexporta leitura/escrita de `io/fs`,
  busca de `io/search` e diff de `io/patch` diretamente, diminuindo dependência pública do legado em
  `io-engine`.
- Boundary interno de `tools/` reforçado: autoimport cíclico do barrel raiz `#copilot/tools` foi
  identificado em módulos internos, revertido para `tools/infra/*` e coberto por governança ESLint
  anti-regressão.
- Avaliação de gates concluída: `test:copilot` já compartilha o mesmo runner/log compacto de
  `test:copilot:unit`, mas ainda falha por suites ampliadas fora do corte imediato de IO/tools;
  `test:copilot:unit` permanece gate canônico de mudança local até nova estabilização transversal.
