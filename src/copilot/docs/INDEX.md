# Índice canônico de documentação — `src/copilot`

> Autoridade documental para navegação, precedência e status dos documentos sob `src/copilot/docs`.
>
> Atualizado em: 2026-08-25.

## 1. Como usar este índice

A documentação deste runtime foi produzida em várias ondas de arquitetura, operação, auditoria e
execução. Nem todo arquivo histórico descreve o `HEAD` atual. Para evitar que uma investigação
antiga volte a ser tratada como contrato vigente, use esta ordem de precedência:

1. código e testes no `HEAD` atual;
2. READMEs canônicos das camadas (`src/copilot/README.md` e READMEs locais);
3. este `docs/INDEX.md`;
4. diagnóstico/roadmap ativo mais recente;
5. runbooks operacionais atuais;
6. roadmaps especializados ainda ativos;
7. auditorias e roadmaps históricos como evidência temporal, nunca como source of truth atual sem
   reconciliação.

Quando código e documento divergirem, **o código validado vence** e a documentação deve ser
atualizada no mesmo change-set.

### Session prime mínima para uma nova conversa

Para trabalho amplo via WORKSPACE, comece pela menor fotografia operacional útil:

1. `mcp_session_profile` / `mcp_autonomy_power_score` quando autonomia/escopo importarem;
2. `repo_status` para causalidade da worktree;
3. `repo_index_status` para freshness/discovery;
4. `mcp_validation_dashboard` para gates recentes;
5. `mcp_post_restart_readiness` + tunnel/Cloudflare audits somente quando a tarefa depender da
   conexão externa.

Depois navegue preferencialmente por símbolo/outline, use plan + precondition/hash em writes e
quarantine antes de delete quando a remoção puder ser reversível.

## 2. Status executivo e documentos de coordenação

A arquitetura 2.4 substituiu a antiga noção de um único roadmap amplo sempre vigente. O status
executivo atual é explícito:

| Documento                                                                                                                                                                             | Classe                                 | Precedência/uso                                                                                                               |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `WORKSPACE_ARQUITETURA_2_4_PRINCIPIOS_INVARIANTS_ESTADO_ALVO_GOVERNANCA_2026-08-23.md`                                                                                                | **CANÔNICO / ATIVO**                   | princípios, invariants e estado-alvo 2.4; governa decisões arquiteturais gerais                                               |
| `WORKSPACE_SRC_COPILOT_MCP_ARQUITETURA_2_4_POS_CAMPANHA_AUDITORIA_PROFUNDA_ESTADO_ATUAL_ESTADO_ALVO_ROADMAP_2026-08-24.md`                                                            | **CANÔNICO / ATIVO**                   | roadmap executivo MCP vigente e ledger da campanha atual; prevalece sobre roadmaps MCP anteriores                             |
| `WORKSPACE_SRC_COPILOT_MCP_ARQUITETURA_2_4_AUDITORIA_ESTADO_ALVO_ROADMAP_2026-08-23.md`                                                                                               | **HISTÓRICO / SUPERADO PARCIALMENTE**  | auditoria de entrada da 2.4; usar como evidência temporal, reconciliada pelo pós-campanha de 24/08                            |
| `WORKSPACE_SRC_COPILOT_CORE_EXTINCAO_ARQUITETURA_1_0_2_0_2_1_AUDITORIA_ESTADO_ALVO_ROADMAP_2026-08-22.md`                                                                             | **HISTÓRICO / CONCLUÍDO**              | registra a extinção de `core/`; não descreve uma pasta ainda existente                                                        |
| `WORKSPACE_SRC_COPILOT_INFRA_ARQUITETURA_2_0_AUDITORIA_ESTADO_ALVO_ROADMAP_2026-08-21.md` e `WORKSPACE_SRC_COPILOT_INFRA_ARQUITETURA_2_1_AUDITORIA_ESTADO_ALVO_ROADMAP_2026-08-21.md` | **HISTÓRICO / CONCLUÍDO PARCIALMENTE** | trilha de evolução de Infra; estado live vem de `infra/README.md`, manifests e código                                         |
| roadmaps de 14–18/08 (`WORKSPACE_SRC_COPILOT_DIAGNOSTICO...`, ILCP, round-trip, NCP)                                                                                                  | **HISTÓRICO / SUPERADO PARCIALMENTE**  | continuam úteis para causalidade, benchmarks e decisões especializadas ainda não substituídas, mas não prevalecem sobre a 2.4 |

Runbooks operacionais (`CHATGPT_MCP_CONNECT_CHATGPT_RUNBOOK.md`,
`MCP-STATEFUL-STREAMABLE-HTTP-RESTART-RUNBOOK-2026-06-13.md`, `CLAUDE_MCP_CONNECTOR_RUNBOOK.md`)
permanecem **RUNBOOK ATIVO** enquanto seus comandos existirem no `package.json`/CLI e não
conflitarem com o README MCP ou o roadmap 2.4. Um runbook nunca eleva uma arquitetura histórica a
contrato vigente.

