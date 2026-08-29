# WORKSPACE MCP — Tools, capacidades, autonomia estruturada, gaps, upgrades e roadmap

**Data da auditoria:** 2026-08-28
**Escopo:** `src/copilot`, com foco principal na superfície MCP efetivamente exposta ao agente, seus owners, contratos, runtime, telemetria e capacidades ausentes.
**Estado observado na auditoria-base:** `main@f97b2474a`, limpa e sincronizada com `origin/main` no início da auditoria original.
**Superfície observada na auditoria-base:** 84 tools anunciadas; `capabilitiesVersion=73`; `semanticContractVersion=2.10.0`; `workflowPolicyVersion=1.3.0`.
**Wire protocol observado:** MCP `2026-07-28`.
**Runtime observado:** Node.js `v24.15.0`.
**Natureza do documento:** nasceu como auditoria/roadmap sem mutação de código; a partir da rodada de implementação de 2026-08-28 tornou-se **documento canônico vivo**, com checkboxes e registros atualizados somente após investigação e evidência de execução. O estado-base acima permanece preservado para comparação histórica.

---

## 1. Propósito e relação com as auditorias anteriores

Este documento não substitui nem repete a auditoria suplementar de racionalização da tool surface:

- `src/copilot/docs/WORKSPACE_MCP_TOOL_SURFACE_AUDITORIA_SUPLEMENTAR_RACIONALIZACAO_DESTINO_131_TOOLS_2026-08-27.md`

A auditoria de 2026-08-27 respondeu principalmente à pergunta:

> **quais entry points devem sobreviver e como reduzir uma superfície de 131 tools sem destruir capacidades?**

A presente auditoria parte do resultado dessa racionalização — 84 tools atuais, nenhuma marcada como deprecated — e responde a uma pergunta diferente e mais profunda:

> **quais capacidades reais ainda faltam para que o agente possa investigar, auditar, transformar, validar, recuperar e compreender o repositório com maior liberdade, precisão semântica, segurança, observabilidade e eficiência de contexto?**

O foco, portanto, deixa de ser contagem de tools e passa a ser **densidade de capacidade útil**.

Não se parte do pressuposto de que “mais tools” é melhor. Uma tool só se justifica quando pelo menos uma destas condições for satisfeita:

1. elimina uso recorrente do shell causado por ausência de uma capacidade estruturada;
2. comprime server-side uma tarefa que hoje exige muitos round trips;
3. adiciona semântica que o shell/text search não fornece;
4. melhora segurança por reduzir a autoridade necessária;
5. melhora recuperação, provenance, observabilidade ou determinismo;
6. permite auditorias exaustivas sem inflar contexto;
7. torna invariantes verificáveis em vez de depender de convenção textual;
8. reduz classes concretas de erro ou ambiguidade.

A tese central deste documento é:

> **A superfície atual não é subpotente por falta de poder bruto — `terminal_exec` já fornece poder bruto elevado. Ela é subpotente em autonomia estruturada. O objetivo futuro deve ser reduzir a distância entre “é possível fazer” e “é possível fazer de forma tipada, bounded, semanticamente correta, observável, reversível e com least authority”.**

---

## 2. Método de investigação

A investigação combinou cinco fontes de evidência.

### 2.1. Surface e contratos MCP

Foram inspecionados:

- catálogo atual de 84 tools;
- grupos funcionais e risk classes;
- descritores de `tools/list`;
- schemas e limites;
- owners compostos e granulares;
- política de `outputSchema`;
- tools experimentais;
- autorização e `operationContext`;
- lifecycle de stateful handles;
- separação entre read, bounded write e destructive operations.

### 2.2. Código dos principais owners

Foram auditados diretamente, entre outros:

- `src/copilot/mcp/tools/repo-read.js`;
- `src/copilot/mcp/tools/repo-write.js`;
- `src/copilot/mcp/tools/repo-index.js`;
- `src/copilot/mcp/tools/repo-working-set.js`;
- `src/copilot/mcp/tools/terminal.js`;
- `src/copilot/mcp/process/terminal/runtime.js`;
- `src/copilot/mcp/tools/git-read.js`;
- `src/copilot/mcp/tools/git-write.js`;
- `src/copilot/mcp/tools/jobs.js`;
- owners de validation jobs;
- `src/copilot/mcp/tools/meta.js`;
- `src/copilot/mcp/tools/maintenance.js`;
- owners de Cloudflare, connection, restart, network posture, latency, Apps SDK, Company Knowledge, autonomy runner, Copilot sessions e LLM-B live.

A inspeção foi orientada por invariantes e fluxos, não por tamanho de arquivo.

### 2.3. Telemetria real

Foram utilizados:

- `mcp_runtime_health`;
- `mcp_smoke_workspace`;
- `mcp_tool_payload_audit`;
- `mcp_round_trip_analytics`;
- index status e runtime diagnostics.

A telemetria de sete dias mostrou, entre outros pontos:

- 13.174 tool starts no corpus agregado;
- 4.738 starts de `terminal_exec`, cerca de **36%** do total;
- forte uso de `repo_read_file`, `repo_search_text`, `repo_apply_patch_batch`, `repo_bulk_inspect` e `repo_apply_patch`;
- `repo_read_file_chunks` com respostas muito grandes em poucos calls;
- `repo_tree` com duplicação textual significativa;
- lineage W3C efetivamente conhecida em zero transições observadas;
- corpus histórico misturando gerações antigas e tools já removidas.

Esses números são usados como **evidência direcional**, não como verdade absoluta, porque a analytics atual mistura gerações de surface.

### 2.4. Experimentos durante a própria auditoria

A auditoria encontrou limitações enquanto tentava se auditar. Isso é especialmente valioso porque transforma hipóteses em evidência operacional.

Exemplos:

- `repo_read_file_chunks` com `chunkLines=1000` sobre um documento de 1.880 linhas devolveu o arquivo inteiro dividido em chunks na mesma resposta, produzindo cerca de **353 KiB** em um call;
- no baseline auditado, `repo_file_outline` não aceitava batch, enquanto `repo_read_file` e `repo_search_text` aceitavam; F2.5 corrigiu essa assimetria sem criar novo owner físico de IO/parsing;
- `repo_tree` repete `absolutePath` em cada entrada e não oferece cursor de continuação;
- para certas perguntas históricas Git — blame, merge-base, pickaxe, show de commit/blob, histórico de arquivo — não existe owner estruturado equivalente e seria necessário usar terminal;
- `repo_find_symbol_usages` foi verificado no código e é uma regex textual sobre arquivos, não resolução semântica de referências.

### 2.5. Documentação oficial externa

A reflexão foi confrontada com documentação oficial atual, em especial:

- MCP Tools specification 2026-07-28;
- release/roadmap MCP 2026-07-28 e roadmap de agosto de 2026;
- MCP Tasks extension;
- TypeScript MCP SDK migration/support para 2026-07-28;
- Node.js 24 `fs` e native test runner;
- Git `status`, `blame`, `log`, `merge-base`, `worktree`;
- npm `audit`, `audit signatures`, `sbom`, `explain`, `find-dupes`;
- TypeScript Language Service / Compiler API.

As referências completas estão ao final.

---

## 3. Como interpretar os achados

Este documento diferencia quatro categorias que não devem ser confundidas.

### 3.1. Bug confirmado

Há evidência de que o comportamento atual viola seu próprio contrato ou pode devolver estado incorreto.

Exemplo: `git_branch_info` pode devolver `success:true` sem verificar explicitamente falha dos subprocessos que obtêm branch e HEAD.

### 3.2. Gap de capacidade

O comportamento atual pode estar correto, mas não fornece uma operação necessária ou de alto valor.

Exemplo: ausência de blame/pickaxe/merge-base estruturados.

### 3.3. Gap de contrato/semântica

A operação existe, mas seu nome, erro, lifecycle ou output pode induzir interpretação incorreta.

Exemplo: `repo_find_symbol_usages` parece semanticamente forte, mas é textual.

### 3.4. Hipótese de otimização

Existe sinal de custo ou fragilidade, porém a transformação só deve ocorrer após medição focalizada.

Exemplo: um smoke de `repo_symbol_search` levou ~783 ms. Uma amostra não justifica reescrever o mecanismo.

Essa classificação evita transformar toda observação em “bug”.

---

# PARTE I — ESTADO ATUAL

## 4. Perfil quantitativo da superfície atual

### 4.1. Contagem por grupo

| Grupo | Tools |
|---|---:|
| Read | 15 |
| Index | 5 |
| Write | 9 |
| Git | 8 |
| Validation | 6 |
| Runtime | 37 |
| Connection | 3 |
| Copilot SDK | 1 |
| **Total** | **84** |

### 4.2. Perfil de autoridade

- read-only: **51**;
- bounded write: **25**;
- destructive: **8**;
- open-world network authority: **9**;
- deprecated: **0**;
- experimentais: **3**:
  - `repo_symbol_search`;
  - `repo_file_outline`;
  - `repo_index_search`.

### 4.3. Tamanho da surface

No snapshot auditado:

- `tools/list`: ~**128.506 bytes**;
- orçamento máximo local: 409.600 bytes;
- média por descritor: ~1.528 bytes;
- p95: ~3.833 bytes;
- maiores descritores:
  - `terminal_exec`: ~9.464 B;
  - `terminal_session_read`: ~8.894 B;
  - `terminal_session_control`: ~8.143 B.

Conclusão: **há headroom suficiente para upgrades seletivos de schema**, mas não há justificativa para expandir indiscriminadamente todos os descriptors.

### 4.4. Output schemas

- 10 tools têm `outputSchema` específico;
- 74 são intencionalmente untyped no output pelo policy atual para evitar schemas genéricos de baixo valor e reduzir wire bytes.

Isso é coerente com a racionalização anterior, mas não significa que 10/84 seja necessariamente o estado ótimo. O próximo passo deve ser **schema seletivo baseado em valor**, não “100% coverage” mecânico.

---

## 5. Inventário completo das 84 tools

A tabela abaixo descreve a função efetiva da surface atual e o principal diagnóstico associado. Não é uma recomendação de manter um entry point para sempre; é o inventário da capacidade observada nesta auditoria.

## 5.1. Read — 15 tools

| Tool | Função atual | Avaliação / direção futura |
|---|---|---|
| `repo_status` | root, branch, HEAD e status curto do workspace | útil e barato; manter projeção compacta |
| `repo_tree` | árvore estrutural flat/path-keyset bounded por depth/entries/bytes | corrigido nesta execução: continuation real, include/exclude, workspace-relative-only, symlink sem traversal e enumeração física centralizada em `infra/filesystem/read` |
| `repo_root_redaction_status` | estado agregado de redaction/protected paths | bom least-authority diagnostic; manter |
| `repo_read_file` | leitura UTF-8 por linha, hash, single/batch | forte; adicionar bounded-output uniforme no single mode |
| `repo_bulk_inspect` | batch heterogêneo read/search/stat | boa compressão de round trips; extensão deve ser conservadora para não virar DSL genérica |
| `repo_read_file_chunks` | leitura segmentada de arquivo grande | semântica atual não é paginação real; pode devolver arquivo inteiro; redesign prioritário |
| `repo_diff_files` | diff entre dois arquivos do workspace | útil, mas não substitui diff Git por revisions |
| `repo_quarantine_status` | listar/inspecionar quarentena reversível | recovery owner correto; manter separado da mutação |
| `repo_search_text` | busca textual/regex filesystem-oriented, cursor e batch | forte para completude textual; precisa byte budget single e coexistir com search indexada |
| `repo_find_symbol_usages` | regex textual por palavra em JS/TS | nome semanticamente forte demais; não é references engine; corrigir contrato ou substituir |
| `repo_symbol_search` | busca de declarações/símbolos pelo índice | experimental; medir latência/precision antes de estabilizar |
| `repo_file_outline` | parser-based symbols/imports/exports/outline, single/batch e continuation revision-bound | F2.5 corrigiu batch + truncation sem cursor; parsing/windowing permanecem em `infra/indexing/parser`, com MCP apenas compondo schema/batch/framing |
| `repo_working_set` | contexto reutilizável bounded com open/find/refresh/status/close | conceito bom; não é inventário exaustivo; lifecycle/ownership devem ficar explícitos |
| `search` | Company Knowledge search, id/title/url | forma requerida por integração; output schema forte; nome genérico é constraint de compatibilidade |
| `fetch` | Company Knowledge fetch pelo id | idem; bounded e read-only |

## 5.2. Index — 5 tools

| Tool | Função atual | Avaliação / direção futura |
|---|---|---|
| `repo_index_status` | disponibilidade/freshness do índice local compartilhado | forte; ampliar evidence de journal gaps/recovery |
| `repo_index_build` | build/reconcile do índice | mutação derivada segura; medir full vs incremental |
| `repo_index_search` | FTS5 index search com cursor/filtros | experimental; definir semântica de completeness vs filesystem search |
| `repo_find_imports` | localizar imports/dynamic imports por module source | base valiosa para graph owner |
| `repo_find_orphan_imports` | detectar imports locais/#copilot sem target existente | diagnóstico útil; manter e integrar a graph/cycle analysis |

## 5.3. Write — 9 tools

| Tool | Função atual | Avaliação / direção futura |
|---|---|---|
| `repo_apply_file_batch` | batch ordenado create/move/quarantine/executable/remove | seguro, mas **não transacional cross-file**; documentar e complementar com change session |
| `repo_apply_patch_batch` | patches exact-string agrupados por target | excelente para bounded edits; target atomic, não batch atomic |
| `repo_write_file` | substituição integral com hash precondition | forte; bom optimistic concurrency |
| `repo_create_file` | criação UTF-8 segura | forte; manter |
| `repo_apply_patch` | exact-string patch controlado | forte e previsível; preferível a AST magic para pequenas mudanças |
| `repo_move_file` | move/rename de um arquivo | útil, mas não atualiza semanticamente imports; futuro refactor owner deve ser distinto |
| `repo_quarantine_file` | remoção reversível para área MCP | design de recovery superior a delete quando possível |
| `repo_restore_quarantined_file` | restauração por quarantineId | bom owner explícito de recovery |
| `repo_remove_file` | delete confirmado | manter como operação destrutiva deliberada; não torná-la implicitamente reversível |

## 5.4. Git — 8 tools

| Tool | Função atual | Avaliação / direção futura |
|---|---|---|
| `git_status` | `git status --short --branch` | migrar para structured porcelain v2 + NUL parsing |
| `git_diff` | diff working tree/staged, opcional path | muito raso para auditoria histórica; adicionar ranges/stat/name-status |
| `git_log` | commits recentes `--oneline`, limitados | muito raso; adicionar filtros/ranges/path/pickaxe de forma estruturada |
| `git_branch_info` | branch/upstream/HEAD | bug false-green possível em falha de branch/HEAD; corrigir primeiro |
| `git_publish_changes` | stage + commit + opcional push de paths explícitos | owner composto de alto valor; source barriers e recovery corretos |
| `git_stage` | stage paths explícitos e bounded | least-authority forte; manter |
| `git_commit` | commit do staged index com preconditions | forte; manter |
| `git_push` | push do branch corrente ao upstream configurado | deliberadamente sem force/refspec/remotes arbitrários; manter restraint |

## 5.5. Validation — 6 tools

| Tool | Função atual | Avaliação / direção futura |
|---|---|---|
| `mcp_run_safe_validation_suite` | suites amplas fixas de escalonamento | bom gate; evitar uso rotineiro |
| `run_copilot_validator` | validators allowlisted, focused/batch | forte; concorrência efetiva 1; expandir inteligência, não simplesmente paralelismo |
| `mcp_validation_dashboard` | dashboard/list/latest de jobs | boa projeção compacta |
| `job_get_summary` | status compacto de job | bom padrão summary-first |
| `job_get_output` | tail bounded de log | bom padrão failure-details-on-demand |
| `job_cancel` | cancela job attached com PID verificado | segurança correta; integrar owner/lifecycle de handles |

## 5.6. Runtime — 37 tools

