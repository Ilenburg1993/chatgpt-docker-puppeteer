# Model Gateway / BYOK / LLM-B — guia canônico pós-consolidação same-session

Data canônica: 2026-06-16

Status: ativo, normativo e continuamente atualizável

Escopo exclusivo: `src/copilot`

Base lida integralmente antes deste guia:
`src/copilot/docs/model-gateway/CANONICAL_MODEL_GATEWAY_LLM_B_CONTROL_PLANE_AUDIT_AND_ROADMAP_2026-06-15.md`

Leitura confirmada: 1.796 linhas, do título até as referências externas.

Checkpoint sincronizado antes desta investigação:

- commit local/remoto: `b211cb47` (`feat(copilot): consolidate model gateway control plane`);
- branch: `main`;
- push: `origin/main` atualizado de `64ab084f3` para `b211cb47`.

Este arquivo passa a ser o novo guia operacional para as próximas etapas. O roadmap anterior continua histórico e
útil como evidência, mas o trabalho novo deve atualizar os checkboxes deste documento no mesmo incremento do código.

## 1. Regra de atualização contínua

- [x] Nenhum checkbox é marcado como concluído sem código ou evidência verificável.
- [x] Trabalho parcial fica em `[ ]` com nota de progresso.
- [x] Live runs que falham por harness, mas provam funcionalidade, são registrados como evidência operacional, não como
  aceite final.
- [x] `/restart` é conversa-only: não muda provider, modelo, rota nem identidade da sessão viva.
- [x] Nova sessão só ocorre por pedido explícito humano ou por comando explícito dedicado a criar nova sessão.
- [ ] Ao implementar qualquer item abaixo, atualizar este arquivo antes do commit.

## 2. Situação atual reconstruída

### 2.1 O que já está forte

- [x] Existe control plane em `src/copilot/model-gateway/control-plane/`.
- [x] `SessionBindingPlan`, `ModelIdentity`, lifecycle canônico e secret diagnostics existem.
- [x] Troca de modelo é transacional e idempotente no caminho canônico.
- [x] Troca de rota/provider preserva `sessionId` e falha fechado se o SDK retornar outra identidade.
- [x] `model_gateway_route_switch` não tenta reattach durante tool-turn ativo; retorna
  `deferred_until_turn_boundary`.
- [x] O terminal consegue promover operação deferida com `/byok provider ... idempotency:<key> force-deferred`.
- [x] O live test mínimo provou deferimento dentro do tool-turn e promoção posterior para
  `ollama-cloud/qwen3-coder-next` na mesma sessão.
- [x] Existem 16 tools locais `model_gateway_*` para LLM-B, incluindo guia e workflow planner.
- [x] Profile store materializa perfis BYOK como `gateway_profile` antes da borda SDK.
- [x] `onListModels` já projeta catálogo elegível do gateway, com fallback compatível.
- [x] `npm run typecheck:node` passou após correção de tipagem em `runtime-route-switch.js`.
- [x] `git diff --check --cached` passou antes do commit `b211cb47`.

### 2.2 O que ainda não está fechado

- [ ] Promoção automática em `assistant.turn_end` ainda não existe.
- [ ] `model_gateway_runtime_reconcile` ainda reconcilia modelo, não operação `same-session-route-switch:*` diferida.
- [ ] Ingress/proxy dinâmico do Model Gateway ainda não existe para providers que o SDK não rebindar diretamente.
- [ ] `terminal/commands/byok.js` segue monolítico e ainda concentra casos de uso.
- [ ] Existem testes legados que ainda esperam `auto_prepare_new_session`, `prepare_new_sdk_session` e
  `/session sdk next new` como caminho normal.
- [ ] Profile management ainda persiste no processo vivo; escrita durável controlada precisa de decisão final.
- [ ] O shape de `profile` em `model_gateway_profile_manage` é flexível demais para ser a situação ideal.
- [ ] Readiness ainda precisa convergir completamente entre `overview`, `/byok`, `ops` e health cockpit.
- [ ] O live mais recente `2026-06-16T07-33-21-790Z` provou o fluxo funcional, mas falhou critérios de export/usage:
  `export-sse-correlation`, `no-prompt-double-render`, `export-ask-user`, `export-ask-user-answer`,
  `byok-real-usage-classified`.
