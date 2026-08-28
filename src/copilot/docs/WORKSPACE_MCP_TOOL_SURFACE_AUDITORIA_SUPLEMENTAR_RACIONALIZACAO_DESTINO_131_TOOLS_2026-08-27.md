# WORKSPACE MCP — AUDITORIA SUPLEMENTAR DA SUPERFÍCIE DE TOOLS

## Racionalização pós-fricção de autorização, consolidação de entry points e destino recomendado das 131 tools — 2026-08-27

> **Status:** ROADMAP SUPLEMENTAR VIVO / IMPLEMENTAÇÃO EM CURSO / EVIDENCE-BOUND. SUP-0, SUP-1/W1 e
> SUP-1/W2 estão concluídas em source; nenhuma mudança é promovida ao host sem os gates correspondentes.
>
> **Relação com o documento canônico de round-trip:** este arquivo é deliberadamente **paralelo** ao
> `WORKSPACE_MCP_ROUND_TRIP_HOT_TOOLS_BATCH_ORCHESTRATION_AUDITORIA_PROFUNDA_ESTADO_ATUAL_ESTADO_ALVO_ROADMAP_2026-08-26.md`.
> Ele **não substitui, reordena nem fecha** gates daquele roadmap. Recomendações de remoção, fusão
> ou mudança de surface aqui só passam a ser trabalho executável quando uma rodada futura as adotar
> explicitamente.
>
> **Escopo vivo:** a fase puramente documental encerrou-se. A implementação foi autorizada e passou a
> seguir este arquivo como ledger obrigatório: investigar primeiro, transformar em ondas coerentes,
> atualizar guidance/tests/contratos no mesmo change-set e certificar cada onda antes de avançar.
>
> **Workspace:** `/workspaces/chatgpt-docker-puppeteer`; foco `src/copilot/mcp`.
>
> **Baseline Git de entrada:** `main`, worktree limpa e `main == origin/main` antes da criação deste
> documento.

---

# 1. Decisão executiva

O baseline congelado desta auditoria tinha **131 tools / 162.586 B** no `tools/list`. W1 removeu
seis aliases/redundâncias; W2 aposentou oito plan-tools históricas; W3 retirou quatro entry points
adicionais; W4 consolidou read-state owners; W5 consolidou meta e connection locais respeitando
least-authority. W6 fechou o control plane LLM-B; W7 consolidou os reads Cloudflare externos e W8
consolidou mutation/local-observability owners sem misturar recovery boundaries. O estado
**source-side certificado** atual é **89 tools / 131.652 B**, fingerprint full
`19d1ec79ab66919609cec98d092e9a68b613ecfaf95b3c6872988a47958201ac`: menos **42 tools
(-32,06%)** e **30.934 B (-19,03%)** que o baseline.

A decisão normativa foi refinada pela execução:

1. **capacidade, não nome nem scope histórico, é a unidade de preservação**. Um entry point separado
   só sobrevive quando fornece uma decisão/capacidade que o owner canônico não reproduz integralmente;
2. **`dryRun` server-enforced pode substituir uma plan-tool**, mesmo que o owner também possua modo de
   escrita, desde que o ramo de preview seja comprovadamente não mutante, não emita capability
   mutável desnecessária e preserve o conteúdo útil de preflight/preview;
3. **autoridade continua sendo requisito da execução real**, mas não é justificativa autônoma para
   duplicar entry points somente porque antigas heurísticas de approval do host favoreciam uma tool
   read-only separada;
4. **wrappers que comprimem trabalho não são automaticamente redundantes**. A reauditoria pós-W2
   mostrou que `mcp_maintenance_apply_safe_fixes` reduz round-trips e que
   `delegate_to_repo_autonomy_runner` contém hoje a única execução MCP de benchmarks IO/transport;
   esses casos exigem absorção/rehome antes de aposentadoria;
5. **instrumentos de medição host-side também não podem virar scripts internos por decreto**:
   `mcp_latency_pulse` observa justamente os gaps entre chamadas que chegam ao origin e
   `mcp_client_latency_evidence` persiste evidência fornecida pelo cliente. Ambos permanecem enquanto
   o programa de latência/round-trip precisar deles;
6. **Cloudflare exige parity por política, não por semelhança de nome**. O edge plan atual cobre
   metadata-cache/compression que o edge apply ainda não materializa; portanto ele migra para SUP-3,
   não pode ser removido como alias exato. O passthrough plan, por outro lado, pode ser absorvido pelo
   apply depois de tornar `dryRun` realmente side-effect-free e devolver o mesmo plano/invariants.

A meta não é chegar a uma contagem predeterminada. A direção permanece reduzir fortemente a
superfície, mas cada retirada precisa melhorar simultaneamente **seleção, round-trip e coerência de
owner sem perder capacidade operacional legítima**.

---

# 2. Contrato de não-confusão com o roadmap de round-trip

Esta auditoria complementa o programa de round-trip em quatro pontos, mas não é uma faixa dele:

- o roadmap de round-trip pergunta **como reduzir chamadas e custo dentro das tools que existem**;
- esta auditoria pergunta **quais entry points deveriam existir**;
- o roadmap pode manter temporariamente instrumentos como `mcp_round_trip_analytics` e
  `mcp_tool_payload_audit`;
- esta auditoria pode recomendar a aposentadoria futura desses instrumentos depois que a campanha
  que os exige terminar.

Portanto, “retirar do default”, “fundir” e “deletar adapter” não são sinônimos. A execução futura
deverá distinguir: **capacidade interna**, **entry point MCP**, **surface padrão**, **surface
administrativa**, **surface de recovery** e **surface de integração**.

---

# 3. Premissa de autorização e limite epistemológico

A premissa operacional fornecida pelo usuário é que o antigo problema de autorizações/approvals no
`chatgpt.com` não está mais presente. A evidência do origin é compatível com uma postura muito mais
autônoma: OAuth está em `max-autonomy`, o grant inicial inclui `repo:read`, `repo:write`,
`repo:validate` e `repo:admin`, `stepUpPreferred=false`, a readiness de conexão está verde e o risco
de reautenticação é classificado como baixo.

Isso **não** significa que todo evento chamado “auth denied” desapareceu. O audit do origin
registrou 20 `tool_call_auth_denied` nas 24 h examinadas: 18 em `repo_apply_patch` e 2 em
`terminal_session_control`; 18/20 estavam marcados `runtimeSourceBinding=manual-unbound`. Esses
eventos são negações de scope no origin em chamadas manuais/diagnósticas e **não equivalem** ao
antigo problema de approval/block do host. Não usar essa contagem para ressuscitar wrappers de
approval nem, no sentido oposto, para enfraquecer OAuth/per-tool scopes.

---

# 4. Metodologia e autoridades de evidência

A auditoria combinou cinco autoridades, nesta ordem:

1. **Registry canônica real:** `getCanonicalMcpTools()` materializada sob a surface `full`;
   exatamente 131 tools.
2. **Wire real do SDK:** medição por `tools/list` in-memory após a conversão dos schemas; envelope
   162.586 B.
3. **Audit append-only:** somente `tool_call_started` e metadados sanitizados; janelas de 1 h, 24 h,
   7 d e 14 d, congeladas em `2026-08-27T23:38:08.621623Z` (`20:38:08-03:00`, America/Sao_Paulo).
4. **Owners de código:** definição atual, shared owner, dry-run/revalidation e composições internas.
5. **Histórico Git:** blame da definição atual para identificar entry points criados na campanha de
   autonomia/approval.

Frequência é um **sinal**, não um critério único. Uma tool de cancelamento ou restore pode ter uso
zero e ainda ser obrigatória para fechar um ciclo de risco. De modo inverso, uma plan-tool pode ter
dezenas de usos e continuar redundante se a própria documentação ensinava o modelo a chamá-la antes
de um apply que já revalida tudo.

---

# 5. Baseline quantitativo

| Métrica                         |     Valor |
| ------------------------------- | --------: |
| Tools anunciadas                |       131 |
| Read-only                       |        93 |
| Bounded-write                   |        30 |
| Destructive                     |         8 |
| Open-world                      |        10 |
| `tools/list` envelope           | 162.586 B |
| Bytes das entradas de tools     | 162.410 B |
| Input schemas                   |  77.362 B |
| Starts 24 h                     |     1.948 |
| Starts 7 d                      |    12.770 |
| Starts 14 d                     |    26.324 |
| Tools nunca observadas no audit |         6 |

## 5.1 Núcleo quente a preservar

| Tool                     | 24 h |   7 d | Descriptor | Decisão     |
| ------------------------ | ---: | ----: | ---------: | ----------- |
| `terminal_exec`          |  443 | 4.538 |    9.464 B | manter core |
| `repo_read_file`         |  360 | 1.632 |    1.700 B | manter core |
| `repo_search_text`       |  316 | 1.377 |    2.219 B | manter core |
| `repo_apply_patch_batch` |  172 | 1.114 |    4.636 B | manter core |
| `repo_apply_patch`       |  171 |   891 |    2.271 B | manter core |

Essas cinco tools responderam por **1.462/1.948 starts em 24 h (75.1%)**. A auditoria recomenda
explicitamente **não fundi-las nem removê-las**. Otimização futura nelas deve atacar schema,
payload, batching e semântica interna, não apagar entry points úteis.

---

# 6. Taxonomia de destino

| Código                              | Significado normativo                                                                                       |
| ----------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| **MANTER — CORE**                   | Entry point geral e frequente; deve continuar fácil de descobrir.                                           |
| **MANTER — ADMIN**                  | Capacidade válida, porém operacional/diagnóstica; candidata a surface administrativa/progressive discovery. |
| **MANTER — RECOVERY**               | Rara por desenho, mas necessária para fechar falha/cancelamento/rollback; não avaliar por popularidade.     |
| **MANTER — INTEGRAÇÃO**             | Contrato especial de Apps SDK, Company Knowledge ou LLM-B; preservar fora do core quando possível.          |
| **MANTER — ESPECIALISTA**           | Capacidade única de baixa frequência; manter discoverable por surface especializada.                        |
| **MANTER — TEMPORÁRIO/ROADMAP**     | Instrumento necessário ao programa de auditoria atual; reavaliar ao encerrar a campanha.                    |
| **FUNDIR → APOSENTAR**              | Transferir capacidade para owner canônico; só então remover o entry point antigo.                           |
| **RETIRAR DO MCP / MANTER INTERNO** | Deixar de anunciar como tool, preservando biblioteca, fixture ou CLI quando útil.                           |
| **APOSENTAR — REDUNDANTE**          | Remover o adapter/entry point; capacidade já existe em outra tool sem perda semântica.                      |

---

# 7. Achado histórico: a camada de autonomia/approval de maio de 2026

O Git confirma que vários entry points foram introduzidos num cluster temporal e semântico muito
específico:

| Tool / grupo                       | Data do blame atual | Commit / intenção histórica                                  | Destino recomendado             |
| ---------------------------------- | ------------------- | ------------------------------------------------------------ | ------------------------------- |
| `mcp_session_profile`              | 2026-05-23          | `00a741a32e30` — feat(mcp): improve ChatGPT autonomy profile | FUNDIR → APOSENTAR              |
| `mcp_tools_status`                 | 2026-05-23          | `00a741a32e30` — feat(mcp): improve ChatGPT autonomy profile | FUNDIR → APOSENTAR              |
| `mcp_golden_prompts`               | 2026-05-23          | `044b2060d516` — docs(mcp): add golden prompt measurement    | RETIRAR DO MCP / MANTER INTERNO |
| `mcp_host_block_diagnostics`       | 2026-05-23          | `c6fa00ed3316` — feat(mcp): diagnose ChatGPT host blocks     | RETIRAR DO MCP / MANTER INTERNO |
| `mcp_autonomy_power_score`         | 2026-05-23          | `be13e1fe3152` — feat(mcp): add autonomy power score         | FUNDIR → APOSENTAR              |
| `delegate_to_repo_autonomy_runner` | 2026-05-23          | `d1f25cddccf0` — feat(mcp): add allowlisted autonomy runner  | RETIRAR DO MCP / MANTER INTERNO |
| `repo_patch_plan`                  | 2026-05-23          | `4475025edf40` — feat(mcp): add plan-only autonomy metadata  | FUNDIR → APOSENTAR              |
| `repo_create_file_plan`            | 2026-05-23          | `4475025edf40` — feat(mcp): add plan-only autonomy metadata  | FUNDIR → APOSENTAR              |
| `repo_move_file_plan`              | 2026-05-23          | `4475025edf40` — feat(mcp): add plan-only autonomy metadata  | FUNDIR → APOSENTAR              |
| `repo_quarantine_file_plan`        | 2026-05-23          | `4475025edf40` — feat(mcp): add plan-only autonomy metadata  | FUNDIR → APOSENTAR              |
| `mcp_validation_plan`              | 2026-05-23          | `4475025edf40` — feat(mcp): add plan-only autonomy metadata  | APOSENTAR — REDUNDANTE          |

O ponto não é “código velho = código ruim”. O ponto é que a **razão arquitetural que justificava
vários desses entry points mudou**. `mcp_host_block_diagnostics` e `mcp_golden_prompts` continuam
úteis como regressão/test fixture, mas não precisam ocupar permanentemente a superfície entregue ao
modelo. Plan-only adapters de create/move/patch perderam a principal justificativa quando os apply
owners passaram a ter dry-run, preconditions e revalidação próprios.

---

# 8. Achado estrutural: plan-tool separada não é uma fronteira de segurança por si só

Hoje vários applies já executam exatamente o que uma plan-tool deveria garantir:

- `repo_apply_patch`, `repo_apply_patch_batch`, `repo_create_file`, `repo_move_file`,
  `repo_quarantine_file` e `repo_apply_file_batch` aceitam dry-run/preview ou revalidam o mesmo
  estado antes da mutação;
- `mcp_cloudflare_edge_policy_apply` e `mcp_cloudflare_mcp_passthrough_apply` defaultam para
  dry-run;
- `git_stage`, `git_commit` e `git_push` revalidam suas preconditions no momento do efeito;
- o Workflow Policy SSOT já diz que plan não é happy path para
  patch/file-batch/validation/publication.

Logo, separar um `*_plan` apenas para atravessar uma autorização diferente do host é dívida
histórica. Uma plan-tool só deve sobreviver quando **o ato de planejar é uma capacidade diferente**,
por exemplo uma simulação cara que retorna informação não disponível no apply dry-run, ou quando há
uma fronteira humana deliberadamente separada.

---

# 9. Auditoria por família

## 9.1 Repositório: preservar o hot path, remover aliases e plumbing

Manter como core `repo_read_file`, `repo_search_text`, `repo_bulk_inspect`, `repo_tree`,
`repo_status`, `repo_file_stats`, `repo_file_outline`, `repo_symbol_search`,
`repo_find_symbol_usages`, `repo_working_set`, os mutators principais e `repo_find_orphan_imports`.
`repo_root_tree` é explicitamente equivalente a `repo_tree(path=".")` e deve desaparecer.
`repo_index_find_symbol` duplica o symbol search canônico. Invalidation do índice é plumbing
automático e não deveria ser uma decisão exposta ao modelo.

Todas as plan-tools de patch/create/move/quarantine/file-batch devem ser aposentadas em favor de
`dryRun=true` no owner que também aplica. **Exceção:** não fundir `repo_apply_patch` no batch; o
single patch é extremamente quente e uma interface menor continua sendo uma boa fronteira cognitiva.

## 9.2 Validação/jobs: 12 → aproximadamente 6 entry points duráveis

`run_typecheck_copilot`, `run_lint_copilot` e `run_unit_copilot` são aliases gerados pelo mesmo
`buildValidatorAliasTool` e chamam o backend que `run_copilot_validator` já expõe. Devem ser
removidos. Também há duplicação literal entre `run_project_doctor` e `project_doctor`; manter apenas
`project_doctor`.

`job_list` e `mcp_last_validation_summary` devem virar views do `mcp_validation_dashboard`.
Preservar `job_get_summary`, `job_get_output` e `job_cancel`: summary/output separam payload
compacto de log e cancel fecha o ciclo de jobs longos. `mcp_run_safe_validation_suite` permanece
como release/cross-cutting gate, não como default.

## 9.3 Git: um happy path e um recovery path, não sete etapas rotineiras

Preservar `git_publish_changes` como happy path. `git_stage_plan`, `git_commit_plan` e
`git_push_plan` devem desaparecer **somente após** seus previews não mutantes serem absorvidos pelos
owners sobreviventes: hoje `git_stage_plan` enumera o conjunto exato a stagear, `git_commit_plan`
expõe staged files/stat/identidade e `git_push_plan` oferece preflight remoto sem efetuar o push.
Revalidação no apply é necessária, mas não substitui semanticamente um preview read-only. `git_stage`,
`git_commit` e `git_push` permanecem como recovery/fallback enquanto ainda existirem estados de
pre-staged index e partial publish. Uma etapa futura pode substituir os três por um único
**resume/recovery** fechado, mas não remover a capacidade de recuperação antes disso.

## 9.4 Conexão/OAuth: oito entry points são demais para uma única responsabilidade

`mcp_connection_readiness` já retorna URL validada, form values, OAuth metadata/scopes/JWKS, HTTP/2+
e tunnel/smoke. Ela deve ser o owner normal. `chatgpt_connector_profile`,
`chatgpt_connector_url_check`, `chatgpt_connector_current_url_status` e `mcp_auth_profile` devem ser
absorvidos/retirados. Os dois diagnósticos OAuth podem virar uma única view profunda
(`mcp_oauth_diagnostics` ou `deep=true` em readiness). O perfil Claude deve ser preservado como
projection de integração, não como mais um entry point permanente.

## 9.5 Cloudflare: 17 tools → poucos owners administrativos

Este é o maior cluster de baixa frequência: 17 tools, 12.566 B de descriptors e apenas 20 starts/7d
no baseline. `mcp_cloudflare_edge_snapshot` já chama internamente remote audit + edge audit + policy
diff; portanto esses três standalones são duplicação demonstrada. O snapshot deve ainda absorver
config, skip, passthrough diff e plan-capability posture.

