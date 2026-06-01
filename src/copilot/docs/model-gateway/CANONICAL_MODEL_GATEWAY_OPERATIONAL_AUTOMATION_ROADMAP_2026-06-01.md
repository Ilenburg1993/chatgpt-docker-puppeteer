# Canonical Model Gateway Operational Automation Roadmap

Status: guia historico. O guia ativo agora e
`CANONICAL_MODEL_GATEWAY_AUTO_RUNTIME_OPERABILITY_ROADMAP_2026-06-01.md`.

Data: 2026-06-01.

Escopo primario:

- `src/copilot/model-gateway/`
- `src/copilot/terminal/`
- `src/copilot/sdk/`
- `scripts/model-gateway/`
- `tests/unit/copilot/model-gateway/`
- `tests/unit/copilot/terminal/`

Guias anteriores:

- `CANONICAL_MODEL_GATEWAY_RUNTIME_AUTOMATION_ROADMAP_2026-06-01.md`
- `CANONICAL_MODEL_GATEWAY_BYOK_NEXT_GUIDE_2026-05-26.md`
- `CANONICAL_MODEL_GATEWAY_BYOK_UNIVERSAL_GUIDE_2026-05-25.md`

Este arquivo passa a ser o guia operacional para o modo auto funcional. Os arquivos anteriores continuam como historico e
contexto.

---

## 1. Objetivo

Queremos que o operador possa usar o terminal com BYOK/model-gateway de forma continua.

O sistema deve:

- carregar metadados canonicos normalizados;
- separar metadados raramente mutaveis de overlays volateis;
- avaliar acesso de conta/key antes de runtime;
- escolher uma rota por perfil de tarefa;
- respeitar preferencias do operador;
- evitar Ollama/local por padrao;
- observar falhas reais de runtime;
- classificar quota, rate-limit, auth, modelo indisponivel e falhas temporarias;
- preparar fallback sem corromper o catalogo canonico;
- aplicar troca live de modelo apenas dentro da mesma boundary SDK/BYOK;
- exigir novo boot SDK quando provider/perfil/baseUrl mudarem;
- explicar cada decisao;
- manter logs/SQLite suficientes para auditoria;
- expor comandos simples para humanos e LLMs.

---

## 2. Situacao Atual Auditada

### 2.1 O Que Ja Existe

- [x] Scripts operacionais do model-gateway estao em `scripts/model-gateway/`.
- [x] Existe barril `scripts/model-gateway/index.mjs`.
- [x] Runner live LLM-B foi migrado para `scripts/model-gateway/model-gateway-terminal-llm-b-live-test.mjs`.
- [x] Wrapper legado `scripts/copilot/run-terminal-llm-b-live-test.mjs` foi removido para evitar dois caminhos concorrentes.
- [x] `package.json` possui comandos `model-gateway:*`.
- [x] Makefile possui comandos `model-gateway-*`.
- [x] `model-gateway:ops` existe e e read-only.
- [x] `model-gateway:auto:status` existe e e read-only por padrao.
- [x] `model-gateway:auto:status -- --write-sqlite` persiste decisao operacional sem executar provider.
- [x] `model-gateway:live:plan` existe e gera plano sem runtime.
- [x] `model-gateway:live:readiness` existe.
- [x] `model-gateway:live:llm-b` e o comando canonico do runner live.
- [x] `automation/decision.js` decide acao pura.
- [x] `automation/controller.js` converte decisao em efeitos explicitos.
- [x] `automation/policy.js` le env de policy.
- [x] Terminal possui `/byok auto status`.
- [x] Terminal possui `/byok auto record`.
- [x] Terminal possui `/byok auto apply`.
- [x] Terminal possui `/byok auto off`.
- [x] Terminal registra dica auto apos falha BYOK.
- [x] SQLite possui tabela de automation decisions.
- [x] Diagnostics/retention conhecem automation decisions.
- [x] Runtime health nao muta metadado canonico.
- [x] Account overlays derivados de health existem.
- [x] Quota do Copilot SDK e separada de quota BYOK provider.
- [x] Ollama/local tem bloqueio opt-in por padrao.

### 2.2 Lacunas Funcionais Encontradas