| Tool | Função atual | Avaliação / direção futura |
|---|---|---|
| `delegate_to_repo_autonomy_runner` | missões allowlisted locais | desenho correto: composição específica sem arbitrary shell |
| `mcp_devcontainer_network_posture_audit` | diagnóstico read-only de DNS/network artifacts | manter especializado |
| `mcp_devcontainer_network_control_plane_refresh` | refresh passivo fixo | autoridade bem limitada |
| `mcp_apps_sdk_readiness` | readiness via markers/runtime metadata parcial | útil; marker scan lexical é frágil a longo prazo |
| `mcp_cloudflare_edge_backup_create` | backup JSON local antes de edge mutation | bom; precisa par de recovery estruturado |
| `mcp_cloudflare_edge_backups_list` | lista backups | bom; agregar validation/retention eventualmente |
| `mcp_cloudflare_edge_policy_apply` | dry-run/apply guarded edge policy/passthrough | design de confirmação/backup forte |
| `mcp_cloudflare_edge_snapshot` | projeções read-only de Cloudflare | owner composto coerente |
| `mcp_cloudflare_metrics_snapshot` | métricas locais / transport benchmark view | forte diagnostic owner |
| `mcp_host_block_diagnostics` | classifica block do host e sugere lower-friction replacements | útil enquanto prompts/host policy forem parte prática do sistema |
| `mcp_cleanup_ai_artifacts` | limpeza bounded de artifacts | manter com dry-run/retention evidence |
| `mcp_dependency_outdated` | audit de updates de deps root | estreito; não cobre supply-chain/security/dependency why |
| `mcp_dependency_upgrade` | upgrade root deps para latest | monolítico; precisa seleção/policy |
| `mcp_maintenance_apply_safe_fixes` | safe maintenance fixes | bom owner composto se continuar estritamente allowlisted |
| `terminal_exec` | shell/arbitrary command sob identidade do MCP | escape hatch poderoso; não ampliar por princípio; reduzir dependência causada por gaps estruturados |
| `terminal_session_control` | write/eof/resize/signal/close/forget em sessões | separar de read é correto; precisa owner binding/lifetime |
| `terminal_session_read` | read/status/list/capabilities + event-driven wait | bom; falta pattern/exit predicate, tags e lifecycle explícito |
| `project_doctor` | runtime/workspace/scripts básicos | barato; alguma sobreposição, mas sem evidência para remoção imediata |
| `mcp_client_latency_evidence` | registra/sumariza TTFT sanitizado do cliente | sem prompts/completions/URLs/tokens; desenho de privacy bom |
| `mcp_latency_attribution` | atribuição cross-layer sem fingir visibilidade do client/model plane | desenho epistemicamente correto |
| `mcp_latency_dashboard` | SLO/latency dashboard local | forte; manter current-generation semantics |
| `mcp_latency_pulse` | pulso no-I/O para medir gaps externos | útil para separar handler de orchestrator/client delay |
| `mcp_openai_endpoint_latency` | DNS/TCP/TLS/TTFB de endpoints fixos | autoridade limitada e sem arbitrary URL; bom |
| `mcp_round_trip_analytics` | analytics de starts/transitions/result bytes | gap de generation filtering; prioridade alta para validade analítica |
| `mcp_runtime_health` | runtime health, uptime, metrics | fundamental; adicionar process-generation attestation |
| `mcp_smoke_workspace` | smoke read-only end-to-end | forte gate barato |
| `mcp_tool_payload_audit` | mede `tools/list` e descriptors | fundamental para governar crescimento futuro |
| `mcp_tunnel_status` | estado de tunnel/connect URL/fallback | owner operacional útil |
| `mcp_connector_smoke_refresh` | refresh do connector smoke | manter enquanto lifecycle externo exigir evidência persistida |
| `mcp_post_restart_readiness` | readiness pós-restart | bom workflow diagnostic |
| `mcp_reload_status` | lê último controlled reload | recovery/observability correta |
| `mcp_reload_schedule` | restart allowlisted com source barrier/fingerprint | excelente padrão para operações de lifecycle perigosas |
| `llmb_live_readiness` | readiness / persisted runs | forte separação read-only |
| `llmb_live_test_cancel` | cancel de detached run com PID/harness verification | forte safety pattern |
| `llmb_live_test_plan` | plano allowlisted e quota-impact | justificadamente separado: informa custo/authority antes de execução |
| `llmb_live_test_run` | execução allowlisted, confirmação para consumo real | design de quota confirmation correto |
| `mcp_capabilities_summary` | summary/session/status da própria surface | essencial, mas full detail pode ser volumoso; manter compact-first |

## 5.7. Connection — 3 tools

| Tool | Função atual | Avaliação / direção futura |
|---|---|---|
| `mcp_connection_readiness` | readiness/profile/url/auth local, sem external probes | bom owner least-authority |
| `mcp_oauth_issuer_diagnostics` | well-known OAuth probe fixo/guarded | separação de network authority correta |
| `mcp_oauth_friction_audit` | auditoria de scope/tool prompt friction | útil para operar em host real; manter baseado em contratos atuais |

## 5.8. Copilot SDK — 1 tool

| Tool | Função atual | Avaliação / direção futura |
|---|---|---|
| `copilot_sessions` | list/get metadata de sessões ativas SDK/LLM-B | inspeção process-global administrativa; sessões podem nascer fora do MCP e não recebem ownership fictício; `callerScope=admin` |

---

# PARTE II — ACHADOS PROFUNDOS

## 6. Matriz de bugs, gaps e hipóteses

| ID | Severidade | Categoria | Achado | Consequência | Direção recomendada |
|---|---|---|---|---|---|
| **F-01** | **Alta — corrigida nesta execução** | contract/scale | baseline de `repo_read_file_chunks` não impunha max chunks/bytes por resposta | “chunk” podia significar particionar e devolver tudo; pressão de contexto | paginação real implementada com `maxChunks`, content budget, cursor determinístico e erro explícito para item maior que o budget |
| **F-02** | **Alta — corrigida nesta execução** | scale/capability/architecture | baseline de `repo_tree` não tinha cursor, byte budget ou include/exclude e projetava `absolutePath` | auditorias grandes podiam truncar sem continuação e desperdiçar tokens; enumeração física também ficava acoplada ao scanner geral | `repo_tree` agora é flat/path-keyset, workspace-relative-only, bounded por entries+bytes e usa walker read-only canônico em `infra/filesystem/read`; inventory e tree compartilham a mesma autoridade física sem duplicar traversal/policy |
| **F-03** | **Alta — corrigida nesta execução** | Git correctness/error semantics | baseline permitia `git_branch_info` false-green em falha de branch/HEAD e os Git reads não possuíam retryability uniforme | estado Git incorreto podia ser apresentado como sucesso e falhas de leitura não orientavam retry seguro | branch/HEAD agora são obrigatórios, upstream continua opcional; todos os Git reads usam `failureClass=git-read`, `retryability=inspect-before-retry`, `recoveryRequired=false` e evidência bounded do subprocesso falho |
| **F-04** | **Crítica/Alta condicional — corrigida para a superfície MCP atual** | security architecture | auditoria-base encontrou handles stateful resolvidos por id sem principal binding visível; a implementação introduziu `McpPrincipalIdentity` auth-derived e vinculou terminal sessions, working sets, validation jobs e LLM-B detached runs; `copilot_sessions` foi classificado honestamente como inspeção process-global administrativa porque suas sessões podem nascer fora do MCP | conhecimento de ID não é mais autoridade nos handles criados pelo MCP; state global sem provenance MCP exige admin em vez de pseudo-ownership | preservar principal-bound state nos handles MCP e exigir provenance real antes de qualquer futura redução do boundary administrativo de `copilot_sessions` |
| **F-05** | **Alta — corrigida nesta execução** | lifecycle | baseline não descrevia lifetime/TTL consistentemente; terminal closed state e working sets podiam persistir sem política temporal explícita | recursos órfãos e semântica de expiração opaca | terminal agora mantém running até exit/close e closed state por 30 min; working sets expiram após 1 h idle; detached LLM-B e validator history receberam retention própria |
| **F-06** | **Média — corrigida para a superfície MCP auditada nesta execução** | error semantics | baseline misturava erro acionável de chamada com resultado de domínio em terminal e alguns action owners | modelo/host podia interpretar precondition/action failure como tool success e aplicar retry inadequado | terminal contract violations, dependency maintenance failures e guarded Cloudflare real-apply blocks usam `isError:true` + failure taxonomy; zero-result, dry-run/diagnostic unhealthy state e item failures de batch permanecem resultados de domínio por desenho |
| **F-07** | **Alta — corrigida nesta execução** | provenance | baseline expunha `runtimeSourceGeneration`, mas não havia um certificate unificado que vinculasse process epoch/source proof à superfície registrada | era possível saber o binding do source ou o descriptor fingerprint separadamente, mas não obter uma identidade única da geração servida | `runtime/source-generation` agora projeta certificate v1 com epoch/process/Node + source proof + frozen tool-surface fingerprint; health expõe fingerprint compacto e certificate completo em details, sem confundir worktree corrente com boot identity |
| **F-08** | Média | resilience | index journal registrou gap, recuperado por full reconcile | recovery existe, mas recorrência pode ocultar fragilidade | métricas, testes de gap/replay e history |
| **F-09** | Média, hipótese | performance | `repo_symbol_search` teve ~783 ms em uma amostra | experimental pode ter cold-path caro | benchmark multi-sample antes de otimizar |
| **F-10** | Alta | semantic correctness | `repo_find_symbol_usages` é regex textual, não semantic references | falso positivo/negativo em refactors | renomear/explicitar textual + Language Service references |
| **F-11** | Alta | capability | não há inventário exaustivo cursor-based de repo | mass audit recorre a shell/find/rg | criar `repo_inventory`/manifest |
| **F-12** | **Alta — corrigida nesta execução** | capability/architecture | baseline não tinha dependency graph/cycles/reverse reachability/change impact e havia resolução de módulos duplicada entre prefetch infra e orphan-import MCP | arquitetura exigia buscas manuais e qualquer graph novo corria risco de institucionalizar resolução/IO duplicados | resolução local foi centralizada em `infra/indexing/module-resolution`; `repo_graph` e `repo_change_impact` usam exclusivamente nós/import edges já persistidos no índice + algoritmos puros em `infra/indexing/graph`, sem reparse nem traversal adicional |
| **F-13** | Alta | capability | Git read não cobre blame/show/merge-base/pickaxe/ranges | regressions/history demand terminal | structured Git inspect surface |
| **F-14** | Alta | change safety | batches são per-file/ordered, não transação multi-arquivo | refactor grande pode ficar parcialmente aplicado após falha tardia | isolated change session + promotion journal |
| **F-15** | Média | capability | dependency tooling: outdated/latest upgrade, sem audit/provenance/SBOM/explain/dupes | incidentes supply-chain exigem shell | `mcp_dependency_audit` e upgrade seletivo |
| **F-16** | Média | capability | validation sem coverage/flaky/repeat/random/test-impact | diagnóstico de testes é raso | test intelligence feature-gated |
| **F-17** | Média | terminal UX/lifecycle | sem wait-for-pattern/exit predicate/tags/TTL/head-tail | polling e sessões difíceis de gerenciar | event predicates + tags + retention |
| **F-18** | Média | contract | somente 10 output schemas específicos | parsing/typing perde informação em tools de alto valor | piloto seletivo medido contra descriptor budget |
| **F-19** | Alta | authority coherence | repo policy protege paths, mas arbitrary terminal pode alcançar o que OS permitir | boundary de segurança pode ser inconsistente entre owners | explicitar terminal como high-authority; criar admin ops estreitas quando legítimas |
| **F-20** | Média | observability | nenhuma transição W3C lineage-bound na janela observada | causalidade entre calls é inferida temporalmente | propagar trace quando recebido; workflow ids server-side |
| **F-21** | Alta/Média | analytics validity | analytics mistura generations/tools antigas | decisões de otimização podem mirar superfície extinta | filter por generation/capabilitiesVersion |
| **F-22** | **Média — corrigida nesta execução** | composition/architecture | baseline de `repo_file_outline` não aceitava batch e seu bounded window podia retornar `truncated=true` sem continuation | architectural audits pagavam round trips e truncation estrutural não era retomável | `windowFileContext` em infra agora possui cursor revision/profile-bound; `repo_file_outline` aceita single/batch e o framing batch comum foi extraído para um owner MCP reutilizado por read/search/bulk/outline |
| **F-23** | Média/Alta | recovery | Cloudflare cria backups antes de mutation, mas não expõe restore estruturado | backup não fecha sozinho o circuito operacional | recovery plan/diff/apply guardado |
| **F-24** | Baixa/Média | robustness | Apps SDK readiness usa marker scan lexical relevante | renames/source rearrangements podem gerar false readiness | derivar de runtime registry/metadata |
| **F-25** | Média | interoperability | `search`/`fetch` são nomes genéricos e podem colidir em agregadores | composição multi-server pode gerar ambiguidade | tratar como constraint da Company Knowledge; não renomear sem verificar contrato externo |
| **F-26** | Média | bounded output | single `repo_read_file`/`repo_search_text` não têm contrato uniforme de max result bytes | outputs extremos dependem de limites indiretos | shared `BoundedResult` |
| **F-27** | Média/Baixa | diagnostics | one-shot terminal retém tail, não combina head/tail | primeira causa de erro pode sumir em output longo | output projection configurável |
| **F-28** | Média, hipótese | concurrency | validator concurrency efetiva fixa em 1 | pode subutilizar recursos, mas aumentar cegamente pode piorar contenção | benchmark por classe de workload |
| **F-29** | **Média — corrigida nesta execução** | lifecycle | working sets usavam limite global 8, eviction global do oldest e nenhum TTL; agora há quota 8 por principal + hard cap global 32 + TTL idle de 1 h | cross-principal eviction e crescimento temporal indefinido foram eliminados; creation/status publicam lifecycle e expiry | preservar quota local, hard cap global fail-closed e close-scope-before-remove na expiração |
| **F-30** | Média | backup lifecycle | backup edge não possui validation/restore lifecycle completo | artifact pode envelhecer sem status de restaurabilidade | schema version/fingerprint/recovery compatibility |
| **F-31** | Baixa | surface overlap | `project_doctor` sobrepõe parcialmente diagnostics | pequena redundância | medir uso; não remover sem benefício demonstrado |
| **F-32** | **Crítica — corrigida nesta execução** | write integrity | `repo_apply_patch`/target V3 com uma única operação materializava `expectedHash`, mas `buildIndependentPatchAttemptOptions()` não o propagava a `patchTextLocked`; o hash ficava apenas em `advisoryLimits` | uma precondição otimista stale podia ser ignorada e a mutação aplicada | propagar `expectedHash` no caminho independente e manter regressão `EEXPECTEDHASH` fail-closed |
| **F-33** | **Alta — corrigida nesta execução** | security/privacy | validator capacity global podia expor `activeJobId`/validator de outro principal por dashboard/erro `ERR_VALIDATOR_CAPACITY_BUSY` | existência e metadados de um job estrangeiro poderiam vazar mesmo após owner-binding do handle | manter capacidade física global, mas expor detalhes somente do caller; foreign busy vira estado genérico `busyByOtherPrincipal` |
| **F-34** | **Alta — corrigida nesta execução** | lifecycle/storage integrity | cleanup de validator jobs aplicava retenção a arquivos `.json`/`.log` individualmente, não ao job UUID | manifest e log do mesmo job podiam ser separados pela retenção, quebrando o handle persistido e a evidência de diagnóstico | retention unit passou a ser job; seleção nunca divide o grupo e remove log antes do manifest |
| **F-35** | **Alta — corrigida nesta execução** | lifecycle/resilience | detached LLM-B recebia `timeoutMs`, mas o manifest não persistia deadline; startup reaper só cobria summary-ready/process-alive e não havia retention owner para `artifacts/terminal-live` | após restart, um run verified sem summary podia sobreviver sem deadline recuperável e state/artifacts encerrados cresciam sem limite | novos manifests persistem timeout/deadline; startup maintenance revalida PID, reaps timeout/completion e retém state encerrado por 7 dias preservando os 20 mais recentes |
| **F-36** | **Alta — corrigida nesta execução** | architecture/process IO | supervisão neutra de child-process e execução Git buffered estavam fisicamente sob `mcp/`, enquanto search mantinha outra implementação buffered própria em `infra/indexing/search` | owners de domínio podiam acumular `spawn`, buffers, timeout, cancel e process-tree semantics duplicados; novas Git capabilities ampliariam a duplicação | supervisão neutra foi movida sem shim para `infra/process/supervision`; `infra/process/execution` passou a ser o executor buffered comum de Git e search; o streaming search permanece especializado apenas por decoding incremental/line callbacks/early-stop e seu corpus de equivalência está verde |
| **F-37** | **Alta — corrigida nesta execução** | TypeScript/toolchain governance | `package.json`, `check-typescript-baseline` e documentação exigiam explicitamente uma ilha `typescript -> @typescript/typescript6`, embora a decisão corrente determine TS **7.0+ exclusivo** | rebuild podia reinstalar TS6 por desenho e manter o lint type-aware preso a peer ranges legados | raiz consolidada em `typescript@7.0.2` único; `@typescript/native`, `@typescript/typescript6`, `typescript-eslint` e `tsc6` aposentados; ESLint ficou syntax/architecture-only; Oxlint + `oxlint-tsgolint@7` assumiram três regras type-aware com policy equivalente; baseline agora rejeita qualquer compiler <7 e peer masking |
| **F-38** | **Alta — corrigida nesta execução** | dependency/install integrity | `.npmrc` mantinha `legacy-peer-deps=true`; após retirar a justificativa TS6, resolução estrita revelou que o lock nem sequer continha o peer obrigatório `hono@^4` de `@hono/node-server@1.19.14` | `npm ci` podia parecer saudável apenas porque peers eram ignorados; futuros conflitos TS7 ou runtime poderiam ser silenciosamente mascarados | lock regenerado com `hono@4.13.5`; `.npmrc` agora fixa `legacy-peer-deps=false`; baseline falha se o masking reaparecer; `npm ci --dry-run --ignore-scripts` e `npm ls --all --omit=optional` fecham com exit 0 |