Mutação deve continuar **separada** do snapshot read-only: não criar uma mega-tool read+write que
destrua annotations/least authority. `mcp_cloudflare_edge_policy_apply` permanece o owner de
mutation e pode absorver passthrough como uma fase fechada. Backup creation deve ser
automática/mandatória dentro do apply; listagem de backups permanece recovery-only. Metrics e
post-change gates permanecem ferramentas administrativas úteis.

## 9.6 Meta/autonomia: remover a interface da crise, preservar a inteligência interna

A recomendação mais forte desta auditoria é retirar `mcp_golden_prompts`,
`mcp_host_block_diagnostics` e `delegate_to_repo_autonomy_runner` da superfície MCP. Seus
owners/fixtures podem sobreviver internamente para regressão. `mcp_session_profile`,
`mcp_tools_status` e `mcp_autonomy_power_score` devem ser projeções opcionais de um único
`mcp_capabilities_summary`, não três decisões adicionais para o modelo.

## 9.7 Terminal: não consolidar por contagem

`terminal_exec`, `terminal_session_control` e `terminal_session_read` devem permanecer. Em especial,
control e read não devem ser fundidos: uma única tool teria de carregar a autoridade
destrutiva/open-world do controle mesmo para uma simples leitura de output. O custo de descriptor do
terminal deve ser atacado por schema/defaults, não por apagar uma fronteira de least authority
correta.

## 9.8 LLM-B/Copilot SDK: simplificar sem enfraquecer o futuro

Preservar `llmb_live_readiness`, `llmb_live_test_plan`, `llmb_live_test_run` e
`llmb_live_test_cancel`. O cancel é raro por desenho; removê-lo deixaria um harness destacado sem
inverse operation. A reauditoria W6 mostrou que `llmb_live_test_plan` **não** deve ser fundido ao run:
o plan é `read/local/effect=none`, enquanto o run é `write/open-world/model-provider/bounded-write`;
a fusão faria um preview seguro herdar autoridade de provider. `llmb_live_runs`, por outro lado,
possui a mesma classe `read/local/idempotent/cancellable` da readiness e pode virar uma view fechada
que despacha diretamente ao comando persisted-runs, sem executar o readiness path. `copilot_sessions`
já é o owner consolidado de observabilidade de sessions.

## 9.9 Company Knowledge / Apps SDK: zero uso local não autoriza remoção

`search` e `fetch` são a dupla de nomes/contratos esperada pela integração Company Knowledge e foram
confirmadas como read-only e Apps-SDK-ready. Devem permanecer numa surface de integração mesmo com
zero starts no audit local. `mcp_apps_sdk_readiness` também permanece como diagnóstico de
integração, não como core de programação.

## 9.10 Latência/observabilidade: distinguir instrumento de produto

`mcp_round_trip_analytics`, `mcp_tool_payload_audit` e `mcp_latency_dashboard` continuam necessários
enquanto o roadmap de round-trip/tool-surface está ativo. Marcar como **temporários do roadmap**,
não como API eterna. O endpoint probe deve ser absorvido por attribution; client-latency evidence e
pulse devem sair do MCP normal e permanecer como instrumentos internos para experimentos
controlados.

---

# 10. Arquitetura-alvo de surfaces

Não executar uma troca cega de `full` para um surface reduzido nesta rodada. O registry atual
seleciona surfaces estaticamente por `COPILOT_MCP_TOOL_SURFACE`; isso é útil para A/B, mas ainda não
é progressive discovery real. O estado-alvo conceitual deve ter cinco classes:

1. **Core/default:** leitura/escrita Git/repo/terminal/validation de uso geral e baixo custo
   cognitivo.
2. **Admin/diagnostic:** Cloudflare, OAuth, dependencies, network, index rebuild, deep latency.
3. **Recovery:** cancel, restore, granular Git resume, reload uncertainty, Cloudflare rollback.
4. **Integration:** Company Knowledge, Apps SDK, LLM-B/Copilot sessions.
5. **Internal-only:** fixtures, benchmarks e plumbing que não precisam ser decisões do modelo.

O roadmap oficial do MCP de **22 de agosto de 2026** reconhece explicitamente que conectar um
servidor com cerca de cem tools faz o modelo pagar por toda a superfície e tende a piorar seleção, e
inicia um esforço de **progressive discovery**. O release `2026-07-28` também tornou list responses
cacheáveis e introduziu `server/discover`. Portanto, a direção desta auditoria é compatível com o
protocolo, mas não se deve inventar um mecanismo proprietário de discovery antes de o padrão
amadurecer.

Fontes oficiais:

- https://blog.modelcontextprotocol.io/posts/mcp-roadmap/
- https://blog.modelcontextprotocol.io/posts/2026-07-28/

---

# 11. Impacto quantitativo — baseline histórico e execução

| Classe                          | Tools atuais | Descriptor bytes | Starts 24 h | Starts 7 d |
| ------------------------------- | -----------: | ---------------: | ----------: | ---------: |
| MANTER — CORE                   |           35 |           73.102 |       1.782 |     12.342 |
| MANTER — ADMIN                  |           18 |           16.383 |          48 |        127 |
| MANTER — RECOVERY               |            8 |            6.663 |          30 |         59 |
| MANTER — INTEGRAÇÃO             |            5 |            5.378 |           1 |         10 |
| MANTER — ESPECIALISTA           |            2 |            2.164 |           0 |          1 |
| MANTER — TEMPORÁRIO/ROADMAP     |            3 |            4.280 |          51 |         72 |
| MANTER — PREVIEW READ-ONLY      |            2 |            5.816 |           7 |         45 |
| FUNDIR → APOSENTAR              |           37 |           28.915 |          26 |         97 |
| APOSENTAR — REDUNDANTE          |           10 |            7.069 |           1 |         15 |
| RETIRAR DO MCP / MANTER INTERNO |           11 |           12.640 |           2 |          2 |

As contagens da tabela acima são a **classificação histórica da auditoria inicial de 131 tools** e
não devem mais ser interpretadas como forecast normativo: W2 falsificou a premissa de preservar dois
preview owners apenas por authority parity, e a reauditoria W3 reclassificou instrumentos de
latência/orquestração que não podem ser retirados diretamente.

**Checkpoint executado:** 131 → 125 → 117 → 113 → 108 → 101 → 100 → 91 → **89 tools**; 162.586 →
158.276 → 147.500 → 145.098 → 142.688 → 138.558 → 138.225 → 132.741 → **131.652 B**. A economia
acumulada é **30.934 B / 19,03%** de envelope. W8 encerrou com `mcp-fast` e `mcp-full` verdes e
**126 arquivos / 755 testes MCP**. O forecast final continua subordinado aos owners reais produzidos
pelas próximas ondas.

Esse resultado é qualitativamente melhor que “esconder raros”: as aposentadorias são sustentadas por
**redundância semântica/owner**, e a baixa frequência serve apenas como confirmação de que o risco
de migração é administrável.

---

# 12. Matriz canônica 131/131 — destino recomendado de cada tool

Esta tabela é a parte normativa da auditoria suplementar. `FUNDIR → APOSENTAR` significa **não
remover antes de o replacement ter parity comprovada**. “APOSENTAR — REDUNDANTE” significa que a
capacidade já está coberta hoje.