- [x] `model-gateway:ops` deixou de mostrar readiness nulo e le o schema atual.
- [x] `/byok auto on` e uma superficie propria e mostra env seguro para o proximo boot.
- [x] Existe policy persistente simples em `data/copilot/model-gateway/runtime-automation-policy.json`.
- [x] O controller pre-turn roda antes de cada turno quando a policy efetiva esta ligada.
- [ ] O controller post-turn ainda e parcial; falhas BYOK geram dica com policy efetiva, mas nao fecham ciclo automatico.
- [ ] `apply_live_model` altera projecao terminal, mas nao grava uma confirmacao de aplicacao efetiva.
- [ ] Falta reconciliacao com `session.model_changed` / `usage/session.model_changed`.
- [ ] Falta representar no cockpit a diferenca entre "proximo boot preparado" e "boot SDK ja refeito".
- [ ] Falta uma linha unica "sistema pronto para live tests" combinando ops, readiness, plan e policy.
- [x] Existe teste de contrato do barril `scripts/model-gateway` e do runner `model-gateway:live:llm-b`.
- [x] Existe teste de terminal para `/byok auto on`.
- [x] Existe teste de terminal para executor compartilhado de efeitos auto.
- [ ] Falta teste de terminal para boundary diferente exigindo novo boot.
- [ ] Falta teste live LLM-B para auto status.
- [ ] Falta teste live LLM-B para falha simulada e fallback.
- [ ] Falta teste live LLM-B para mesma boundary e `setModel`.
- [ ] Falta teste live LLM-B para boundary diferente e novo boot recomendado.

### 2.3 Riscos Arquiteturais Atuais

- [ ] Se o operador espera automacao continua, ainda ha passos manuais demais.
- [ ] Se um modelo esgota quota no meio do turno, o sistema registra health, mas o proximo turno ainda depende de comando.
- [ ] Se o provider troca, a aplicacao live nao pode resolver; o sistema precisa preparar boot novo com clareza.
- [ ] Se uma falha de conta e account-wide, ela pode bloquear outros modelos do mesmo provider, mas isso depende de policy.
- [ ] Se uma falha e rate-limit resetavel, ela deve entrar em cooldown e voltar depois sem apagar metadados.
- [ ] Se a key muda, overlays antigos precisam expirar ou ser diferenciados por accountScope/secretRef.
- [ ] Se Ollama esta catalogado, defaults nunca devem seleciona-lo sem pedido explicito.
- [ ] Se o SDK nativo tem quota baixa, isso nao deve ser misturado com quota BYOK provider.

---

## 3. Arquitetura Ideal

### 3.1 Camadas

1. Catalogo canonico.
2. Provider specs e endpoints.
3. Account/key overlays.
4. Elegibilidade pre-runtime.
5. Runtime health observado.
6. Runtime selector.
7. Automation decision pura.
8. Automation controller puro.
9. Terminal adapter.
10. SDK/session boundary.
11. Observabilidade SQLite.
12. Cockpit operacional.
13. Testes live LLM-B.

### 3.2 Regra De Separacao

- Catalogo canonico descreve o que o mundo oferece.
- Account overlay descreve o que a key/conta aparenta permitir agora.
- Runtime health descreve o que aconteceu em execucao.
- Selection escolhe candidatos.
- Runtime selector escolhe rota tentavel.
- Automation decision escolhe acao.
- Controller produz efeitos.
- Terminal executa efeitos permitidos.
- SDK confirma o que realmente mudou.

### 3.3 Estado Persistente

Persistente canonico:

- modelos;
- route options;
- provider projections;
- endpoint specs;
- provenance;
- import runs;
- refresh logs;
- integrity facts.

Persistente operacional:

- runtime health;
- probe results;
- route decisions;
- automation decisions;
- live test baselines;
- readiness snapshots.

Volatil em processo:

- sessao SDK viva;
- binding BYOK vivo;
- projection terminal atual;
- falha do turno atual;
- policy lida do env.

### 3.4 Fluxo Pre-Turn Ideal

1. Terminal recebe novo turno do operador.
2. Se auto esta off, segue fluxo atual.
3. Se auto esta on, le policy.
4. Le catalogo e overlays.
5. Le runtime health.
6. Roda runtime selector sem executar provider.
7. Gera decision.
8. Gera controller step pre-turn.
9. Se `keep_current`, segue.
10. Se `apply_live_model`, aplica apenas se mesma boundary e policy permitir.
11. Se `prepare_new_session`, prepara boot novo e informa claramente.
12. Se `wait_for_reset`, escolhe fallback ou pede espera.
13. Se `manual_intervention`, mostra blockers e comando de recuperacao.

