# Model Gateway e LLM-B: Diagnostico, Estado Ideal e Roadmap Canonico

> Reconstruido em 2026-08-14. Este arquivo substitui o diario incremental de junho como fonte canonica do estado, das decisoes e da continuidade. Evidencias operacionais dinamicas ficam em `artifacts/` e no SQLite local; nao contem segredos e nao entram no Git.

## 1. Decisao Executiva

Em 2026-08-14 a LLM-B respondeu de verdade. Nao foi encontrada uma quebra externa que impedisse o provider Kilo/SDK de responder. A causa percebida como "nao responde" era uma combinacao de tres fatores locais:

1. O boot podia anunciar `LLM-B pronta` sem repintar de forma garantida o prompt REPL. O primeiro comando automatico parecia sair de uma linha sem prompt.
2. O harness de troca de rota encerrava o terminal antes do reattach diferido no limite do turno. Isso fabricava `SAME_SESSION_ROUTE_REATTACH_FAILED` durante o shutdown.
3. O catalogo estava cerca de 59 dias vencido. A atualizacao de JSON nao espelhava o SQLite no caminho CLI, entao a readiness corretamente acusava paridade quebrada.

As tres causas foram corrigidas e comprovadas por execucao viva. A configuracao padrao de `npm run terminal:llm-b` inicia com BYOK Kilo pronto; o alerta de quota Premium do Copilot permanece apenas telemetria lateral e nao bloqueia a rota BYOK.

## 2. Evidencia Atual

### 2.1 Terminal padrao

- [x] `node scripts/model-gateway/run.mjs llmBLiveTest --no-pr --timeout-ms=180000` passou em 2026-08-14.
- [x] A sessao mostrou `LLM-B pronta`, prompt interativo, `kilo-auto/free`, BYOK pronto e 127 ferramentas.
- [x] `/usage`, `/activity`, `/session sdk`, `/health`, `/events` e `/errors 10` responderam; erros rastreados: zero.
- [x] O prompt apareceu antes de `/usage now`; nao houve pintura dupla no boot.
- [x] O encerramento foi feito por `/quit`, sem processo de teste ativo remanescente.
- Evidencia: `artifacts/terminal-live/2026-08-14T-llmb-default-boot-ready/summary.md`.

### 2.2 Fluxo vivo de troca de provider/modelo

- [x] `model-gateway-route-apply-minimal` passou em PTY com SDK e provider reais.
- [x] A LLM-B chamou `report_intent`, `read_file_content`, duas vezes `model_gateway_overview`, duas vezes `model_gateway_operation_status` e `model_gateway_route_switch` em `plan` e `apply`.
- [x] Os oito `DELTA-CANONICAL` foram publicados antes de `ask_user`.
- [x] `ask_user` exibiu pergunta persistente, recebeu `SIM` de autoria humana e a LLM-B publicou o marcador final.
- [x] O apply retornou deferimento seguro e a promocao posterior confirmou a mesma sessao no SQLite: `kilo-auto/free` para `ollama-cloud/qwen3-coder-next`.
- [x] Nenhum erro SSE, nenhum erro do terminal, nenhum novo `sessionId` e nenhum fallback oculto foram observados.
- Evidencia: `artifacts/terminal-live/2026-08-14T-llmb-route-promotion-verified/summary.md`.

### 2.3 Catalogo e readiness

- [x] Os 25 importadores vencidos foram atualizados em 2026-08-14.
- [x] O refresh detectou mudanca externa real: 307 adicoes, 157 remocoes e 865 alteracoes de projecao na primeira rodada.
- [x] A revisao atual e `catalog:32d63087aea2afdba080e6b6`; a data do snapshot foi renovada.
- [x] O espelho JSON/SQLite passou com zero divergencias de contagem e chave.
- [x] `liveReadiness --json` esta verde.
- [x] `operatorReady --profile=repo_agent --json` esta verde: 9/9 checks, sem blockers ou warnings.
- [x] O plano standby foi persistido: 12 rotas, 5 providers e 12 provas de runtime.

### 2.4 Validacao de codigo

- [x] `npm run typecheck` passou em modo strict.
- [x] `npm run lint` passou.
- [x] `npm run test:copilot` passou: 6.856 aprovados, zero falhas e 33 pendentes declarados.
- [x] A fixture de `/history` que chamava uma timeline reconciliada de divergente foi corrigida; o caso agora exige a mensagem de bloqueio somente para o estado `diverged`.

## 3. Achados e Correcoes Aplicadas