|   # | Tool                                             | Grupo      | 24 h |  7 d | Bytes | Owner atual                               | Destino                             | Replacement / destino                                     | Razão                                                                                                                                                                                      |
| --: | ------------------------------------------------ | ---------- | ---: | ---: | ----: | ----------------------------------------- | ----------------------------------- | --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
|   1 | `chatgpt_connector_current_url_status`           | connection |    0 |    2 |   663 | `tools/connection.js`                     | **FUNDIR → APOSENTAR**              | `mcp_connection_readiness`                                | Capacidade válida, mas o entry point separado não justifica owner próprio; absorver em mcp_connection_readiness e aposentar somente após parity comprovada.                                |
|   2 | `chatgpt_connector_profile`                      | connection |    0 |    0 |   739 | `tools/connection.js`                     | **RETIRAR DO MCP / MANTER INTERNO** | `mcp_connection_readiness`                                | Não justifica permanecer como decisão MCP; retirar do catálogo e preservar internamente em mcp_connection_readiness quando útil para regressão/operação.                                   |
|   3 | `chatgpt_connector_url_check`                    | connection |    0 |    0 |   702 | `tools/connection.js`                     | **FUNDIR → APOSENTAR**              | `mcp_connection_readiness`                                | Capacidade válida, mas o entry point separado não justifica owner próprio; absorver em mcp_connection_readiness e aposentar somente após parity comprovada.                                |
|   4 | `claude_connector_profile`                       | connection |    0 |    0 |   734 | `tools/connection.js`                     | **FUNDIR → APOSENTAR**              | `mcp_connection_readiness`                                | Capacidade válida, mas o entry point separado não justifica owner próprio; absorver em mcp_connection_readiness e aposentar somente após parity comprovada.                                |
|   5 | `copilot_session_get`                            | copilotSdk |    0 |    0 |   633 | `tools/copilot-session.js`                | **FUNDIR → APOSENTAR**              | `copilot_sessions`                                        | Merge get/list into one read-only session-observability tool with action=list\|get; keep on LLM-B integration surface.                                                                     |
|   6 | `copilot_sessions_list`                          | copilotSdk |    0 |    0 |   659 | `tools/copilot-session.js`                | **FUNDIR → APOSENTAR**              | `copilot_sessions`                                        | Capacidade válida, mas o entry point separado não justifica owner próprio; absorver em copilot_sessions e aposentar somente após parity comprovada.                                        |
|   7 | `delegate_to_repo_autonomy_runner`               | runtime    |    0 |    0 |  1156 | `tools/delegation-runner.js`              | **RETIRAR DO MCP / MANTER INTERNO** | `direct MCP tools / validator`                            | Wrapper da campanha de autonomia de maio; direct tools e validators hoje cobrem suas missões sem um meta-runner MCP.                                                                       |
|   8 | `fetch`                                          | read       |    0 |    0 |  1184 | `tools/company-knowledge.js`              | **MANTER — INTEGRAÇÃO**             | `Company Knowledge`                                       | Contrato exato de Company Knowledge pareado com search; preservar na surface de integração mesmo sem uso local observado.                                                                  |
|   9 | `git_branch_info`                                | git        |    3 |   11 |   832 | `tools/git-read.js`                       | **MANTER — CORE**                   | `Git read surface`                                        | Capacidade distinta e de uso geral; preservar como entry point core. Responsabilidade: Git read surface.                                                                                   |
|  10 | `git_commit`                                     | git        |    3 |   11 |   744 | `tools/git-write.js`                      | **MANTER — RECOVERY**               | `granular Git fallback`                                   | Necessário para índice intencionalmente pré-staged/partial publish; manter recovery até existir composite equivalente.                                                                     |
|  11 | `git_commit_plan`                                | git        |    2 |   10 |   667 | `tools/git-write.js`                      | **FUNDIR → APOSENTAR**              | `git_commit(preview) / Git recovery owner`                | Preserva preview read-only de staged files/stat/identidade que `git_commit` atual revalida internamente, mas não expõe sem mutar; absorver preview antes da retirada.                       |
|  12 | `git_diff`                                       | git        |    1 |    3 |   976 | `tools/git-read.js`                       | **MANTER — CORE**                   | `Git read surface`                                        | Capacidade distinta e de uso geral; preservar como entry point core. Responsabilidade: Git read surface.                                                                                   |
|  13 | `git_log`                                        | git        |    1 |    6 |   868 | `tools/git-read.js`                       | **MANTER — CORE**                   | `Git read surface`                                        | Capacidade distinta e de uso geral; preservar como entry point core. Responsabilidade: Git read surface.                                                                                   |
|  14 | `git_publish_changes`                            | git        |    4 |    7 |  1833 | `tools/git-write.js`                      | **MANTER — CORE**                   | `primary publication path`                                | Capacidade distinta e de uso geral; preservar como entry point core. Responsabilidade: primary publication path.                                                                           |
|  15 | `git_push`                                       | git        |    3 |   10 |  1141 | `tools/git-write.js`                      | **MANTER — RECOVERY**               | `publication resume`                                      | Necessário para retomar publicação quando commit já ocorreu e o push falhou/foi adiado; manter recovery.                                                                                   |
|  16 | `git_push_plan`                                  | git        |    2 |   10 |   733 | `tools/git-write.js`                      | **FUNDIR → APOSENTAR**              | `git_push(previewOnly) / publication recovery owner`      | `pushDryRunFirst` ainda acopla preflight ao push real; preservar a capacidade de dry-run remoto read-only até existir preview-only com parity.                                               |
|  17 | `git_stage`                                      | git        |    3 |    8 |  1087 | `tools/git-write.js`                      | **MANTER — RECOVERY**               | `granular Git fallback`                                   | Necessário para casos granulares excepcionais enquanto não houver composite de recovery equivalente; manter recovery.                                                                      |
|  18 | `git_stage_plan`                                 | git        |    2 |    8 |   809 | `tools/git-write.js`                      | **FUNDIR → APOSENTAR**              | `git_stage(preview) / Git recovery owner`                 | Preserva enumeração read-only do conjunto exato de paths e mode drift; `git_stage` atual revalida, mas não oferece preview-only. Absorver antes da retirada.                                  |
|  19 | `git_status`                                     | git        |    6 |   26 |   737 | `tools/git-read.js`                       | **MANTER — CORE**                   | `Git read surface`                                        | Capacidade distinta e de uso geral; preservar como entry point core. Responsabilidade: Git read surface.                                                                                   |
|  20 | `job_cancel`                                     | validation |    0 |    2 |   563 | `tools/jobs.js`                           | **MANTER — RECOVERY**               | `validator lifecycle`                                     | Inverse operation necessária para job longo; baixa frequência é esperada e não justifica remoção.                                                                                          |
|  21 | `job_get_output`                                 | validation |    2 |   23 |   685 | `tools/jobs.js`                           | **MANTER — CORE**                   | `validator diagnostics`                                   | Capacidade distinta e de uso geral; preservar como entry point core. Responsabilidade: validator diagnostics.                                                                              |
|  22 | `job_get_summary`                                | validation |   32 |   72 |   593 | `tools/jobs.js`                           | **MANTER — CORE**                   | `validator lifecycle`                                     | Capacidade distinta e de uso geral; preservar como entry point core. Responsabilidade: validator lifecycle.                                                                                |
|  23 | `job_list`                                       | validation |    0 |    0 |   910 | `tools/jobs.js`                           | **FUNDIR → APOSENTAR**              | `mcp_validation_dashboard`                                | Capacidade válida, mas o entry point separado não justifica owner próprio; absorver em mcp_validation_dashboard e aposentar somente após parity comprovada.                                |
|  24 | `llmb_live_readiness`                            | runtime    |    1 |   10 |   743 | `tools/llm-b-live.js`                     | **MANTER — INTEGRAÇÃO**             | `LLM-B control plane`                                     | Preservar como owner de readiness da LLM-B. A consulta feita em 27/08 retornou snapshot gerado em 14/08 com gap de SQLite parity; isso exige revalidação futura, não remoção.              |
|  25 | `llmb_live_runs`                                 | runtime    |    0 |    1 |   603 | `tools/llm-b-live.js`                     | **FUNDIR → APOSENTAR**              | `llmb_live_readiness(view=runs)`                          | W6 provou authority/effect/cancellation parity. A view `runs` deve chamar diretamente o fixed read-only runs command e jamais executar readiness/fingerprint primeiro.                       |
|  26 | `llmb_live_test_cancel`                          | runtime    |    0 |    0 |   689 | `tools/llm-b-live.js`                     | **MANTER — RECOVERY**               | `LLM-B control plane`                                     | Inverse operation de segurança para harness destacado; manter como recovery mesmo com uso zero.                                                                                            |
|  27 | `llmb_live_test_plan`                            | runtime    |    0 |    0 |  1556 | `tools/llm-b-live.js`                     | **MANTER — PREVIEW READ-ONLY**      | `LLM-B least-authority preview`                           | W6 reclassificou: plan é read/local/effect=none; run é write/open-world/model-provider. Fundir reduziria contagem mas elevaria authority do preview, violando least-authority.              |
|  28 | `llmb_live_test_run`                             | runtime    |    0 |    0 |  1676 | `tools/llm-b-live.js`                     | **MANTER — INTEGRAÇÃO**             | `LLM-B control plane`                                     | Contrato/capacidade de integração válido; preservar na surface de integração (LLM-B control plane) e não julgar apenas por uso local.                                                      |
|  29 | `mcp_apps_sdk_readiness`                         | runtime    |    0 |    0 |   590 | `tools/apps-sdk-readiness.js`             | **MANTER — INTEGRAÇÃO**             | `Apps SDK / Company Knowledge`                            | Contrato/capacidade de integração válido; preservar na surface de integração (Apps SDK / Company Knowledge) e não julgar apenas por uso local.                                             |
|  30 | `mcp_auth_profile`                               | connection |    0 |    0 |   750 | `tools/connection.js`                     | **FUNDIR → APOSENTAR**              | `mcp_connection_readiness`                                | Capacidade válida, mas o entry point separado não justifica owner próprio; absorver em mcp_connection_readiness e aposentar somente após parity comprovada.                                |
|  31 | `mcp_autonomy_power_score`                       | runtime    |    2 |    2 |   612 | `tools/tools-status.js`                   | **FUNDIR → APOSENTAR**              | `mcp_capabilities_summary`                                | Capacidade válida, mas o entry point separado não justifica owner próprio; absorver em mcp_capabilities_summary e aposentar somente após parity comprovada.                                |
|  32 | `mcp_capabilities_summary`                       | runtime    |    2 |    2 |   695 | `tools/meta.js`                           | **MANTER — ADMIN**                  | `meta/control surface`                                    | Capacidade legítima, porém operacional/diagnóstica; manter em surface administrativa, fora do hot path. Responsabilidade: meta/control surface.                                            |
|  33 | `mcp_cleanup_ai_artifacts`                       | runtime    |    0 |    7 |  1220 | `tools/maintenance.js`                    | **MANTER — ADMIN**                  | `maintenance/recovery`                                    | Capacidade legítima, porém operacional/diagnóstica; manter em surface administrativa, fora do hot path. Responsabilidade: maintenance/recovery.                                            |
|  34 | `mcp_client_latency_evidence`                    | runtime    |    0 |    0 |  2736 | `tools/client-latency-evidence.js`        | **RETIRAR DO MCP / MANTER INTERNO** | `diagnostic fixture/CLI`                                  | Nunca usado no audit e com descriptor grande; persistência de evidência client-side deve permanecer instrumento controlado interno, não decisão MCP geral.                                 |
|  35 | `mcp_cloudflare_config_audit`                    | runtime    |    0 |    2 |   893 | `tools/cloudflare-config.js`              | **FUNDIR → APOSENTAR**              | `mcp_cloudflare_edge_snapshot`                            | Capacidade válida, mas o entry point separado não justifica owner próprio; absorver em mcp_cloudflare_edge_snapshot e aposentar somente após parity comprovada.                            |
|  36 | `mcp_cloudflare_edge_audit`                      | runtime    |    0 |    1 |   843 | `tools/cloudflare-edge.js`                | **FUNDIR → APOSENTAR**              | `mcp_cloudflare_edge_snapshot`                            | Capacidade válida, mas o entry point separado não justifica owner próprio; absorver em mcp_cloudflare_edge_snapshot e aposentar somente após parity comprovada.                            |
|  37 | `mcp_cloudflare_edge_backup_create`              | runtime    |    0 |    0 |   827 | `tools/cloudflare-edge-backup.js`         | **RETIRAR DO MCP / MANTER INTERNO** | `mcp_cloudflare_edge_policy_apply`                        | Backup deve ser precondition automática da mutation Cloudflare; criação standalone não deve ser escolha separada do modelo.                                                                |
|  38 | `mcp_cloudflare_edge_backups_list`               | runtime    |    0 |    0 |   674 | `tools/cloudflare-edge-backup.js`         | **MANTER — RECOVERY**               | `Cloudflare rollback`                                     | Lookup de rollback para mudança Cloudflare; manter em recovery, não no hot path.                                                                                                           |
|  39 | `mcp_cloudflare_edge_policy_apply`               | runtime    |    0 |    0 |  1180 | `tools/cloudflare-edge-apply.js`          | **MANTER — ADMIN**                  | `Cloudflare mutation`                                     | Capacidade legítima, porém operacional/diagnóstica; manter em surface administrativa, fora do hot path. Responsabilidade: Cloudflare mutation.                                             |
|  40 | `mcp_cloudflare_edge_policy_diff`                | runtime    |    0 |    1 |   601 | `tools/cloudflare-edge-diff.js`           | **FUNDIR → APOSENTAR**              | `mcp_cloudflare_edge_snapshot`                            | Capacidade válida, mas o entry point separado não justifica owner próprio; absorver em mcp_cloudflare_edge_snapshot e aposentar somente após parity comprovada.                            |
|  41 | `mcp_cloudflare_edge_policy_plan`                | runtime    |    0 |    0 |   635 | `tools/cloudflare-edge-policy.js`         | **APOSENTAR — REDUNDANTE**          | `mcp_cloudflare_edge_policy_apply(dryRun=true)`           | A capacidade já está coberta por mcp_cloudflare_edge_policy_apply(dryRun=true); aposentar o entry point sem shim após atualizar callers, docs e testes.                                    |
|  42 | `mcp_cloudflare_edge_snapshot`                   | runtime    |    0 |    0 |   593 | `tools/cloudflare-edge-snapshot.js`       | **MANTER — ADMIN**                  | `Cloudflare read surface`                                 | Capacidade legítima, porém operacional/diagnóstica; manter em surface administrativa, fora do hot path. Responsabilidade: Cloudflare read surface.                                         |
|  43 | `mcp_cloudflare_mcp_passthrough_apply`           | runtime    |    0 |    0 |   843 | `tools/cloudflare-passthrough.js`         | **FUNDIR → APOSENTAR**              | `mcp_cloudflare_edge_policy_apply`                        | Capacidade válida, mas o entry point separado não justifica owner próprio; absorver em mcp_cloudflare_edge_policy_apply e aposentar somente após parity comprovada.                        |
|  44 | `mcp_cloudflare_mcp_passthrough_diff`            | runtime    |    0 |    0 |   624 | `tools/cloudflare-passthrough.js`         | **FUNDIR → APOSENTAR**              | `mcp_cloudflare_edge_snapshot`                            | Capacidade válida, mas o entry point separado não justifica owner próprio; absorver em mcp_cloudflare_edge_snapshot e aposentar somente após parity comprovada.                            |
|  45 | `mcp_cloudflare_mcp_passthrough_plan`            | runtime    |    0 |    0 |   609 | `tools/cloudflare-passthrough.js`         | **REMOVIDA — W3** | `mcp_cloudflare_mcp_passthrough_apply(dryRun=true)` | Apply dry-run tornou-se side-effect-free e passou a devolver desiredPlan/invariants; backup ocorre apenas na fronteira de mutação confirmada. |
|  46 | `mcp_cloudflare_metrics_snapshot`                | runtime    |    0 |    1 |   843 | `tools/cloudflare-metrics.js`             | **MANTER — ADMIN**                  | `Cloudflare observability`                                | Capacidade legítima, porém operacional/diagnóstica; manter em surface administrativa, fora do hot path. Responsabilidade: Cloudflare observability.                                        |
|  47 | `mcp_cloudflare_plan_capabilities_audit`         | runtime    |    1 |    1 |   574 | `tools/cloudflare-config.js`              | **FUNDIR → APOSENTAR**              | `mcp_cloudflare_edge_snapshot`                            | Capacidade válida, mas o entry point separado não justifica owner próprio; absorver em mcp_cloudflare_edge_snapshot e aposentar somente após parity comprovada.                            |
|  48 | `mcp_cloudflare_post_change_gates`               | runtime    |    1 |   13 |   777 | `tools/cloudflare-post-change-gates.js`   | **MANTER — ADMIN**                  | `Cloudflare verification`                                 | Capacidade legítima, porém operacional/diagnóstica; manter em surface administrativa, fora do hot path. Responsabilidade: Cloudflare verification.                                         |
|  49 | `mcp_cloudflare_remote_audit`                    | runtime    |    0 |    0 |   587 | `tools/cloudflare-remote.js`              | **FUNDIR → APOSENTAR**              | `mcp_cloudflare_edge_snapshot`                            | Capacidade válida, mas o entry point separado não justifica owner próprio; absorver em mcp_cloudflare_edge_snapshot e aposentar somente após parity comprovada.                            |
|  50 | `mcp_cloudflare_skip_audit`                      | runtime    |    0 |    1 |   621 | `tools/cloudflare-skip.js`                | **FUNDIR → APOSENTAR**              | `mcp_cloudflare_edge_snapshot`                            | Capacidade válida, mas o entry point separado não justifica owner próprio; absorver em mcp_cloudflare_edge_snapshot e aposentar somente após parity comprovada.                            |
|  51 | `mcp_cloudflare_transport_benchmark_plan`        | runtime    |    0 |    0 |   842 | `tools/cloudflare-transport-benchmark.js` | **RETIRAR DO MCP / MANTER INTERNO** | `benchmark script/diagnostic`                             | Plano experimental de benchmark deve permanecer script/diagnóstico interno, não entry point permanente.                                                                                    |
|  52 | `mcp_connection_readiness`                       | connection |    8 |   21 |   770 | `tools/connection.js`                     | **MANTER — ADMIN**                  | `connection/OAuth canonical read`                         | Capacidade legítima, porém operacional/diagnóstica; manter em surface administrativa, fora do hot path. Responsabilidade: connection/OAuth canonical read.                                 |
|  53 | `mcp_connector_smoke_refresh`                    | runtime    |   19 |   34 |   902 | `tools/tunnel-status.js`                  | **MANTER — ADMIN**                  | `post-reload connector gate`                              | Capacidade legítima, porém operacional/diagnóstica; manter em surface administrativa, fora do hot path. Responsabilidade: post-reload connector gate.                                      |
|  54 | `mcp_dependency_outdated`                        | runtime    |    0 |    1 |   785 | `tools/maintenance.js`                    | **MANTER — ADMIN**                  | `dependency maintenance`                                  | Capacidade legítima, porém operacional/diagnóstica; manter em surface administrativa, fora do hot path. Responsabilidade: dependency maintenance.                                          |
|  55 | `mcp_dependency_upgrade`                         | runtime    |    0 |    0 |  1197 | `tools/maintenance.js`                    | **MANTER — ADMIN**                  | `dependency maintenance`                                  | Capacidade legítima, porém operacional/diagnóstica; manter em surface administrativa, fora do hot path. Responsabilidade: dependency maintenance.                                          |
|  56 | `mcp_devcontainer_network_control_plane_refresh` | runtime    |    0 |    0 |   749 | `tools/devcontainer-network-posture.js`   | **MANTER — ADMIN**                  | `network recovery`                                        | Capacidade legítima, porém operacional/diagnóstica; manter em surface administrativa, fora do hot path. Responsabilidade: network recovery.                                                |
|  57 | `mcp_devcontainer_network_posture_audit`         | runtime    |    0 |    0 |   613 | `tools/devcontainer-network-posture.js`   | **MANTER — ADMIN**                  | `network diagnostics`                                     | Capacidade legítima, porém operacional/diagnóstica; manter em surface administrativa, fora do hot path. Responsabilidade: network diagnostics.                                             |
|  58 | `mcp_golden_prompts`                             | runtime    |    0 |    0 |   552 | `tools/golden-prompts.js`                 | **RETIRAR DO MCP / MANTER INTERNO** | `test fixture/docs`                                       | Artefato explícito da campanha de medição de host/approval de maio; retirar do MCP e manter corpus como fixture/docs.                                                                      |
|  59 | `mcp_host_block_diagnostics`                     | runtime    |    0 |    0 |  1898 | `tools/host-blocks.js`                    | **RETIRAR DO MCP / MANTER INTERNO** | `diagnostic library/test`                                 | Artefato explícito da campanha de host blocks de maio; retirar do MCP, preservando classifier/testes para regressão.                                                                       |
|  60 | `mcp_last_validation_summary`                    | validation |    0 |    0 |   853 | `tools/jobs.js`                           | **FUNDIR → APOSENTAR**              | `mcp_validation_dashboard`                                | Capacidade válida, mas o entry point separado não justifica owner próprio; absorver em mcp_validation_dashboard e aposentar somente após parity comprovada.                                |
|  61 | `mcp_latency_attribution`                        | runtime    |    0 |    0 |  1339 | `tools/latency-attribution.js`            | **MANTER — ADMIN**                  | `latency diagnostics`                                     | Capacidade legítima, porém operacional/diagnóstica; manter em surface administrativa, fora do hot path. Responsabilidade: latency diagnostics.                                             |
|  62 | `mcp_latency_dashboard`                          | runtime    |    5 |   22 |  1969 | `tools/latency-dashboard.js`              | **MANTER — TEMPORÁRIO/ROADMAP**     | `round-trip/latency program`                              | Instrumento necessário ao roadmap em curso; manter temporariamente (round-trip/latency program) e reavaliar quando a campanha terminar.                                                    |
|  63 | `mcp_latency_pulse`                              | runtime    |    0 |    0 |  1738 | `tools/latency-attribution.js`            | **RETIRAR DO MCP / MANTER INTERNO** | `controlled experiment`                                   | Primitive de experimento controlado sem uso recente; manter interna/scriptada, não como entry point permanente.                                                                            |
|  64 | `mcp_maintenance_apply_safe_fixes`               | runtime    |    0 |    0 |   915 | `tools/maintenance.js`                    | **RETIRAR DO MCP / MANTER INTERNO** | `direct canonical tools`                                  | Wrapper agregado sem uso recente que duplica tools canônicas de status/smoke/index; retirar do MCP e manter helpers internos se úteis.                                                     |
|  65 | `mcp_maintenance_plan`                           | runtime    |    2 |    2 |   557 | `tools/maintenance.js`                    | **REMOVIDA — W3** | `mcp_maintenance_apply_safe_fixes(dryRun=true)` | Plan items/defaults/risk/current report foram absorvidos pelo composite dry-run, que permanece por reduzir round-trips. |
|  66 | `mcp_oauth_friction_audit`                       | connection |    0 |    6 |   611 | `tools/oauth-friction-audit.js`           | **FUNDIR → APOSENTAR**              | `mcp_oauth_diagnostics / mcp_connection_readiness(deep)`  | Capacidade válida, mas o entry point separado não justifica owner próprio; absorver em mcp_oauth_diagnostics / mcp_connection_readiness(deep) e aposentar somente após parity comprovada.  |
|  67 | `mcp_oauth_issuer_diagnostics`                   | connection |    0 |    4 |   926 | `tools/connection.js`                     | **FUNDIR → APOSENTAR**              | `mcp_oauth_diagnostics / mcp_connection_readiness(deep)`  | Capacidade válida, mas o entry point separado não justifica owner próprio; absorver em mcp_oauth_diagnostics / mcp_connection_readiness(deep) e aposentar somente após parity comprovada.  |
|  68 | `mcp_openai_endpoint_latency`                    | runtime    |    0 |    0 |  1468 | `tools/openai-endpoint-latency.js`        | **FUNDIR → APOSENTAR**              | `mcp_latency_attribution`                                 | Capacidade válida, mas o entry point separado não justifica owner próprio; absorver em mcp_latency_attribution e aposentar somente após parity comprovada.                                 |
|  69 | `mcp_post_restart_readiness`                     | runtime    |    4 |   11 |   596 | `tools/tunnel-status.js`                  | **FUNDIR → APOSENTAR**              | `mcp_connector_smoke_refresh / mcp_connection_readiness`  | Capacidade válida, mas o entry point separado não justifica owner próprio; absorver em mcp_connector_smoke_refresh / mcp_connection_readiness e aposentar somente após parity comprovada.  |
|  70 | `mcp_reload_plan`                                | runtime    |    6 |   14 |   815 | `tools/restart-control.js`                | **FUNDIR → APOSENTAR**              | `mcp_reload_schedule(dryRun/preview)`                     | Capacidade válida, mas o entry point separado não justifica owner próprio; absorver em mcp_reload_schedule(dryRun/preview) e aposentar somente após parity comprovada.                     |
|  71 | `mcp_reload_schedule`                            | runtime    |   18 |   27 |  1285 | `tools/restart-control.js`                | **MANTER — ADMIN**                  | `reload control`                                          | Capacidade legítima, porém operacional/diagnóstica; manter em surface administrativa, fora do hot path. Responsabilidade: reload control.                                                  |
|  72 | `mcp_reload_status`                              | runtime    |   21 |   28 |   527 | `tools/restart-control.js`                | **MANTER — RECOVERY**               | `reload control`                                          | Capacidade necessária para fechar rollback/cancel/resume; manter em surface de recovery (reload control), ainda que rara.                                                                  |
|  73 | `mcp_round_trip_analytics`                       | runtime    |   28 |   31 |  1255 | `tools/round-trip-analytics.js`           | **MANTER — TEMPORÁRIO/ROADMAP**     | `round-trip program`                                      | Instrumento necessário ao roadmap em curso; manter temporariamente (round-trip program) e reavaliar quando a campanha terminar.                                                            |
|  74 | `mcp_run_safe_validation_suite`                  | validation |    5 |   12 |   826 | `tools/jobs.js`                           | **MANTER — CORE**                   | `validation release gate`                                 | Capacidade distinta e de uso geral; preservar como entry point core. Responsabilidade: validation release gate.                                                                            |
|  75 | `mcp_runtime_health`                             | runtime    |   44 |   99 |   662 | `tools/runtime-health.js`                 | **MANTER — CORE**                   | `runtime diagnostics`                                     | Capacidade distinta e de uso geral; preservar como entry point core. Responsabilidade: runtime diagnostics.                                                                                |
|  76 | `mcp_session_profile`                            | runtime    |    2 |    3 |   528 | `tools/session-profile.js`                | **FUNDIR → APOSENTAR**              | `mcp_capabilities_summary`                                | Capacidade válida, mas o entry point separado não justifica owner próprio; absorver em mcp_capabilities_summary e aposentar somente após parity comprovada.                                |
|  77 | `mcp_smoke_workspace`                            | runtime    |    5 |   16 |   518 | `tools/smoke-workspace.js`                | **MANTER — CORE**                   | `workspace smoke`                                         | Capacidade distinta e de uso geral; preservar como entry point core. Responsabilidade: workspace smoke.                                                                                    |
|  78 | `mcp_tool_payload_audit`                         | runtime    |   18 |   19 |  1056 | `tools/tool-payload-audit.js`             | **MANTER — TEMPORÁRIO/ROADMAP**     | `tool-surface optimization`                               | Instrumento necessário ao roadmap em curso; manter temporariamente (tool-surface optimization) e reavaliar quando a campanha terminar.                                                     |
|  79 | `mcp_tools_status`                               | runtime    |    5 |    7 |   553 | `tools/tools-status.js`                   | **FUNDIR → APOSENTAR**              | `mcp_capabilities_summary`                                | Capacidade válida, mas o entry point separado não justifica owner próprio; absorver em mcp_capabilities_summary e aposentar somente após parity comprovada.                                |
|  80 | `mcp_tunnel_status`                              | runtime    |    0 |    3 |   557 | `tools/tunnel-status.js`                  | **FUNDIR → APOSENTAR**              | `mcp_connection_readiness / mcp_cloudflare_edge_snapshot` | Capacidade válida, mas o entry point separado não justifica owner próprio; absorver em mcp_connection_readiness / mcp_cloudflare_edge_snapshot e aposentar somente após parity comprovada. |
|  81 | `mcp_validation_dashboard`                       | validation |    3 |    5 |   896 | `tools/jobs.js`                           | **MANTER — CORE**                   | `validation status`                                       | Capacidade distinta e de uso geral; preservar como entry point core. Responsabilidade: validation status.                                                                                  |
|  82 | `mcp_validation_plan`                            | read       |    1 |    3 |   760 | `tools/repo-plan.js`                      | **REMOVIDA — W2**                   | `run_copilot_validator(dryRun=true)`                      | W2 absorveu inspect-first/file-scoped/suite preview no validator canônico e removeu o entry point sem shim.                                                                                |
|  83 | `project_doctor`                                 | runtime    |    0 |    2 |   616 | `tools/project-doctor.js`                 | **MANTER — ADMIN**                  | `project diagnostics`                                     | Capacidade legítima, porém operacional/diagnóstica; manter em surface administrativa, fora do hot path. Responsabilidade: project diagnostics.                                             |
|  84 | `repo_apply_file_batch`                          | write      |    6 |   83 |  3833 | `tools/repo-write.js`                     | **MANTER — CORE**                   | `repository mutation`                                     | Capacidade distinta e de uso geral; preservar como entry point core. Responsabilidade: repository mutation.                                                                                |
|  85 | `repo_apply_file_batch_plan`                     | read       |    1 |    2 |  2908 | `tools/repo-write.js`                     | **REMOVIDA — W2**                   | `repo_apply_file_batch(dryRun=true)`                      | W2 provou preview não mutante no owner canônico e aposentou o plan separado sem perda funcional.                                                                                           |
|  86 | `repo_apply_patch`                               | write      |  171 |  891 |  2271 | `tools/repo-write.js`                     | **MANTER — CORE**                   | `repository mutation`                                     | Hot path single-file com interface menor e útil; não forçar toda edição pelo batch.                                                                                                        |
|  87 | `repo_apply_patch_batch`                         | write      |  172 | 1114 |  4636 | `tools/repo-write.js`                     | **MANTER — CORE**                   | `repository mutation`                                     | Hot path de mutação multi-target e principal primitive de redução de round trips; preservar.                                                                                               |
|  88 | `repo_bulk_inspect`                              | read       |   42 | 1060 |  1336 | `tools/repo-read.js`                      | **MANTER — CORE**                   | `repository read`                                         | Capacidade distinta e de uso geral; preservar como entry point core. Responsabilidade: repository read.                                                                                    |
|  89 | `repo_create_file`                               | write      |   30 |  183 |  1468 | `tools/repo-write.js`                     | **MANTER — CORE**                   | `repository mutation`                                     | Capacidade distinta e de uso geral; preservar como entry point core. Responsabilidade: repository mutation.                                                                                |
|  90 | `repo_create_file_plan`                          | read       |    0 |    4 |   976 | `tools/repo-plan.js`                      | **REMOVIDA — W2**                   | `repo_create_file(dryRun=true)` / file batch dry-run      | Preview e destination preflight foram preservados nos owners canônicos; plan separado removido.                                                                                            |
|  91 | `repo_diff_files`                                | read       |    0 |    0 |   975 | `tools/repo-read.js`                      | **FUNDIR → APOSENTAR**              | `repo_bulk_inspect(op=diff) or specialist read composite` | Capacidade válida, mas o entry point separado não justifica owner próprio; absorver em repo_bulk_inspect(op=diff) or specialist read composite e aposentar somente após parity comprovada. |
|  92 | `repo_file_outline`                              | read       |    4 |   53 |  1269 | `tools/repo-read.js`                      | **MANTER — CORE**                   | `code navigation`                                         | Capacidade distinta e de uso geral; preservar como entry point core. Responsabilidade: code navigation.                                                                                    |
|  93 | `repo_file_stats`                                | read       |    7 |   48 |   943 | `tools/repo-read.js`                      | **MANTER — CORE**                   | `repository read`                                         | Capacidade distinta e de uso geral; preservar como entry point core. Responsabilidade: repository read.                                                                                    |
|  94 | `repo_find_imports`                              | index      |    0 |    1 |   984 | `tools/repo-index.js`                     | **MANTER — ESPECIALISTA**           | `indexed dependency navigation`                           | Capacidade única de baixa frequência; manter como specialist (indexed dependency navigation), fora do core default.                                                                        |
|  95 | `repo_find_orphan_imports`                       | index      |    1 |   11 |  1498 | `tools/repo-index.js`                     | **MANTER — CORE**                   | `architecture validation`                                 | Capacidade distinta e de uso geral; preservar como entry point core. Responsabilidade: architecture validation.                                                                            |
|  96 | `repo_find_symbol_usages`                        | read       |    2 |    7 |  1383 | `tools/repo-read.js`                      | **MANTER — CORE**                   | `refactor impact analysis`                                | Capacidade distinta e de uso geral; preservar como entry point core. Responsabilidade: refactor impact analysis.                                                                           |
|  97 | `repo_index_build`                               | index      |    0 |    1 |  1692 | `tools/repo-index.js`                     | **MANTER — ADMIN**                  | `index maintenance`                                       | Capacidade legítima, porém operacional/diagnóstica; manter em surface administrativa, fora do hot path. Responsabilidade: index maintenance.                                               |
|  98 | `repo_index_find_symbol`                         | index      |    0 |    0 |   980 | `tools/repo-index.js`                     | **APOSENTAR — REDUNDANTE**          | `repo_symbol_search`                                      | A capacidade já está coberta por repo_symbol_search; aposentar o entry point sem shim após atualizar callers, docs e testes.                                                               |
|  99 | `repo_index_invalidate`                          | index      |    0 |    0 |   680 | `tools/repo-index.js`                     | **REMOVIDA — W3** | automatic index invalidation/coherence | Entry point manual e wrapper MCP mortos foram removidos; invalidation interna/watcher/write coherence permanecem. |
| 100 | `repo_index_refresh_plan`                        | read       |    0 |    0 |   758 | `tools/repo-plan.js`                      | **REMOVIDA — W2**                   | `repo_index_build(dryRun=true)` / auto-refresh            | W2 adicionou preview não mutante ao build e removeu o plan separado.                                                                                                                       |
| 101 | `repo_index_search`                              | index      |    0 |    0 |  1180 | `tools/repo-index.js`                     | **MANTER — ESPECIALISTA**           | `FTS discovery`                                           | Capacidade única de baixa frequência; manter como specialist (FTS discovery), fora do core default.                                                                                        |
| 102 | `repo_index_status`                              | index      |    0 |   10 |   531 | `tools/repo-index.js`                     | **MANTER — ADMIN**                  | `index diagnostics`                                       | Capacidade legítima, porém operacional/diagnóstica; manter em surface administrativa, fora do hot path. Responsabilidade: index diagnostics.                                               |
| 103 | `repo_inspect_quarantined_file`                  | read       |    0 |    0 |   879 | `tools/repo-write.js`                     | **FUNDIR → APOSENTAR**              | `repo_quarantine_status`                                  | Merge inspect + list into one read-only recovery tool with action=list\|inspect.                                                                                                           |
| 104 | `repo_list_quarantine`                           | read       |    0 |    0 |   778 | `tools/repo-write.js`                     | **FUNDIR → APOSENTAR**              | `repo_quarantine_status`                                  | Capacidade válida, mas o entry point separado não justifica owner próprio; absorver em repo_quarantine_status e aposentar somente após parity comprovada.                                  |
| 105 | `repo_move_file`                                 | write      |    0 |   12 |  1122 | `tools/repo-write.js`                     | **MANTER — CORE**                   | `repository mutation`                                     | Capacidade distinta e de uso geral; preservar como entry point core. Responsabilidade: repository mutation.                                                                                |
| 106 | `repo_move_file_plan`                            | read       |    0 |    2 |   848 | `tools/repo-plan.js`                      | **REMOVIDA — W2**                   | `repo_move_file(dryRun=true)` / file batch dry-run        | Source/destination/overwrite preflight preservado no owner canônico.                                                                                                                       |
| 107 | `repo_patch_batch_plan`                          | read       |    6 |   43 |  2908 | `tools/repo-write.js`                     | **REMOVIDA — W2**                   | `repo_apply_patch_batch(dryRun=true)`                     | W2 preservou preflight/target summaries/recovery evidence no apply dry-run e removeu o preview owner separado.                                                                             |
| 108 | `repo_patch_plan`                                | read       |    0 |    3 |  1239 | `tools/repo-plan.js`                      | **REMOVIDA — W2**                   | `repo_apply_patch(dryRun=true)`                           | Exact-string preview/diff/hash continuam no owner canônico; plan separado removido.                                                                                                       |
| 109 | `repo_quarantine_file`                           | write      |    0 |    4 |   787 | `tools/repo-write.js`                     | **MANTER — CORE**                   | `safe deletion workflow`                                  | Capacidade distinta e de uso geral; preservar como entry point core. Responsabilidade: safe deletion workflow.                                                                             |
| 110 | `repo_quarantine_file_plan`                      | read       |    0 |    1 |   696 | `tools/repo-plan.js`                      | **REMOVIDA — W2**                   | `repo_quarantine_file(dryRun=true)` / file batch dry-run  | Preview preservado sem mover arquivo e sem emitir capability mutável desnecessária.                                                                                                       |
| 111 | `repo_read_file`                                 | read       |  360 | 1632 |  1700 | `tools/repo-read.js`                      | **MANTER — CORE**                   | `repository read`                                         | Hot path fundamental de leitura, batching e hashes; preservar como core top-level.                                                                                                         |
| 112 | `repo_read_file_chunks`                          | read       |    3 |   31 |  1215 | `tools/repo-read.js`                      | **MANTER — CORE**                   | `large-file read`                                         | Capacidade distinta e de uso geral; preservar como entry point core. Responsabilidade: large-file read.                                                                                    |
| 113 | `repo_remove_file`                               | write      |    0 |   12 |   902 | `tools/repo-write.js`                     | **MANTER — CORE**                   | `repository mutation`                                     | Capacidade distinta e de uso geral; preservar como entry point core. Responsabilidade: repository mutation.                                                                                |
| 114 | `repo_restore_quarantined_file`                  | write      |    0 |    0 |  1238 | `tools/repo-write.js`                     | **MANTER — RECOVERY**               | `quarantine recovery`                                     | Inverse operation necessária para a quarentena reversível; manter como recovery.                                                                                                           |
| 115 | `repo_root_redaction_status`                     | read       |    0 |    8 |   596 | `tools/repo-read.js`                      | **MANTER — ADMIN**                  | `security diagnostics`                                    | Capacidade legítima, porém operacional/diagnóstica; manter em surface administrativa, fora do hot path. Responsabilidade: security diagnostics.                                            |
| 116 | `repo_root_tree`                                 | read       |    0 |    0 |   919 | `tools/repo-read.js`                      | **APOSENTAR — REDUNDANTE**          | `repo_tree(path=".")`                                     | É semanticamente substituível por repo_tree com path="."; remover o alias para reduzir ambiguidade de seleção.                                                                             |
| 117 | `repo_search_text`                               | read       |  316 | 1377 |  2219 | `tools/repo-read.js`                      | **MANTER — CORE**                   | `repository read`                                         | Hot path fundamental de busca completa/batched; preservar como core top-level.                                                                                                             |
| 118 | `repo_status`                                    | read       |   68 |  236 |   890 | `tools/repo-read.js`                      | **MANTER — CORE**                   | `repository read`                                         | Capacidade distinta e de uso geral; preservar como entry point core. Responsabilidade: repository read.                                                                                    |
| 119 | `repo_symbol_search`                             | read       |    4 |   20 |  1377 | `tools/repo-read.js`                      | **MANTER — CORE**                   | `code navigation`                                         | Capacidade distinta e de uso geral; preservar como entry point core. Responsabilidade: code navigation.                                                                                    |
| 120 | `repo_tree`                                      | read       |   23 |   73 |  1051 | `tools/repo-read.js`                      | **MANTER — CORE**                   | `repository read`                                         | Capacidade distinta e de uso geral; preservar como entry point core. Responsabilidade: repository read.                                                                                    |
| 121 | `repo_working_set`                               | read       |    1 |   21 |  2920 | `tools/repo-working-set.js`               | **MANTER — CORE**                   | `stateful read/context`                                   | Capacidade distinta e de uso geral; preservar como entry point core. Responsabilidade: stateful read/context.                                                                              |
| 122 | `repo_write_file`                                | write      |    5 |   65 |  1558 | `tools/repo-write.js`                     | **MANTER — CORE**                   | `repository mutation`                                     | Capacidade distinta e de uso geral; preservar como entry point core. Responsabilidade: repository mutation.                                                                                |
| 123 | `run_copilot_validator`                          | validation |    7 |   96 |  2797 | `tools/jobs.js`                           | **MANTER — CORE**                   | `validation execution`                                    | Capacidade distinta e de uso geral; preservar como entry point core. Responsabilidade: validation execution.                                                                               |
| 124 | `run_lint_copilot`                               | validation |    0 |    0 |   604 | `tools/jobs.js (alias gerado)`            | **APOSENTAR — REDUNDANTE**          | `run_copilot_validator(validator=lint)`                   | A capacidade já está coberta por run_copilot_validator(validator=lint); aposentar o entry point sem shim após atualizar callers, docs e testes.                                            |
| 125 | `run_project_doctor`                             | validation |    0 |    0 |   581 | `tools/jobs.js`                           | **APOSENTAR — REDUNDANTE**          | `project_doctor`                                          | Duplica literalmente project_doctor sobre o mesmo owner readMcpProjectDoctor; manter apenas o nome canônico.                                                                               |
| 126 | `run_typecheck_copilot`                          | validation |    0 |   10 |   616 | `tools/jobs.js (alias gerado)`            | **APOSENTAR — REDUNDANTE**          | `run_copilot_validator(validator=typecheck)`              | A capacidade já está coberta por run_copilot_validator(validator=typecheck); aposentar o entry point sem shim após atualizar callers, docs e testes.                                       |
| 127 | `run_unit_copilot`                               | validation |    0 |    2 |   607 | `tools/jobs.js (alias gerado)`            | **APOSENTAR — REDUNDANTE**          | `run_copilot_validator(validator=unit-copilot)`           | A capacidade já está coberta por run_copilot_validator(validator=unit-copilot); aposentar o entry point sem shim após atualizar callers, docs e testes.                                    |
| 128 | `search`                                         | read       |    0 |    0 |  1185 | `tools/company-knowledge.js`              | **MANTER — INTEGRAÇÃO**             | `Company Knowledge`                                       | Contrato exato de Company Knowledge; preservar na surface de integração mesmo sem uso local observado.                                                                                     |
| 129 | `terminal_exec`                                  | runtime    |  443 | 4538 |  9464 | `tools/terminal.js`                       | **MANTER — CORE**                   | `terminal execution`                                      | Tool mais usada do baseline; preservar como core top-level e otimizar apenas schema/result/batching, sem fusão.                                                                            |
| 130 | `terminal_session_control`                       | runtime    |    6 |   69 |  8143 | `tools/terminal.js`                       | **MANTER — CORE**                   | `persistent terminal lifecycle`                           | Preservar separado de read: controle carrega autoridade mutável/open-world e não deve contaminar observação.                                                                               |
| 131 | `terminal_session_read`                          | runtime    |    5 |  426 |  8894 | `tools/terminal.js`                       | **MANTER — CORE**                   | `persistent terminal observation`                         | Preservar separado de control: leitura de sessão deve continuar read-only apesar do custo do descriptor.                                                                                   |