### 3.5 Fluxo Post-Turn Ideal

1. Turno termina com sucesso ou falha.
2. Sucesso grava health positivo quando aplicavel.
3. Falha BYOK e classificada.
4. Rate-limit ganha reset/cooldown.
5. Quota hard/account limit vira overlay operacional.
6. Auth/key vira overlay de account/key.
7. Model unavailable bloqueia rota/modelo.
8. Controller post-turn replaneja.
9. Decision e persistida.
10. Proximo comando/acao fica visivel.

### 3.6 Troca Live E Novo Boot

Troca live permitida:

- mesma profile;
- mesmo provider preset;
- mesma baseUrl quando conhecida;
- mesma wire API implicita;
- sessao SDK viva;
- policy `allowLiveSetModel=true`;
- target model valido;
- nao local/private sem opt-in.

Novo boot exigido:

- provider mudou;
- profile mudou;
- baseUrl mudou;
- wire API mudou;
- sem sessao viva;
- SDK binding vivo ausente;
- policy nao permite live switch;
- provider boundary nao pode ser provada.

### 3.7 Ollama E Local

- Catalogar local e permitido.
- Selecionar local por default e proibido.
- Rota local precisa de pedido explicito do operador.
- Comando deve aceitar opt-in direto, por exemplo `local_private` ou `allow-local-private`.
- Readiness default nao deve falhar por Ollama desligado.
- Readiness strict pode falhar se operador pediu local e daemon nao esta ativo.

---

## 4. Comandos Canonicos

### 4.1 Cockpit

- [x] `npm run model-gateway:ops`
- [x] `make model-gateway-ops`

### 4.2 Banco

- [x] `npm run model-gateway:metadata:build:plan`
- [x] `npm run model-gateway:metadata:build:preview`
- [x] `npm run model-gateway:metadata:build`
- [x] `npm run model-gateway:refresh:plan`
- [x] `npm run model-gateway:refresh`
- [x] `make model-gateway-refresh-provider PROVIDER=<id>`

### 4.3 Selecao

- [x] `npm run model-gateway:selection:effective`
- [x] `npm run model-gateway:runtime-selector`
- [x] `npm run model-gateway:auto:status`
- [x] `npm run model-gateway:auto:status -- --write-sqlite`

### 4.4 Terminal

- [x] `/byok auto status profile:repo_agent`
- [x] `/byok auto record profile:repo_agent`
- [x] `/byok auto apply profile:repo_agent allow-live-set-model`
- [x] `/byok auto off`
- [x] `/byok auto on profile:repo_agent allow-live-set-model`
- [ ] `/byok auto policy`
- [x] `/byok auto history`
- [ ] `/byok auto explain`

### 4.5 Live

- [x] `npm run model-gateway:live:readiness`
- [x] `npm run model-gateway:live:plan`
- [x] `npm run model-gateway:live:llm-b -- --no-pr --timeout-ms=180000`
- [ ] `npm run model-gateway:live:llm-b -- --byok-probe --byok-fixture --no-pr --timeout-ms=240000`
- [ ] `npm run model-gateway:live:llm-b -- --byok-real ... --no-pr`
- [ ] `npm run model-gateway:live:llm-b -- --byok-real ...`

---

## 5. Roadmap

## Faixa A - Cockpit Operacional Confiavel

- [x] A.1 Corrigir `model-gateway:ops` para resumir readiness usando o schema atual.
- [x] A.2 Mostrar `readiness.selectedProfileCount/profileCount` sem nulos.
- [x] A.3 Mostrar `livePlan` status dentro de ops.
- [ ] A.4 Mostrar `automationDecisionRows` e ultima decision com timestamp.
- [ ] A.5 Adicionar `--profile` consistente em todos os subcomandos do cockpit.
- [ ] A.6 Adicionar modo texto com proximo comando recomendado.
- [ ] A.7 Adicionar `--fail` coerente para CI/manual gate.
- [ ] A.8 Testar ops com fixtures ou mocks sem provider.

## Faixa B - Policy Persistente Do Operador