| Prioridade | Achado | Correcao | Prova |
| --- | --- | --- | --- |
| P0 | Prompt podia faltar apos `LLM-B pronta`. | `engine.js` faz redraw forcado apos reattach pronto. | Boot padrao e criterio `ux-diagnostic-commands-start-at-prompt` passaram. |
| P0 | O teste matava a sessao durante a promocao diferida. | Cenario de rota ganhou fase de deltas, continuacao separada para `ask_user` e grace de 15 s pos-final. | Handoff `committed` e confirmacao `route_confirmed_same_session`. |
| P0 | `model-gateway:refresh` deixava SQLite obsoleto. | O CLI agora espelha o snapshot commitado e devolve `sqlite.parityOk`. | `liveReadiness` voltou a verde apos refresh. |
| P1 | `snapshotId` antigo sobrevivia a revisoes de conteudo. | Refresh recalcula o hash depois de elegibilidade e retencao. | Id mudou de `catalog:88612...` para `catalog:32d630...`. |
| P1 | Um processo de teste orfao segurava a porta 3010. | Processo sem pai foi encerrado durante a auditoria. | Nenhuma instancia LLM-B de teste ficou ativa apos as validacoes. |
| P2 | A fixture de `/history` combinava estado `reconciliada` com expectativa exclusiva de `diverged`. | A expectativa passou a respeitar o contrato de apresentacao do estado. | Suite de comandos e suite maxima verdes. |

## 4. Arquitetura Alvo

1. **Boot previsivel:** banner, readiness e exatamente um prompt utilizavel; nenhum comando interno pode atravessar o limite visual do prompt.
2. **Uma sessao SDK:** toda troca de model/provider usa a mesma sessao. Durante um tool-turn, o apply cria handoff autorizado; o scheduler promove somente apos `dialog.turn_end` estavel.
3. **Commit verificavel:** `committed` significa reattach concluido, rota/projecao confirmada e ledger atualizado. `deferred_until_turn_boundary` nunca e apresentado como troca concluida.
4. **Catalogo revisionado:** JSON redigido e SQLite sao um par atomico para a operacao. `snapshotId` identifica o conteudo e `generatedAt` identifica observacao; paridade e bloqueador de readiness.
5. **Observabilidade humana:** SSE e ledger preservam ids tecnicos, enquanto a superficie REPL mostra estados, rotas e acoes compreensiveis sem segredos.
6. **Teste vivo determinista:** o harness separa etapas que dependem de fronteira de turno, aguarda a promocao e falha por evidencia ausente, nao por encerramento prematuro do proprio teste.

## 5. Estado Operacional e Riscos Residuais

### Pronto agora

- A rota default usa BYOK Kilo (`kilo-auto/free`) e respondeu no teste vivo.
- A rota de teste `ollama-cloud/qwen3-coder-next` foi promovida na mesma sessao e confirmada.
- O catalogo foi renovado, o SQLite esta em paridade e ha standby persistido.
- A quota Premium do Copilot aparece como informacao lateral de conta. Ela nao foi usada para a chamada BYOK comprovada e nao e criterio de bloqueio da LLM-B.

### Acompanhar, sem bloquear o uso

- [ ] **P1 - Timeline/export:** o export do run completo preservou todo o conteudo correto, mas seu cabecalho ainda declarou `timeline=mixed/diverged` e `sync=blocked:diverged-no-overlap`. A regra e fail-closed e evita gravacao insegura, portanto nao e perda de conversa; falta reduzir falsos positivos e validar a reconciliacao depois de `ask_user` mais promocao de rota.
- [ ] **P1 - Resultado compacto de tool:** `model_gateway_overview` ainda pode entregar payload grande ao modelo. Criar visao resumida limitada para LLM-B, mantendo `detail/raw` somente em diagnostico, reduz pressao de contexto em workflows longos.
- [ ] **P2 - Saude de alternativas:** o standby e baseado em evidencia e nao substitui probes recentes. Antes de promover uma alternativa em producao, executar probe autorizado para a rota escolhida.

## 6. Roadmap Executavel

### Faixa 0 - Recuperacao e Verdade Operacional

- [x] 0.1 Reproduzir boot da LLM-B em PTY com configuracao efetiva.
- [x] 0.2 Inspecionar env sem revelar valores e confirmar rota BYOK preparada.
- [x] 0.3 Rodar conversa viva com tools, `ask_user` e final publico.
- [x] 0.4 Rodar troca real de provider/modelo na mesma sessao.
- [x] 0.5 Limpar processo de teste orfao e conferir portas.
- [x] 0.6 Atualizar catalogo vencido e persistir standby.

### Faixa 1 - Confiabilidade de Boot e Promocao