---

# 13. Aposentadoria direta / absorção já provada

Esta lista contém apenas casos cuja retirada não apaga uma capacidade legítima. Itens falsificados
pela reauditoria foram movidos para a seção 14 ou para preservação explícita.

- [x] `run_typecheck_copilot`, `run_lint_copilot`, `run_unit_copilot` → `run_copilot_validator` — **W1**.
- [x] `run_project_doctor` → `project_doctor` — **W1**.
- [x] `repo_root_tree` → `repo_tree(path=".")` — **W1**.
- [x] `repo_index_find_symbol` → `repo_symbol_search` — **W1**.
- [x] `repo_patch_plan`, `repo_create_file_plan`, `repo_move_file_plan`,
      `repo_quarantine_file_plan`, `repo_patch_batch_plan`, `repo_apply_file_batch_plan`,
      `repo_index_refresh_plan`, `mcp_validation_plan` → owners canônicos com `dryRun` — **W2**.
- [ ] `repo_index_invalidate` → invalidation/coherence automática. **W3 candidato forte:** writes,
      watcher e refresh owners já invalidam/reconciliam o índice; manter a função interna, remover só
      a decisão MCP manual.
- [ ] `mcp_golden_prompts` → fixture/docs/connection smoke prompts. **W3 candidato forte:** corpus
      histórico de experimento de approval; o connector profile já possui smoke prompts vivos.
- [ ] `mcp_maintenance_plan` → `mcp_maintenance_apply_safe_fixes(dryRun=true)`. **W3 candidato após
      absorção:** o composite é útil para round-trip; somente o menu separado é redundante.
- [ ] `mcp_cloudflare_mcp_passthrough_plan` → `mcp_cloudflare_mcp_passthrough_apply(dryRun=true)`.
      **W3 candidato após correção:** o dry-run precisa deixar de escrever backup e deve devolver o
      mesmo desired plan/safety invariants antes da retirada.

## 13.1 Reclassificações — não retirar diretamente

- `mcp_latency_pulse` → **MANTER — TEMPORÁRIO/ROADMAP**. A própria distância entre pulses é evidência
  do gap externo; um script local não substitui a observação do host/modelo.
- `mcp_client_latency_evidence` → **MANTER — TEMPORÁRIO/ROADMAP** enquanto houver campanha TTFT; é a
  ingestão sanitizada da observação do cliente.
- `mcp_maintenance_apply_safe_fixes` → **MANTER — COMPOSITE** por ora; agrega status/capabilities/
  artifacts/smoke/index em uma única chamada e reduz round-trips.
- `delegate_to_repo_autonomy_runner` → **FUNDIR → APOSENTAR**, não retirar direto: hoje é o único
  executor MCP para benchmark IO-cache e transport e também comprime diagnostics/validation.
- `mcp_cloudflare_transport_benchmark_plan` → **FUNDIR → APOSENTAR** junto do executor de benchmark;
  remover isoladamente quebraria plan/status do benchmark persistido.
- `mcp_host_block_diagnostics` → **FUNDIR → APOSENTAR** em connection diagnostics/readiness; o
  classifier evidence-first ainda é útil para regressões de host/schema/OAuth.
- `chatgpt_connector_profile` → **FUNDIR → APOSENTAR** em connection readiness/setup; ainda contém
  valores de formulário e smoke guidance não reproduzidos pelo readiness compacto.
- `mcp_cloudflare_edge_backup_create` → **SUP-3 / decisão após desenho de recovery**; apply já cria
  backup, mas backup standalone ainda é um checkpoint manual legítimo até o workflow consolidado.