- [ ] Falta live controlado de rollback induzido e reconcile pós-mismatch.
- [ ] O caminho vanilla GitHub Copilot SDK ainda precisa de golden tests explícitos.

## 3. Situação ideal

### 3.1 Superfície única

Operador humano e LLM-B devem enxergar uma superfície única:

```text
catálogo + perfis + saúde + rota + sessão viva
  -> Model Gateway Control Plane
  -> terminal / tools / boot / SDK server
```

O terminal renderiza e aciona use-cases. As tools planejam e aplicam operações. O boot consome bindings. Nenhuma borda
reinventa regra de provider/modelo.

### 3.2 Troca natural na mesma sessão

Trocar modelo/provider/rota deve parecer tão natural quanto trocar reasoning:

- planejar com explicação;
- aplicar com idempotência;
- preservar `sessionId`;
- exibir provider/modelo efetivo;
- registrar operação e saúde;
- corrigir mismatch sem nova sessão implícita.

Quando o reattach imediato é perigoso no meio do tool-turn, a operação deve ser agendada/promovida no limite seguro do
turno, não empurrada para uma nova sessão.

### 3.3 Control plane completo para LLM-B

A LLM-B deve conseguir:

- consultar visão geral;
- buscar catálogo;
- propor workflow;
- planejar rota/modelo;
- avaliar modelos por custo, contexto, saúde e tool-calling;
- executar probes descartáveis;
- atualizar catálogo;
- gerir perfis sem segredo inline;
- trocar modelo/provider;
- reconciliar divergência;
- acompanhar ledgers e evidências.

### 3.4 Segurança e observabilidade

- Segredos nunca aparecem em transcript, tool result, export, SSE ou Markdown.
- `sessionId`, provider, providerModel, profile, route key, operation id e idempotency key aparecem em forma redigida e
  rastreável.
- Falhas de provider viram health evidence e política de elegibilidade, não ruído textual.
- Readiness distingue estrutural, operacional, live, freshness e mismatch.

## 4. Roadmap executável

### Faixa 0 — Governança pós-push

- [x] Commit estrutural `b211cb47` criado.
- [x] Push para `origin/main` concluído.
- [x] Roadmap canônico anterior lido integralmente.
- [x] Gaps abertos extraídos por checkbox e busca textual.
- [x] Novo guia canônico criado.
- [ ] Limpar ou substituir rascunhos documentais locais que contradizem o estado atual.
- [ ] Commitar e pushar este novo guia.

### Faixa A — Promoção automática de route switch deferido

#### A.1 Ledger e descoberta de operações deferidas

- [ ] Adicionar consulta dedicada para operações `same-session-route-switch:*` em
  `deferred_until_turn_boundary`.
- [ ] Indexar por `sessionId`, `idempotencyKey`, route identity e `createdAt`.
- [ ] Expor no `model_gateway_operation_status` quais operações diferidas são promovíveis.
- [ ] Incluir `nextActions` concretos: promoção terminal, promoção automática ou descarte.

#### A.2 Scheduler em limite de turno

- [ ] Definir evento canônico de promoção em `assistant.turn_end`.
- [ ] Garantir que a promoção só roda depois de tool responses fechadas.
- [ ] Exigir sinal explícito de autorização/política para aplicar promoção automática.
- [ ] Preservar dialog loop e `sessionId` durante a promoção.
- [ ] Registrar transição `deferred_until_turn_boundary -> reattach_requested -> ... -> committed`.
- [ ] Cobrir operação agendada, operação cancelada e operação expirada.

#### A.3 UX e tools

- [ ] `model_gateway_route_switch` deve explicar quando a LLM-B não deve tentar reaplicar imediatamente.
- [ ] `model_gateway_workflow_plan` deve gerar etapa de promoção pós-turno quando apropriado.
- [ ] `/activity`, `/byok` e `/tools diag` devem exibir operação diferida pendente sem sugerir nova sessão.
- [ ] `/restart` deve continuar descrito como conversa-only em todos os pontos.