- [x] B.1 Definir arquivo local de policy operacional sem segredos.
- [x] B.2 Criar parser de policy combinando env + arquivo + flags de comando.
- [x] B.3 Criar `/byok auto on`.
- [ ] B.4 Criar `/byok auto policy`.
- [ ] B.5 Criar `/byok auto off` com leitura de policy efetiva.
- [ ] B.6 Garantir que `off` nao apaga segredo nem catalogo.
- [ ] B.7 Garantir que local/private continua opt-in.
- [ ] B.8 Testar precedencia env > flags > arquivo ou definir regra inversa explicitamente.

## Faixa C - Pre-Turn Controller Real

- [x] C.1 Localizar ponto exato antes do envio de mensagem ao SDK.
- [x] C.2 Injetar etapa auto pre-turn apenas se policy enabled.
- [x] C.3 Rodar runtime selector sem provider execution.
- [x] C.4 Aplicar `keep_current` sem ruido.
- [x] C.5 Aplicar `apply_live_model` com policy e same-boundary.
- [x] C.6 Bloquear provider switch live e preparar novo boot.
- [x] C.7 Persistir decision pre-turn.
- [x] C.8 Renderizar explicacao curta no terminal.

## Faixa D - Post-Turn Recovery

- [x] D.1 Consolidar hook de falha BYOK no engine.
- [x] D.2 Classificar falha com provider failure taxonomy.
- [x] D.3 Gravar health com reset/retryAfter quando existir.
- [ ] D.4 Derivar account overlay quando falha for auth/credits/rate-limit.
- [ ] D.5 Rodar controller post-turn em dry-run.
- [ ] D.6 Persistir decision post-turn.
- [x] D.7 Mostrar proxima acao no terminal.
- [ ] D.8 Evitar repeticao imediata de modelo falho.

## Faixa E - SDK Boundary E Confirmacao

- [ ] E.1 Mapear todos os eventos `session.model_changed`.
- [ ] E.2 Criar reconciliador de `setModel` solicitado vs confirmado.
- [ ] E.3 Persistir confirmation record operacional.
- [ ] E.4 Expor no `/byok auto status` ultimo switch confirmado.
- [ ] E.5 Se confirmacao falhar, marcar decision como nao confirmada.
- [ ] E.6 Testar model drift e confirmacao.
- [ ] E.7 Manter SDK quota separada de BYOK quota.
- [ ] E.8 Explicar Copilot SDK native vs BYOK provider no cockpit.

## Faixa F - Account/Key Robustez

- [ ] F.1 Reavaliar account overlay quando key muda.
- [ ] F.2 Diferenciar secretRef, accountScope e provider account.
- [ ] F.3 Melhorar TTL para auth/credits/rate-limit.
- [ ] F.4 Separar quota hard de rate-limit resetavel.
- [ ] F.5 Expor matriz de limites em cockpit.
- [ ] F.6 Impedir que overlay expirado bloqueie rota indefinidamente.
- [ ] F.7 Criar historico de account blockers.
- [ ] F.8 Testar derivacao account-wide por provider.

## Faixa G - Runtime Selector Automatizavel

- [ ] G.1 Garantir entrada unica para profiles/fallback profiles.
- [ ] G.2 Expor motivo de selecao em formato curto.
- [ ] G.3 Expor rejeicoes top-N por perfil.
- [ ] G.4 Integrar blockerClass ao plano.
- [ ] G.5 Garantir que Ollama/local nunca passa default.
- [ ] G.6 Permitir policy `prefer_runtime_proved`.
- [ ] G.7 Permitir policy `require_runtime_proof`.
- [ ] G.8 Testar sem runtime execution.

## Faixa H - Terminal UX

- [ ] H.1 `/byok auto status` deve mostrar policy efetiva completa.
- [ ] H.2 `/byok auto record` deve mostrar id da decision.
- [ ] H.3 `/byok auto apply` deve listar efeitos antes/depois.
- [x] H.4 `/byok auto on` deve informar que novo boot pode ser necessario.
- [x] H.5 `/byok auto history` deve ler SQLite.
- [ ] H.6 `/byok auto explain` deve explicar boundary, blockers e cooldown.
- [ ] H.7 Help `/byok` deve permanecer curto apesar do sistema crescer.
- [ ] H.8 Comandos devem ser intuitivos para LLM e humano.