- `mcp_cloudflare_edge_policy_plan` → **SUP-3 / FUNDIR**, não alias: o plan atual inclui
  metadata-cache/compression que o apply atual não materializa. Parity deve ser construída primeiro.

---

# 14. Fusões obrigatórias antes de aposentadoria

- [x] W2 — os oito repo/validation plan entry points foram absorvidos em `dryRun` canônico e removidos.
- [ ] `delegate_to_repo_autonomy_runner` → rehome de `benchmark-io-cache` e `benchmark-transport` nos
      respectivos owners; diagnostics/validation passam a usar composites canônicos diretamente.
- [ ] `mcp_cloudflare_transport_benchmark_plan` → um único owner benchmark `plan|run|status`, sem
      depender de delegation mega-tool.
- [ ] `mcp_host_block_diagnostics` + `chatgpt_connector_profile` → connection readiness/diagnostics
      com modos explícitos, mantendo classifier e setup projection sem multiplicar entry points.
- [ ] `mcp_cloudflare_edge_policy_plan` → alinhar policy SSOT e apply/snapshot antes de retirar o
      plan; metadata cache/compression não podem desaparecer.
- [ ] `mcp_cloudflare_edge_backup_create` → tornar checkpoint/rollback parte coerente do owner
      Cloudflare consolidado antes de decidir retirada standalone.
- [ ] `git_stage_plan` → **`git_stage(preview)` ou owner fechado de Git recovery**. Preservar a
      enumeração não mutante do path-set/mode drift; retirar somente após parity de preview.
- [ ] `git_commit_plan` → **`git_commit(preview)` ou owner fechado de Git recovery**. Preservar
      staged files, diff stat, identidade e `canCommit` sem criar commit; retirar somente após parity.
- [ ] `git_push_plan` → **`git_push(previewOnly)` ou owner de publication recovery**. O atual
      `pushDryRunFirst` não basta porque continua associado à execução real; preservar preflight
      remoto read-only até existir equivalente.
- [ ] `llmb_live_test_plan` → **`llmb_live_test_run(planOnly=true)`**. O run já reutiliza
      `buildModelGatewayLiveRunPlan`, mas precisa expor o plano sem iniciar processo/harness e sem
      consumir créditos/quota antes de o entry point separado desaparecer.
- [ ] `copilot_session_get` → **`copilot_sessions`**. Capacidade válida, mas o entry point separado
      não justifica owner próprio; absorver em copilot_sessions e aposentar somente após parity
      comprovada.
- [ ] `copilot_sessions_list` → **`copilot_sessions`**. Capacidade válida, mas o entry point
      separado não justifica owner próprio; absorver em copilot_sessions e aposentar somente após
      parity comprovada.
- [ ] `llmb_live_runs` → **`llmb_live_readiness(includeRecentRuns)`**. Capacidade válida, mas o
      entry point separado não justifica owner próprio; absorver em
      llmb_live_readiness(includeRecentRuns) e aposentar somente após parity comprovada.
- [ ] `mcp_autonomy_power_score` → **`mcp_capabilities_summary`**. Capacidade válida, mas o entry
      point separado não justifica owner próprio; absorver em mcp_capabilities_summary e aposentar
      somente após parity comprovada.
- [ ] `mcp_session_profile` → **`mcp_capabilities_summary`**. Capacidade válida, mas o entry point
      separado não justifica owner próprio; absorver em mcp_capabilities_summary e aposentar somente
      após parity comprovada.
- [ ] `mcp_tools_status` → **`mcp_capabilities_summary`**. Capacidade válida, mas o entry point
      separado não justifica owner próprio; absorver em mcp_capabilities_summary e aposentar somente
      após parity comprovada.
- [ ] `mcp_cloudflare_mcp_passthrough_apply` → **`mcp_cloudflare_edge_policy_apply`**. Capacidade
      válida, mas o entry point separado não justifica owner próprio; absorver em
      mcp_cloudflare_edge_policy_apply e aposentar somente após parity comprovada.
- [ ] `mcp_cloudflare_config_audit` → **`mcp_cloudflare_edge_snapshot`**. Capacidade válida, mas o
      entry point separado não justifica owner próprio; absorver em mcp_cloudflare_edge_snapshot e
      aposentar somente após parity comprovada.
- [ ] `mcp_cloudflare_edge_audit` → **`mcp_cloudflare_edge_snapshot`**. Capacidade válida, mas o
      entry point separado não justifica owner próprio; absorver em mcp_cloudflare_edge_snapshot e
      aposentar somente após parity comprovada.
- [ ] `mcp_cloudflare_edge_policy_diff` → **`mcp_cloudflare_edge_snapshot`**. Capacidade válida, mas
      o entry point separado não justifica owner próprio; absorver em mcp_cloudflare_edge_snapshot e
      aposentar somente após parity comprovada.
- [ ] `mcp_cloudflare_mcp_passthrough_diff` → **`mcp_cloudflare_edge_snapshot`**. Capacidade válida,
      mas o entry point separado não justifica owner próprio; absorver em
      mcp_cloudflare_edge_snapshot e aposentar somente após parity comprovada.
- [ ] `mcp_cloudflare_plan_capabilities_audit` → **`mcp_cloudflare_edge_snapshot`**. Capacidade
      válida, mas o entry point separado não justifica owner próprio; absorver em
      mcp_cloudflare_edge_snapshot e aposentar somente após parity comprovada.
- [ ] `mcp_cloudflare_remote_audit` → **`mcp_cloudflare_edge_snapshot`**. Capacidade válida, mas o
      entry point separado não justifica owner próprio; absorver em mcp_cloudflare_edge_snapshot e
      aposentar somente após parity comprovada.
- [ ] `mcp_cloudflare_skip_audit` → **`mcp_cloudflare_edge_snapshot`**. Capacidade válida, mas o
      entry point separado não justifica owner próprio; absorver em mcp_cloudflare_edge_snapshot e
      aposentar somente após parity comprovada.
- [ ] `chatgpt_connector_current_url_status` → **`mcp_connection_readiness`**. Capacidade válida,
      mas o entry point separado não justifica owner próprio; absorver em mcp_connection_readiness e
      aposentar somente após parity comprovada.
- [ ] `chatgpt_connector_url_check` → **`mcp_connection_readiness`**. Capacidade válida, mas o entry
      point separado não justifica owner próprio; absorver em mcp_connection_readiness e aposentar
      somente após parity comprovada.
- [ ] `claude_connector_profile` → **`mcp_connection_readiness`**. Capacidade válida, mas o entry
      point separado não justifica owner próprio; absorver em mcp_connection_readiness e aposentar
      somente após parity comprovada.
- [ ] `mcp_auth_profile` → **`mcp_connection_readiness`**. Capacidade válida, mas o entry point
      separado não justifica owner próprio; absorver em mcp_connection_readiness e aposentar somente
      após parity comprovada.
- [ ] `mcp_tunnel_status` → **`mcp_connection_readiness / mcp_cloudflare_edge_snapshot`**.
      Capacidade válida, mas o entry point separado não justifica owner próprio; absorver em
      mcp_connection_readiness / mcp_cloudflare_edge_snapshot e aposentar somente após parity
      comprovada.
- [ ] `mcp_post_restart_readiness` → **`mcp_connector_smoke_refresh / mcp_connection_readiness`**.
      Capacidade válida, mas o entry point separado não justifica owner próprio; absorver em
      mcp_connector_smoke_refresh / mcp_connection_readiness e aposentar somente após parity
      comprovada.
- [ ] `mcp_openai_endpoint_latency` → **`mcp_latency_attribution`**. Capacidade válida, mas o entry
      point separado não justifica owner próprio; absorver em mcp_latency_attribution e aposentar
      somente após parity comprovada.
- [ ] `mcp_oauth_friction_audit` → **`mcp_oauth_diagnostics / mcp_connection_readiness(deep)`**.
      Capacidade válida, mas o entry point separado não justifica owner próprio; absorver em
      mcp_oauth_diagnostics / mcp_connection_readiness(deep) e aposentar somente após parity
      comprovada.
- [ ] `mcp_oauth_issuer_diagnostics` → **`mcp_oauth_diagnostics / mcp_connection_readiness(deep)`**.
      Capacidade válida, mas o entry point separado não justifica owner próprio; absorver em
      mcp_oauth_diagnostics / mcp_connection_readiness(deep) e aposentar somente após parity
      comprovada.
- [ ] `mcp_reload_plan` → **`mcp_reload_schedule(dryRun/preview)`**. Capacidade válida, mas o entry
      point separado não justifica owner próprio; absorver em mcp_reload_schedule(dryRun/preview) e
      aposentar somente após parity comprovada.
- [ ] `job_list` → **`mcp_validation_dashboard`**. Capacidade válida, mas o entry point separado não
      justifica owner próprio; absorver em mcp_validation_dashboard e aposentar somente após parity
      comprovada.
- [ ] `mcp_last_validation_summary` → **`mcp_validation_dashboard`**. Capacidade válida, mas o entry
      point separado não justifica owner próprio; absorver em mcp_validation_dashboard e aposentar
      somente após parity comprovada.
- [ ] `repo_diff_files` → **`repo_bulk_inspect(op=diff) or specialist read composite`**. Capacidade
      válida, mas o entry point separado não justifica owner próprio; absorver em
      repo_bulk_inspect(op=diff) or specialist read composite e aposentar somente após parity
      comprovada.
- [ ] `repo_inspect_quarantined_file` → **`repo_quarantine_status`**. Capacidade válida, mas o entry
      point separado não justifica owner próprio; absorver em repo_quarantine_status e aposentar
      somente após parity comprovada.
- [ ] `repo_list_quarantine` → **`repo_quarantine_status`**. Capacidade válida, mas o entry point
      separado não justifica owner próprio; absorver em repo_quarantine_status e aposentar somente
      após parity comprovada.

---

# 15. Roadmap suplementar de execução futura

Este roadmap é **autônomo**. Nenhuma checkbox marcada abaixo significa autorização desta rodada;
todas começam abertas porque a execução de código foi explicitamente excluída.

## SUP-0 — Freeze e rebaseline

- [x] congelar novo baseline `tools/list`, usage 1h/24h/7d/14d e a fronteira observável do host;
- [x] revalidar a fricção observável: não há blocker/critical no origin/OAuth e as chamadas desta
      sessão chegam ao MCP; prompts/Action Snapshot do ChatGPT continuam explicitamente
      **host-controlled e não observáveis pelo origin**, portanto nenhuma inferência de "prompts
      impossíveis" é permitida;
- [x] separar origin OAuth denial de host approval em toda telemetria: analytics preserva
      `tool_call_auth_denied`, descriptor observation marca o Action Snapshot como
      `external-admin-state`, e OAuth audit declara separadamente o boundary de approvals do host;
- [x] definir `toolSurfaceRevision`/migration ledger sem duplicar a autoridade do wire:
      `MCP_TOOL_CONTRACTS_VERSION` é a revisão semântica; o fingerprint de
      `buildMcpToolWireDescriptorSnapshot` é a revisão exata de `tools/list`; este documento é o
      ledger normativo das ondas;
- [x] congelar `mcp_autonomy_power_score` como métrica **não normativa** e recalibrar seu modelo para
      não premiar contagem bruta de tools, quantidade de plans ou aliases de validação;
- [x] inventariar guidance/descriptions/README/semantic-contracts que ainda ensinam nomes destinados
      à remoção; a migração de cada referência viva passa a fazer parte do mesmo change-set da tool.

### SUP-0 — baseline congelado antes da primeira remoção

| Janela / autoridade | Evidência congelada |
| --- | --- |
| `tools/list` full | **131 tools / 162.586 B**, fingerprint `2449c418de55b14c51ac8760fe42612d521bc62d7c2e461a8a356942f739cfa7` |
| 1 h | 62 starts / 61 terminal / pairing ~98,39%; lineage conhecida = 0% |
| 24 h | 1.914 starts / 1.913 terminal / 1.913 paired (~99,95%) |
| 7 d | 12.681 starts / 12.676 terminal / 12.676 paired (~99,96%); lineage conhecida = 0% |
| 14 d | 37.391 starts / 37.354 terminal / 26.409 paired (~70,63%); 10.975 starts antigos sem `callId`, logo janela inadequada para causalidade |
| surface histórica `latency` | 71 tools / 107.458 B / **97,5467%** de coverage ponderada em 7 d; não é a candidate surface normativa |
| conexão/OAuth | `mcp_connection_readiness.ready=true`, blockers `[]`; `mcp_oauth_friction_audit.reauthRisk=low`, warnings/critical `[]` |
| host snapshot | estado administrativo externo: origin `tools/list` observation **não** prova Refresh/Action Snapshot do ChatGPT |
| autonomy score pré-recalibração | 91/A no modelo antigo; congelado apenas como baseline histórico, nunca como gate de promoção |

### Migration ledger da surface

| Revisão semântica | Onda | Entry points | Replacement canônico | Estado |
| --- | --- | --- | --- | --- |
| `2.1.0` | `SUP-1/W1` | `run_typecheck_copilot`, `run_lint_copilot`, `run_unit_copilot`, `run_project_doctor`, `repo_root_tree`, `repo_index_find_symbol` | `run_copilot_validator`, `project_doctor`, `repo_tree(path=".")`, `repo_symbol_search` | **SOURCE VALIDADO** — 125 tools, envelope 158.276 B, fingerprint `dfbd5ffd6129ff333590a5538e3bb33de4e3435c4b900cee93733bd92477eecb`; reload/host Refresh ainda pendentes |
| `2.2.0` | `SUP-1/W2` | `repo_patch_plan`, `repo_create_file_plan`, `repo_move_file_plan`, `repo_quarantine_file_plan`, `repo_patch_batch_plan`, `repo_apply_file_batch_plan`, `repo_index_refresh_plan`, `mcp_validation_plan` | owners canônicos com `dryRun` server-enforced | **SOURCE CERTIFICADO** — 117 tools, envelope 147.500 B, fingerprint `35dd639b0e923238a4fe968d33b7c563b28d37ce9cf9fb6b6dc2e12577463d26`; `mcp-fast` e `mcp-full` verdes |
| `2.3.0` | `SUP-1/W3` | `repo_index_invalidate`, `mcp_golden_prompts`, `mcp_maintenance_plan`, `mcp_cloudflare_mcp_passthrough_plan` | automatic index coherence; docs/smoke guidance; maintenance composite dry-run; passthrough apply dry-run | **SOURCE CERTIFICADO** — 113 tools / 145.098 B, fingerprint `640e242280d88841a9574c9cfabaf6eabcb2dbbb91ccb5a4d2972085a76314a6`; `mcp-fast` + `mcp-full` verdes, 743/743 MCP tests |
| `2.4.0` | `SUP-2/W4` | `job_list`, `mcp_last_validation_summary`, `repo_list_quarantine`, `repo_inspect_quarantined_file`, `copilot_sessions_list`, `copilot_session_get`, `mcp_autonomy_power_score` | `mcp_validation_dashboard(view=dashboard|list|latest)`, `repo_quarantine_status(action=list|inspect)`, `copilot_sessions(action=list|get)`; score sintético removido sem replacement | **SOURCE CERTIFICADO** — 108 tools / 142.688 B, fingerprint full `8a48dd3d16d339b7ea22c9ae04e0b7b1f8cc839bd94076f042bddc76ff3ae115`; latency 65 / `11a1d7448f717ea19c05fd65a91fbf1f8dac0f34ee08dc69e0799eab155f14df`; `mcp-fast` + `mcp-full` verdes, 745/745 MCP tests |
| `2.5.0` | `SUP-2/W5` | `mcp_session_profile`, `mcp_tools_status`, `chatgpt_connector_profile`, `claude_connector_profile`, `chatgpt_connector_url_check`, `chatgpt_connector_current_url_status`, `mcp_auth_profile` | `mcp_capabilities_summary(view=summary|session|status)` e `mcp_connection_readiness(view=readiness|profile|url-check|current-url|auth-profile)` | **SOURCE CERTIFICADO** — 101 tools / 138.558 B, fingerprint full `3d8bf83c2694bbc4fce1a6d597eaeab28a4e542cb2f2392755ffcf8aaf3950f6`; latency 61 / 101.323 B / `d09a2abbcd4c731a754fc4f5cbd47395cf4c6f39fd861445163725095c31982d`; `mcp-fast` + `mcp-full` verdes, 748/748 MCP tests |
| `2.6.0` | `SUP-2/W6` | `llmb_live_runs` | `llmb_live_readiness(view=readiness|runs)`; `llmb_live_test_plan` reclassificado para KEEP least-authority | **SOURCE CERTIFICADO** — 100 tools / 138.225 B, fingerprint full `4983d4caef78c7c62a4fc94cca67bae9108cb93900674fade8f943995418b8c8`; latency inalterada 61 / 101.323 B / `d09a2abbcd4c731a754fc4f5cbd47395cf4c6f39fd861445163725095c31982d`; `mcp-fast` + `mcp-full` verdes, 750/750 MCP tests |
| `2.7.0` | `SUP-3/W7` | `mcp_cloudflare_config_audit`, `mcp_cloudflare_plan_capabilities_audit`, `mcp_cloudflare_edge_audit`, `mcp_cloudflare_edge_policy_plan`, `mcp_cloudflare_edge_policy_diff`, `mcp_cloudflare_post_change_gates`, `mcp_cloudflare_remote_audit`, `mcp_cloudflare_skip_audit`, `mcp_cloudflare_mcp_passthrough_diff` | `mcp_cloudflare_edge_snapshot(view=overview|remote|edge|policy-plan|policy-diff|config|capabilities|skip|passthrough-diff|post-change)` | **SOURCE CERTIFICADO** — 91 tools / 132.741 B, fingerprint full `2458b7db96f052d55d4b785303abeb78bd718bf7384ed52d82dc0ed3cca09ab4`; latency 53 / 96.461 B / `6a96a197a892541e123a9d1439884b6fb24df4475a2d453931812d1a5e2043f1`; minimal 17; cloudflare 17; `mcp-fast` + `mcp-full` verdes, 754/754 MCP tests |
| `2.8.0` | `SUP-3/W8` | `mcp_cloudflare_mcp_passthrough_apply`, `mcp_cloudflare_transport_benchmark_plan` | `mcp_cloudflare_edge_policy_apply(target=edge-policy|passthrough)` e `mcp_cloudflare_metrics_snapshot(view=metrics|transport-plan)` | **SOURCE CERTIFICADO** — 89 tools / 131.652 B, fingerprint full `19d1ec79ab66919609cec98d092e9a68b613ecfaf95b3c6872988a47958201ac`; latency 52 / 95.952 B / `93ed1020a86ab6f1bb07ced9c04651ecae80feefe4197ba7278ae61aa62f290d`; minimal 17; cloudflare 16; `mcp-fast` + `mcp-full` verdes, 755/755 MCP tests |