---

## 7. Achado estrutural nº 1: poder bruto não é autonomia

O indicador mais importante da janela de sete dias é o peso de `terminal_exec`: aproximadamente 36% dos starts agregados.

A conclusão errada seria:

> “o terminal é um problema e deve ser restringido”.

A conclusão mais precisa é:

> “o terminal é simultaneamente um escape hatch legítimo e um sensor de capacidades estruturadas ausentes”.

Existem operações que devem continuar no terminal:

- comandos raros;
- experimentos exploratórios;
- ferramentas externas não integradas;
- debugging de baixo nível;
- tarefas cuja surface dedicada não se justifica.

Mas existem outras classes em que o uso do shell é um sintoma de gap:

- `git blame` / `git log -S/-G` / `merge-base`;
- inventário exaustivo de milhares de arquivos;
- ciclos/import graph;
- references semânticas;
- dependency explain/SBOM/audit signatures;
- test discovery/coverage/repeat;
- isolated refactor worktree lifecycle.

Portanto, a KPI futura não deve ser “reduzir chamadas de terminal” globalmente. Deve ser:

> **reduzir a taxa de terminal escape em classes de workflow para as quais passou a existir owner estruturado equivalente e superior.**

---

## 8. Achado estrutural nº 2: bounded context precisa virar invariant transversal

O MCP local já possui muitos limites prudentes, mas eles não formam ainda um contrato transversal uniforme.

### 8.1. Problema de `repo_read_file_chunks`

O nome sugere paginação, porém o contrato atual aceita um range e o divide em chunks, retornando todos os chunks selecionados. Um arquivo grande pode, portanto, virar uma única resposta enorme.

Isso conflita com a função esperada de uma tool de navegação de large files.

### 8.2. Problema de `repo_tree`

- `maxEntries <= 2000`;
- sem cursor;
- sem byte budget;
- sem include/exclude glob;
- `absolutePath` + relative `path` em cada row;
- truncation não fornece continuação.

Isso serve para exploração humana bounded, mas não para auditoria exaustiva.

### 8.3. Estado-alvo: `BoundedResult<T>`

Sem impor uma implementação concreta, operações de cardinalidade alta deveriam convergir conceitualmente para algo como:

```text
{
  items: T[],
  returnedCount: number,
  totalKnown: boolean,
  totalCount?: number,
  resultBytes: number,
  truncated: boolean,
  nextCursor?: string,
  projection: string,
  sourceGeneration?: string
}
```

Propriedades desejadas:

1. cursor opaco e determinístico;
2. byte budget além de item count;
3. projection compacta por padrão;
4. ausência de campos redundantes de alto custo;
5. total apenas quando barato/confiável;
6. resultado reprodutível sob snapshot/generation conhecido;
7. cursor inválido/expirado como erro acionável.

Esse contrato deveria orientar `tree`, inventory, search, logs, graph queries, test discovery e outras operações extensas.

---

## 9. Achado estrutural nº 3: text search e semantic code intelligence são problemas distintos

`repo_find_symbol_usages` foi inspecionado até sua implementação efetiva. O owner:

1. escapa o nome do símbolo;
2. cria regex com word boundary;
3. pesquisa arquivos JS/TS por texto.

Isso é útil para **lexical occurrence discovery**. Não é suficiente para:

- shadowed variables;
- imports re-exportados;
- aliasing;
- property names homônimos;
- comentários/strings;
- overloads;
- referências por binding;
- definitions/implementations;
- rename seguro.

### 9.1. Princípio

Não se deve “melhorar a regex” até ela parecer um Language Service. São abstrações diferentes.

### 9.2. Estado-alvo proposto

Manter duas capacidades distintas:

**Textual discovery**

- rápida;
- ampla;
- filesystem-oriented;
- adequada para strings, configs e aproximations.

**Semantic navigation**

- JS/TS binding-aware;
- path + position ou symbol identity;
- definition/references/implementation;
- long-lived incremental TypeScript program;
- fallback explícito quando arquivo/projeto não é semanticamente coberto.

O TypeScript Language Service expõe precisamente primitives como definitions, references e implementations e é apropriado para um processo long-lived incremental.

### 9.3. Tool conceitual

Em vez de várias tools pequenas imediatamente, testar inicialmente um owner coeso:

`repo_code_navigation`

Ações possíveis:

- `definition`;
- `references`;
- `implementations`;
- `type-definition`;
- `document-symbols`;
- `project-symbols`.

Input preferido para referências semanticamente inequívocas:

- `path`;
- `line`/`column` ou offset;
- filtros/include declaration;
- byte/result budget.

Não usar apenas `symbol: "foo"` quando a identidade do binding é ambígua.

---

## 10. Achado estrutural nº 4: falta um modelo de auditoria exaustiva

`repo_working_set` é uma boa abstração, mas sua função é **context selection bounded**. O cap de 500 arquivos e a seleção default de 80 são intencionais e corretos para contexto.

Uma auditoria massiva tem outro problema:

> “preciso provar que examinei todo o conjunto relevante, mas não quero despejar todo o conjunto no contexto do modelo”.

Isso pede uma abstração diferente.

## 10.1. `repo_inventory`

Função: obter uma enumeração exaustiva e cursor-based sem ler conteúdo.

Projeções possíveis:

- path;
- kind;
- size;
- extension/language;
- tracked/untracked/ignored, quando source=git;
- hash opcional;
- mtime opcional;
- aggregate by extension/directory/size band.

Sources possíveis:

- `git`: `git ls-files -z` / tracked-aware;
- `filesystem`: Node native glob/walk;
- `index`: snapshot da geração indexada.

Importante: o source faz parte da semântica. “Todos os arquivos” não significa a mesma coisa em Git, filesystem e index.

## 10.2. `repo_audit_session`

Uma abstração futura, de maior nível, poderia manter evidence server-side:

- `open` — define scope/snapshot;
- `run` — executa analyzers allowlisted;
- `findings` — pagina findings;
- `aggregate` — retorna contagens/compliance;
- `refresh` — delta sobre mudanças;
- `close`.

Isso não deve virar um generic DAG executor. O ganho está em **evidence compression e completeness accounting**, não em criar uma linguagem de programação dentro do MCP.

Exemplo de audit session:

- scope = `src/copilot/mcp`;
- inventory = 100% dos `.js` relevantes;
- analyzers = imports, cycles, public-boundary, forbidden deep imports, TODO markers, export reachability;
- output ao modelo = 30 findings + aggregates + cursor, não 2.000 arquivos.

---

## 11. Achado estrutural nº 5: falta graph intelligence

O índice já conhece imports e symbols. A surface, porém, expõe principalmente consultas locais:

- find imports por module source;
- orphan imports;
- symbol search.

**Estado após F4:** essas relações foram promovidas a um graph owner: facts vêm do SQLite index existente, resolução local é canônica em `infra/indexing/module-resolution`, e os algoritmos ficam em `infra/indexing/graph`; o MCP apenas compõe scope/pagination/projection.

## 11.1. `repo_graph`

Ações propostas:

- `dependencies(path)`;
- `dependents(path)`;
- `cycles(scope)`;
- `reachability(from,to)`;
- `strongly-connected-components(scope)`;
- `public-surface(scope)`;
- `boundary-violations(policy)` — apenas se policy formal existir;
- `summary(scope)`.

O cálculo de SCC, degree e reverse reachability deve ocorrer server-side.

### 11.2. Por que isso amplia liberdade real

Hoje, para responder “se movermos este módulo, o que quebra?”, o agente precisa combinar:

- search textual;
- find imports;
- outlines;
- leitura de barrels;
- Git diff;
- guesses sobre tests.

Com um graph owner, pode obter primeiro uma prova estrutural compacta e só então ler os arquivos de maior centralidade.

---

## 12. Achado estrutural nº 6: change impact precisa ser first-class

Uma transformação segura não depende apenas de “arquivos alterados”. Depende da closure de dependência.

Proposta:

`repo_change_impact`

Inputs alternativos:

- `paths[]`;
- `gitBase` + `gitHead`;
- staged/working-tree changes.

Outputs possíveis:

- direct dependents;
- transitive dependents, bounded/ranked;
- exported API touched;
- candidate tests;
- configuration/build owners atingidos;
- risk summary;
- evidence generation.

Esse owner não deve automaticamente rodar testes. Ele deve **informar o validator planner**.

Isso cria a sequência racional:

1. identificar mudança;
2. calcular impacto;
3. selecionar validação proporcional;
4. executar focused checks;
5. escalar apenas se necessário.

---

## 13. Achado estrutural nº 7: Git read é muito menos poderoso que Git write

Git write é uma das partes mais disciplinadas da superfície:

- explicit paths;
- sem pathspec magic arbitrário;
- preconditions;
- dry-run/confirmation onde necessário;
- no force;
- no arbitrary refspec/remotes;
- source barrier no publish composto.

Git read, por outro lado, oferece apenas uma pequena fração da informação que Git já mantém.

### 13.1. Bug confirmado: `git_branch_info`

A implementação dispara leituras em paralelo e trata upstream opcional, mas não transforma falhas de branch/HEAD em failure de tool antes de compor `success:true`.

Isso deve ser corrigido antes de qualquer expansão.

### 13.2. `git_status` machine interface

A documentação oficial de Git fornece `--porcelain=v2` e `-z` precisamente para consumers programáticos.

Estado-alvo:

- structured rows;
- branch HEAD/upstream/ahead/behind;
- ordinary/unmerged/untracked records;
- NUL-safe names;
- sem parse frágil de output human-oriented.

### 13.3. Git forensics ausente

Operações de alto valor:

- `show` commit/tree/blob/path-at-revision;
- `blame` com porcelain;
- `merge-base`;
- `changed-files base..head`;
- `log` por path;
- pickaxe `-S` / regex diff search `-G`;
- `-L` function/line history quando aplicável;
- refs/worktrees read-only;
- diff `--stat` / `--name-status` / range.

### 13.4. Surface sugerida

Não é necessário criar dez tools. Duas alternativas coerentes:

**A. ampliar `git_diff`/`git_log` e criar `git_inspect`**; ou

**B. owner único `git_read` com actions**, se isso não degradar descriptor/approval semantics.

Preferência inicial: preservar owners atuais e introduzir **um `git_inspect` read-only** para forensics que não cabem semanticamente em diff/log.

Nunca aceitar revision strings sem validação. Um read owner ainda deve rejeitar options injection e revision/path ambiguities.

---

## 14. Achado estrutural nº 8: batches não são transações — e não devem fingir ser

`repo_apply_patch_batch` e `repo_apply_file_batch` são bons mecanismos de throughput e preflight.

Mas:

- cada target/file publication é individual;
- `global-preflight` impede começar quando preview detecta falha;
- depois de iniciado, uma falha tardia pode deixar subset aplicado;
- o filesystem não fornece uma transação ACID cross-file nativa.

Seria um erro arquitetural renomear esse mecanismo para “transaction” e encobrir a realidade.

## 14.1. Estado-alvo: isolated change session

Para refactors grandes, propõe-se explorar:

`repo_change_session`

Ações:

- `open`;
- `status`;
- `read/diff`;
- `validate`;
- `promote-plan`;
- `promote`;
- `discard/close`.

### 14.2. Backend inicial recomendado: detached Git worktree

Git documenta worktrees detached como mecanismo adequado para experimentação/teste sem perturbar o working tree principal.

Modelo:

1. criar worktree em diretório MCP gerenciado;
2. fixar `baseHead` exato;
3. aplicar transformações cumulativas ali;
4. rodar validators allowlisted naquele workspace isolado;
5. produzir diff;
6. promover ao workspace principal apenas se source/hash preconditions ainda valerem;
7. manter journal durável de promotion;
8. cleanup TTL/prune.

### 14.3. O que isso não promete

- não promete atomicidade filesystem cross-file;
- não resolve automaticamente mudanças concorrentes;
- não deve dar arbitrary network/shell extra;
- não deve ocultar conflitos;
- não deve promover se HEAD/source fingerprint divergiu sem replan.

O ganho é isolamento + validação cumulativa + recovery, não magia transacional.

### 14.4. Worktree vs overlay VFS

**Worktree primeiro** porque:

- toolchain real enxerga arquivos reais;
- Node/npm/tsc/tests funcionam naturalmente;
- Git fornece diff/status;
- menor risco de divergência entre VFS e filesystem.

Overlay VFS pode ser explorado depois para previews ultrarrápidos, mas é uma abstração mais perigosa para validação completa.

---

## 15. Achado estrutural nº 9: state handles precisam de uma política unificada

A specification MCP 2026-07-28 é explícita: stateful handles são names/identifiers, não capabilities; em servidores autenticados, autorização deve ser revalidada em cada uso, e lifetime deve ser descrito na criação.

O `operationContext` atual já carrega `authInfo`. Porém, na implementação inspecionada:

- terminal sessions usam `sessions.get(sessionId)`;
- working sets usam map por `workingSetId`;
- validation jobs são lidos/cancelados por `jobId`;
- não foi encontrada utilização de `authInfo` nesses owners para principal binding.

### 15.1. Severidade corretamente qualificada

Se o processo for **formalmente single-principal e impossibilitado de servir principals distintos**, a explorabilidade é reduzida.

Se o mesmo runtime puder atender múltiplos principals autenticados, o gap é de alta severidade.

Portanto, antes de “corrigir” é necessário tornar explícita uma destas arquiteturas:

**A. single-principal process invariant**

- runtime nasce vinculado a um principal/grant;
- requests de outro principal são recusados;
- handles podem ser process-scoped.

**B. multi-principal registry**

- cada handle registra owner principal;
- cada read/control/cancel revalida principal;
- list filtra por principal;
- expiry e cleanup por owner.

### 15.2. Central state registry

Em vez de cada owner inventar lifecycle, considerar um registry comum com:

- opaque ID;
- type;
- principal key;
- createdAt;
- lastAccessAt;
- expiresAt / retention policy;
- process generation;
- optional persisted manifest;
- cleanup callback;
- visibility policy.

A principal key **não deve ser o bearer token bruto**. Deve derivar de identidade/grant estável permitida pelo `AuthInfo`/issuer/client semantics disponível.

Handles a inventariar:

- terminal sessions;
- working sets;
- validator jobs;
- detached LLM-B run IDs;
- Copilot SDK session IDs;
- reload request IDs, quando controláveis;
- futuros audit/change sessions.

---

## 16. Achado estrutural nº 10: error semantics devem ser semanticamente honestas

A specification MCP recomenda tool execution errors (`isError:true`) para erros acionáveis de input, business rule e execution em que o modelo pode corrigir o próximo call.

No terminal atual, foram observadas paths em que erros como:

- `ERR_TERMINAL_EXEC_SHAPE`;
- command required;
- inactive fields;
- sessionId required;

são representados como `success:false` dentro de um resultado formalmente bem-sucedido.

Isso tem custo real:

- host/model observability distingue pior failure;
- analytics classifica como domain failure em vez de tool error;
- retry policies ficam menos precisas.

### 16.1. Envelope recomendado

Sem exigir que todo output seja idêntico, failures poderiam convergir para:

```text
{
  code,
  message,
  retryability: "none" | "same-call" | "after-state-change",
  nextAction?,
  recoveryRecipe?,
  details?
}
```

E `isError:true` quando o call falhou semanticamente.

Uma busca que encontra zero rows, por outro lado, continua sendo sucesso vazio.

---

## 17. Achado estrutural nº 11: runtime provenance está abaixo do padrão do reload

`mcp_reload_schedule` já contém um desenho sofisticado:

- source barrier manifest;
- expected source fingerprint;
- allowlisted restart profile;
- explicit confirmation;
- audit event.

Entretanto, o runtime observado reportou source generation `manual-unbound`.

Há uma assimetria:

> o mecanismo de restart sabe exigir provenance, mas o processo já rodando nem sempre consegue provar com a mesma força a que source generation pertence.

### 17.1. Generation certificate

No boot do MCP, persistir/expor um certificate com, no mínimo:

- process start timestamp;
- PID;
- Git HEAD no start;
- dirty state/fingerprint no start;
- source manifest fingerprint;
- descriptor fingerprint;
- capabilitiesVersion;
- semanticContractVersion;
- Node version;
- config profile fingerprint sanitizado;
- restart request id/manifest, se aplicável.

`mcp_runtime_health` deve então responder:

> “este processo é a geração X, construída/iniciada a partir do source fingerprint Y”.

Isso reduz ambiguidades durante reconexões e auditorias.

---

## 18. Achado estrutural nº 12: index recovery existe, mas journal gaps devem ser observáveis

O índice atual estava fresh e saudável no fim da investigação:

- milhares de files/symbols/imports/chunks;
- zero stale/failed;
- full reconciliation recuperou corretamente um gap de journal.

O ponto não é “o índice está quebrado”. O ponto é:

> `gapDetected=true` ocorreu e a recuperação ampla funcionou; agora é necessário saber se isso é raro, normal ou recorrente.

Melhorias:

- counter histórico de journal gaps;
- cause/recovery duration;
- paths lost/recovered quando conhecidos;
- explicit `reconcileReason`;
- fault-injection tests para gap/restart/truncated journal;
- repair action idempotente.

### 18.1. Polling vs watcher

Há polling de coherence com muitos empty polls e custo CPU baixo porém não zero.

Node 24 oferece `fs.watch`, mas a própria documentação alerta para comportamentos problemáticos em Docker/networked/virtual filesystems.

Portanto:

- **não** migrar para watcher-only;
- explorar watcher como fast path;
- manter reconciliation/poll adaptativo como safety net;
- medir miss rate e latency before/after.

---

## 19. Achado estrutural nº 13: validation precisa de inteligência, não simplesmente de mais CPU

Os validators atuais são deliberadamente allowlisted e a concorrência efetiva é 1. Isso reduz contenção e torna failure handling simples.

Não há evidência suficiente para “aumentar para 4/8” como otimização genérica.

### 19.1. Gaps concretos

Faltam first-class:

- test discovery;
- mapping changes → candidate tests;
- coverage;
- repeat/flakiness;
- randomized order/seed;
- comparison de duration/history por test;
- validator planning baseado em impact.

### 19.2. Node.js 24 native test runner

A documentação Node 24 atual suporta:

- glob patterns;
- coverage include/exclude/reporter/summary;
- randomization/seed em versões mais novas da linha 24.

A randomização foi adicionada em **Node 24.16.0**; o runtime observado é **24.15.0**.

Logo, qualquer roadmap deve usar:

- feature detection; ou
- gate `node >= 24.16`;
- nunca assumir que a feature já existe neste runtime.

Coverage continua experimental na documentação Node 24 e deve ser tratada como tal.

### 19.3. Concorrência adaptativa

Depois de mapear workload classes:

- typecheck: CPU/memory heavy;
- focused unit: geralmente menor;
- lint: CPU/filesystem;
- network contracts: external waits;

pode-se testar um scheduler class-aware. Mas a mudança só deve ocorrer se houver redução de wall-clock sem regressão de memory pressure, flakiness ou handler responsiveness.

---

## 20. Achado estrutural nº 14: MCP Tasks é interessante, mas não substitui jobs locais automaticamente

A Tasks extension atual oferece handles duráveis para trabalhos long-running, mas é uma **extension negociada**.

O princípio correto é:

> se o request/client anunciar `io.modelcontextprotocol/tasks`, uma future validation/live-run surface pode oferecer interoperability; caso contrário, preservar o job model local.

Não se deve:

- tornar o servidor dependente de Tasks para funcionar no ChatGPT atual;
- remover `job_get_summary`/`job_cancel` prematuramente;
- assumir suporte de UI sem capability negotiation.

A arquitetura mais robusta é adaptar o mesmo underlying job owner a duas projeções de protocolo quando suportado.

---

## 21. Achado estrutural nº 15: terminal sessions são poderosas, mas lifecycle/observability podem melhorar

O terminal atual possui bons mecanismos:

- single/batch;
- persistent sessions;
- output bounded;
- cursor sequence;
- event-driven `waitFor=output-or-exit`;
- read e control separados;
- safe ambient environment sem credenciais parentais.

### 21.1. Gaps

- sem TTL/idle TTL explícito;
- closed sessions são podadas principalmente sob pressure;
- running sessions podem persistir indefinidamente;
- sem mission/tag;
- sem wait-for-pattern;
- sem wait-for-exit-code/predicate;
- output one-shot é essencialmente tail-oriented;
- list não é principal-scoped pelo owner inspecionado.

### 21.2. Upgrades

**Session metadata**

- `tag`/`purpose` sanitized;
- createdAt/lastActivityAt/expiresAt;
- generation/owner principal;
- cwd;
- command fingerprint/preview sanitizado.

**Wait predicates**

- `output-or-exit` atual;
- `pattern-or-exit` com regex bounded;
- optional expected exit codes;
- max wait continua bounded.

**Output projection**

- `tail` default;
- `head`;
- `head-tail` com orçamento dividido.

**Cleanup**

- idle TTL;
- closed retention TTL;
- scoped cleanup por tag/owner;
- nunca matar PID sem identity verification.

---

## 22. Achado estrutural nº 16: dependency maintenance é estreita demais

A surface atual responde bem a:

> “quais root dependencies estão outdated?”

E consegue:

> “upgrade root dependencies para latest”.

Mas faltam perguntas fundamentais:

- por que este pacote transitivo existe?;
- qual chain o introduziu?;
- há vulnerabilidades conhecidas?;
- signatures/provenance do registry são válidas?;
- qual SBOM do projeto?;
- há duplicatas dedupáveis?;
- quais updates são apenas patch/minor/within-range?;

### 22.1. `mcp_dependency_audit`

Ações allowlisted sugeridas:

- `vulnerabilities` → `npm audit` structured;
- `signatures` → `npm audit signatures`;
- `sbom` → `npm sbom` SPDX/CycloneDX;
- `explain` → `npm explain <pkg>` com package name validated;
- `duplicates` → `npm find-dupes`;
- `tree-summary` → projection compacta da dependency tree.

Sem arbitrary npm subcommand.

### 22.2. Upgrade seletivo

Evoluir `mcp_dependency_upgrade` com:

- `packages[]`;
- policy: `within-range | patch | minor | latest`;
- `dependencyKind` filter;
- preview/diff;
- lockfile strategy;
- scripts disabled por default quando tecnicamente possível;
- explicit confirmation para instalação que execute scripts;
- focused validation profile pós-upgrade.

---

## 23. Achado estrutural nº 17: Cloudflare backup sem recovery ainda é um circuito incompleto

O desenho atual de apply é bom:

1. plan/diff;
2. confirmation;
3. mandatory backup imediatamente antes da mutation;
4. apply;
5. post-change gates.

Porém, não há owner público que restaure de um backup.

### 23.1. O que não fazer

Não criar:

> `restoreRawJsonBackup(backupId)`

Um snapshot antigo pode conter:

- resources que mudaram;
- ids expirados;
- regras que já não existem;
- schema antigo;
- estado parcialmente incompatível.

### 23.2. Recovery owner correto

`mcp_cloudflare_edge_recovery`

Ações:

- `inspect-backup`;
- `recovery-plan`;
- `recovery-diff`;
- `apply` com `confirmRecovery=true`;
- `post-recovery-gates`.

O plan deve classificar resources:

- restorable;
- already-equal;
- missing;
- incompatible;
- manual-review-required.

Backup precisa de schema version + resource fingerprints + createdAt + environment identity.

---

## 24. Achado estrutural nº 18: analytics precisa conhecer a generation que está analisando

A janela de sete dias inclui tools que já não pertencem à surface atual e múltiplos cohorts/generations.

Isso é aceitável para histórico, mas perigoso para decisões do tipo:

> “qual tool atual é mais problemática?”

### 24.1. Upgrade

Adicionar filtro/projection conceitual:

- `generation=current`;
- `capabilitiesVersion=73`;
- explicit generation id;
- `all` para historical.

E retornar:

- rows included/excluded por generation;
- unknown-generation count;
- descriptor/source generation fingerprint;
- warning quando pure cohort não puder ser obtido.

### 24.2. KPIs melhores

Além de tool call count:

- result bytes por successful task;
- continuation rate;
- structured-vs-terminal escape por task class;
- retries por error code;
- stale-context patch rate;
- current-generation only failure rate;
- handler time vs incoming external gap;
- schema-related validation failures;
- handle expiry/access-denied events;
- audit/change-session adoption;
- semantic navigation hit rate.

---

## 25. Achado estrutural nº 19: W3C tracing deve ser usado quando houver, não inventado

A current MCP direction incorpora W3C Trace Context em `_meta`, mas a telemetria local não encontrou lineage-bound transitions na janela observada.

Isso pode significar simplesmente que o client/host não está enviando trace context útil.

A regra epistemicamente correta é:

1. preservar/propagar W3C trace metadata quando recebido;
2. nunca inferir trace-id a partir de timing;
3. usar `workflowId` interno apenas para chamadas compostas que o servidor realmente controla;
4. marcar transitions temporais inferidas como inferidas;
5. expor `lineageAvailability` na analytics.

Não estabelecer KPI “100% W3C lineage” enquanto o upstream não fornecer o dado.

---

## 26. Achado estrutural nº 20: protected-path policy e terminal são dois níveis de autoridade

Repo tools bloqueiam protected paths. Isso é uma boa política local.

`terminal_exec`, porém, é arbitrary shell sob o usuário do processo. Se o sistema operacional permitir, o shell pode acessar áreas que as repo tools recusam.

Isso não é necessariamente um bug: terminal pode ser deliberadamente uma high-authority capability.

O problema ocorre se a documentação/security model fingir que a proteção de repo tools é uma fronteira global do processo.

### 26.1. Estado-alvo

- documentar explicitamente a diferença de authority;
- manter protected path deny nas ferramentas normais;
- para mudanças legítimas frequentes em um protected domain, criar **admin owner estreito** com schema/preconditions/audit;
- não “resolver” autorizando `repo_write_file` genericamente em secrets/config sensível;
- não criar shell wrappers que apenas escondam a mesma autoridade ampla.

---

# PARTE III — CENÁRIOS DE AUDITORIA E LIMITAÇÕES REAIS

## 27. Cenário A — auditoria arquitetural massiva de todo `src/copilot`

### Pergunta

“Quero provar quais módulos importam quais, detectar ciclos, avaliar violations de public boundaries, identificar hubs e dead zones e ler apenas os arquivos decisivos.”

### Hoje

- `repo_tree`: bounded/truncável;
- `repo_find_imports`: query-oriented;
- `repo_file_outline`: após F2.5, single ou batch bounded, com paginação estrutural revision-bound;
- `repo_working_set`: intentionally sampled/bounded;
- shell/rg/find podem preencher as lacunas;
- **baseline histórico:** graph closure precisava ser reconstruída pelo modelo ou scripts ad hoc; após F4, `repo_graph` e `repo_change_impact` eliminam esse round trip para dependências de módulo.

### Estado-alvo

1. `repo_inventory` exaustivo;
2. `repo_graph summary/cycles`;
3. server-side SCC/degree ranking;
4. `repo_audit_session` mantém evidence;
5. modelo recebe aggregates + top findings;
6. `repo_bulk_inspect` lê apenas hubs/violations.

Resultado: mais completude **com menos contexto**.

---

## 28. Cenário B — rename de símbolo central

### Hoje

- textual usage regex;
- symbol search declarações;
- manual inspection;
- patch em múltiplos arquivos;
- focused validation.

Risco: homônimos, shadowing e false usages.

### Estado-alvo

1. `repo_code_navigation references` binding-aware;
2. preview de affected references;
3. futuro `repo_refactor rename-symbol` usa Language Service edit plan;
4. applies em isolated change session;
5. typecheck/test impact;
6. promotion com source preconditions.

---

## 29. Cenário C — investigar quando um bug entrou

### Hoje

Precisa terminal para operações como blame/pickaxe/show mais ricas.

### Estado-alvo

- structured status;
- merge-base;
- changed-files;
- `git_inspect blame`;
- `git_log` com `-S/-G` bounded;
- `git_inspect show`;
- leitura do arquivo naquela revision sem alterar working tree.

O modelo recebe dados parseados, não precisa interpretar output terminal frágil.

---

## 30. Cenário D — refactor de 30 arquivos

### Hoje

- hashes/preconditions protegem cada file;
- patch batch reduz round trips;
- global preflight ajuda;
- uma falha tardia ainda pode deixar subset aplicado;
- validators rodam no working tree real.

### Estado-alvo

- detached change worktree;
- cumulative edits isolados;
- validation no sandbox;
- promotion diff;
- durable promotion journal;
- conflict detection se source mudou;
- cleanup explícito.

---

## 31. Cenário E — supply-chain incident

### Pergunta

“Este pacote vulnerável entra por quem? O artifact possui provenance? Qual SBOM? Há duplicata evitável?”

### Hoje

Terminal/npm manual.

### Estado-alvo

`mcp_dependency_audit` com outputs estruturados para:

- audit;
- signatures;
- sbom;
- explain;
- duplicates.

---

## 32. Cenário F — flaky tests

### Hoje

- run focused test;
- repetir manualmente;
- sem seed/random order first-class;
- sem history por test.

### Estado-alvo

- repeat count bounded;
- seed quando runtime suportar;
- record pass/fail/duration distribution;
- coverage optional;
- detect order dependence;
- store compact evidence.

---

## 33. Cenário G — servidor dev longo / processo interativo

### Hoje

Persistent terminal + repeated reads.

### Estado-alvo

- tagged session;
- wait for “ready” pattern ou exit;
- idle TTL;
- read delta cursor;
- cleanup por tag;
- owner-principal check.

---

## 34. Cenário H — “o MCP reiniciou mesmo com o código novo?”

### Hoje

Há reload source barrier, health e file samples, mas a generation ativa apareceu `manual-unbound`.

### Estado-alvo

- generation certificate criado no boot;
- descriptor fingerprint + source fingerprint;
- health informa exatamente generation;
- connection/restart diagnostics correlacionam requestId → process generation.

---

## 35. Cenário I — rollback Cloudflare

### Hoje

Há snapshot/backup e apply guarded, mas restore não é first-class.

### Estado-alvo

- inspect backup;
- compute current-vs-backup resource diff;
- plan apenas recursos restauráveis;
- confirm recovery;
- post-change gates.

---

# PARTE IV — ARQUITETURA-ALVO DAS CAPACIDADES

## 36. Princípios arquiteturais

### P1. Native-first, mas não native-only

Usar Node/Git/npm/TypeScript primitives diretamente quando oferecem semântica madura. Introduzir dependência apenas quando resolver um problema que a plataforma não resolve adequadamente.

### P2. Least authority por operação

Uma capacidade estruturada não deve herdar `terminal_exec` authority apenas por conveniência.

### P3. Exhaustive server-side, bounded client-side

O servidor pode examinar milhares de itens; o modelo não precisa receber milhares de itens.

### P4. Semântica explícita

Text search não deve ser chamada de semantic references. Preflight não deve ser chamado de transaction. Backup não deve ser chamado de rollback.

### P5. Handles são nomes, não capabilities

Auth + owner + lifetime em todo lifecycle.

### P6. Evidence antes de mutation

Plan/diff/precondition/impact antes de ações cross-cutting.

### P7. Recovery é parte da feature

Se uma operação cria long-lived state ou faz mutation arriscada, seu recovery lifecycle deve ser projetado junto.

### P8. Outputs são parte da performance

O custo não termina quando o handler retorna. Bytes enviados ao modelo são memória/context pressure e podem aumentar latência global.

### P9. Composição específica, não DSL universal

Composite tools devem codificar workflows recorrentes e invariantes fortes. Evitar um “execute arbitrary graph of tools” genérico.

### P10. Medir antes de otimizar

Especialmente em index, concurrency, cache, TypeScript service e fs watchers.

---

## 37. Famílias de novas capacidades propostas

### 37.1. P0/P1 — Core inspection

**`repo_inventory`**
Exhaustive cursor-based inventory; alto benefício e risco baixo.

**Upgrade `repo_tree`**
Cursor/byte budget/compact projection ou delegação ao inventory.

**Upgrade `repo_read_file_chunks`**
Pagina uma bounded window de chunks, não retorna todo o selection implicitamente.

**Batch `repo_file_outline` — implementado em F2.5**
Reusa `runBoundedOperationBatch` da infra e um único framing MCP compartilhado; não duplica executor, IO ou parser.

### 37.2. P1/P2 — Semantic intelligence

**`repo_code_navigation`**
Definitions/references/implementations via TypeScript Language Service.