## 3. Mapas arquiteturais canônicos

- `../README.md` — mapa canônico de `src/copilot`, ownership por camada e fluxo de boot/runtime.
- `../sdk/README.md` — SSOT local para o wrapper do `@github/copilot-sdk`, surfaces e disciplina de
  compatibilidade.
- `../agent/README.md` — ownership do runtime AlwaysAlive e fronteira com `presentation/`.
- `../presentation/README.md` — superfícies compartilhadas para runtime, estado e projeções entre
  bordas.
- `../terminal/README.md` — frontend operacional LLM-B, REPL, eventos, estado e UX.
- `../model-gateway/README.md` — control plane de catálogo, BYOK, providers, routing e binding.
- `../mcp/README.md` — servidor WORKSPACE MCP, transports, OAuth e operação Cloudflare.
- `../infra/README.md` — I/O, cache, índice, locks, storage e façades públicas de infraestrutura.

## 4. Operação MCP / ChatGPT / Cloudflare

### Runbooks e referências de operação

- `CHATGPT_MCP_CONNECT_CHATGPT_RUNBOOK.md` — conexão do ChatGPT ao MCP.
- `CHATGPT_MCP_CLOUDFLARE_TUNNEL.md` — tunnel permanente e diagnóstico Cloudflare.
- `CHATGPT_MCP_GOLDEN_PROMPTS_AND_MEASUREMENT.md` — conjunto de prompts canônicos e esquema de
  medição.
- `CHATGPT_MCP_OPERATIONAL_RELEASE.md` — release/estado operacional.
- `MCP-STATEFUL-STREAMABLE-HTTP-RESTART-RUNBOOK-2026-06-13.md` — restart e runtime stateful.
- `CLAUDE_MCP_CONNECTOR_RUNBOOK.md` — integração Claude, quando aplicável.

### Arquitetura e roadmaps especializados

- `DEVCONTAINER_NETWORK_CONTROL_PLANE_DIAGNOSTICO_ESTADO_ALVO_ROADMAP_2026-08-18.md` — arquitetura e
  roadmap ativo do NCP/DevContainer e do circuito ChatGPT/OpenAI↔MCP/Cloudflare; contém o
  estado-alvo provider-neutral e os gates atuais.
- `MCP_CANONICAL_ARCHITECTURE_2026-06-01.md` — arquitetura MCP consolidada da onda de junho.
- `MIGRACAO-MCP-STATEFUL-STREAMABLE-HTTP-ROADMAP-2026-06-13.md` — histórico da migração stateful;
  verificar estado atual antes de executar itens abertos.
- `CLOUDFLARE_EDGE_CANONICAL_ROADMAP_2026-05-24.md` — histórico/planejamento de edge; alterações
  remotas devem partir dos audits e plans atuais, nunca apenas deste documento.
- `MCP_HTTP2_PLUS_LATENCY_ROADMAP_2026-05-31.md` — histórico de transporte/latência.
- `MCP-CONEXAO-LATENCIA-ROADMAP-2026-06-09.md` e `ROADMAP-LATENCIA-REPO-MCP-NODE24-2026-06-10.md` —
  trilha histórica de performance.

## 5. Model Gateway

### Referência atual

- `../model-gateway/README.md` — contrato arquitetural da camada.
- `model-gateway/CANONICAL_MODEL_GATEWAY_OPERATIONAL_AND_CODE_REFERENCE_2026-06-02.md` — referência
  operacional/código.
- `model-gateway/CANONICAL_MODEL_GATEWAY_LLM_B_CONTROL_PLANE_AUDIT_AND_ROADMAP_2026-06-15.md` —
  roadmap especializado importante, porém sujeito a reconciliação com o `HEAD`; itens de
  deferred-route promotion já podem estar implementados.
- `model-gateway/CANONICAL_MODEL_GATEWAY_SAME_SESSION_PROVIDER_SWITCH_ROADMAP_2026-06-16.md` —
  continuação focada em switch na mesma sessão.

### Histórico e aprofundamento

Os demais arquivos em `model-gateway/` preservam decisões, guias BYOK e ondas anteriores de
automação/runtime. Eles são valiosos como contexto e critérios, mas não substituem a leitura do
código atual, do `model-gateway/README.md` nem do roadmap executivo 2.4 vigente.

## 6. SDK

- `sdk/COPILOT_SDK_1_0_UPGRADE_AUDIT_ROADMAP_2026-06-08.md` — auditoria extensa da migração SDK 1.0;
  usar em conjunto com `../sdk/README.md`, `package.json` e lockfile atuais.
- O baseline documentado em `../sdk/README.md` deve acompanhar a versão realmente instalada e
  validada.