### Faixa B — Reconcile de rota/provider, não só modelo

- [ ] Fazer `model_gateway_runtime_reconcile` aceitar `operationId` de route switch diferido.
- [ ] Distinguir reconcile de modelo (`expectedModelId`) e reconcile de rota (`expectedRoute`/`operationId`).
- [ ] Quando a operação estiver deferida, retornar plano de promoção em vez de `runtime_reconcile_not_committed`.
- [ ] Quando a rota efetiva já estiver convergida, marcar `already_converged`.
- [ ] Quando houver mismatch, aplicar o mesmo executor de route switch com rollback e identidade imutável.
- [ ] Adicionar testes unitários para deferred -> committed via reconcile.
- [ ] Adicionar live mínimo: deferir route switch, promover por reconcile, continuar mesma sessão.

### Faixa C — Matar a dívida de nova sessão implícita

- [ ] Atualizar testes legados em `tests/unit/copilot/terminal/test_commands_byok.spec.js` que ainda esperam
  `auto_prepare_new_session`.
- [ ] Atualizar testes legados em `tests/unit/copilot/model-gateway/test_model_gateway_contracts.spec.js` que ainda
  esperam `prepare_new_session` como ação normal.
- [ ] Reclassificar `/session sdk next new` como ação explícita de operador, nunca recomendação automática de BYOK.
- [ ] Preservar compatibilidade de leitura do preset `auto_prepare_new_session` como alias para
  `auto_same_session_route`, sem efeito de nova sessão.
- [ ] Remover copy de terminal que sugira que restart/next boot é forma normal de trocar provider.
- [ ] Adicionar regra de teste: qualquer novo `prepare_new_sdk_session` precisa provar que é opt-in explícito.

### Faixa D — Decompor `/byok`

- [ ] Mapear casos ainda implementados diretamente em `terminal/commands/byok.js`.
- [ ] Extrair parser puro de argumentos.
- [ ] Extrair renderers de status, provider, health, probes e recommendation.
- [ ] Extrair use-cases que chamam control plane: profile, model, provider, probe, refresh, recommend.
- [ ] Garantir que terminal e tools usam os mesmos serviços, não parsing textual.
- [ ] Manter aliases humanos PT-BR/EN sem transformar output humano em API primária.
- [ ] Reduzir `terminal/commands/byok.js` para orquestração fina e delegação.

### Faixa E — Perfis BYOK duráveis e schemas por provider

- [ ] Decidir store durável canônico: `.env.local` controlado, JSON dedicado ou SQLite.
- [ ] Implementar `plan` com diff redigido antes de qualquer escrita persistente.
- [ ] Implementar `apply` atômico com idempotency key.
- [ ] Implementar rollback de mutação de perfil.
- [ ] Criar validação estrutural por provider/wire API.
- [ ] Restringir `profile` flexível da tool por canonicalização antes da escrita.
- [ ] Bloquear refs arbitrárias fora da allowlist do provider, preservando leitura de legados.
- [ ] Expor auditoria de mutação de perfil em `operation_status`.

### Faixa F — Readiness única

- [ ] Definir schema único `ModelGatewayReadiness`.
- [ ] Alimentar `model_gateway_overview` com esse schema.
- [ ] Alimentar `/byok` e `/session sdk` com o mesmo schema.
- [ ] Alinhar `ops --json` ao mesmo readiness, removendo falso `ok` para snapshot obsoleto/mismatch.
- [ ] Incluir freshness, standby, health probes, route mismatch, session identity e deferred operations.
- [ ] Adicionar budget de latência e fonte dos dados no payload.
- [ ] Cobrir por unit tests e um smoke real.

### Faixa G — Catálogo, saúde e política de modelo

- [ ] Executar refresh controlado sem exposição de segredo.
- [ ] Normalizar filtros `provider:kilo-code` para refletir modelos funcionais selecionáveis.
- [ ] Rebaixar modelos com `agent probe tool-missing` para tarefas que exigem tool-calling.
- [ ] Separar capability de visão como opcional enquanto fixture PNG falha em providers reais.
- [ ] Promover/rebaixar elegibilidade por evidência live recente, não só catálogo remoto.
- [ ] Criar standby plans persistidos e testáveis.