**`repo_graph`**
Dependencies/dependents/cycles/SCC/reachability.

**`repo_change_impact`**
Paths ou Git range → reverse dependency/test candidates/risk.

### 37.3. P1/P2 — Git forensics

**`git_inspect`**
Blame/show/merge-base/changed-files/worktree read views.

**Upgrade `git_status`**
Porcelain v2 `-z` structured.

**Upgrade `git_log`/`git_diff`**
Ranges, path filters, stat/name-status, pickaxe bounded.

### 37.4. P2 — Isolated changes

**`repo_change_session`**
Worktree-backed edit/validate/promote lifecycle.

### 37.5. P1 — State lifecycle

**Internal principal-bound handle registry**
Não precisa necessariamente ser uma public tool; deve ser infrastructure shared.

### 37.6. P2 — Test intelligence

**`repo_test_discovery`** ou projection em validator owner
Descobre tests de forma nativa.

**`repo_test_impact`** ou projection de `repo_change_impact`
Relaciona source changes a tests candidatos.

**Validator extensions**
Coverage/repeat/seed feature-gated.

### 37.7. P2 — Dependency intelligence

**`mcp_dependency_audit`**
Vulnerabilities/signatures/SBOM/explain/duplicates.

**Upgrade `mcp_dependency_upgrade`**
Targeted packages/policy.

### 37.8. P2/P3 — Recovery

**`mcp_cloudflare_edge_recovery`**
Plan/diff/apply-from-backup com compatibility checks.

### 37.9. P2/P3 — Audit evidence

**`repo_audit_session`**
Somente depois de inventory/graph/semantic primitives estabilizarem.

---

## 38. Output schema: estratégia seletiva

A specification MCP atual reforça valor de `outputSchema` para:

- validation;
- typing;
- deterministic parsing;
- interoperabilidade.

Mas adicionar schemas gigantes a 74 tools de uma vez iria:

- crescer `tools/list`;
- aumentar model context fixo;
- duplicar estruturas genéricas;
- criar manutenção sem benefício proporcional.

### 38.1. Prioridade para piloto

Schemas compactos em:

1. `git_status` estruturado;
2. `repo_inventory`;
3. `repo_graph` summary;
4. `repo_change_impact`;
5. state handle creation/status;
6. `mcp_dependency_audit`;
7. high-risk Cloudflare recovery;
8. standardized error envelope/discriminants.

### 38.2. Acceptance gate

Toda expansão deve medir:

- descriptor bytes before/after;
- tools/list total;
- invalid-call rate;
- retries;
- parsing failures;
- task success;
- latency/context impact.

---

## 39. Progressive discovery e authorization-scoped catalogs

A surface atual mantém full default catalog e não usa progressive discovery. Isso foi decisão consciente na auditoria anterior.

Não há nova evidência suficiente para reverter isso.

Entretanto, a MCP spec atual permite tools variarem por autorização. Isso abre uma linha futura separada:

- read-only principals veem apenas read tools;
- admin grants veem protected mutations;
- experimental/private tools podem ser scope-gated;
- high-authority terminal pode exigir grant explícito distinto.

Isso não deve ser usado como mecanismo de “esconder” complexidade do modelo sem necessidade. É sobretudo uma ferramenta de **authority partitioning**.

---

## 40. MRTR / elicitation: possibilidade futura, não pressuposto

A MCP atual fornece mecanismos para input requerido/user interaction em fluxos suportados.

Isso poderia, no futuro, substituir alguns padrões de:

- plan tool;
- call novamente com `confirm=true`.

Mas há três restrições:

1. suporte de client/host precisa ser verificado;
2. confirmation semantics precisam continuar auditáveis;
3. plan separado ainda é justificável quando possui valor informacional próprio, como LLM-B quota impact.

Logo, **não remover confirm booleans nem plan owners nesta etapa**.

---

# PARTE V — IDEIAS DELIBERADAMENTE REJEITADAS OU POSTERGADAS

## 41. “Uma tool genérica que executa qualquer sequência de outras tools”

Rejeitada como direção default.

Problemas:

- vira DSL implícita;
- aumenta authority aggregation;
- dificulta approval/risk semantics;
- piora debuggability;
- duplica o orchestrator do próprio modelo.

Composição deve ser domain-specific.

## 42. “Aumentar todos os limits”

Rejeitado.

O problema de auditoria massiva não se resolve retornando 20.000 arquivos em uma resposta. Resolve-se com server-side completeness + pagination + aggregation.

## 43. “Transformar batch em transação” apenas por nomenclatura

Rejeitado.

Sem durable journal/isolated staging/recovery, seria semanticamente falso.

## 44. “Substituir index polling por `fs.watch` apenas”

Rejeitado.

Node documenta caveats em Docker/networked/virtual filesystems. Usar watcher como fast path, reconciliation como safety net.

## 45. “Dar mais liberdade criando mais shell wrappers”

Rejeitado.

Um wrapper que aceita arbitrary command com nome diferente não reduz autoridade nem aumenta semântica.

## 46. “Adicionar outputSchema completo a todas as 84 tools imediatamente”

Rejeitado.

A expansão deve ser seletiva e medida.

## 47. “Cloudflare rollback = replay do JSON backup”

Rejeitado.

Recovery precisa de compatibility/diff/resource identity.

## 48. “Adotar MCP Tasks como requisito”

Postergado/feature-gated.

Tasks é extension negociada; jobs locais continuam baseline.

## 49. “Usar semantic rename antes de construir semantic navigation confiável”

Rejeitado.

Primeiro read-only definitions/references + precision tests; só depois refactor mutation.

## 50. “Aumentar validator concurrency porque há CPU livre”

Postergado até benchmark workload-aware.

---

# PARTE VI — ROADMAP DE IMPLEMENTAÇÃO FUTURA

> **Estado vivo do roadmap.** A auditoria original encerrou-se sem implementação. Em 2026-08-28 foi iniciada uma nova rodada de execução após releitura integral deste documento e reauditoria dos owners P0. Os checkboxes abaixo passam, a partir deste ponto, a registrar somente trabalho efetivamente comprovado. Itens ainda em investigação permanecem desmarcados.

### Registro de execução — rodada de implementação 2026-08-28

- releitura integral das 2.544 linhas da versão inicial: **concluída**;
- reauditoria de F0/F1: **concluída para correctness/measurement e para o primeiro conjunto de handles de alta autoridade; lifetime/provenance e handles remanescentes continuam no plano**;
- `CAPABILITIES_VERSION`: `73 → 75`;
- `MCP_TOOL_CONTRACTS_VERSION`: `2.10.0 → 2.12.0`;
- `MCP_TOOL_OPERATION_CONTEXT_VERSION`: `1.1.0 → 1.2.0`;
- `MCP_AUTH_IMPLEMENTATION_VERSION`: `1.3.0 → 1.4.0`;
- `MCP_TERMINAL_CONTROL_VERSION`: `4 → 6` — v5 introduziu principal binding; v6 formalizou lifetime/retention;
- novo bug crítico F-32 descoberto empiricamente durante uma mutação real: **corrigido e coberto por regressão**;
- novo side channel F-33 encontrado durante a reauditoria de jobs: **corrigido**; a capacidade de validator continua global para proteger CPU/memória, mas IDs/validator do job ativo só são revelados ao próprio owner;
- `git_branch_info`: branch/HEAD agora são required reads; upstream continua opcional; false-green eliminado e testado com Git sintético;
- terminal error semantics: violações de shape/action/required-fields passaram de `okResult({success:false})` para `errorResult`/`isError:true`; non-zero exit de processo continua corretamente como resultado de domínio, não tool failure;
- round-trip analytics: o índice já possuía `runtime_epoch_id`; a consulta passou a filtrar server-side por epoch e `mcp_round_trip_analytics` agora usa `generation=current` por padrão, com `generation=all` apenas por opt-in histórico;
- auth/principal: o resource server passou a produzir uma `McpPrincipalIdentity` sanitizada a partir da autorização já verificada; sua `key` é estável sob narrowing/refresh de scopes, muda quando muda o subject/trust-domain e não contém token/PII textual; o registry a anexa ao `McpToolOperationContext` **somente após autorização positiva**;
- terminal sessions: cada record carrega `ownerPrincipalKey`; `list/read/status/control` são owner-scoped; foreign IDs retornam o mesmo `ERR_TERMINAL_SESSION_NOT_FOUND` de IDs inexistentes;
- working sets: cada handle carrega owner; a antiga eviction global foi substituída por quota **8 por principal** e hard cap global **32**; atingir a quota só pode evictar handle do próprio principal e atingir o cap global falha fechado em vez de sacrificar estado alheio;
- validation jobs: owner key é persistida no **manifest privado** para sobreviver a restart, mas removida de `PublicJobRecord`; manifests legados sem owner não são apropriados implicitamente; list/read/wait/cancel filtram por principal e foreign IDs são indistinguíveis de not-found;
- LLM-B detached runs: novos manifests persistem `ownerPrincipalKey` privado; spawn/list/cancel são principal-bound na superfície MCP; `view=runs` deixa de atribuir histórico global sem provenance e expõe somente runs cujo `runId` é comprovado por detached manifest do caller, marcando `visibility=principal-owned-detached-runs` e `completeness=bounded-global-source-window`; startup reaper continua global deliberadamente como maintenance owner interno;
- Copilot SDK sessions: a reauditoria distinguiu o binding já existente SDK↔hub/runtime de identidade do caller MCP. Como sessões podem nascer fora do MCP, não houve adoção heurística: `copilot_sessions` passou de `callerScope=read` para **`admin`**, explicitando inspeção process-global administrativa;
- composição: `run_copilot_validator`, safe validation suite, delegation runner e post-validation de repository writes propagam a mesma principal identity, sem JWT/OAuth/headers entrarem nos owners de validation/repository;
- runtime provenance: a reauditoria corrigiu a premissa de que seria necessário um subsistema novo — já existem `runtimeEpochId`, source binding, source fingerprint e correlação com controlled promotion; F1.4 deve evoluir essa primitive existente;
- lifetime terminal: processo `running` não expira por ausência de output e vive até exit/close explícito; após encerramento, status/output permanecem por **30 min**, `retentionExpiresAt` é publicado e operações oportunisticamente removem state expirado; exit do processo MCP força cleanup dos process trees ainda running para evitar órfãos;
- lifetime working set: TTL idle de **1 h**, renovado apenas por acesso autorizado do owner; creation/status publicam `idleTtlMs`, `lastAccessAtMs` e `idleExpiresAtMs`; expiração fecha a scope antes de remover o handle;
- lifetime validator jobs: timeout de execução permanece separado de retention histórica; `.json + .log` passaram a ser um **job group atômico para retenção**, e `retainNewest` conta jobs, não arquivos; budget de delete não divide um par apenas para preencher quota;
- lifetime LLM-B detached: novos manifests persistem `timeoutMs` + `deadlineAtMs`; manifests legados sem deadline continuam legíveis, explicitamente sem deadline recuperável; list calcula última atividade por manifest/summary/log; startup maintenance reaps somente PID verified por completion grace ou deadline+grace, relê o registry e só então remove state com `pidPresent=false`;
- retention LLM-B detached: default **7 dias**, preservando pelo menos os **20 stopped runs mais recentes**; artifacts são removidos antes do manifest e o PID é novamente comprovado ausente a partir do manifest canônico imediatamente antes da remoção;
- validações focadas concluídas: patch target V3, Git read, terminal option enforcement, analytics interna/wire, auth/principal, terminal ownership/lifetime, working-set ownership/lifetime, specific-output parity, validator jobs/retention, Model Gateway detached-run boundaries/deadline, startup maintenance, LLM-B runs wire, autonomy/cancel/retention e auth scope de `copilot_sessions`; strict typecheck `src/copilot` voltou a **verde** após cada checkpoint relevante;
- suites amplas: **não executadas**, deliberadamente, por não agregarem evidência proporcional nesta etapa.

## Faixa 0 — Baseline, invariants e critérios de medição

### F0.1 — Congelar baseline reproduzível

- [ ] Persistir snapshot current-generation de 84 tools, descriptor bytes e fingerprints.
- [ ] Capturar 24h/7d de metrics com generation identificável.
- [ ] Definir baseline de result bytes por tool de leitura.
- [ ] Definir baseline de terminal escape por task class, não apenas call count bruto.
- [ ] Documentar runtime Node/Git/npm/TypeScript versions relevantes.

### F0.2 — Inventário de state handles

- [x] Enumerar os state-handle families relevantes da superfície MCP atual: terminal sessions, working sets, validation jobs, LLM-B detached runs e Copilot SDK sessions/process-global registry.
- [x] Determinar formalmente se o runtime é single-principal ou multi-principal. **Decisão:** runtime deve permanecer seguro sob múltiplos principals; ownership é derivado da autorização e não do mero conhecimento do handle id.
- [x] Mapear creation/read/control/cancel/list dos handle families atuais; `copilot_sessions` foi classificado separadamente como process-global admin porque não possui provenance MCP de criação.
- [x] Mapear e formalizar **expiry/retention** de cada family na F1.3.
- [x] Definir lifetime e cleanup invariant por type: terminal running/closed, working-set idle, validator execution/history e LLM-B detached process/state; `copilot_sessions` permanece process-global admin sem handle MCP-owned.

### F0.3 — Error taxonomy

- [ ] Catalogar `success:false` dentro de `okResult`.
- [ ] Classificar query-empty vs execution failure vs conflict vs authorization failure.
- [ ] Definir envelope mínimo de error/retryability.

**Gate da Faixa 0:** nenhuma transformação arquitetural ampla antes de sabermos medir current-generation isoladamente.

---

## Faixa 1 — Correções P0: correctness, authorization e provenance

### F1.1 — `git_branch_info`

- [x] Reproduzir falhas de branch/HEAD em teste focalizado.
- [x] Corrigir false-green.
- [x] Padronizar failure details e retryability: todos os Git reads usam `failureClass=git-read`, `retryability=inspect-before-retry`, `recoveryRequired=false` e lista bounded de subprocessos falhos; upstream de `git_branch_info` permanece opcional.

### F1.2 — Principal-bound state

- [x] Implementar/enforçar primitive multi-principal comum: `McpPrincipalIdentity` auth-derived no resource server, anexada ao `McpToolOperationContext` somente após authorization success.
- [x] Vincular terminal session handles; lookup/list/control são owner-scoped e foreign ID é indistinguível de not-found.
- [x] Vincular working sets; quota/eviction são por principal e hard cap global falha fechado.
- [x] Vincular validation jobs; owner persiste em manifest privado, não em `PublicJobRecord`, e manifests legados ownerless não são adotados.
- [x] Revisar LLM-B detached run IDs: owner persiste em manifest privado; list/cancel MCP são principal-bound; runs sem provenance não são atribuídos ao caller.
- [x] Revisar Copilot SDK session IDs: não há provenance MCP honesta para ownership porque as sessões podem nascer fora do MCP; classificar `copilot_sessions` como **process-global admin** em vez de adotar estado alheio.
- [x] Filtrar list operations por principal nos owners migrados; validator capacity mantém apenas contagem física global e redige detalhes estrangeiros.
- [x] Adicionar cross-principal denial/fail-closed tests para terminal, working sets, persisted validator jobs e LLM-B persisted visibility.
- [x] Propagar owner sem acoplamento a OAuth/JWT em delegation runner e repository post-validation.
- [x] Fechar a propriedade de authority/provenance nos handle families da superfície MCP atual.

### F1.3 — Lifetime

- [x] Creation/status responses descrevem/retornam expiration semantics para os handles MCP que possuem expiração temporal observável.
- [x] Expired handles retornam o mesmo not-found family error usado para IDs inexistentes, sem existence oracle pós-expiração.
- [x] Closed/idle resource retention é bounded.
- [x] Terminal: `running` até exit/close explícito; state encerrado retido 30 min; process-exit cleanup mata process trees ainda ativos; nenhum kill por heurística de silêncio/idle.
- [x] Working sets: idle TTL 1 h, renovado por acesso do owner; expiração executa `closeScope` antes de remover o handle; quota 8/principal e hard cap global 32 continuam invariants separados do TTL.
- [x] Validator jobs: timeout de execução e retention histórica permanecem conceitos distintos; cleanup agrupa artifacts por UUID e nunca divide `.json + .log` de um mesmo job para satisfazer `maxDeleteCount`.
- [x] LLM-B detached: novos manifests persistem `timeoutMs/deadlineAtMs`; startup maintenance recupera deadline após restart, reaps apenas processo identity-verified e mantém compatibilidade fail-safe com manifests legados sem deadline.
- [x] LLM-B stopped-state retention: 7 dias por default + proteção dos 20 stopped runs mais recentes; âncora temporal usa última atividade observável de summary/log; cleanup relê manifest, reprova ausência de PID, remove artifacts primeiro e manifest por último.
- [x] Observabilidade de startup registra quantos detached runs foram reaped, quantos por timeout, quantos states foram removidos e quantas falhas ocorreram.