## 7. Terminal e UX LLM-B

- `terminal/TERMINAL_LLM_B_REALTIME_UX_DEEP_AUDIT_ROADMAP_2026-06-02.md` — auditoria/roadmap
  profundo de UX em tempo real.
- `terminal/LLM_B_TOOLS_DEEP_AUDIT_ROADMAP_2026-06-05.md` — ferramentas da LLM-B.
- `terminal/LLM_B_TERMINAL_TOOLS_UX_FREE_TEXT_AUDIT_2026-06-08.md` — interação free-text/tools.
- `terminal/TERMINAL_UX_REVOLUTION_ROADMAP_2026-06-08.md` — onda posterior de UX.
- `SRC_COPILOT_AGENT_TERMINAL_DEEP_UPGRADE_ROADMAP_2026-06-04.md` e
  `SRC_COPILOT_TERMINAL_MCP_AGENT_DEEP_AUDIT_ROADMAP_2026-06-05.md` — contexto transversal
  agent/terminal/MCP.

Esses documentos são extensos e temporais; o `terminal/README.md` e o código atual definem a
topologia vigente.

## 8. I/O, cache, índice e performance

- `ANALISE-ARQUITETURA-REPO-READ-IO-CACHES-2026-06-10.md` — análise arquitetural de I/O/cache.
- `PESQUISA-ESTRUTURAL-LATENCIA-REPO-MCP-2026-06-10.md` — pesquisa de latência.
- `EXECUCAO-LATENCIA-REPO-NODE24-P0-P1-2026-06-10.md` — execução anterior.
- `WORKSPACE_MCP_DIFF_PREVIEW_SUPPRESSION_STATUS_2026-05-24.md` — comportamento de payload/diff
  preview.

Novas decisões L2/L3 de cache devem ser baseadas em benchmark representativo e não em hit ratio de
auditorias com leituras únicas.

## 9. Auditorias históricas importantes

- `AUDITORIA-AMPLA-SRC-COPILOT-ROADMAP-2026-06-13.md` — **histórica**. Algumas conclusões foram
  superadas pelo `HEAD`: o runtime MCP atual é stateful; `env-secret-registry.js` é protegido pela
  policy de leitura e não deve ser inferido como ausente; aliases de `package.json#imports` exigem
  resolução semântica.
- `WORKSPACE_MCP_GENERAL_AUDIT_ROADMAP_2026-05-24.md` e
  `WORKSPACE_MCP_ZERO_BASE_AUDIT_AND_FIXES_2026-05-23.md` — históricos da evolução do conector.
- `CHATGPT_MCP_MAX_AUTONOMY_CONSOLIDATED_REPORT.md`, `NEW_AUDIT_AUTONOMIA_GPT.md` e
  `Plano consolidado de autonomia máxima.md` — material de autonomia em ondas anteriores; usar como
  contexto, não como estado atual automático.
- Arquivos com “Auditoria”, “Diagnóstico”, “Plano” ou data anterior no nome devem ser presumidos
  temporais até reconciliação explícita.

## 10. Política de atualização documental

Para mudanças arquiteturais relevantes:

- atualizar o README da camada afetada;
- atualizar este índice se a autoridade ou o status de um documento mudou;
- atualizar o roadmap mestre quando uma faixa/subfase for concluída ou redefinida;
- marcar claramente afirmações históricas quando o código atual as superou;
- não deixar paths removidos como instrução presente;
- não declarar versão de SDK/protocolo como baseline atual sem conferir `package.json`/lockfile e
  validações;
- preservar documentos históricos quando têm valor de auditoria, preferindo anotação de supersessão
  a reescrita retroativa de fatos temporais.

## 11. Gates recomendados

- caminhos canônicos citados pelos READMEs devem existir ou ser explicitamente históricos;
- `src/copilot/infra/public/` deve continuar descobrível pelo scanner/índice;
- `package.json#imports` deve ser entendido pelo detector de imports;
- documentos canônicos não devem reintroduzir `presentation/agent-runtime.js` nem
  `presentation/runtime-ui-state-store.js`;
- o README SDK deve registrar o baseline instalado atual;
- o README MCP deve diferenciar claramente endpoint HTTP local e origin HTTPS/HTTP2 do tunnel.

## 12. Convenção de status

Quando um novo documento amplo for criado, prefira declarar no topo uma destas classes:

- **CANÔNICO / ATIVO** — contrato/roadmap vigente;
- **RUNBOOK ATIVO** — procedimento operacional vigente;
- **HISTÓRICO / SUPERADO PARCIALMENTE** — evidência temporal útil, mas não source of truth do
  `HEAD`;
- **ARQUIVADO** — mantido apenas por rastreabilidade.

Isso reduz o custo de decisão para humanos, ChatGPT/LLM-B e automações que navegam o workspace.