## SUP-1 — Remover redundâncias exatas/aliases

- [x] W1 — seis aliases/redundâncias exatas removidos;
- [x] W2 — oito plan-tools absorvidas por `dryRun`, `repo-plan.js` removido e guidance/tests migrados;
- [x] W2 — `mcp_autonomy_power_score` recalibrado para não premiar quantidade de plan-tools/aliases e
      marcado informational-only durante a racionalização;
- [x] W2 — semantic-contract profile separado da projeção runtime para quebrar ciclo e manter public
      membrane micro (`2 módulos / 81.874 B`, baseline 1,5×);
- [x] W3 — `repo_index_invalidate` removido do wire; invalidation automática interna preservada;
- [x] W3 — `mcp_golden_prompts` retirado do wire; corpus histórico preservado por Git e smoke guidance viva;
- [x] W3 — `mcp_maintenance_plan` absorvido no composite dry-run; composite mantido por reduzir round-trips;
- [x] W3 — passthrough apply dry-run side-effect-free + desired-plan parity; plan separado removido;
- [ ] não retirar diretamente latency pulse/evidence, delegation runner, transport benchmark,
      host-block diagnostics, edge policy plan ou edge backup; seguir as fusões documentadas na
      seção 14/SUP-2/SUP-3;
- [ ] nenhum shim/alias de compatibilidade salvo prova de client projection stale realmente ativa.

## SUP-2 — Consolidar meta, connection, validation e recovery reads

- [x] W5 — meta consolidado em `mcp_capabilities_summary(view=summary|session|status)` sem aumentar
      o default response; status pesado continua opt-in e cacheado;
- [x] W5 — connection local consolidado em
      `mcp_connection_readiness(view=readiness|profile|url-check|current-url|auth-profile)`;
      issuer diagnostics permaneceu separado e `fixed-external`, enquanto readiness foi corrigido
      para authority `local`;
- [x] W5 — `mcp_oauth_friction_audit` e `mcp_host_block_diagnostics` preservados como owners
      cross-cutting distintos, evitando mega-tool e descriptor inflation no happy path;
- [x] W4 — `mcp_validation_dashboard` absorveu job-list/last-summary com views fechadas e authority
      read-only coerente; job summary/output/cancel permanecem lifecycle/recovery;
- [x] W4 — quarantine list/inspect convergiram em `repo_quarantine_status(action=list|inspect)`;
- [x] W4 — Copilot SDK session get/list convergiram em `copilot_sessions(action=list|get)`;
- [x] W4 — `mcp_autonomy_power_score` aposentado sem replacement artificial;
- [x] W6 — `llmb_live_runs` absorvido em `llmb_live_readiness(view=readiness|runs)` com dispatch
      direto por view, preservando o fixed persisted-runs path sem executar readiness;
- [x] W6 — preservar `llmb_live_test_plan` como preview read-only independente do open-world
      `llmb_live_test_run`; preservar `llmb_live_test_cancel` como inverse/recovery operation.

## SUP-3 — Consolidar Cloudflare

- [ ] expandir snapshot read-only para remote/edge/diff/config/skip/passthrough/capability posture;
- [ ] preservar policy apply separado e high-impact;
- [ ] tornar backup creation uma precondition automática do apply;
- [ ] absorver passthrough como phase fechada somente se isso não misturar authorities
      incompatíveis;
- [ ] manter metrics/post-change gates e rollback lookup como admin/recovery.

## SUP-4 — Git recovery e reload

- [ ] absorver primeiro os previews read-only de stage/commit/push em owners sobreviventes e só
      então retirar as três plan tools;
- [ ] manter granular applies apenas enquanto recovery composite não existir;
- [ ] desenhar `publish resume` fechado para commit-succeeded/push-failed sem force/refspec
      arbitrário;
- [ ] incorporar preview/dry-run em reload schedule e retirar reload plan;
- [ ] manter reload status somente para transição incerta.

## SUP-5 — Surfaces e progressive discovery

- [ ] não mudar default surface antes de ≥98% de cobertura observada ou experimento equivalente;
- [ ] construir candidate surface a partir das tools preservadas, não da taxonomia histórica;
- [ ] medir envelope, escolha correta de tool, missing-tool recovery e latency;
- [ ] acompanhar a especificação oficial de progressive discovery;
- [ ] evitar protocolo proprietário irreversível enquanto o standard estiver em evolução;
- [ ] manter `full` como fallback administrativo durante rollout.

## SUP-6 — Cleanup definitivo

- [ ] remover adapters, exports, registry rows, guidance e tests obsoletos;
- [ ] remover código interno somente quando não houver consumidor legítimo;
- [ ] atualizar Workflow Policy SSOT e capability groups;
- [ ] recalcular public API/cost governance;
- [ ] full typecheck/lint/unit/prettier + connector smoke + tools/list parity;
- [ ] commit/push somente quando o novo catálogo estiver evidence-bound e rollback simples.

---

# 16. Promotion gates

Uma remoção/fusão só é promovida quando todos os gates aplicáveis passam:

- **G1 — capability parity:** nenhuma capacidade legítima desaparece sem decisão explícita;
- **G2 — execution authority:** execução real mantém least-authority e confirmação proporcional ao risco; preview pode viver no mesmo owner quando `dryRun` é server-enforced, comprovadamente não mutante e não emite capability mutável desnecessária;
- **G3 — usage:** ausência/redução de uso é medida, mas nunca usada sozinha para remover
  recovery/integration;
- **G4 — wire:** tools/list count e bytes diminuem de forma mensurável;
- **G5 — selection:** modelo não passa a escolher uma mega-tool mais perigosa por falta de primitive
  adequada;
- **G6 — no hidden plan tax:** apply dry-run substitui plan sem adicionar call obrigatório;
- **G7 — host parity:** ChatGPT action snapshot/refresh observado após mudança de schema/lista;
- **G8 — rollback:** reintroduzir um entry point removido deve ser simples enquanto o rollout ainda
  é experimental;
- **G9 — docs:** este documento e o Workflow Policy não ensinam nomes já removidos;
- **G10 — no shims:** compatibilidade só sobrevive quando uma client projection stale comprovada
  realmente a exige.

---

# 17. O que não fazer

- Não deletar uma tool apenas porque `7d=0`.
- Não fundir read e destructive/open-world em uma única mega-tool só para reduzir contagem.
- Não remover `terminal_session_read` em favor de `terminal_session_control`; a separação de
  autoridade é correta.
- Não remover cancel/restore/rollback porque “quase nunca são chamados”.
- Não remover `search`/`fetch` por zero uso local; são contrato de integração Company Knowledge.
- Não remover LLM-B control plane porque o uso caiu durante outra campanha; LLM-B é requisito futuro
  independente.
- Não preservar plan-tools apenas por hábito se o apply faz o mesmo dry-run e revalida o estado.
- Não manter `full` com 131 tools eternamente apenas porque o envelope cabe em 400 KiB; caber não
  significa ser cognitivamente ótimo para seleção do modelo.
- Não trocar agora para `minimal`/`latency` por decreto; coverage e recovery precisam ser medidos.
- Não confundir esta auditoria com autorização para executar o roadmap de round-trip ou vice-versa.

---

# 18. Evidência oficial MCP e implicação para o WORKSPACE

O roadmap oficial MCP publicado em 22/08/2026 afirma que uma superfície de aproximadamente cem tools
cobra o custo do catálogo inteiro antes da pergunta e tende a piorar tool selection; a resposta
planejada pelo projeto é progressive discovery. O release 2026-07-28 já fornece um core stateless,
`server/discover` opcional e listas cacheáveis. Para o WORKSPACE isso implica:

1. **podar redundância agora** é compatível com a direção oficial e independe de future discovery;
2. **tiering estático** pode servir para A/B, mas não deve ser confundido com a solução final do
   protocolo;
3. a surface default deve privilegiar tools gerais/hot e revelar admin/recovery/integration por
   mecanismo suportado quando houver suporte confiável do host/protocolo;
4. descriptor optimization continua relevante mesmo depois da poda, porque `terminal_exec` e
   terminal sessions são grandes e corretamente preservados.

---

# 19. Apêndice A — tools nunca observadas

- `copilot_session_get` — FUNDIR → APOSENTAR; Capacidade válida, mas o entry point separado não
  justifica owner próprio; absorver em copilot_sessions e aposentar somente após parity comprovada.
- `llmb_live_test_cancel` — MANTER — RECOVERY; Inverse operation de segurança para harness
  destacado; manter como recovery mesmo com uso zero.
- `mcp_client_latency_evidence` — RETIRAR DO MCP / MANTER INTERNO; Nunca usado no audit e com
  descriptor grande; persistência de evidência client-side deve permanecer instrumento controlado
  interno, não decisão MCP geral.
- `mcp_cloudflare_edge_backup_create` — RETIRAR DO MCP / MANTER INTERNO; Backup deve ser
  precondition automática da mutation Cloudflare; criação standalone não deve ser escolha separada
  do modelo.
- `mcp_openai_endpoint_latency` — FUNDIR → APOSENTAR; Capacidade válida, mas o entry point separado
  não justifica owner próprio; absorver em mcp_latency_attribution e aposentar somente após parity
  comprovada.
- `repo_inspect_quarantined_file` — FUNDIR → APOSENTAR; Capacidade válida, mas o entry point
  separado não justifica owner próprio; absorver em repo_quarantine_status e aposentar somente após
  parity comprovada.

# 20. Apêndice B — custo por família relevante

| Família                         | Tools | Descriptor bytes | Starts 7 d | Observação                      |
| ------------------------------- | ----: | ---------------: | ---------: | ------------------------------- |
| Repositório — leitura/navegação |    16 |           20.450 |      4.566 | ver decisões por tool na matriz |
| Repositório — índice            |     7 |            7.545 |         23 | ver decisões por tool na matriz |
| Repositório — mutação           |     9 |           17.815 |      2.364 | ver decisões por tool na matriz |
| Git                             |    11 |           10.427 |        110 | ver decisões por tool na matriz |
| Validação/jobs                  |    12 |           10.531 |        222 | ver decisões por tool na matriz |
| Cloudflare                      |    17 |           12.566 |         20 | ver decisões por tool na matriz |
| Conexão/OAuth                   |     8 |            5.895 |         33 | ver decisões por tool na matriz |
| LLM-B/Copilot SDK               |     7 |            6.559 |         11 | ver decisões por tool na matriz |
| Latência/observabilidade        |     8 |           12.223 |        171 | ver decisões por tool na matriz |
| Meta/autonomia/manutenção       |    24 |           19.017 |        159 | ver decisões por tool na matriz |
| Integração Company Knowledge    |     2 |            2.369 |          0 | ver decisões por tool na matriz |
| Terminal                        |     3 |           26.501 |      5.033 | ver decisões por tool na matriz |

# 21. Reauditoria de congelamento pré-implementação — 2026-08-27

Esta seção **supersede** qualquer classificação anterior conflitante neste mesmo documento. A
releitura integral das 131 decisões foi cruzada novamente com registry, owners, Workflow Policy,
wire real, analytics de 7 dias, índice, readiness, smoke e implementações dos composites antes de
autorizar qualquer transformação de código.

## 21.1 Estado confirmado

- `tools/list` continua em **131 tools / 162.586 B** no full surface;
- Workflow Policy `1.1.0` continua com `planFirstWorkflows=[]`; plans são preview/escalation, não
  requisito automático do happy path;
- o índice está íntegro (`3007` files, `13723` symbols, `0` stale/failed no snapshot observado);
- `mcp_connection_readiness` está `ready=true`, sem blockers, e o smoke de workspace passou todos os
  checks funcionais; o status global `degraded` decorre exclusivamente do worktree já sujo;
- a surface histórica chamada `latency` também contém **71 tools**, mas cobre apenas **97.60%** das
  chamadas observadas em 7 dias e inclui vários entry points destinados à retirada. Ela **não é** a
  candidate surface de 71 tools desta auditoria e não deve ser reutilizada por coincidência nominal;
- `llmb_live_readiness` permanece bloqueada apenas por `sqlite_parity` no snapshot gerado em
  2026-08-14; seleção/runtime/redaction estão saudáveis. Isso é uma pendência do control plane LLM-B,
  não justificativa para remover sua surface de integração.

## 21.2 Correções normativas produzidas por esta reauditoria

1. **Git plans:** `git_stage_plan`, `git_commit_plan` e `git_push_plan` deixam de ser aposentadoria
   direta e passam a `FUNDIR → APOSENTAR`. Revalidação dentro do apply não substitui o preview
   read-only que eles hoje expõem.
2. **LLM-B plan — supersedido por W6:** a reauditoria de authority rejeitou a fusão. O plan é
   `read/local/effect=none`; o run é `write/open-world/model-provider/bounded-write`. Mesmo um
   `planOnly` server-enforced na tool de run faria a chamada de preview herdar a authority estática
   do run. `llmb_live_test_plan` passa a **MANTER — PREVIEW READ-ONLY**.
3. **Quantitativo, supersedido pela auditoria SUP-1/W2:** aposentadoria direta passa a **21** tools
   (`19.709 B`, `17 starts/7d`), fusão prévia a **37** (`28.915 B`, `97 starts/7d`) e dois batch
   preview owners passam a preservação explícita. O destino atual é **58 entry points
   removidos/absorvidos e 73 preservados**; a meta de contagem é subordinada à authority parity.
4. **Validator typo:** `run_unit_copilot` mapeia para
   `run_copilot_validator(validator=unit-copilot)`, não `typecheck`.
5. **Index:** `repo_symbol_search` já usa `indexRegistry.findSymbol` como fast path e cai para `rg`
   quando necessário; `repo_index_find_symbol` pode continuar na aposentadoria direta, preservando
   `repo_index_status` como observabilidade do índice.
6. **Cloudflare — supersedido por W7:** o read owner agora expõe views fechadas para overview,
   remote, edge, policy-plan/diff, config, capabilities, skip, passthrough-diff e post-change. Edge e
   passthrough applies criam backup **somente imediatamente antes de mutação real confirmada**;
   dry-run/unconfirmed/blocked/already-satisfied são side-effect-free. Backup-create sai do happy path,
   mas permanece por enquanto para snapshot explícito antes de mudança manual dashboard/API.
7. **Connection/OAuth:** `mcp_connection_readiness` ainda não substitui toda a profundidade de
   `mcp_auth_profile`/issuer diagnostics; as remoções permanecem condicionadas a parity, não a mera
   troca de nome.
8. **Guidance debt:** `mcp_capabilities_summary`, `mcp_session_profile`, OAuth friction audit, README e
   outras projeções ainda ensinam vários nomes que o roadmap remove. A migração de guidance faz
   parte do mesmo change-set de cada onda e é gate G9, não cleanup opcional tardio.
9. **Autonomy score:** o score atual não serve como promotion KPI: ele atribui pontos à quantidade de
   plan-tools e a aliases de validação que serão removidos. Recalibrar ou aposentar antes de medir
   regressão de autonomia.
10. **Analytics:** transições plan→apply observadas têm `lineageKnownRate=0`; devem ser tratadas como
    pressão temporal, não prova causal. A decisão de poda continua semantic/owner-first, com uso como
    evidência secundária.

## 21.3 Ordem de execução consolidada após o freeze

SUP-0 e SUP-1/W1/W2/W3 estão concluídas em source. W2 aposentou **oito** plan-tools — inclusive os dois
batch preview owners — depois de provar que o preview podia residir com segurança nos owners
canônicos. O gate amplo encontrou e corrigiu um ciclo de import no catálogo; a solução separou o
perfil estático de semantic contracts da projeção runtime, e o `mcp-full` final ficou verde.

W3 removeu apenas os quatro candidatos confirmados pela reauditoria e preservou latency
pulse/evidence; delegation/transport, host diagnostics/profile e edge policy/backup seguem para
fusão arquitetural. A próxima faixa ativa é **SUP-2**, começando por auditoria de parity dos owners
meta/connection/validation/recovery antes de qualquer retirada. Em seguida vem **SUP-3**, que consolidam connection/meta/validation/recovery e Cloudflare
sem apagar capabilities. **SUP-4** continua responsável por Git/reload previews; o preview LLM-B foi preservado por least-authority em W6. **SUP-5** só
mede candidate surface a partir do catálogo então sobrevivente; `full` continua fallback até A/B
host-side. **SUP-6** fecha exports/docs/governance e publicação.

## 21.4 Evidência de certificação W2 e achados pré-W3

- source wire: **117 tools / 147.500 B**, tool entries 147.338 B, headroom 262.100 B sob 400 KiB;
- fingerprint: `35dd639b0e923238a4fe968d33b7c563b28d37ce9cf9fb6b6dc2e12577463d26`;
- `mcp-fast`: verde; `mcp-full`: verde após corrigir architecture cycle;
- architecture: zero cycles; public aliases governados 84/84; zero cost/import-purity violations;
- semantic-contract facts membrane: 2 módulos / 81.874 B, sem packages externos;
- `mcp_latency_pulse` possui metadata especial no registry e seu uso causal depende de chamadas
  origin-boundary sucessivas: **não internalizar** durante o roadmap de latência;
- `mcp_client_latency_evidence` é a autoridade de ingestão de TTFT sanitizado do cliente: **não
  internalizar** enquanto esta evidência for necessária;
- Cloudflare edge plan/apply ainda não têm policy parity: plan inclui metadata-cache/compression que
  o apply não materializa;
- passthrough apply hoje cria backup até em dry-run: corrigir esse side effect antes de absorver plan;
- maintenance composite reduz round-trips e delegation contém executores únicos de benchmark: ambos
  exigem absorção/rehome antes de eventual aposentadoria.

## 21.5 Certificação SUP-1/W3