### F1.4 — Runtime generation certificate

- [x] Projetar certificate schema: `copilot-mcp-runtime-generation-certificate`, schema v1, fingerprint `sha256-stable-projection-v1` calculada apenas sobre a pequena projeção de identidade — nunca sobre o repositório no hot path.
- [x] Bind boot a source manifest/fingerprint reutilizando a autoridade já existente de `runtime/source-generation`: `controlled-promotion` carrega request id + exact source-barrier fingerprint + manifest; `manual-unbound` permanece explicitamente sem fingerprint inventada.
- [x] Vincular também a superfície realmente registrada/efetiva: preferir `operationContext.capabilities.toolSurface` frozen com descriptor fingerprint/count; fallback para descriptor observation apenas quando a capability exata não estiver disponível.
- [x] Expor em `mcp_runtime_health`: compact view publica somente schema + certificate fingerprint para preservar o budget < 6 KiB; `includeDetails=true` publica runtime/source/toolSurface completos.
- [x] Separar certificate imutável de observação mutável: detailed health publica `runtimeGenerationRelation` com Git head/branch/dirty + source-drift amostrado e afirma `exactCurrentWorktreeEqualityProven=false`; ausência de drift mtime não é promovida a igualdade criptográfica.
- [x] Correlacionar controlled reload request → new process generation pela cadeia já existente e testada `source-barrier run` → promotion environment estrito → `createMcpRuntimeSourceGeneration`; a mesma request id/fingerprint torna-se parte do certificate da nova geração.
- [x] Testar dirty/manual boot semantics: manual startup continua `manual-unbound` e não fabrica source proof; current dirty/worktree state é observação separada e não altera retroativamente a identidade carregada.
- [x] Regression do certificate prova fingerprint estável para mesma geração/surface e mudança de fingerprint quando a superfície registrada muda, mantendo o mesmo runtime epoch/source binding.
- [x] Manter bounded-output gate: a primeira projeção excedeu o teto compacto; em vez de elevar budget, compact certificate foi reduzido à identidade e `runtimeSourceDrift` perdeu campos redundantes apenas no compact view; o teste `< 6 KiB` voltou a verde.

### F1.5 — Error semantics

- [x] Converter violações acionáveis do contrato de entrada do terminal para `isError:true`, preservando exit code/timeout de comando como resultado de domínio quando a tool executou corretamente.
- [x] Auditar demais owners pelo critério semântico **call/precondition/action failure ≠ diagnostic/domain outcome**; a busca negativa final não encontrou `okResult({success:false})` direto na camada de tools.
- [x] Dependency maintenance: confirmação ausente é `shape-config/manual-decision`; falhas reais de `npm-check-updates`/upgrade são `isError:true`, `retryability=inspect-before-retry`, preservando rollback/step evidence no envelope.
- [x] Cloudflare guarded mutation: preview/dry-run pode retornar `ok=false` como diagnóstico; `dryRun=false` sem confirmação é `ERR_CLOUDFLARE_APPLY_CONFIRM_REQUIRED`; real apply bloqueado após preflight/backup é `ERR_CLOUDFLARE_APPLY_BLOCKED` e nunca false-green.
- [x] Git read: status/diff/log/branch-info compartilham failure taxonomy bounded e não sugerem retry cego.
- [x] Preservar empty-result como sucesso quando semanticamente correto; falhas por item em batch continuam item-level domain outcomes quando a chamada de batch em si executou corretamente.
- [x] Gates focais: `test_mcp_git_read_tools.spec.js`, `test_mcp_tools.spec.js` e `typecheck:strict:src.copilot` verdes após o fechamento.

**Gate da Faixa 1:** 100% dos handle types de autoridade relevante possuem owner/lifetime definido; live generation deixa de ser “manual-unbound” após boot controlado.

### F1.6 — Integridade de preconditions de patch — adição emergente da implementação

- [x] Reproduzir bypass de `expectedHash` no caminho de target com operação única.
- [x] Propagar o baseline hash até `patchTextLocked` em `buildIndependentPatchAttemptOptions()`.
- [x] Adicionar regressão fail-closed exigindo `EEXPECTEDHASH` e zero mutação.
- [x] Validar focalmente o target-group owner após a correção.

---

## Faixa 2 — Bounded output e escala de auditoria

### F2.1 — Shared bounded-result contract

- [x] Definir cursor semantics: página MCP comum preserva `cursor` do caller e `nextCursor` somente quando existe continuação; o cursor específico continua pertencendo ao owner (linha em chunks, offset nos search owners) em vez de impor um cursor universal artificial.
- [x] Definir result byte accounting: `withBoundedResultPage()` publica `resultBytes/budgetBytes` para o envelope completo e separa `contentBytes/contentBudgetBytes` quando existe budget interno de payload pesado.
- [x] Definir `truncated/nextCursor` invariant: `hasMore` deriva de `nextCursor != null`; `truncated` é verdadeiro quando há continuação e `truncationReason` é explícita.
- [x] Definir compact projections: conteúdo pesado permanece uma única vez em `structuredContent`; `TextContent` usa resumo determinístico <= 2 KiB nos owners matriculados.
- [x] `MCP_TOOL_EXECUTION_LIMITS_VERSION=3` passa a projetar limites canônicos de chunks; `CAPABILITIES_VERSION=76`, semantic contract `2.13.0` e option-contract ledger `1.9.0` refletem a mudança pública.

### F2.2 — `repo_read_file_chunks`

- [x] Mudar semantics para page/window real: omitir `endLine` não lê mais o arquivo inteiro; a página é limitada por `chunkLines × maxChunks`.
- [x] Adicionar `maxChunks`: default 4, hard max 64; `chunkLines` default 200/hard max 1000 permanecem explícitos no execution-limit SSOT.
- [x] Adicionar max output bytes: content budget default 512 KiB, min 16 KiB, hard max 1 MiB, separado do tool-result ceiling de 1,5 MiB.
- [x] Garantir continuation cursor em limite de linhas, requested window e byte budget; cache canônico permanece cursor/byte-budget-neutral e a projeção do caller recalcula a continuação sem duplicar I/O.
- [x] Testar paginação automática sem `endLine`, segunda página via cursor, truncamento em fronteira de chunk por byte budget e long line/chunk que sozinho excede o hard budget.
- [x] Long line oversize falha explicitamente com `ERR_CHUNK_PAGE_ITEM_TOO_LARGE`, `requiredBytes` e taxonomy bounded; não trunca conteúdo nem fabrica cursor que pule bytes.
- [x] Gates focais: `test_mcp_tools.spec.js` e `typecheck:strict:src.copilot` verdes após a mudança; sem broad suite nesta etapa.

### F2.3 — `repo_tree`

- [x] Introduzir continuation real por keyset do último workspace-relative path (`path-keyset-v1`); página seguinte não repete entradas anteriores e não depende de offset instável.
- [x] Substituir a projeção antiga por `flat-path-page-v2`: `path/name/type/depth` e `size` somente para arquivos da página; `absolutePath` não é retornado nem como metadata de entrada.
- [x] Adicionar `includePattern`/`excludePattern` com matching nativo do Node. A responsabilidade física foi movida para o walker de `infra/filesystem/read`; o MCP não reimplementa matching/traversal.
- [x] Adicionar content byte budget: default 512 KiB, min 16 KiB, hard max 1 MiB, tool-result ceiling 1,5 MiB; item isolado maior que o budget falha explicitamente e não cria cursor que pule entrada.
- [x] Preservar security redaction invariants: canonical read-path policy é aplicada pelo walker antes da projeção; protected names são contados mas não expostos; symlink pode ser listado, porém jamais seguido; paths retornados são workspace-relative-only.
- [x] Centralizar IO: `walkWorkspaceEntriesFresh()` tornou-se o owner único de traversal read-only; `listWorkspaceTreeEntriesFresh()` e `listRegularFilesFresh()` são projections estreitas sobre ele. O implementation passou a `node:fs/promises.readdir` iterativo, removendo duplicação entre tree/inventory e permitindo contagem exata de protected leaves/branches.
- [x] Manter enrichment caro fora da enumeração completa: `stat` para `size` roda somente sobre os itens já selecionados para a página, em batches bounded; o universo inteiro não recebe milhares de stats.
- [x] Compactar `mcp_capabilities_summary(view=status)` para uma projection de execution limits crítica (`status-critical-v1`), mantendo o SSOT completo em `view=summary`; o status voltou a permanecer <8 KiB após o crescimento dos limits de tree.
- [x] Surface/versioning corrente após F2.3: 85 tools; `CAPABILITIES_VERSION=78`, semantic contracts `2.15.0`, option contracts `1.11.0`, execution limits v5; full descriptor fingerprint `fcae10191ba0e94367605e8126c15db368d4f8162f24a56d68719e788da5a04d`.
- [x] Gates focais verdes: `test_mcp_tools` 75/75, novo `test_io_filesystem_walk`, option contracts, descriptor fingerprint e `typecheck:strict:src.copilot`; broad suite deliberadamente adiada.

### F2.4 — `repo_inventory`

- [x] Definir sources `git|filesystem|index` sob uma única tool pública e uma projeção plana/workspace-relative comum; não fragmentar a surface em três wrappers.
- [x] Implementar tracked inventory NUL-safe via runtime Git governado: `git --literal-pathspecs ls-files -z -- [scope]`, timeout/buffer bounded e sem pathspec magic controlado pelo caller.
- [x] Implementar filesystem inventory native-first em `infra/filesystem/read`; após F2.3, inventory e tree foram consolidados sobre `walkWorkspaceEntriesFresh()` (`node:fs/promises.readdir` iterativo), com policy/pruning/symlink non-traversal em um único owner e somente regular files projetados pelo inventory.
- [x] Expor `indexRegistry.listFiles()` como leitura estreita sobre `store.listIndexedFiles()`; o MCP não atravessa a membrane do registry nem recebe store/database handles.
- [x] Cursor determinístico por keyset do último path (`path-keyset-v1`), depois de normalização, redaction, dedupe e ordenação lexical; não usa offset instável.
- [x] Aplicar simultaneamente `maxResults` e UTF-8 content budget; oversize do primeiro item falha explicitamente em vez de truncar/pular path. O envelope usa o shared bounded-result contract e ceiling próprio de 1,5 MiB.
- [x] Aggregates server-side sobre o universo visível completo: `visibleFiles`, `totalPathBytes`, extensões e diretórios predominantes, sem despejar o inventário integral na resposta.
- [x] Hash optional/lazy por desenho: inventory não lê conteúdo em massa; `hashPolicy` aponta para composição posterior com `repo_bulk_inspect`/stat `includeHash` apenas nos candidatos selecionados.
- [x] Security invariants: todas as fontes reaplicam o read-path policy antes da paginação; filesystem poda protected branches antes do traversal; paths absolutos, protected names e symlink traversal não entram na projeção.
- [x] Surface/versioning: 85 tools canônicas; `CAPABILITIES_VERSION=77`, semantic contracts `2.14.0`, option contracts `1.10.0`, execution limits v4; full descriptor fingerprint `3bf74f61c7b2887274e441dd26453521f4157d03be0acff67c2b09c081a0330f` e latency surface = 52 tools.
- [x] Gates focais verdes: `test_mcp_tools`, index registry, registry/semantic coverage, option contracts, descriptor fingerprint, payload audit, dual-era/modern protocol, cache hints, OAuth modern shadow e `typecheck:strict:src.copilot`; broad suite deliberadamente adiada.

### F2.5 — Batch structural inspection

- [x] Adicionar batch ao `repo_file_outline` sem criar nova tool: single/batch são modos do mesmo owner; batch aceita até 64 requests, concurrency bounded e `best-effort|fail-fast` como os demais read batches.
- [x] Manter parsing/windowing no owner arquitetural correto: `windowFileContext()` em `infra/indexing/parser/context/window` recebeu cursor v1 com offsets das cinco coleções (`symbols/imports/exports/outline/topComments`), revision hash e projection profile; o MCP não reimplementa offsets nem parsing.
- [x] Tornar truncation retomável: `nextCursor` é emitido quando qualquer coleção incluída conserva itens; cursor de revision/projection divergente falha com `ERR_REPO_OUTLINE_CURSOR`; item estrutural isolado maior que o content budget falha explicitamente com `ERR_REPO_OUTLINE_PAGE_ITEM_TOO_LARGE`.
- [x] Separar content budget do envelope MCP: outline single usa default 512 KiB, min 16 KiB, hard max 1 MiB e result ceiling 1,5 MiB; `MCP_TOOL_EXECUTION_LIMITS_VERSION=6` publica esses limites.
- [x] Eliminar duplicação do framing batch: `repo-read-batch.js` passou a concentrar compact rows, aggregate budget, size hint e continuation hint para `repo_read_file`, `repo_search_text`, `repo_bulk_inspect` e `repo_file_outline`; execução concorrente continua pertencendo a `infra/concurrency/bulk`.
- [x] Preservar semântica estrutural sob aggregate pressure: arrays não são cortados parcialmente; são omitidos atomicamente com `payloadOmittedForBatchBudget`, `payloadRecoveryCursor` da mesma página e recovery strategy explícita. Truncation de transporte permanece distinta de continuation normal por `nextCursor`.
- [x] Medir parsing throughput/result bytes em Node v24.15.0 sobre oito owners MCP representativos: primeiro parse+window do maior arquivo ~55,8 ms; oito cold-ish parses somaram ~105,5 ms; warm median do arquivo principal ~7,7 ms; oito structural rows totalizaram ~49,6 KiB, sem truncation sob o aggregate budget padrão de 2 MiB. É baseline direcional local, não SLO definitivo.
- [x] Surface/versioning após F2.5: 85 tools; `CAPABILITIES_VERSION=79`, semantic contracts `2.16.0`, option contracts `1.12.0`, execution limits v6; full descriptor fingerprint `a826e8ff13fe8bd73d434b6572dddc3ed0a91df67ba5a97e6b886908b9bc28d3`.
- [x] Gates focais verdes: infra parser cursor tests, `test_mcp_tools`, option contracts, continuation semantics, descriptor fingerprint, registry, payload audit e `typecheck:strict:src.copilot`; nenhuma broad suite foi gasta nesta faixa.

**Gate da Faixa 2 — [x] FECHADO:** operações high-cardinality atacadas nesta faixa (`repo_read_file_chunks`, `repo_tree`, `repo_inventory`, `repo_file_outline`) não truncam conteúdo lógico sem continuation explícita; truncation exclusivamente de transporte em batch é marcada separadamente e conserva recipe/cursor para recuperar a mesma página.

---

## Faixa 3 — Semantic code intelligence — **ADIADA POR DECISÃO ARQUITETURAL**

> **Decisão 2026-08-28:** não criar LSP, TypeScript Language Service, tsserver owner nem `repo_code_navigation` nesta campanha. A faixa permanece deliberadamente aberta e será retomada somente por decisão explícita futura; nenhuma faixa posterior deve depender dela.
>
> **Baseline TypeScript — concluído em 2026-08-28:** `typescript@7.0.2` é agora a **única autoridade TypeScript local**. Não existem mais aliases `@typescript/native`/`@typescript/typescript6`, `typescript-eslint` ou `tsc6`. ESLint 10 ficou responsável por parsing JS/ESM e regras arquiteturais; Oxlint + `oxlint-tsgolint@7` executam o lane type-aware TS7 selecionado. `check-typescript-baseline` rejeita qualquer compiler TypeScript <7, aliases aposentados e `legacy-peer-deps=true`. Essa consolidação **não reabre F3/LSP**: apenas remove a antiga compatibility island.

### F3.1 — Prototype TypeScript Language Service — **adiado**

- [ ] Medir startup/cold memory somente quando a faixa for reaberta.
- [ ] Medir incremental update cost.
- [ ] Verificar JS + JSDoc + NodeNext sob TS 7.0+ real.
- [ ] Definir cache/lifecycle e invalidation sem depender de TS6.

### F3.2 — `repo_code_navigation` read-only — **adiado**

- [ ] Definition.
- [ ] References.
- [ ] Implementations.
- [ ] Type definition, se útil.
- [ ] Result pagination/budget.
- [ ] Explicit fallback/error quando semantic project unavailable.

### F3.3 — Corrigir `repo_find_symbol_usages` — **adiado junto do semantic owner**

- [ ] Renomear/reespecificar como textual occurrence ou deprecate somente após semantic owner comprovado.
- [ ] Evitar compatibility shim permanente sem necessidade.
- [x] O contrato atual permanece explicitamente entendido como **lexical/textual**, não semantic references; `repo_change_impact` cobre impacto de módulo, não binding-level references.