## Faixa I - SQLite E Observabilidade

- [ ] I.1 Avaliar schema atual 5 para proximas tabelas operacionais.
- [ ] I.2 Se necessario, schema 6 para switch confirmations.
- [ ] I.3 Retention para confirmations.
- [ ] I.4 Diagnostics para policy, decision, confirmation.
- [ ] I.5 Redaction audit cobre novos payloads.
- [ ] I.6 Route decisions, health e automation decisions continuam separados.
- [ ] I.7 Criar summary unico para ops.
- [ ] I.8 Testar migracao incremental.

## Faixa J - Scripts E Barrels

- [x] J.1 Scripts em `scripts/model-gateway/`.
- [x] J.2 Barril com paths.
- [x] J.3 Runner live canonico no namespace model-gateway.
- [x] J.4 Wrapper legado preservado.
- [ ] J.5 Adicionar teste para paths do barril.
- [ ] J.6 Adicionar comando de doctor de scripts.
- [ ] J.7 Garantir que package/make/canonical inventory nao divergem.
- [ ] J.8 Remover referencias novas ao caminho legado em docs ativas.

## Faixa K - Testes Unitarios Escopados

- [ ] K.1 Automation decision: same boundary.
- [ ] K.2 Automation decision: provider boundary crossing.
- [ ] K.3 Automation decision: local/private blocked.
- [ ] K.4 Controller: dry-run vs allowed.
- [x] K.5 Terminal: auto on/off/status/record/apply.
- [ ] K.6 Ops: readiness summary atual.
- [ ] K.7 SDK boundary: model changed confirmation.
- [ ] K.8 SQLite: persistence/retention/redaction.

## Faixa L - Testes Live LLM-B

- [ ] L.1 Rodar control no-pr.
- [ ] L.2 Rodar BYOK fixture no-pr.
- [ ] L.3 Rodar auto status em terminal vivo.
- [ ] L.4 Rodar falha simulada e fallback.
- [ ] L.5 Rodar mesma boundary e setModel.
- [ ] L.6 Rodar boundary diferente e novo boot recomendado.
- [ ] L.7 Rodar BYOK real no-pr.
- [ ] L.8 Rodar BYOK real full turn.
- [ ] L.9 Gerar relatorio redigido.
- [ ] L.10 Corrigir bugs encontrados.

## Faixa M - Chancela De Pronto Operacional

- [ ] M.1 `npm run model-gateway:ops -- --fail`.
- [ ] M.2 `npm run model-gateway:live:readiness`.
- [ ] M.3 `npm run model-gateway:live:plan`.
- [ ] M.4 Testes unitarios escopados passam.
- [ ] M.5 Lint escopado passa.
- [ ] M.6 Typecheck strict de `src/copilot` passa em momento de chancela.
- [ ] M.7 Live no-pr passa.
- [ ] M.8 Live BYOK fixture passa.
- [ ] M.9 Live BYOK real no-pr passa.
- [ ] M.10 Live BYOK real full passa.
- [ ] M.11 Documento de operador atualizado.
- [ ] M.12 Commit e push finais sincronizados.

---

## 6. Primeiras Transformacoes A Fazer

1. Corrigir `model-gateway:ops` para ler o schema atual de readiness.
2. Criar teste de contrato para `model-gateway:live:llm-b` e paths do barril.
3. Feito: implementar `/byok auto on` como comando explicativo/policy-aware.
4. Expor decision id em `/byok auto record`.
5. Adicionar `/byok auto history` read-only.
6. Planejar reconciliacao `setModel` -> `session.model_changed`.

---

## 7. Criterios De Nao Regressao

- [ ] Nenhum comando read-only chama provider.
- [ ] Nenhum comando read-only muta sessao terminal.
- [ ] Nenhum secret aparece em stdout, JSON, docs ou SQLite.
- [ ] Ollama/local continua fora dos defaults.
- [ ] Catalogo canonico nao recebe runtime health.
- [ ] Account/key volatile nao vira metadado canonico.
- [ ] SDK quota nao bloqueia BYOK provider runtime.
- [ ] BYOK provider quota nao bloqueia SDK native route.
- [ ] Provider boundary nunca e cruzada por setModel live.
- [ ] Falha de quota nao gera loop infinito de tentativa.