- catálogo: **113 tools**; `latency` histórica: **67 tools**;
- `tools/list`: **145.098 B**; tool entries **144.940 B**; headroom **264.502 B**;
- redução W3 vs W2: **4 tools / 2.402 B**; acumulada vs baseline: **18 tools / 17.488 B**;
- fingerprint: `640e242280d88841a9574c9cfabaf6eabcb2dbbb91ccb5a4d2972085a76314a6`;
- semantic contract revision `2.3.0`; capability projection revision `66`;
- `mcp_fast`: **126/126 files, 743/743 tests**; `mcp_full`: verde com strict typecheck,
  lint-changed, docs-contract, architecture-contract, full lint e os mesmos **743/743** MCP tests;
- architecture: zero cycles, zero public-alias/cost/import-purity violations;
- passthrough: novo teste causal prova que dry-run/unconfirmed/dirty-preflight nunca cruza a fronteira
  de backup; somente mutação limpa e confirmada exige backup, e already-satisfied não cria artefato;
- nenhuma referência operacional às quatro tools aposentadas permanece em `src/copilot/mcp` ou nos
  testes MCP; menções no documento são histórico/ledger deliberado.

## 21.6 Reauditoria SUP-2 — desenho da primeira onda de read-state consolidation

A SUP-2 não será executada como uma fusão indiscriminada de diagnósticos. A leitura dos owners
revelou quatro classes diferentes:

1. **validation reads — fusão forte:** `job_list`, `mcp_last_validation_summary` e
   `mcp_validation_dashboard` leem o mesmo job manager persistido. O dashboard pode ganhar modos
   `dashboard|list|latest`, preservando filtros, tails e productivity/effective-checks sem criar um
   novo owner. `job_get_summary`, `job_get_output` e `job_cancel` permanecem porque operam sobre um
   job id específico e fecham lifecycle/recovery;
2. **quarantine reads — fusão forte:** list e inspect são duas projeções read-only do mesmo
   quarantine owner. Consolidar em `repo_quarantine_status(action=list|inspect)` e manter
   quarantine/restore/remove separados por efeito;
3. **Copilot SDK sessions — fusão forte:** list/get consultam o mesmo registry process-local e podem
   convergir para `copilot_sessions(action=list|get)` sem misturar mutation nem runtime externo;
4. **autonomy score — aposentadoria, não fusão:** `mcp_autonomy_power_score` é explicitamente
   informational/non-normative e deriva fatos já expostos por status/capabilities/auth. Um score
   sintético adicional não justifica uma decisão MCP independente e não deve ser preservado apenas
   para manter uma métrica histórica.

Dois casos foram **excluídos desta onda** após auditoria:

- `llmb_live_runs` não será absorvido diretamente em `llmb_live_readiness`: runs é uma leitura SQLite
  barata; readiness pode iniciar um fresh process/cache de readiness. Forçar o custo maior para ler
  histórico seria regressão de round-trip. O desenho LLM-B será separado;
- connection/meta amplo (`mcp_tools_status`, `mcp_session_profile`, auth/profile/issuer/host
  diagnostics) exige modos e boundaries próprios. A primeira onda SUP-2 deve provar o padrão de
  consolidação em owners homogêneos antes de atacar esse conjunto.

### SUP-2/W4 — plano executável

- [ ] `mcp_validation_dashboard` absorver `view=list` com `status`, `validator`, `limit`,
      `includeCompleted`;
- [ ] `mcp_validation_dashboard` absorver `view=latest` com `validator`, `includeOutputTail`,
      `tailBytes`, preservando effective checks e next-action;
- [ ] remover `job_list` e `mcp_last_validation_summary` somente depois dos testes de parity;
- [ ] criar `repo_quarantine_status(action=list|inspect)` e aposentar list/inspect antigos sem shim;
- [ ] criar `copilot_sessions(action=list|get)` e aposentar list/get antigos sem shim;
- [ ] aposentar `mcp_autonomy_power_score`, removendo guidance/contrato/teste em vez de inventar um
      replacement artificial;
- [ ] atualizar semantic contracts/capability groups/surfaces/guidance/hints no mesmo change-set;
- [ ] medir novo wire/fingerprint e certificar em focused tests → architecture → `mcp-fast` →
      `mcp-full` antes de iniciar connection/meta W5.

## 21.7 Certificação SUP-2/W4 — read-state owners

A primeira onda SUP-2 consolidou apenas owners homogêneos e foi promovida em source:

- **validation:** `job_list` e `mcp_last_validation_summary` saíram; `mcp_validation_dashboard`
  passou a expor `dashboard|list|latest` com validação de campos inativos. Como a tool apenas lê
  manifests/estado persistido, seu caller scope passou de `repo:validate` para **`repo:read`**;
- **quarantine:** list/inspect viraram `repo_quarantine_status(action=list|inspect)`, mantendo
  quarantine/restore/remove separados por efeito;
- **Copilot SDK:** list/get viraram `copilot_sessions(action=list|get)` sobre o mesmo registry
  process-local;
- **autonomy score:** removido sem replacement porque era sintético, derivado e explicitamente
  non-normative; os fatos continuam em capabilities/status/auth;
- cada owner consolidado rejeita argumentos pertencentes à outra view/action, impedindo uma interface
  permissiva e ambígua;
- `llmb_live_runs` foi deliberadamente preservado: leitura SQLite barata não deve obrigar o caller a
  pagar o fresh-process/cache path de readiness;
- catálogo full: **108 tools / 142.688 B**, tool entries **142.535 B**, headroom **266.912 B**;
- full fingerprint: `8a48dd3d16d339b7ea22c9ae04e0b7b1f8cc839bd94076f042bddc76ff3ae115`;
- surface histórica `latency`: **65 tools**, fingerprint
  `11a1d7448f717ea19c05fd65a91fbf1f8dac0f34ee08dc69e0799eab155f14df`;
- semantic contracts `2.4.0`; capability projection `67`;
- W4 vs W3: **-5 tools / -2.410 B**; acumulado vs baseline: **-23 tools / -19.898 B**;
- `mcp-fast`: **126/126 files, 745/745 tests**;
- `mcp-full`: strict typecheck, lint-changed, docs-contract, architecture-contract, full lint e
  **126/126 files / 745/745 MCP tests**, todos verdes;
- architecture continua com zero cycles e zero violações de public API/cost/import purity.

Próximo gate: **SUP-2/W5**, começando por auditoria — não implementação automática — de meta e
connection. O critério será custo/owner/side effects por view; nenhuma chamada compacta deve passar a
executar network probes ou payload audits caros só porque entry points foram fundidos.

## 21.8 Reauditoria SUP-2/W5 — meta e connection por authority

A auditoria W5 separou as projections por **authority estática da tool**, não apenas por semelhança de
nome. Como o semantic contract é atribuído por entry point inteiro, uma view local não pode dividir a
mesma tool com uma view que faça DNS/HTTP externo sem elevar a autoridade de todas as chamadas.

### Meta — consolidação aprovada

`mcp_capabilities_summary`, `mcp_session_profile` e `mcp_tools_status` são três projections do mesmo
control-plane de capacidade/workflow e todas são read-only/local. O custo diferente de status
(`tools/list` payload audit) já é cacheado por processo e será mantido atrás de uma view explícita:

- `view=summary` — comportamento default atual, compacto; `includeDetails=true` continua opt-in;
- `view=session` — operating profile task-first, sem payload audit;
- `view=status` — contract/risk/descriptor/wire status, inclusive payload summary cacheado.

Resultado: `mcp_session_profile` e `mcp_tools_status` deixam o wire; seus builders permanecem módulos
internos coerentes, sem shim MCP.

### Connection — consolidação local aprovada

Cinco projections compartilham somente config/state local e podem ser absorvidas por
`mcp_connection_readiness` com `view` fechado:

- `view=readiness` — default atual;
- `view=profile`, `client=chatgpt|claude` — substitui os dois connector profiles;
- `view=url-check` — valida URL candidata, sem rede;
- `view=current-url` — lê state/smoke persistido e configuração local;
- `view=auth-profile` — Protected Resource Metadata/challenge/config local.

A implementação deve rejeitar campos de outras views para não criar uma mega-interface permissiva.
O semantic contract de `mcp_connection_readiness` deve ser corrigido para **network=local**: sua
implementação atual não faz probe externo; `buildConnectorStateSummary` lê state/smoke local.

### Entry points deliberadamente preservados

- `mcp_oauth_issuer_diagnostics`: faz DNS/HTTP para well-known metadata/CIMD e permanece
  `fixed-external`;
- `mcp_oauth_friction_audit`: cruza auth/issuer runtime, persistence, tool-scope surface e
  compatibility evidence; é diagnóstico cross-cutting próprio, embora local;
- `mcp_host_block_diagnostics`: classificador de incidente com evidence schema grande e sem relação
  1:1 com readiness; fundi-lo apenas aumentaria o descriptor do happy path.

### SUP-2/W5 — plano executável

- [x] consolidar meta em `mcp_capabilities_summary(view=summary|session|status)`;
- [x] consolidar connection local em
      `mcp_connection_readiness(view=readiness|profile|url-check|current-url|auth-profile)`;
- [x] preservar `mcp_oauth_issuer_diagnostics`, `mcp_oauth_friction_audit` e
      `mcp_host_block_diagnostics` separados;
- [x] corrigir `mcp_connection_readiness` para network authority local e provar que issuer continua
      fixed-external;
- [x] migrar surfaces, capability groups, auth hints, smoke prompts, host-block alternatives,
      README e testes no mesmo change-set;
- [x] adicionar `mcp_connection_readiness` à surface histórica `latency` como replacement explícito
      dos três antigos ChatGPT projections;
- [x] medir full/latency bytes + fingerprints antes de atualizar qualquer baseline global;
- [x] focused tests → strict typecheck/lint → architecture → `mcp-fast` → `mcp-full`.

## 21.9 Certificação SUP-2/W5 — meta/connection least-authority

W5 foi promovida em source com duas consolidações e três boundaries deliberadamente preservados:

- `mcp_capabilities_summary(view=summary|session|status)` absorveu `mcp_session_profile` e
  `mcp_tools_status`; os builders especializados permanecem internos, sem shim MCP;
- `mcp_connection_readiness(view=readiness|profile|url-check|current-url|auth-profile)` absorveu os
  dois connector profiles, URL check/current URL e auth profile;
- cada owner consolidado rejeita campos de views incompatíveis (`ERR_CAPABILITIES_VIEW_FIELDS` /
  `ERR_CONNECTION_VIEW_FIELDS`), preservando uma interface fechada;
- `mcp_connection_readiness` foi corrigido de `fixed-external` para **`network=local`**, refletindo o
  implementation path real; teste causal fixa esse boundary;
- `mcp_oauth_issuer_diagnostics` permanece **`fixed-external`** porque executa DNS/HTTP de metadata;
- `mcp_oauth_friction_audit` permanece owner cross-cutting local; `mcp_host_block_diagnostics`
  permanece classificador de incidentes separado para não inflar o happy-path descriptor;
- full: **101 tools / 138.558 B**, tool entries **138.412 B**, headroom **271.042 B**;
- full fingerprint: `3d8bf83c2694bbc4fce1a6d597eaeab28a4e542cb2f2392755ffcf8aaf3950f6`;
- surface histórica `latency`: **61 tools / 101.323 B**, tool entries **101.217 B**, fingerprint
  `d09a2abbcd4c731a754fc4f5cbd47395cf4c6f39fd861445163725095c31982d`;
- semantic contracts `2.5.0`; capability projection `68`;
- W5 vs W4: **-7 tools / -4.130 B**; acumulado vs baseline: **-30 tools / -24.028 B**;
- focused owner/registry/transport/OAuth tests verdes;
- strict typecheck, lint-changed e architecture verdes, com zero cycles e zero violações;
- `mcp-fast`: **126/126 files / 748/748 tests**;
- `mcp-full`: typecheck, lint-changed, docs-contract, architecture-contract, full lint e
  **126/126 files / 748/748 MCP tests**, todos verdes.

**Boundary normativo pós-W5:** não fundir issuer/friction/host-block no readiness apenas para reduzir
número de tools. Qualquer revisão futura precisa provar authority parity, custo de default e descriptor
budget novamente.

**Próxima investigação:** concluir SUP-2 com o desenho LLM-B (`llmb_live_runs` vs readiness/test
control plane) e então entrar na consolidação Cloudflare SUP-3. A leitura SQLite barata de runs deve
continuar independente de fresh-process readiness enquanto não houver um modo que preserve esse custo.

## 21.10 Reauditoria SUP-2/W6 — LLM-B control-plane least-authority

A auditoria do control plane LLM-B corrigiu duas premissas anteriores:

1. **readiness + runs podem compartilhar entry point sem compartilhar custo.** Ambos são
   `read/local/effect=none/idempotent/cancellable`. O persisted-runs path chama o script fixo
   `model-gateway-live-runs.mjs` e mescla detached manifests; readiness usa seu próprio
   fingerprint/cache/fresh-process path. A fusão correta é um dispatch fechado
   `llmb_live_readiness(view=readiness|runs)`, em que `view=runs` chama diretamente
   `readModelGatewayPersistedLiveRuns` e não toca em readiness;
2. **plan + run não devem compartilhar entry point.** `llmb_live_test_plan` é um cálculo puro de
   allowlisted invocation, `read/local/effect=none`, sem workspace/process/provider. Já
   `llmb_live_test_run` é `write/open-world`, credential-bound a `model-provider`, pode iniciar
   processo e consumir quota/créditos. Como semantic authority é estática por tool, um `planOnly`
   dentro do run degradaria least-authority do preview. A redução de descriptor (~4,35 KiB) não
   justifica essa regressão.

Também ficam preservados:

- `llmb_live_test_cancel`, por ser inverse operation destrutiva/recovery com verificação de PID;
- `llmb_live_test_run`, como owner de execução control-only/real-provider com confirmação explícita;
- o módulo puro `buildModelGatewayLiveRunPlan`, compartilhado internamente por plan e run sem
  duplicação semântica.

### SUP-2/W6 — plano executável

- [x] adicionar `view=readiness|runs` e `limit` ao owner `llmb_live_readiness`;
- [x] rejeitar `limit` em readiness e `includeSqliteRuntimeHealth/includeDetails` em runs;
- [x] provar em teste causal que `view=runs` usa somente o runs script/read-only environment;
- [x] aposentar `llmb_live_runs` sem shim e migrar guidance/README/next-action/meta group;
- [x] manter plan/run/cancel como três authorities distintas;
- [x] atualizar semantic contract rationale sem perder o drain guarantee da readiness;
- [x] medir catálogo/fingerprint e certificar focused → strict/lint → architecture → `mcp-fast` →
      `mcp-full`.

## 21.11 Certificação SUP-2/W6 — LLM-B read owner e preview boundary

W6 foi promovida em source com uma única redução de entry point e uma reclassificação normativa:

- `llmb_live_readiness(view=readiness|runs)` substitui o antigo `llmb_live_runs` sem executar
  readiness quando `view=runs` é escolhido;
- teste causal usa scripts distintos e contador de SQLite fingerprint: `view=runs` conclui com
  **zero fingerprint reads**, provando que não atravessa readiness/cache;
- fields de uma projection são rejeitados na outra com `ERR_LLMB_LIVE_READ_VIEW_FIELDS`;
- `llmb_live_test_plan` permanece **preview read-only** separado: `read/local/effect=none` não é
  promovido à authority `write/open-world/model-provider` do run apenas para economizar descriptor;
- `llmb_live_test_cancel` permanece inverse/recovery operation local destrutiva;
- full: **100 tools / 138.225 B**, tool entries **138.080 B**, headroom **271.375 B**;
- full fingerprint: `4983d4caef78c7c62a4fc94cca67bae9108cb93900674fade8f943995418b8c8`;
- `latency` permaneceu **61 tools / 101.323 B**, fingerprint
  `d09a2abbcd4c731a754fc4f5cbd47395cf4c6f39fd861445163725095c31982d`, porque o antigo runs não
  integrava essa surface;
- semantic contracts `2.6.0`; capability projection `69`;
- W6 vs W5: **-1 tool / -333 B**; acumulado vs baseline: **-31 tools / -24.361 B**;
- architecture: zero cycles e zero public API/cost/import-purity violations;
- `mcp-fast`: **126/126 files / 750/750 tests**;
- `mcp-full`: typecheck, lint-changed, docs-contract, architecture-contract, full lint e
  **126/126 files / 750/750 MCP tests**, todos verdes.

**SUP-2 está materialmente concluída** para os owners auditados nesta auditoria suplementar. A próxima
faixa ativa é **SUP-3 Cloudflare**, iniciando por reauditoria de parity/authority/custo de snapshot,
config, skip, passthrough, edge policy, backup, metrics e post-change gates antes de qualquer fusão.


## 21.12 Reauditoria SUP-3/W7 — Cloudflare read owner, custo por view e mutation boundary

A enumeração source-side após W6 encontrou **16 entry points `mcp_cloudflare_*`**, divididos por
contrato/efeito real em três grupos:

1. **10 reads `fixed-external` / `repo:read` / idempotentes:** config audit, plan-capabilities audit,
   edge audit, edge policy plan, edge policy diff, edge snapshot, post-change gates, remote audit,
   skip audit e passthrough diff;
2. **3 reads locais:** edge-backups list, metrics snapshot e transport benchmark plan;
3. **3 bounded writes `fixed-external`:** edge backup create, edge policy apply e passthrough apply.

A fusão aprovada para W7 é **somente o grupo 1**. `mcp_cloudflare_edge_snapshot` passa a ser o owner
read-only externo com dispatch fechado por `view`, sem executar outras projections implicitamente:

- `overview` — comportamento default atual: remote + edge + policy diff para rollback/readiness;
- `remote` — remote tunnel/DNS audit **compactado**, preservando a proteção contra payload grande;
- `edge` — rulesets/cache/WAF/rate-limit/transform audit;
- `policy-plan` — desired edge policy read-only;
- `policy-diff` — actual × desired, sem mutation;
- `config` — config/product posture; mantém `forceRefresh/cacheTtlMs` somente nesta view;
- `capabilities` — plan/capability posture;
- `skip` — skip/non-interference posture;
- `passthrough-diff` — desired passthrough plan + actual diff, preservando preview em authority read;
- `post-change` — post-change gates; `includeDetails` somente nesta view.