### F3.4 — Precision corpus — **adiado**

- [ ] Tests com shadowing.
- [ ] Aliases/re-exports.
- [ ] Same-name bindings.
- [ ] Comments/strings.
- [ ] Dynamic imports.
- [ ] JSDoc/type-only constructs.

**Gate da Faixa 3:** permanece fechado por decisão de escopo. Se reaberto, semantic references deverá demonstrar precision/recall superior à regex em corpus adversarial e operar exclusivamente sobre TS 7.0+ antes de qualquer rename mutation.

---

## Faixa 4 — Graph, cycles e impact analysis — **núcleo concluído**

### F4.1 — Graph storage/projection

- [x] Reusar exclusivamente indexed file/import edges existentes; nenhuma leitura/reparse de source foi adicionada ao graph path.
- [x] Centralizar resolution semantics antes do graph: novo owner `infra/indexing/module-resolution` absorveu relative imports, `package.json#imports` exact/wildcard, candidatos file/index e fallbacks TS-source; prefetch e orphan-import audit passaram a reutilizá-lo.
- [x] Definir node identity como path absoluto normalizado internamente + projection workspace-relative na borda; scope é validado pelo workspace capability.
- [x] Tratar external, unresolved local e dynamic edges explicitamente; `includeDynamic=false` filtra dynamic imports na construção do snapshot.
- [x] Implementar algoritmos puros em `infra/indexing/graph`, sem imports MCP: adjacency/reverse adjacency, Tarjan SCC, BFS path/reachability, summary degree e reverse impact.

### F4.2 — `repo_graph`

- [x] `dependencies` com depth bounded e paginação.
- [x] `dependents`/reverse reachability.
- [x] SCC/cycles via Tarjan, incluindo self-loop real.
- [x] Shortest dependency `path` via BFS.
- [x] `summary` com node/edge/import/external/unresolved/dynamic/cycle counts e top in/out degree.
- [x] `unresolved` com projection segura de candidatos workspace-relative.
- [x] Precondition failures retornam tool errors explícitos (`ERR_GRAPH_NODE_REQUIRED`, node/path outside scope, node not indexed), evitando false-green vazio.

### F4.3 — `repo_change_impact`

- [x] Explicit changed `paths` como input (1–64).
- [x] Git range as input via `gitBase` + `gitHead`, derivado pelo read-service Git compartilhado com `--name-status -z`, scope filtering no próprio Git e suporte honesto a deleted/renamed historical seeds.
- [x] Reverse dependency closure com nearest-seed distance e `maxDepth` bounded.
- [x] Reportar seeds não indexados em vez de inventar ausência de impacto.
- [ ] Public/export binding impact — depende da Faixa 3 semantic intelligence, agora adiada.
- [ ] Candidate test ranking — pertence à Faixa 8/test intelligence.
- [x] Risk evidence permanece read-only e não dispara validação automaticamente.

### F4.4 — Policy-aware architecture

- [x] Graph atual não hardcode boundaries arquiteturais tribais; representa fatos de dependência indexados.
- [ ] Boundary violations só serão adicionadas quando regras estiverem formalizadas em data/config verificável.

### Evidência de fechamento do núcleo F4

- [x] `test_io_module_resolution`: exact/wildcard package imports, relative/external e JS→TS candidate fallback.
- [x] `test_io_module_graph`: cycles, dependencies/dependents, shortest path, external/unresolved/dynamic edges e reverse impact.
- [x] `test_mcp_repo_graph`: build do índice → summary/dependencies → change impact sobre SQLite em memória, sem source reparse.
- [x] Registry/protocol/payload/cache/OAuth gates afetados por `tools/list` verdes; strict typecheck verde.
- [x] Surface corrente após o fechamento F5: **88 tools**, `CAPABILITIES_VERSION=83`, semantic contracts `2.19.0`, surface policy `2.1.0`, latency surface **55**, full descriptor fingerprint `eee32b918a88abca177e4803774da0725835f3fbb91129d0cefaf8c6a9a4e7b2`.

**Gate da Faixa 4:** **FECHADO para cycles/reverse dependencies e impact por paths/Git range**. Mass audit pode provar cycles/reverse dependencies e derivar changed seeds históricos sem shell ad hoc. Public/export binding impact continua deliberadamente dependente de F3 adiada; test ranking permanece F8.

---

## Faixa 5 — Git forensics estruturado

> **Reauditoria 2026-08-28 19:30 -03:** F5 passa a incluir a correção de arquitetura necessária para que expansão Git não replique processo/parsing. `infra/process` é o owner físico de subprocessos; `workspace/git` deve concentrar gramática/revision/path e parsers machine-readable; a camada de tools fica apenas com schema/authority/MCP result. O parser `--name-status -z` já existente no auto-build deve ser promovido/reutilizado, não reescrito em paralelo.

### F5.1 — Structured status — **CONCLUÍDA**

- [x] `--porcelain=v2 -z` parser NUL-safe.
- [x] branch/upstream/ahead/behind/stash estruturados.
- [x] rename/unmerged/untracked/ignored fixtures.

### F5.2 — Diff/log upgrades — **CONCLUÍDA**

- [x] revision ranges validados por grammar fail-closed.
- [x] path filters literais governados.
- [x] patch/stat/name-status projections.
- [x] bounded pickaxe `-S`/`-G`.
- [x] structured commit fields em formato machine-readable.

### F5.3 — `git_inspect` — **CONCLUÍDA**

- [x] show commit/blob/path-at-revision.
- [x] tree via `ls-tree -z -l`, bounded e estruturado, com path/recursive/maxEntries.
- [x] blame line-porcelain.
- [x] merge-base.
- [x] changed-files NUL-safe.
- [x] worktree list/read metadata via porcelain `-z`.
- [x] strict option/revision grammar e field-shape enforcement por view.

**Gate da Faixa 5:** **FECHADO**. Status, ranges, log/diff, show/tree/blob, blame, merge-base, changed-files e worktree metadata recorrentes não exigem `terminal_exec`. Process execution fica em `infra/process`; parsers/grammar/read-service em `workspace/git`; tools possuem apenas schema/authority/result framing.

---

## Faixa 6 — Isolated change sessions

### F6.1 — Worktree prototype

- [ ] Managed root fora da source tree normal.
- [ ] Detached exact `baseHead`.
- [ ] Max active sessions.
- [ ] Principal-bound handles.
- [ ] TTL/prune.
- [ ] Submodule/package-manager caveat audit.

### F6.2 — Apply in sandbox

- [ ] Reutilizar canonical repo-write owners quando possível.
- [ ] Garantir path policy coerente.
- [ ] Audit every mutation.

### F6.3 — Validation

- [ ] Validators recebem explicit workspace/session context.
- [ ] No implicit network authority expansion.
- [ ] Results vinculados ao session fingerprint.

### F6.4 — Promotion

- [ ] Compute promotion diff.
- [ ] Revalidate primary source/head/hash preconditions.
- [ ] Durable promotion journal.
- [ ] Conflict/failure recovery.
- [ ] Declarar explicitamente que promotion não é filesystem ACID transaction.

### F6.5 — Cleanup

- [ ] close/discard.
- [ ] crash recovery/prune.
- [ ] orphan worktree detection.

**Gate da Faixa 6:** um refactor multi-arquivo pode ser integralmente validado antes de tocar o primary working tree.

---

## Faixa 7 — Terminal e long-running lifecycle

### F7.1 — Session lifecycle — **núcleo concluído em F1.2/F1.3**

- [x] Decisão de idle lifetime: sessão `running` **não** expira por silêncio/ausência de output; vive até exit/close explícito, evitando matar servidor legítimo por heurística de inatividade.
- [x] Closed retention TTL: 30 min.
- [x] Owner principal em open/list/read/status/control.
- [x] Explicit retention/expiry fields após encerramento e not-found indistinguível após expiração.

### F7.2 — Tags

- [ ] Sanitized purpose/tag.
- [ ] Filter list by tag.
- [ ] Scoped cleanup.

### F7.3 — Event predicates

- [ ] `pattern-or-exit` bounded.
- [ ] Exit-code wait.
- [ ] Cursor correctness under wait.

### F7.4 — Output projection

- [ ] tail default.
- [ ] head.
- [ ] head-tail.
- [ ] total observed/truncated bytes invariant.

### F7.5 — Tasks interoperability experiment

- [ ] Detect per-request Tasks extension.
- [ ] Adapt one validation job as experiment.
- [ ] Preserve legacy/local job surface when extension absent.
- [ ] Measure ChatGPT host support antes de qualquer dependência.

---

## Faixa 8 — Test intelligence e validator scheduling

### F8.1 — Discovery

- [ ] Native Node glob/test discovery.
- [ ] Map test files to source graph quando possível.

### F8.2 — Coverage

- [ ] Prototype Node native coverage.
- [ ] Mark experimental status.
- [ ] Compact coverage summary; raw artifacts ficam server-side.

### F8.3 — Flakiness

- [ ] Bounded repeated runs.
- [ ] Duration/pass distribution.
- [ ] Persist sanitized evidence.

### F8.4 — Randomization

- [ ] Gate em Node >=24.16 ou feature detection.
- [ ] Seed reproduzível.
- [ ] Registrar seed no artifact/job summary.

### F8.5 — Scheduler

- [ ] Benchmark per-validator resource profile.
- [ ] Testar concurrency >1 em classes leves.
- [ ] Manter 1 quando contenção superar ganho.

---

## Faixa 9 — Dependency/supply-chain intelligence

### F9.1 — Dependency audit owner

- [ ] `npm audit` structured.
- [ ] `npm audit signatures`.
- [ ] `npm sbom` SPDX/CycloneDX.
- [ ] `npm explain` package validated.
- [ ] `npm find-dupes`.

### F9.2 — Selective upgrades

- [ ] Package allowlist input.
- [ ] within-range/patch/minor/latest policy.
- [ ] dev/runtime dependency filter.
- [ ] preview manifest/lock diff.
- [ ] install-script authority explicit.

### F9.3 — Post-upgrade impact

- [ ] Dependency change → impacted source/tests.
- [ ] Focused validation profile.

---

## Faixa 10 — Cloudflare recovery lifecycle

### F10.1 — Backup schema

- [ ] Version/fingerprint/environment identity.
- [ ] Validate old backup compatibility.
- [ ] Retention/status projection.

### F10.2 — Recovery plan/diff

- [ ] Classify restorable resources.
- [ ] Show current-vs-backup diff.
- [ ] No mutation by default.

### F10.3 — Recovery apply

- [ ] Explicit confirmation.
- [ ] New pre-recovery backup.
- [ ] Apply only supported resources.
- [ ] Post-recovery gates.
- [ ] Audit events.

---

## Faixa 11 — Protocol contracts, telemetry e lineage

### F11.1 — Current-generation analytics — **parcialmente concluída**

- [x] `generation=current` filtra server-side pelo `runtimeEpochId` da geração ativa e é o default público.
- [ ] Adicionar filtro explícito por `capabilitiesVersion`/certificate quando a pergunta for por cohort de surface, sem confundir epoch com schema generation.
- [ ] Quantificar/warn cohorts desconhecidos quando a consulta histórica não puder ser atribuída com pureza.
- [x] Historical vs current views: `generation=all` é opt-in; current permanece o caminho normal.

### F11.2 — W3C trace metadata

- [ ] Preserve incoming trace context when present.
- [ ] Propagate through internal composed operations quando semanticamente válido.
- [ ] Track `lineageAvailability`.
- [ ] Never manufacture upstream trace lineage.

### F11.3 — Output schema pilot

- [ ] Choose 5–8 high-value tools.
- [ ] Measure tools/list delta.
- [ ] Measure invalid-call/task-success delta.
- [ ] Promote only evidence-positive schemas.

### F11.4 — MRTR experiment

- [ ] Verify actual host support.
- [ ] Select one non-destructive confirmation workflow.
- [ ] Compare prompt friction and auditability.
- [ ] Do not remove existing confirm path until proven.

### F11.5 — Apps SDK readiness

- [ ] Replace lexical marker assertions progressively with runtime catalog/resource registry assertions.
- [ ] Preserve source scan only as supplemental static audit if useful.

---

## Faixa 12 — Experimental tool stabilization

### F12.1 — `repo_symbol_search`

- [ ] Cold/warm benchmark.
- [ ] Precision/duplicate tests.
- [ ] Index freshness semantics.
- [ ] SLO before stable promotion.

### F12.2 — `repo_file_outline`

- [ ] Parser correctness corpus ampliado para promoção de experimental → stable.
- [x] Batch throughput baseline executado em F2.5 (8 arquivos: ~105,5 ms cold-ish total; warm median principal ~7,7 ms); SLO definitivo continua pertencendo a F12.
- [x] Large-file/page byte budget e aggregate structural budget implementados em F2.5, com continuation/recovery explícita.
- [ ] JSX/TS/JSDoc/export edge cases.

### F12.3 — `repo_index_search`

- [ ] Document ranking semantics.
- [ ] Define completeness limitations vs `repo_search_text`.
- [ ] Cursor stability under index generation changes.

---

## Faixa 13 — Audit session de alto nível

**Somente após F2–F4 estabilizarem.**

### F13.1 — Evidence store

- [ ] Principal-bound audit session.
- [ ] Snapshot/generation fixed.
- [ ] Inventory completeness accounting.
- [ ] TTL/storage budget.

### F13.2 — Allowlisted analyzers

- [ ] import graph/cycles.
- [ ] boundary policy.
- [ ] symbol/export surface.
- [ ] forbidden/deprecated patterns.
- [ ] selected validation evidence.

### F13.3 — Delta refresh

- [ ] Refresh only changed paths/generation.
- [ ] Invalidate affected findings.
- [ ] Preserve evidence provenance.

### F13.4 — Avoid generic agent DSL

- [ ] Review API specifically for capability creep.
- [ ] Reject arbitrary command/analyzer/plugin execution unless separately governed.

---

## Faixa 14 — Adoção, medição e eventual racionalização

### F14.1 — Before/after

- [ ] Result bytes p50/p95 por mass-audit workflow.
- [ ] Round trips por workflow.
- [ ] Terminal escape rate nos workflows substituídos.
- [ ] Current-generation failure rates.
- [ ] Semantic navigation precision/recall.
- [ ] Change-session success/recovery metrics.

### F14.2 — Surface cost

- [ ] Reexecutar `mcp_tool_payload_audit`.
- [ ] Manter descriptor headroom saudável.
- [ ] Verificar tool-choice ambiguity.

### F14.3 — Rationalization pós-upgrade

- [ ] Identificar tools tornadas redundantes por owners novos.
- [ ] Remover somente quando capability coverage estiver comprovada.
- [ ] Evitar aliases/shims permanentes sem consumidores reais.

---

# PARTE VII — CRITÉRIOS DE SUCESSO

## 51. KPIs técnicos propostos

### 51.1. Completeness e contexto

- 100% das operações high-cardinality com continuation quando truncadas;
- nenhum “truncated=true sem nextCursor” quando continuation for semanticamente possível;
- redução material do p95 de bytes em large-file navigation;
- inventory completo de `src/copilot` sem shell e sem carregar todos os paths no contexto de uma vez.

### 51.2. Segurança/lifecycle

- 100% dos state handles de autoridade relevante têm owner principal ou single-principal invariant formal;
- 100% das creations documentam lifetime;
- cross-principal handle access tests falham corretamente;
- PID/process cancellation nunca ocorre sem identity verification quando aplicável.

### 51.3. Provenance

- controlled MCP boots expõem source generation certificate válido;
- runtime health consegue distinguir source drift de schema projection staleness;
- reload request → process generation correlation verificável.

### 51.4. Semântica

- semantic references superam textual regex em corpus adversarial;
- `repo_find_symbol_usages` deixa de sugerir semântica que não fornece;
- Git status parsing deixa de depender de human format.

### 51.5. Change safety

- refactor multi-file grande pode ser validado em isolamento;
- promotion verifica source preconditions;
- failure de promotion deixa journal recuperável;
- nenhuma documentação chama preflight/batch de transação ACID.

### 51.6. Validation

- impact analysis reduz validators amplos desnecessários;
- flaky repeat possui seed/evidence reproduzível quando runtime suportar;
- concurrency só aumenta onde benchmark prova ganho líquido.

### 51.7. Telemetria

- analytics oferece current-generation view pura ou declara quando não consegue;
- W3C lineage é reportada como available/unavailable, não inferida;
- novas composite/structured tools mostram redução mensurável de shell escapes em seus task classes.

### 51.8. Tool surface cost

- manter `tools/list` confortavelmente abaixo do hard limit;
- não trocar 30 round trips por 300 KiB de descriptor fixo;
- cada nova tool demonstra capability delta real.