### Faixa H — Ingress/proxy dinâmico

- [ ] Definir se o SDK consegue rebindar todos os providers necessários via `resumeSession`.
- [ ] Para providers sem rebind direto, desenhar ingress OpenAI-compatible estável visto pelo SDK como provider único.
- [ ] Roteamento interno do ingress deve usar provider/model/profile/secret do Model Gateway.
- [ ] Preservar streaming, JSON, tool-calling e ask_user.
- [ ] Registrar health por provider real, não apenas pelo ingress.
- [ ] Testar troca cross-provider sem recriar sessão usando ingress.

### Faixa I — Harness live, export e SSE

- [ ] Corrigir `export-sse-correlation` para ask_user e answer.
- [ ] Corrigir export Markdown para conter pergunta canônica e resposta humana com autoria correta.
- [ ] Corrigir `no-prompt-double-render` sem mascarar prompts legítimos.
- [ ] Corrigir `byok-real-usage-classified` para classificação BYOK atual.
- [ ] Manter cenário mínimo de deferimento + promoção como PASS formal.
- [ ] Criar cenários menores por família de tools: catálogo, probes, perfil, switch/reconcile, manutenção.
- [ ] Rodar live rollback induzido e live reconcile pós-mismatch.

### Faixa J — Golden path vanilla GitHub Copilot SDK

- [ ] Criar golden test para `createSession` sem BYOK.
- [ ] Criar golden test para `resumeSession` sem BYOK.
- [ ] Provar que defaults e capabilities nativas são preservadas.
- [ ] Provar que `onListModels` vanilla não é sequestrado quando gateway não está ativo.
- [ ] Provar que BYOK/gateway não degrada sessão nativa.

### Faixa K — Aceite final

- [ ] Catálogo elegível e sessão real concordam sobre provider/modelo em todos os cockpits.
- [ ] Troca de provider/modelo ocorre na mesma sessão de forma natural, inclusive via LLM-B.
- [ ] Tool-turn ativo nunca perde tool response por reattach no meio do turno.
- [ ] Deferimento tem promoção automática ou caminho explícito pelo control plane.
- [ ] Reconcile entende modelo, rota e operações deferidas.
- [ ] Terminal e tools compartilham serviços sem semânticas paralelas.
- [ ] Profile management é durável, auditável e redigido.
- [ ] Readiness única governa overview, terminal, ops e health.
- [ ] Testes focados e live autorizados passam sem segredo em output/export/SSE.
- [ ] Branch `main` fica limpa, commitada e pushada após cada incremento relevante.

## 5. Ordem recomendada de execução

1. Fechar Faixa A e B juntas: scheduler de promoção + reconcile de operação diferida.
2. Corrigir harness/export da Faixa I para transformar o live mínimo em PASS formal.
3. Atualizar testes legados da Faixa C para remover a expectativa de nova sessão implícita.
4. Persistir perfis da Faixa E.
5. Decompor `/byok` na Faixa D.
6. Avançar readiness única e golden path vanilla.
7. Só então atacar ingress/proxy dinâmico se os providers reais ainda exigirem.

## 6. Evidência inicial deste guia

- [x] `git fetch origin main` antes do push não encontrou avanço remoto.
- [x] `npm run validate:copilot` rodou até o `typecheck`; o lint amplo passou e o `typecheck` apontou um erro real.
- [x] Erro corrigido: `forceApplyDeferred` agora aceita `undefined` explicitamente sob `exactOptionalPropertyTypes`.
- [x] `npm run typecheck:node` passou após a correção.
- [x] `npx eslint src/copilot/model-gateway/control-plane/runtime-route-switch.js` passou.
- [x] `git diff --check --cached` passou.
- [x] `git commit -m "feat(copilot): consolidate model gateway control plane"` criou `b211cb47`.
- [x] `git push origin main` atualizou `origin/main`.