**Gate de custo:** `view=overview` continua a executar apenas o snapshot atual; nenhuma das novas views
é executada por default. O fato de todas compartilharem `fixed-external + cloudflare-api + effect=none`
permite a consolidação sem elevar authority estática. Metrics, benchmark e backup lookup continuam
locais e separados; mutation tools continuam admin/high-impact.

A auditoria encontrou ainda um bug de side effect no edge apply: `applyCloudflareEdgePolicy()` cria
backup **antes** de decidir `dryRun`/confirmação/preflight. Isso viola a semântica já corrigida no
passthrough. W7 deve alterar o fluxo para:

`audit/diff/plan -> decisão -> [preview/blocked sem escrita] -> backup somente imediatamente antes de
mutation real -> mutation`.

O apply também deve evitar backup quando o desired state já estiver satisfeito. A criação manual de
backup **não será aposentada em W7**: embora todo mutation owner deva criar backup automaticamente,
`mcp_cloudflare_edge_backup_create` ainda é útil antes de mudança manual pelo dashboard/API e exige
uma decisão separada na fase de recovery. `mcp_cloudflare_edge_backups_list` permanece explicitamente
recovery/local.

### SUP-3/W7 — plano executável

- [x] tornar edge-policy dry-run/unconfirmed/preflight-blocked side-effect-free;
- [x] criar `mcp_cloudflare_edge_snapshot(view=overview|remote|edge|policy-plan|policy-diff|config|capabilities|skip|passthrough-diff|post-change)`;
- [x] manter remote projection compacta e testar ausência do desired-origin profile repetitivo;
- [x] rejeitar fields exclusivos de outra view (`ERR_CLOUDFLARE_READ_VIEW_FIELDS`);
- [x] aposentar os nove read entry points absorvidos, sem shims;
- [x] migrar guidance, session profile, connection prompts, Cloudflare surfaces e semantic contracts;
- [x] preservar `metrics_snapshot`, `transport_benchmark_plan`, `edge_backups_list`, `edge_backup_create`
      e os dois applies como boundaries distintos nesta onda;
- [x] medir full/latency/cloudflare/minimal surfaces antes de atualizar baselines globais;
- [x] focused tests -> strict/lint -> architecture -> `mcp-fast` -> `mcp-full`.


## 21.13 Certificação SUP-3/W7 — Cloudflare fixed-external read owner

W7 foi promovida com parity funcional e redução real de superfície:

- nove wrappers read-only `fixed-external` foram **removidos fisicamente**, sem aliases/shims;
- `mcp_cloudflare_edge_snapshot` é o owner read-only externo com dez views fechadas e dispatch direto;
- `view=overview` preserva o custo histórico do snapshot e **não executa** as outras views;
- `view=remote` mantém a projection compacta, evitando o repeated desired-origin profile;
- cache controls são aceitos apenas em `view=edge|config`; `includeDetails`, apenas em
  `view=post-change`; fields cruzados falham com `ERR_CLOUDFLARE_READ_VIEW_FIELDS`;
- a capability de passthrough preview permanece em authority read através de
  `view=passthrough-diff`, em vez de ser empurrada para o apply admin;
- `applyCloudflareEdgePolicy` foi corrigido para não criar backup em dry-run, unconfirmed,
  preflight bloqueado, seleção vazia ou desired state já satisfeito; backup ocorre somente no
  mutation boundary confirmado;
- permanecem separados nesta onda: metrics snapshot, transport benchmark plan, backup list/create e
  os dois applies;
- full: **91 tools / 132.741 B**, entries **132.605 B**, headroom **276.859 B**;
- full fingerprint: `2458b7db96f052d55d4b785303abeb78bd718bf7384ed52d82dc0ed3cca09ab4`;
- `latency`: **53 tools / 96.461 B**, fingerprint
  `6a96a197a892541e123a9d1439884b6fb24df4475a2d453931812d1a5e2043f1`;
- `minimal`: **17 tools / 20.805 B**, fingerprint
  `f402a732b1b37e9dacef3d9bbd87a8215be09066c1b2233544e2baae7da9ccc0`;
- `cloudflare`: **17 tools / 15.495 B**, fingerprint
  `f19bc91ae707cc537d7ecb28dc0f35bdd72e2774ae419024ebcb108e48bb9fd6`;
- semantic contracts `2.7.0`; capability projection `70`;
- W7 vs W6: **-9 tools / -5.484 B**; acumulado vs baseline: **-40 tools / -29.845 B**;
- architecture: 398 módulos MCP parseados, 854 edges locais, zero cycles/mismatches e zero
  violações de public API/cost/import purity;
- `mcp-fast`: **126/126 files / 754/754 tests**;
- `mcp-full`: typecheck, lint-changed, docs-contract, architecture-contract, full lint e
  **126/126 files / 754/754 MCP tests**, todos verdes.

**Próximo gate SUP-3/W8:** reauditar os sete entry points Cloudflare sobreviventes por capability,
recovery e mutation scope antes de decidir qualquer nova consolidação. Em especial, a semelhança de
authority entre edge-policy apply e passthrough apply não é, isoladamente, prova suficiente para
fusão; o mutation envelope e os recovery invariants precisam ser comparados integralmente.


## 21.14 Reauditoria SUP-3/W8 — mutation owner e local observability owner

Os sete entry points Cloudflare sobreviventes de W7 foram reclassificados por contrato e owner:

- `mcp_cloudflare_edge_backup_create` — **KEEP**: admin/fixed-external/bounded-write, porém
  `externalSideEffects=none`; persiste snapshot local explícito e preserva o caso de backup antes de
  mudança manual dashboard/API;
- `mcp_cloudflare_edge_backups_list` — **KEEP recovery**: read/local/idempotente; fundi-lo ao create
  elevaria desnecessariamente authority/efeito da listagem;
- `mcp_cloudflare_edge_snapshot` — **KEEP read owner** da W7;
- `mcp_cloudflare_edge_policy_apply` + `mcp_cloudflare_mcp_passthrough_apply` — **FUNDIR**: ambos são
  admin/fixed-external/cloudflare-api/bounded-write/non-idempotent/guarded/manual-only, ambos possuem
  `dryRun + confirmApply` e ambos criam backup somente no mutation boundary. O edge owner passa a
  aceitar `target=edge-policy|passthrough`, default `edge-policy` para preservar compatibilidade;
- `mcp_cloudflare_metrics_snapshot` + `mcp_cloudflare_transport_benchmark_plan` — **FUNDIR**: ambos
  são read/local/none/idempotent/no-credentials. O benchmark plan já lê estado local persistido e
  opcionalmente reutiliza o metrics owner; `view=metrics|transport-plan` preserva custo opt-in sem
  alterar o default metrics.

### Gates de interface W8

- `target=passthrough` rejeita `phases/ruleRefs`; esses fields só pertencem ao target edge-policy;
- `view=transport-plan` rejeita `includeMetricNames`; `view=metrics` rejeita
  `includeMetricsBaseline`;
- `timeoutMs` permanece válido em ambas as views locais, pois é fetch timeout no snapshot e baseline
  timeout no benchmark plan;
- delegation guidance para `benchmark-transport` passa a apontar para
  `mcp_cloudflare_metrics_snapshot view=transport-plan` antes/depois do runner;
- nenhuma mudança é feita nesta onda no detached benchmark executor, no persisted benchmark state,
  no backup store ou na read surface fixed-external.

### SUP-3/W8 — plano executável

- [x] absorver passthrough apply em `mcp_cloudflare_edge_policy_apply(target=...)`;
- [x] adicionar cross-target field validation antes de adquirir Cloudflare authority;
- [x] absorver transport benchmark plan em `mcp_cloudflare_metrics_snapshot(view=...)`;
- [x] adicionar cross-view field validation antes de adquirir config/capability;
- [x] remover os dois wrappers/semantic contracts aposentados sem shim;
- [x] migrar delegation plan, guidance, surfaces, tests e capability groups;
- [x] medir full/latency/minimal/cloudflare e fingerprints reais;
- [x] focused tests -> strict/lint -> architecture -> `mcp-fast` -> `mcp-full`.


## 21.15 Certificação SUP-3/W8 — Cloudflare mutation/local observability owners

W8 fecha a racionalização Cloudflare sem colapsar recovery boundaries:

- `mcp_cloudflare_edge_policy_apply(target=edge-policy|passthrough)` substitui o antigo passthrough
  apply; ambos os targets mantêm `dryRun + confirmApply` e o mesmo mandatory backup imediatamente
  antes de mutação real;
- `phases/ruleRefs` são exclusivos de `target=edge-policy`; cross-target misuse falha antes de
  adquirir Cloudflare authority com `ERR_CLOUDFLARE_APPLY_TARGET_FIELDS`;
- `mcp_cloudflare_metrics_snapshot(view=metrics|transport-plan)` substitui o benchmark-plan wrapper;
  default `metrics` mantém o happy path histórico, enquanto `view=transport-plan` lê design e último
  estado persistido sem acionar o detached executor;
- `includeMetricNames` é exclusivo de metrics e `includeMetricsBaseline` de transport-plan;
  cross-view misuse falha antes de adquirir config com `ERR_CLOUDFLARE_LOCAL_VIEW_FIELDS`;
- delegation `benchmark-transport` agora aponta para `mcp_cloudflare_metrics_snapshot
  view=transport-plan` antes/depois do runner, sem mudar a execução detached nem a restauração do
  transport control;
- wrappers aposentados foram removidos fisicamente, sem shim;
- sobrevivem **cinco** `mcp_cloudflare_*` entry points, todos com boundary explícito:
  `edge_backup_create` (snapshot manual), `edge_backups_list` (recovery local),
  `edge_policy_apply` (mutation), `edge_snapshot` (fixed-external read) e `metrics_snapshot`
  (local observability/transport plan);
- full: **89 tools / 131.652 B**, entries **131.518 B**, headroom **277.948 B**;
- full fingerprint: `19d1ec79ab66919609cec98d092e9a68b613ecfaf95b3c6872988a47958201ac`;
- `latency`: **52 tools / 95.952 B**, fingerprint
  `93ed1020a86ab6f1bb07ced9c04651ecae80feefe4197ba7278ae61aa62f290d`;
- `minimal`: **17 tools / 21.139 B**, fingerprint
  `4e875e93daf588dbae33df7f222b9f9660bccb6cdb05c22b5d747d05ce57a1d9`;
- `cloudflare`: **16 tools / 14.986 B**, fingerprint
  `4d1cce776d6f52be5fa7863908e2d6a776c498004bfca539cecc843fb1b6b2c8`;
- semantic contracts `2.8.0`; capability projection `71`;
- W8 vs W7: **-2 tools / -1.089 B**; acumulado vs baseline: **-42 tools / -30.934 B**;
- architecture: 396 módulos MCP parseados, 848 edges locais, zero cycles/mismatches e zero
  violações de public API/cost/import purity;
- `mcp-fast`: **126/126 files / 755/755 tests**;
- `mcp-full`: typecheck, lint-changed, docs-contract, architecture-contract, full lint e
  **126/126 files / 755/755 MCP tests**, todos verdes.

**SUP-3 está materialmente concluída.** Os cinco entry points Cloudflare restantes são owners distintos
por efeito/authority/recovery; novas fusões nessa família exigiriam nova evidência, não mera busca por
contagem menor. A próxima faixa ativa é **SUP-4 Git/reload previews**, reavaliando plan-tools agora
que a exigência histórica de entry points read-only separados por limitações do ChatGPT.com deixou de
ser requisito de produto, mas mantendo parity funcional e dry-run server-enforced como gates duros.


## 21.16 Reauditoria SUP-4/W9 — Git granular dry-run e reload preview

A reauditoria dos quatro plan entry points sobreviventes confirma que a separação histórica não
representa capability exclusiva. Todos usam a mesma lógica interna dos owners mutantes e podem ser
absorvidos com preview server-enforced, desde que a confirmação deixe de ser um requisito de schema e
passe a ser requisito **somente do ramo mutante**.

### Git

- `git_stage_plan` chama `planStage()` e lê HEAD; `git_stage` já chama o mesmo `planStage()` antes de
  `chmod/git add`. W9 adiciona `dryRun=true` ao owner; preview retorna paths normalizados, affected,
  affectedCount, executableModeDrift e HEAD sem reparar modo nem tocar no index.
- `git_commit_plan` lê HEAD, identity e staged summary; `git_commit` executa exatamente as mesmas
  leituras antes do commit. W9 adiciona `dryRun=true`; preview preserva message, stagedFiles/count,
  stat, identity e `canCommit`.
- `git_push_plan` usa `buildPushState()` e opcionalmente `git push --dry-run --porcelain` contra o
  upstream já configurado. `git_push(dryRun=true)` absorve esse comportamento, mantendo
  `runDryRun=false` para preview puramente local e default `runDryRun=true` para parity histórica.
  `expectedUpstream`/`confirmPush` continuam obrigatórios **somente para push real**; remote/refspec/
  force seguem impossíveis.
- `git_publish_changes` permanece o happy path de uma chamada porque comprime stage+commit+push com
  source-barrier e recovery recipe; a fusão dos plans não reduz sua importância.

### Reload

`mcp_reload_plan` e `mcp_reload_schedule` já compartilham `buildControlledMcpReloadPlan()`. O owner
schedule passa a aceitar `dryRun=true`, que retorna o plan **antes** de requerer workspace, audit,
source-barrier, confirmação ou spawn. O ramo mutante continua exigindo manifest + fingerprint +
`confirmRestart=true`; `mcp_reload_status` permanece separado porque lê persisted state de outro owner.

### Gates W9

- confirmações (`confirmStage`, `confirmCommit`, `confirmPush`, `confirmRestart`) tornam-se opcionais
  no wire apenas para viabilizar preview, mas cada ramo real rejeita ausência antes da mutação;
- preview não grava audit mutation events, não repara x-bit, não altera index/HEAD/upstream, não
  persiste reload state e não spawna runner;
- fields de push ficam fechados: `runDryRun` pertence apenas ao preview; `pushDryRunFirst` pertence
  apenas ao push real;
- source-barrier fields de reload pertencem apenas ao schedule real e são rejeitados no preview;
- o round-trip analyzer pode manter nomes Git plan aposentados **somente como vocabulário histórico**
  para logs antigos, com comentário explícito; guidance/runtime surface não pode continuar ensinando-os.

### SUP-4/W9 — plano executável

- [ ] absorver `git_stage_plan` em `git_stage(dryRun=true)`;
- [ ] absorver `git_commit_plan` em `git_commit(dryRun=true)`;
- [ ] absorver `git_push_plan` em `git_push(dryRun=true, runDryRun=...)`;
- [ ] absorver `mcp_reload_plan` em `mcp_reload_schedule(dryRun=true)`;
- [ ] provar preview side-effect-free e confirmation gates nos quatro owners;
- [ ] remover quatro entry points/contracts sem shim e migrar testing membrane de reload;
- [ ] migrar workflow policy, tools-status, meta, README e guidance;
- [ ] manter somente exceções históricas documentadas no round-trip analyzer;
- [ ] medir surfaces/fingerprints e executar focused -> strict/lint -> architecture -> `mcp-fast` ->
      `mcp-full`.

---

# 22. Definition of Done desta auditoria

- [x] registry full materializada e 131/131 tools inventariadas;
- [x] wire bytes medidos pelo SDK real;
- [x] uso 24 h / 7 d / 14 d cruzado com o audit append-only;
- [x] owners e redundâncias estruturais investigados;
- [x] histórico da campanha de autonomia/approval identificado por Git;
- [x] Company Knowledge e LLM-B tratados como exceções de integração, não por frequência bruta;
- [x] destino forte atribuído a 131/131 tools;
- [x] roadmap suplementar e promotion gates definidos;
- [~] implementação de código — W1–W8 **source-certified**; SUP-2 e SUP-3 concluídas; a meia-W9 Git/reload foi deliberadamente revertida antes de B4-0 para restaurar o boundary W8 e permanece **pausada**, não certificada; SUP-4, SUP-5 e cleanup ainda possuem trabalho;
- [ ] publicação deste documento — depende de pedido/gate de publicação posterior.

---

# 23. Conclusão

A superfície atual não está “errada” por ter 131 tools; ela é o resultado acumulado de fases nas
quais separar plan/apply, criar wrappers de autonomia e expor diagnósticos finos resolveu problemas
reais. O problema é continuar pagando indefinidamente por essas decisões depois que a fronteira
mudou.

A recomendação desta auditoria é **forte e conservadora ao mesmo tempo**: preservar integralmente o
núcleo quente e as fronteiras corretas de autoridade; retirar do MCP o que é alias, fixture,
plumbing ou workaround histórico; fundir diagnósticos que já têm owner composto; e mover capacidades
raras válidas para admin/recovery/integration em vez de apagá-las. O alvo não é “ter poucas tools”.
O alvo é **cada tool restante justificar sua existência como uma decisão distinta que vale a pena
apresentar ao modelo**.


## 21.17 Checkpoint de coordenação com o roadmap canônico de round-trip

A implementação parcial da SUP-4/W9 chegou a iniciar a absorção de `git_stage_plan`, `git_commit_plan`
e `git_push_plan` por `dryRun=true` nos owners granulares, mas foi interrompida antes de completar
semantic contracts/guidance/tests/surfaces e, portanto, deixou temporariamente o registry inconsistente.

Antes de III-B4-0, essa **meia-W9 não certificada foi revertida integralmente**, sem tocar W1–W8. O
boundary restaurado e posteriormente usado em B4-0/B4-1/B4-2 é:

```text
full tools          = 89
full fingerprint    = 19d1ec79ab66919609cec98d092e9a68b613ecfaf95b3c6872988a47958201ac
latency tools       = 52
latency fingerprint = 93ed1020a86ab6f1bb07ced9c04651ecae80feefe4197ba7278ae61aa62f290d
semantic contracts  = 2.8.0
```

A decisão arquitetural da W9 continua válida como investigação, mas **não está aplicada** no source
certificado atual. SUP-4 só deve ser retomada depois dos gates canônicos de round-trip que têm
precedência e mediante uma nova promotion barrier.