---

# PARTE VIII — ORDEM RECOMENDADA E PRIORIZAÇÃO

## 52. P0 — fazer primeiro

1. `git_branch_info` correctness;
2. state handle ownership/lifetime architecture;
3. execution error semantics;
4. runtime source generation certificate;
5. generation-aware analytics. **Implementado nesta rodada no nível de `runtimeEpochId`: current por padrão, historical/all por opt-in.**

Razão: corrigem confiança, autorização, provenance e validade das próximas medições.

## 53. P1 — maior ganho de autonomia por risco baixo/moderado

1. bounded result contract;
2. `repo_read_file_chunks` pagination real;
3. `repo_tree`/`repo_inventory`;
4. batch `repo_file_outline`;
5. structured Git status/forensics;
6. graph/dependents/cycles;
7. semantic code navigation read-only.

Razão: reduzem shell e round trips sem introduzir mutation inteligente ainda.

## 54. P2 — mutation e workflows mais sofisticados

1. change impact;
2. isolated change sessions;
3. test intelligence;
4. dependency intelligence;
5. terminal lifecycle upgrades;
6. Cloudflare recovery.

## 55. P3 — protocol experimentation e higher-order orchestration

1. MCP Tasks interoperability;
2. MRTR confirmation experiments;
3. targeted output schema expansion;
4. audit sessions;
5. authorization-scoped catalogs, se necessidade concreta surgir.

Essa ordem é deliberada: **primeiro aumentar a qualidade da percepção; depois aumentar a capacidade de transformação.**

---

# PARTE IX — QUESTÕES EM ABERTO

## 56. Hipóteses que exigem benchmark/investigação adicional

### Q1. TypeScript Language Service

- memória steady-state aceitável?
- invalidation incremental adequada ao volume do repo?
- coexistência com índice atual sem duplicar trabalho em excesso?

### Q2. Index polling

- o custo de empty polls é material em long-running sessions?
- watcher híbrido reduz latency sem perder events em Docker?

### Q3. Validator concurrency

- unit-focused pode rodar paralelo com typecheck sem degradar MCP responsiveness?
- memory/GC tornam paralelismo contraproducente?

### Q4. Change worktrees

- custo de npm/node_modules em worktree;
- como compartilhar dependências sem introduzir state leakage;
- comportamento com generated artifacts/submodules;
- cleanup após crash/restart.

### Q5. Host support

- Tasks extension efetivamente anunciada pelo ChatGPT connector atual?
- MRTR/input-required possui UX adequada?
- trace context chega ao servidor em alguma classe de call?

### Q6. Principal identity

- qual campo de `AuthInfo` é a chave estável correta no deployment atual?
- existe um único grant por runtime ou múltiplos principals reais?

### Q7. Experimental search latency

- os ~783 ms observados em `repo_symbol_search` são cold start, DB lock, parser, index I/O ou ruído?

### Q8. Descriptor/schema tradeoff

- quanto `outputSchema` seletivo reduz calls inválidos no host/model atual?

---

# PARTE X — REFERÊNCIAS OFICIAIS CONSULTADAS

## 57. Model Context Protocol

- Tools — specification 2026-07-28:
  https://modelcontextprotocol.io/specification/2026-07-28/server/tools

- MCP 2026-07-28 release:
  https://blog.modelcontextprotocol.io/posts/2026-07-28/

- MCP 2026-07-28 release candidate / protocol changes:
  https://blog.modelcontextprotocol.io/posts/2026-07-28-release-candidate/

- MCP roadmap, versão corrente consultada em agosto de 2026:
  https://blog.modelcontextprotocol.io/posts/mcp-roadmap/

- Tasks extension:
  https://tasks.extensions.modelcontextprotocol.io/

- TypeScript SDK support/migration para 2026-07-28:
  https://ts.sdk.modelcontextprotocol.io/v2/migration/support-2026-07-28

### Implicações extraídas

- tools podem variar com autorização;
- paginação/cache de tools/list fazem parte do protocolo atual;
- stateful handles devem ter authorization revalidada e lifetime declarado;
- `outputSchema` pode fortalecer parsing/validation;
- Tasks é extension negociada, não baseline universal;
- W3C trace context é direção atual;
- primitives antigas como Roots/Sampling/Logging não devem ser escolhidas como nova base arquitetural sem forte motivo.

## 58. Node.js 24

- File system APIs:
  https://r2.nodejs.org/docs/latest-v24.x/api/fs.html

- Test runner:
  https://r2.nodejs.org/docs/latest-v24.x/api/test.html

### Implicações extraídas

- `fs.glob` é estável na linha Node 24 e pode apoiar inventory/discovery native-first;
- `fs.watch` deve ser usado com cautela em virtualized/networked/Docker environments;
- native test runner suporta glob/coverage;
- randomization/seed depende de versão da linha 24 e exige gate no runtime atual 24.15.0.

## 59. Git

- `git status`:
  https://git-scm.com/docs/git-status

- `git blame`:
  https://git-scm.com/docs/git-blame

- `git log`:
  https://git-scm.com/docs/git-log

- `git merge-base`:
  https://git-scm.com/docs/git-merge-base

- `git worktree`:
  https://git-scm.com/docs/git-worktree

### Implicações extraídas

- porcelain v2 + NUL é a interface apropriada para machine parsing;
- blame possui formatos machine-oriented;
- log fornece path history, pickaxe e line/function history primitives;
- merge-base fornece base correta para change impact;
- detached worktrees são uma base nativa plausível para experimentação/refactor isolado.

## 60. npm

- `npm audit`:
  https://docs.npmjs.com/cli/v11/commands/npm-audit/

- `npm sbom`:
  https://docs.npmjs.com/cli/commands/npm-sbom/

- `npm explain`:
  https://docs.npmjs.com/cli/v11/commands/npm-explain/

- `npm find-dupes`:
  https://docs.npmjs.com/cli/v11/commands/npm-find-dupes/

### Implicações extraídas

- vulnerabilidades, signatures/provenance, SBOM, dependency chains e duplicate analysis já possuem primitives oficiais; não há razão para reinventar esses analyzers inicialmente.

## 61. TypeScript

- Language Service API:
  https://github.com/microsoft/typescript/wiki/Using-the-Language-Service-API

- Compiler API:
  https://github.com/microsoft/TypeScript/wiki/Using-the-Compiler-API

- Service type surface / references and definitions:
  https://github.com/microsoft/TypeScript/blob/main/src/services/types.ts

### Implicações extraídas

- um Language Service long-lived é a primitive correta para semantic references/definitions/implementations em JS/TS;
- parser/index textual continua útil, mas não deve fingir binding semantics.

---

# CONCLUSÃO

## 62. Diagnóstico final

A surface de 84 tools é significativamente mais coerente que a superfície de 131 entry points auditada anteriormente. A racionalização funcionou: há owners compostos onde composição é justificável, separação de authority em áreas sensíveis, write operations com preconditions, Git publish disciplinado, LLM-B quota confirmation, Cloudflare backup-before-mutation, validation jobs safe e diagnostics especializados.

O próximo salto de qualidade **não** consiste em voltar a crescer horizontalmente com dezenas de wrappers.

O problema que resta é mais interessante:

> **o agente possui poder para executar quase qualquer investigação via terminal, mas ainda não possui semântica estruturada suficiente para fazer algumas das tarefas mais importantes com a mesma precisão, completude e segurança que já existem nas melhores áreas do MCP.**

As lacunas mais transformadoras são:

1. **exhaustive bounded inspection** — inventory/pagination em vez de dumps;
2. **semantic code intelligence** — references/definitions reais;
3. **graph/change impact** — compreender dependências antes de editar;
4. **Git forensics** — usar a memória histórica do repo sem shell;
5. **isolated change sessions** — validar refactors grandes antes da promoção;
6. **principal-bound state** — handles com authorization/lifetime rigorosos;
7. **runtime provenance** — provar qual geração está servindo requests;
8. **test/dependency intelligence** — diagnosticar em vez de apenas executar comandos amplos;
9. **recovery completeness** — especialmente Cloudflare;
10. **generation-aware observability** — medir a superfície atual, não uma mistura histórica.

A formulação mais importante para orientar o próximo trabalho é:

> **liberdade operacional não é ausência de limites; é a capacidade de realizar mais classes de tarefa por caminhos semanticamente fortes, com a menor autoridade necessária e com evidência suficiente para saber quando a operação é correta.**

A melhor arquitetura futura é, portanto, aquela em que `terminal_exec` continua disponível como escape hatch de alta potência, mas deixa de ser necessário para tarefas recorrentes que merecem invariantes melhores.

---

## 63. Estado histórico da auditoria-base

O texto original desta seção registrava corretamente que a **auditoria-base** terminou sem mutação de código e que sua única mudança era a criação deste documento. Essa afirmação é preservada apenas como fato histórico; deixou de descrever o estado corrente desde que o roadmap passou a ser executado.

## 64. Nova reauditoria integral e estado vivo — 2026-08-28 19:30 -03

- releitura integral da versão corrente com **2.637 linhas / ~123 KiB**: **concluída** antes da nova onda de transformação;
- branch observada: `main@f97b2474a`, inicialmente alinhada a `origin/main` porém com a ampla onda de mudanças ainda não commitada;
- strict typecheck reexecutado no início da reauditoria: encontrou somente uma anotação JSDoc ausente no novo executor buffered; corrigida e strict voltou a **verde**;
- testes causais do novo `infra/process/execution` e do Git read adapter: **verdes**;
- drift do próprio roadmap encontrado e corrigido: F7.1 já estava materialmente concluída; F11.1 já possuía current/historical view por runtime epoch, embora ainda falte cohort explícito por capabilities/certificate;
- F3/LSP permanece **deliberadamente adiada**; nenhuma faixa atual deve introduzir TypeScript Language Service/tsserver owner como dependência;
- baseline TypeScript foi efetivamente consolidado em **TS 7.0+ exclusivo**: `typescript@7.0.2` é a única autoridade; aliases TS6/@typescript-native e `typescript-eslint` saíram; Oxlint/tsgolint 7 assumiu o lane type-aware de três regras; global `src` passou com 0 warnings/0 errors em 2.269 arquivos;
- dependency graph npm também foi endurecido: `legacy-peer-deps=false`, peer `hono@4.13.5` materializado no lock, `npm ci --dry-run --ignore-scripts` e `npm ls --all --omit=optional` verdes;
- F5 foi concluída architecture-first: process IO neutro em infra; grammar/parsers/read-service em `workspace/git`; schemas/results em tools; parser `name-status -z` do auto-build passou a reutilizar o owner comum; `git_inspect` inclui agora `tree` NUL-safe além de merge-base/changed-files/show/blame/worktrees;
- F-36 está concluída: `infra/process/supervision` e `infra/process/execution` são os owners comuns; Git e search buffered compartilham a mesma primitive e o streaming search permanece especializado por contrato funcional;
- `repo_change_impact` fecha o input Git range e trata deleted/renamed historical seeds sem exigir existência física corrente;
- surface fonte atual: **88 tools**, `CAPABILITIES_VERSION=83`, semantic contracts `2.19.0`, latency **55**, descriptor fingerprint `eee32b918a88abca177e4803774da0725835f3fbb91129d0cefaf8c6a9a4e7b2`, `git_inspect=wire-v1:918279dabe389fb3`, `repo_change_impact=wire-v1:95c061bf0c47b372`;
- primeira execução de `copilot-fast` no checkpoint passou `typecheck`, `lint` e `docs-contract`, mas corretamente bloqueou publicação por drift no `architecture-contract`; a falha foi tratada como evidência causal, não relaxada;
- manifests arquiteturais foram reconciliados com a implementação real: state scopes removeram o cache já extinto de `orphan-imports` e passaram a declarar o flag único de teardown terminal; `workspace/git` deixou de figurar como child-process launcher físico após F-36; owner graph foi rederivado e fecha **70 owners / 230 dependências diretas / 0 SCC / 0 mismatches / 0 violations**;
- a surface pública MCP aposentada `#copilot/mcp/public/process/supervision` foi removida dos manifests/baselines de custo; o owner físico permanece somente em `#copilot/infra/public/process/supervision`;
- cost governance MCP foi reavaliada por closure, não simplesmente afrouxada: `indexing/auto-build` passou de `micro` para `standard` porque sua closure real é 44 módulos; baseline canônico foi regenerado e fecha **83 aliases / 0 manifest violations / 0 cost violations / 0 import-purity violations**;
- novas surfaces infra `indexing/graph`, `indexing/module-resolution`, `process/execution` e `process/supervision` receberam authority/cost metadata explícita; `module-resolution` foi classificado `standard` pela closure real de 66 módulos / ~237 KiB; rebaseline infra preservou semanticamente o manifest e fecha **53 entrypoints / 0 cost violations / mutable state 20/20**;
- cold-import baseline infra foi regenerado pelo benchmark canônico (`7 samples`, `1 warmup`) para **44 aliases** e valida sem violações; `src/copilot/infra/public/API_REFERENCE.md` foi regenerado e seu check está verde;
- `npm run copilot:architecture:check` está agora **integralmente verde**, incluindo core extinction, graph sem cycles/unresolved imports, 264/264 architecture checks, package-import/surface/owner governance, MCP/infra cost, authority signatures, cold-import baselines e documentação pública;
- a segunda execução de `copilot-fast` confirmou `typecheck`, `lint`, `docs-contract` e `architecture-contract` verdes, mas falhou no `unit-copilot` (59 testes em 8 arquivos); a falha foi decomposta em causas comuns, sem rerun cego da suite: fixtures de write sem `McpPrincipalIdentity`, assertions stale do novo `isError:true`, contracts anteriores à F-36 e uma assertiva SQLite textual stale;
- fixtures de `repo_write`, patch-target-groups e recovery agora carregam principal explícito; `repo_write`/recovery e ambas as suites target-group estão verdes, preservando dry-run negativo como resultado normal e marcando workflow de apply parcial/falho como tool error;
- a dívida F-36 residual também foi fechada: `infra/process/` é capability primária declarada; search buffered consome o barrel interno de `process/execution`; `buffered.js` usa apenas barrels internos; o contract de `child_process` reconhece os dois owners físicos atuais (`stream.js` especializado e `process/execution/buffered.js` genérico);
- `source-barrier.js` deixou de possuir writers `node:fs/promises`: persistência do manifest passa pela `workspace.io` já composta; o workload L2 passou a ler por `runtime.workspace(...).io`; o teste de fingerprint SQLite consome a membrane pública de testing;
- a surface `#copilot/infra/public/composition/database/sqlite/path` foi normalizada integralmente para barrel: package alias → `public/.../path/index.js` → `composition/.../path/index.js` → `service.js`; o rebaseliner canônico recalculou as 53 closures preservando metadata semântica;
- após essas correções, as sete suites causais ficaram verdes, `typecheck:strict:src.copilot` ficou verde e `npm run copilot:architecture:check` voltou a ficar integralmente verde;
- a terceira execução final de `copilot-fast` concluiu **verde** em ~333 s (exit 0), atravessando novamente `typecheck`, `lint`, `docs-contract`, `architecture-contract` e o conjunto `unit-copilot` de 723 arquivos; o checkpoint está, portanto, liberado para revisão Git final, staging explícito e publicação, sem novo gate amplo salvo se o diff mudar materialmente durante o fechamento.

### 64.1. Critérios objetivos para commit/push

Um commit/push somente é autorizado quando **todos** os critérios abaixo forem verdadeiros:

1. a faixa/checkpoint escolhido forma uma unidade arquitetural coerente e o roadmap descreve exatamente o que foi concluído e o que permanece aberto;
2. `typecheck:strict:src.copilot` está verde após as últimas mutações;
3. todos os testes causais diretamente associados às mudanças estão verdes;
4. se a surface mudou, tool count, versions, semantic contracts, profiles e descriptor fingerprints/snapshots estão intencionalmente atualizados e seus gates estão verdes;
5. um gate mais amplo (`mcp-fast`/`copilot-fast` ou equivalente) é executado **somente no checkpoint cross-cutting anterior ao commit**, não a cada micro-onda;
6. `git diff --check`, status e diff summary não apresentam whitespace errors, arquivos acidentais ou mudanças sem explicação na onda atual;
7. staging é explícito e o commit representa a unidade arquitetural auditada — nenhum `git add -A` cego;
8. imediatamente antes do push, `origin/main` é consultada novamente; se avançou, a divergência é integrada/reavaliada e os gates proporcionais são repetidos;
9. o push deve ser fast-forward/non-force; após ele, provar `HEAD == origin/main`, branch `main` e working tree limpa;
10. somente então o checkpoint pode ser marcado como **100% sincronizado com main**.