- [x] 1.1 Forcar a pintura do prompt no marco de readiness apos reattach.
- [x] 1.2 Registrar teste unitario que protege o redraw forcado.
- [x] 1.3 Separar deltas e `ask_user` no cenario que testa promocao de rota.
- [x] 1.4 Aguardar grace suficiente para `dialog.turn_end` e scheduler antes dos diagnosticos/`/quit`.
- [x] 1.5 Provar `route_confirmed_same_session` no ledger vivo.
- [ ] 1.6 Adicionar ao harness uma espera por estado `committed` (alem do grace temporal) para tornar a prova independente de latencia.

### Faixa 2 - Catalogo, SQLite e Selecao

- [x] 2.1 Detectar expiracao real de todas as fontes e executar refresh controlado.
- [x] 2.2 Espelhar cada refresh CLI commitado no SQLite.
- [x] 2.3 Expor `sqlite.mirrored` e `sqlite.parityOk` no resumo do CLI.
- [x] 2.4 Recalcular `snapshotId` para cada revisao material.
- [x] 2.5 Validar integridade, paridade, `liveReadiness` e `operatorReady` apos refresh.
- [x] 2.6 Tornar falha de paridade no CLI explicitamente nao-zero, preservando resumo redigido para diagnostico.
- [ ] 2.7 Adicionar um teste de integracao do CLI com stores temporarios para cobrir refresh + mirror sem depender de rede.

### Faixa 3 - Contexto, Timeline e Export

- [ ] 3.1 Reproduzir em fixture a sequencia `tool-turn -> deltas -> ask_user -> resposta -> promocao -> export` que hoje resulta em `diverged-no-overlap`.
- [ ] 3.2 Diferenciar cauda temporalmente segura de divergencia genuina, usando `traceId`, `turnId`, `requestId` e ordem SSE quando presentes.
- [ ] 3.3 Manter bloqueio fail-closed para conflito real; nunca gravar ou deduplicar por heuristica fraca.
- [ ] 3.4 Fazer o header do export comunicar estado humano, sem enums internos, e incluir causa tecnica apenas no modo diagnostico.
- [ ] 3.5 Repetir o cenario vivo e exigir `bridge_tail` ou `aligned` quando a evidencia permitir.

### Faixa 4 - Ergonomia e Carga de Contexto

- [ ] 4.1 Definir contrato `summary`/`detail` para `model_gateway_overview` e `operation_status`.
- [ ] 4.2 Limitar listas de perfis/operacoes na resposta injetada no modelo, sem limitar `/events --raw` ou APIs diagnosticas.
- [ ] 4.3 Medir tokens de tool definitions e de resultados em cenarios de troca; fixar orcamento maximo no harness.
- [ ] 4.4 Executar regressao viva com todas as tools Model Gateway em serializacao de uma tool por resposta.

### Faixa 5 - Validacao e Governanca Continua

- [x] 5.1 Validacao focada: syntax, ESLint e suites de contratos, turn boundary e promocao diferida.
- [x] 5.2 Executar typecheck strict, lint e testes maximos de `src/copilot` antes de publicar a proxima leva.
- [x] 5.3 Executar live full apos cada alteracao de scheduler, rota ou protocolo de pergunta.
- [ ] 5.4 Atualizar este arquivo ao concluir cada subfase; marcar apenas evidencia observada, com caminho do artefato.

## 7. Comandos de Operacao

```bash
# Uso cotidiano
npm run terminal:llm-b

# Boot e superficie sem consumir um turno de modelo
node scripts/model-gateway/run.mjs llmBLiveTest --no-pr --timeout-ms=180000

# Prova viva de troca same-session
COPILOT_LIVE_TEST_COPILOT_MODEL=kilo-auto/free \
  node scripts/model-gateway/run.mjs llmBLiveTest \
  --live-scenario=model-gateway-route-apply-minimal --timeout-ms=420000

# Estado operacional redigido
node scripts/model-gateway/run.mjs liveReadiness --json
node scripts/model-gateway/run.mjs operatorReady --profile=repo_agent --json

# Atualizacao de catalogo com espelho SQLite automatico
npm run model-gateway:refresh -- --commit
node scripts/model-gateway/run.mjs catalogIntegrity --json
```

## 8. Criterio de Encerramento da Proxima Leva

Somente considerar a proxima leva concluida quando os itens da Faixa 3 ou 4 escolhidos tiverem testes unitarios, lint e uma evidencia live pertinente. `PASS` de boot nao prova provider switch; `route_confirmed_same_session` nao prova catalogo fresco; e paridade de catalogo nao prova conversa. Cada criterio tem sua propria prova para evitar regressao por inferencia.
