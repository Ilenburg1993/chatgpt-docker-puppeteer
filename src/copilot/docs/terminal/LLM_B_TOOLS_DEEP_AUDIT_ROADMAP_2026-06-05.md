# Auditoria profunda e roadmap das tools da LLM-B

Data local: 2026-06-05T13:00:22-03:00

Este documento passa a guiar a etapa de tools da LLM-B dentro de `src/copilot`.
Ele não substitui roadmaps amplos de terminal/BYOK/model-gateway, mas concentra a
fronteira que agora importa: as tools reais utilizadas pela LLM-B, sua execução,
seus contratos, seus eventos, sua observabilidade e sua apresentação no terminal.

## Escopo

- Inclui `src/copilot/tools/**`, `src/copilot/sdk/tools/**`, `src/copilot/hooks/**`,
  `src/copilot/observability/**`, `src/copilot/terminal/**`, `src/copilot/agent/**`
  apenas onde houver acoplamento direto com tools da LLM-B.
- Inclui ferramentas locais de leitura, escrita, patch, busca, shell, git,
  sessão, todo, hook, hub, introspecção, permissão e web.
- Exclui execução MCP como alvo principal. MCP entra aqui apenas como referência
  arquitetural análoga para schemas, lifecycle, progress, errors e metadata.
- Exclui mudanças de produto fora de `src/copilot`, salvo scripts de teste live
  em `scripts/copilot`/`scripts/model-gateway` quando forem necessários para
  exercitar a LLM-B.

## Princípios

1. A LLM-B deve usar tools locais canônicas, não MCP tools.
2. Tools devem ter contratos ricos o bastante para o modelo escolher corretamente,
   chamar com argumentos válidos, entender falhas e recuperar sem adivinhação.
3. A UX do terminal deve mostrar o ciclo real de tool com precisão: solicitada,
   iniciada, progresso, resultado parcial, concluída, falha, aguardando humano.
4. O operador humano deve ver nomes humanos, alvos, risco, duração, status e
   rastreio compacto; IDs internos só devem aparecer em diagnóstico detalhado.
5. `approve_all` e `audit_only` são modos deliberados de autonomia: não devem ser
   apresentados como falha simplesmente porque tools mutáveis têm
   `skipPermission=true`.
6. Toda tool mutável deve retornar mudança observável, rollback possível quando
   aplicável, hashes/trace e resumo seguro para terminal.
7. Toda tool de leitura deve retornar metadados úteis sem despejar conteúdo
   excessivo na UX.
8. Roadmap e testes live devem provar comportamento real, especialmente para
   `read_file_content` e `patch_file`.

## Situação atual observada

### Registry e factory

- `src/copilot/tools/infra/tool-factory.js` encapsula `defineTool` do
  `@github/copilot-sdk`, converte Zod/JSON Schema e adiciona feedback estruturado.
- `buildTool()` usa `requiresApproval=true` por padrão, que vira
  `skipPermission=false`.
- `withSkipPermission()` cria cópia rasa com `skipPermission=true` e evita mutar a
  tool original.
- `src/copilot/tools/bootstrap.js` registra grupos estáticos por categoria/tags e
  aplica `applySessionToolPermissionPolicy()` no array entregue ao SDK.
- `approve_all` e `audit_only` fazem todas as tools da sessão pularem prompts SDK;
  `selective` preserva prompts/policies.

### Read e patch

- `read_file_content` já tem janela por linha, cursor, `maxBytes`, base64,
  estratégia `cached|stream`, hash opcional, metadata e read-through.
- `patch_file` já exige `old_string`, suporta `replace_all`,
  `expected_occurrences`, `occurrence_index`, `expectedHash`, `dryRun`,
  `allowNoop`, preview de diff e rollback/snapshot.
- Ambas usam `validatePath`, I/O engine, envelopes e feedback estruturado.
- O modelo ainda depende muito de instruções textuais para escolher `includeHash`,
  `dryRun` e janela correta; falta uma camada explícita de affordances/riscos
  normalizados para o terminal e para introspecção.

### Introspecção

- `readIntrospectionRegistrySnapshot()` informa total, nomes, categorias,
  disabled/sessionExcluded, presença de FS canônico e relatório de contrato.
- `verifyToolRegistryContracts()` mede descrição, parameters, categoria, tags,
  instructions e `RISKY_SKIP_PERMISSION`.
- O verifier ainda trata `skipPermission=true` em tool mutável como warning
  genérico, sem saber se a sessão está em `approve_all`, `audit_only` ou
  `selective`.
- Isso cria ruído: em nosso objetivo de autonomia máxima, mutating tools com
  `skipPermission=true` são uma decisão operacional esperada, não um gap por si.

### Terminal e lifecycle

- `tool-activity-presenter.js` concentra nomes humanos, inferência de operação,
  alvo, resumo de resultado e compactação de IDs.
- `commands/tools.js` já tem linhas de diagnóstico com nome visual e nome interno
  apenas em detalhe.
- O SDK expõe eventos `tool.user_requested`, `tool.execution_start`,
  `tool.execution_progress`, `tool.execution_partial_result`,
  `tool.execution_complete` e `session.tools_updated`, todos com timestamps ISO
  8601 no tipo gerado.
- A UX ainda precisa garantir que todos esses eventos fluam para linha viva e
  `/tools diag` de forma coerente para read/patch reais.

### Auditoria de claims da LLM-B

- `assistant-tool-claim-audit.js` compara afirmações públicas com ledger recente.
- Regras atuais usam nomes técnicos explícitos como `read_file_content`,
  `patch_file`, `create_file`, `delete_file`, `report_intent`.
- Falta mapear aliases/nomes humanos e operações canônicas para evitar falso
  negativo quando a LLM-B fala "editei o arquivo" sem citar `patch_file`, ou
  quando o ledger registra `io.patch.*`.

### Contrato SDK local

- `@github/copilot-sdk` define `ToolResultObject` com `textResultForLlm`,
  `resultType`, `error`, `sessionLog`, `toolTelemetry`.
- O SDK também contém `convertMcpCallToolResult`, o que confirma que o formato MCP
  pode ser usado como referência de compatibilidade, mas a LLM-B local consome o
  contrato SDK de tools.
- Eventos gerados têm campos de progresso, parcial, resultado detalhado e conteúdo
  estruturado. A nossa camada deve aproveitar esses campos, não depender apenas
  de parsing heurístico de stdout.

## Referências externas verificadas

- MCP 2025-11-25 `server/tools`: lista/call de tools, `inputSchema`,
  `outputSchema`, annotations, resultados e mudanças de lista.
- MCP utilities de progress/cancellation/ping: referência para lifecycle e
  responsividade, não para execução direta da LLM-B.
- OpenAI Apps SDK e tools: referência para tool descriptors, resultados
  estruturados e `_meta`; aqui serve como inspiração de metadata para UX e
  interoperabilidade.
- `@github/copilot-sdk/dist/types.d.ts` e
  `dist/generated/session-events.d.ts`: fonte local autoritativa para o SDK que
  realmente executa a LLM-B neste repo.

## Bugs, gaps e oportunidades

### BGO-001: warning de autonomia confundido com risco

`RISKY_SKIP_PERMISSION` é válido em modo seletivo, mas em `approve_all` e
`audit_only` deve ser classificado como decisão operacional auditável. O relatório
precisa separar "autonomia deliberada" de "bypass acidental".

### BGO-002: contrato de tool não expõe affordances normalizadas

O registry guarda categoria/tags/readOnly, mas não há metadados canônicos para
capacidade (`read`, `patch`, `delete`), risco, side effects, rollback, streaming,
hash recomendado, dry-run recomendado, alvo esperado e preview.

### BGO-003: read/patch têm bons retornos, mas falta resumo unificado de execução

Cada handler retorna seu objeto específico. Falta um envelope semântico comum para
o terminal: `operation`, `targets`, `risk`, `changed`, `dryRun`, `rollback`,
`hashes`, `preview`, `nextAction`.

### BGO-004: presenter depende de heurística pesada

`tool-activity-presenter.js` faz bom trabalho, mas precisa de um caminho preferido
via metadata estruturada quando disponível. Heurística deve ser fallback.

### BGO-005: auditoria de claims é restrita

O auditor reconhece poucas tools e depende de nomes técnicos. Precisa usar a mesma
normalização de nomes/operações do presenter/ledger.

### BGO-006: testes live ainda não exercitam matriz read/patch de ponta a ponta

Há testes de terminal e diagnostics, mas precisamos de um roteiro live com:
read pequeno, read paginado, read com hash, patch dry-run, patch aplicado,
patch hash stale, patch multi-match, create/move/delete cleanup e uma falha
policy-denied.

### BGO-007: comando `/tools` ainda é muito diagnóstico, pouco operacional

O operador precisa ver "o que posso usar agora", "o que está em autonomia total",
"o que está desabilitado", "quais tools estão falhando" e "como testar read/patch"
sem decifrar contrato interno.

### BGO-008: list_tools não retorna parameters/instructions

A descrição promete parâmetros, mas o retorno atual lista nome, descrição,
metadata e disabled. Isso reduz capacidade da própria LLM-B de auditar seu
arsenal. Precisa de modo resumido/detalhado com schema e instructions sanitizados.

### BGO-009: disabled tools e excluded tools não têm razão/autor/timestamp

Hoje o estado é set de nomes. Para UX e recuperação, precisamos saber se a tool
foi excluída pela sessão, desabilitada em runtime, por quem, quando e por quê.

### BGO-010: contract report não diferencia error, warning, notice e decision

O relatório só tem `error|warning`. Para autonomia máxima, precisamos também de
`notice`/`decision` para achados esperados e auditáveis.

## Situação ideal

### Tool Definition Metadata

Cada tool registrada deve ter contrato canônico derivável:

- `name`, `description`, `parameters`, `instructions`.
- `category`, `tags`, `readOnly`.
- `operation`: `read|write|patch|delete|move|copy|search|shell|web|session|ask|intent|inspect`.
- `risk`: `low|medium|high|destructive`.
- `sideEffects`: `none|filesystem|process|network|session|permission|mixed`.
- `requiresApprovalByDefault` e `effectiveSkipPermission`.
- `autonomyReason` quando `skipPermission` vier de modo operacional.
- `supportsDryRun`, `supportsRollback`, `supportsHashPrecondition`,
  `supportsPagination`, `supportsStreaming`, `returnsDiff`, `returnsPreview`.
- `targetKinds`: arquivo, diretório, comando, URL, busca, sessão, humano.

### Tool Result Envelope

Sem quebrar compatibilidade, resultados devem poder carregar:

- `success`/`ok`, `error`/`reason` legados.
- `toolFeedback` para falhas.
- `operation` e `changeSet`.
- `io`/`operation` com trace.
- `terminalSummary`: resumo pequeno, seguro e humano.
- `llmNextAction`: orientação curta de recuperação ou próximo passo.
- `presentation`: hints opcionais para `tool-activity-presenter`.

### Terminal UX

- Linha viva deve preferir metadata estruturada de tool; heurística como fallback.
- `/tools` deve ter visão operacional limpa.
- `/tools diag` deve mostrar contrato, lifecycle, IDs e warnings técnicos.
- `/tools contract` deve listar gaps reais com severidade adequada.
- `report_intent_local` deve aparecer como "Intenção capturada"; IDs internos
  apenas em modo verbose.

### Live tests

O roteiro live deve criar área temporária em `artifacts/terminal-live-tools/`,
pedir à LLM-B executar read/patch/move/delete, registrar o terminal como o
operador vê e salvar summary com critérios objetivos.

## Roadmap

### Faixa A — Contrato canônico de metadata de tools

- [x] A1. Criar módulo puro para inferir metadata canônica de ToolEntry.
- [x] A2. Incluir operação, risco, side effects e capacidades em snapshot.
- [x] A3. Separar metadata declarada, inferida e efetiva.
- [x] A4. Garantir barrel exports sem acoplamento circular.
- [x] A5. Cobrir read, patch, create, write, move, copy, delete, search e shell.

### Faixa B — Verifier e autonomia máxima

- [x] B1. Transformar `RISKY_SKIP_PERMISSION` em severidade contextual.
- [x] B2. Adicionar modo `decision`/`notice` ao relatório sem quebrar consumers.
- [x] B3. Expor `permissionMode` e `effectiveSkipPermission` no report.
- [x] B4. Manter warning forte em `selective` quando mutating tool pula prompt.
- [x] B5. Atualizar `/tools contract` e `/tools diag` para nomes humanos.

### Faixa C — Introspecção útil para LLM-B

- [x] C1. Fazer `list_tools` retornar schema/instructions em modo detalhado.
- [x] C2. Adicionar filtros por operação, risco, side effect e capability.
- [x] C3. Sanitizar schemas grandes e segredos.
- [x] C4. Incluir razões de disabled/sessionExcluded.
- [ ] C5. Expor lista curta de "tools recomendadas para FS canônico".

### Faixa D — Read tool

- [x] D1. Adicionar `terminalSummary` ao sucesso de leitura.
- [x] D2. Tornar hash/cursor/truncation mais explícitos para o modelo.
- [x] D3. Adicionar `llmNextAction` para arquivo grande, diretório, base64 e cursor.
- [ ] D4. Garantir metadata consistente em cached e stream.
- [ ] D5. Testar read pequeno, paginado, stream, base64 e erro de diretório.
- [x] D6. Adicionar `terminalSummary`/`llmNextAction` às falhas de leitura.

### Faixa E — Patch tool

- [x] E1. Adicionar `terminalSummary` e `presentation` para dry-run/aplicado.
- [x] E2. Adicionar `llmNextAction` para stale hash, multi-match, noop e missing old_string.
- [x] E3. Padronizar diff preview truncado para terminal e LLM.
- [x] E4. Garantir rollback metadata legível.
- [ ] E5. Testar dry-run, apply, stale hash, multi-match e replace_all.

### Faixa F — Presenter e lifecycle

- [x] F1. Preferir hints estruturados de result/presentation.
- [ ] F2. Reduzir exposição de IDs no modo normal.
- [ ] F3. Melhorar labels de read/patch em linha viva.
- [ ] F4. Mostrar ISO 8601 completo em views persistentes.
- [x] F5. Consolidar fallback heurístico para tools externas/legadas.
- [x] F6. Adiar sucesso provisório de `external_completed` até `postToolUse` estruturado em operações com resultado tardio.
- [x] F7. Estacionar redraw de prompt idle durante narração de tools para evitar prompt pronto em turno ativo.
- [x] F8. Deduplicar alvos de arquivos vindos simultaneamente de args/result/presentation.
- [x] F9. Deduplicar paths equivalentes absoluto/relativo na superfície humana sem afetar `cwd` de comandos.

### Faixa G — Auditoria de claims

- [ ] G1. Reusar normalização canônica de nomes/operações.
- [ ] G2. Auditar claims por operação, não apenas nome técnico.
- [ ] G3. Evitar falsos positivos em respostas condicionais.
- [ ] G4. Mostrar achados com evidência curta e comando de diagnóstico.

### Faixa H — Disabled/excluded state

- [x] H1. Trocar sets simples por registros com source, reason e timestamp.
- [x] H2. Preservar compatibilidade de `getDisabledTools()`.
- [x] H3. Atualizar `toggle_tool` para reason opcional mas recomendado.
- [x] H4. Mostrar disabled/excluded com fonte em `/tools`.

### Faixa I — UX operacional de `/tools`

- [x] I1. Criar `/tools contract`.
- [x] I2. Criar `/tools fs`.
- [x] I3. Criar `/tools failures`.
- [x] I4. Reorganizar `/tools` para sumário limpo por categoria/capability.
- [x] I5. Manter `/tools diag` profundo para depuração.

### Faixa J — Testes unitários focados

- [x] J1. Testar metadata canônica.
- [x] J2. Testar verifier contextual.
- [x] J3. Testar `list_tools` detalhado.
- [x] J4. Testar summaries de read/patch.
- [x] J5. Testar presenter com hints estruturados.
- [x] J6. Testar lifecycle tardio `external_completed` -> `postToolUse` para falha e sucesso.
- [x] J7. Testar `/export` criando diretórios de destino antes da escrita.

### Faixa K — Testes live LLM-B

- [x] K1. Criar roteiro live read/patch em workspace temporário.
- [x] K2. Salvar transcript e summary em artifacts.
- [x] K3. Conferir terminal como operador humano.
- [x] K4. Corrigir discrepâncias de layout, nomes e timing.
- [ ] K5. Repetir com falhas intencionais e recuperação.
- [x] K6. Confirmar runner canônico: `node scripts/model-gateway/run.mjs llmBLiveTest`; wrapper antigo `scripts/copilot/run-terminal-llm-b-live-test.mjs` não existe mais.
- [x] K7. Executar live PTY `--no-pr` para validar boot/UX/artefatos sem abrir turno de LLM.
- [x] K8. Reexecutar `file-patch-roundtrip` após correções de lifecycle/prompt/export.
- [ ] K9. Rodar cenário `recoverable-tool-error` para confirmar falhas sem "Concluído" falso.
- [x] K10. Rodar cenário `file-write-roundtrip` para criação/move/delete e claims.
- [ ] K11. Consolidar relatório visual comparando screenshots antigas versus saída live atual.
- [x] K12. Sincronizar comandos diagnósticos live por retorno ao prompt antes de `/quit`.
- [x] K13. Em timeout de cenário live, coletar `/activity`, `/tools`, `/events`, `/errors`, `/health` e `/export` antes de encerrar.
- [x] K14. Remover log técnico `TerminalServer` da superfície pública para falhas BYOK já apresentadas em formato operacional.
- [x] K15. Tratar `Turno vazio` como erro rastreável em `/errors` quando recuperação falha.
- [x] K16. Remover cabeçalho duplicado de `/tools diag` quando nenhuma ferramenta foi usada.
- [x] K17. Trocar aviso antigo `[fila] Mensagem não produziu resposta` por linha semântica do tema do terminal.
- [x] K18. Fazer `/export` criar Markdown diagnóstico mínimo mesmo quando não há transcript materializado.
- [x] K19. Classificar rota BYOK sem resposta como bloqueio operacional do live runner, não como falha de protocolo com dezenas de critérios irrelevantes.
- [x] K20. Humanizar `/errors` para timeouts de progresso e turnos vazios, escondendo `SessionError`, `DialogLoopManager` e sources internos na superfície padrão.
- [x] K21. Corrigir `/events` default para buscar janela bruta maior e limitar eventos operacionais visíveis depois do filtro, evitando que ruído interno empurre pergunta/resposta/transcript para fora da tela.
- [x] K22. Humanizar labels/detalhes crus em `/events` para `session.title_changed`, `assistant.intent` e `Disabled tools`.
- [x] K23. Ajustar harness `sse-stdout-trace-overlap` para reconhecer que trace IDs são ocultos no default e que preview raw pode cair em cauda sem trace, mantendo o envelope SSE como validação primária.
- [x] K24. Fazer o harness considerar tools de falha esperada como obrigatórias antes de responder `ask_user`, bloqueando claims de recuperação sem `exec_command` real.

### Faixa L — Agente e outras superfícies src/copilot

- [ ] L1. Auditar acoplamento com `src/copilot/agent/**`.
- [ ] L2. Auditar hooks e permission controller depois do verifier contextual.
- [ ] L3. Auditar observability/tool-stats para refletir capabilities.
- [ ] L4. Auditar presentation/runtime/tools para não criar contrato paralelo.
- [ ] L5. Registrar próximos upgrades fora do terminal sem misturar escopos.

### Faixa M — UX de rota, modelo e automação BYOK

- [x] M1. Auditar arquivos centrais de troca viva de modelo: `byok/live-model-switch.js`, `events/model-transition-presentation.js`, `byok/gateway-auto.js` e `repl/live-status-line.js`.
- [x] M2. Garantir que a linha viva reconhece a terminologia atual `rota BYOK`, além de `provider/provedor BYOK`.
- [x] M3. Auditar `/byok auto handoffs|confirmations|recoveries|recovery-fixture` para remover cabeçalhos crus em inglês e ANSI manual.
- [ ] M4. Auditar `/byok auto status|plan|apply` para confirmar linguagem, timestamps ISO e separação entre intenção, aplicação e confirmação.
- [ ] M5. Auditar eventos `session.model_changed` e confirmação de troca para não misturar pedido de troca com confirmação real do SDK.
- [ ] M6. Auditar persistência de handoff/confirmation do model-gateway e como ela aparece em `/activity`, `/events`, `/byok auto confirmations` e `/health full`.
- [ ] M7. Criar live/probe sem PR para troca de modelo fake/fixture, validando layout sem consumir provider real.
- [ ] M8. Documentar a situação ideal de modelo/rota: selecionado, solicitado, preparado, confirmado, adiado, fallback e falha.

## Prioridade imediata

1. Faixa A: metadata canônica.
2. Faixa B: verifier contextual de autonomia.
3. Faixa C: `list_tools` detalhado.
4. Faixas D/E: summaries e next actions para read/patch.
5. Faixa F: presenter usando hints estruturados.
6. Faixa K: live tests read/patch.

## Registro de execução

- [x] 2026-06-05: investigação inicial do fluxo Tool -> SDK -> registry ->
  bootstrap -> introspecção -> terminal lifecycle.
- [x] 2026-06-05: distinção explícita entre LLM-B tools e MCP tools.
- [x] 2026-06-05: identificação de gaps BGO-001 a BGO-010.
- [x] 2026-06-05: implementadas Faixas A, B1-B4, C1-C3, D1-D3, E1/E3/E4 e F1.
- [x] 2026-06-05: `/tools contract` criado; `/tools diag` agora mostra contrato mesmo sem tools observadas e separa decisão de autonomia de warning operacional.
- [x] 2026-06-05: falhas de `read_file_content` agora retornam `terminalSummary`, `llmNextAction` e `presentation` estruturados.
- [x] 2026-06-05: falhas de `patch_file` agora retornam `terminalSummary`, `llmNextAction` e `presentation` estruturados para validação e erros da infra.
- [x] 2026-06-05: `/tools fs` criado para listar capacidades canônicas de filesystem por operação, risco, autonomia e affordances.
- [x] 2026-06-05: `/tools failures` criado para mostrar agregados problemáticos e lifecycle falho com nomes humanos.
- [x] 2026-06-05: disabled/sessionExcluded agora têm registros ricos com source, reason e ISO timestamp, preservando `getDisabledTools()`.
- [x] 2026-06-05: `/tools` padrão ganhou resumo compacto por categoria; `/tools all` mostra timestamp ISO no lifecycle.
- [x] 2026-06-05: validações focadas verdes: typecheck strict `src/copilot`, lint `src/copilot`, e 145 testes unitários focados de terminal/tools/read/write.
- [x] 2026-06-05: após push `1d58e746`, retomada análise de linha viva e runner live; caminho canônico de live test confirmado.
- [x] 2026-06-05: live PTY `--no-pr` PASS em `artifacts/terminal-live/llm-b-tools-ux-no-pr-rerun-20260605`; harness atualizado para critérios da UX atual.
- [x] 2026-06-05: live real `file-patch-roundtrip` executado em `artifacts/terminal-live/llm-b-tools-ux-file-patch-20260605`; achou claim de `delete_file` sem lifecycle, sucesso provisório antes de falha real, prompt pronto durante turno ativo e export prematuro.
- [x] 2026-06-05: `tool-lifecycle-runtime` agora adia sucesso provisório de operações read/write/create/edit/delete/move/run/search até `postToolUse` estruturado quando aplicável.
- [x] 2026-06-05: narração de tools estaciona redraw de prompt idle por janela curta para manter linha viva como fonte de estado durante turno ativo.
- [x] 2026-06-05: `/export` cria diretório destino recursivamente; harness live reconhece a linha `Exportado` atual e espera mais antes de `/quit`.
- [x] 2026-06-05: validações focadas verdes: lifecycle runtime, inline status/prompt e export (`40` testes).
- [x] 2026-06-05: rerun live `file-patch-roundtrip` PASS em `artifacts/terminal-live/llm-b-tools-ux-file-patch-rerun-20260605`, incluindo deltas, ask_user real, resposta humana, final pós-pergunta, SSE/export e ausência de prompt idle durante turno ativo.
- [x] 2026-06-05: presenter deduplica `fileTargets` para evitar detalhes como `arquivos: X, X`; teste focado adicionado.
- [x] 2026-06-05: live `recoverable-tool-error` BLOCKED em `artifacts/terminal-live/llm-b-tools-ux-recoverable-error-20260605` por `assistant-asked-before-required-deltas`; UX de falha ficou correta (`Falhou` sem falso `Concluído`).
- [x] 2026-06-05: dedupe de paths agora considera equivalência absoluto/relativo para arquivos e patches, preservando diretórios/cwd técnicos de comandos.
- [x] 2026-06-05: live `file-write-roundtrip` em `artifacts/terminal-live/llm-b-tools-ux-file-write-20260605` falhou corretamente por `delete_file` ausente; create/move renderizaram sem prompt de permissão, e artefato residual foi limpo.
- [x] 2026-06-05: harness live agora usa sequência prompt-synchronized para diagnósticos com `/export` e `/quit`, evitando embolar comandos longos durante `[PERG]`.
- [x] 2026-06-05: rerun live `file-write-roundtrip` PASS em `artifacts/terminal-live/llm-b-tools-ux-file-write-rerun-20260605`, cobrindo `create_file`, `move_file`, `delete_file`, ausência de prompt de permissão, `/activity`, `/intent`, `/tools diag`, `/events`, `/health full`, `/export` e cleanup real.
- [x] 2026-06-05: rerun live `recoverable-tool-error` em `artifacts/terminal-live/llm-b-tools-ux-recoverable-error-rerun-20260605` bloqueou por `live-timeout` antes das tools; achou dois gaps: timeout encerrava sem diagnósticos/export e falha BYOK apresentava linha técnica `TerminalServer` no terminal público.
- [x] 2026-06-05: timeouts de cenário live agora passam por diagnóstico/export prompt-synchronized antes de `/quit`; falhas BYOK já apresentadas ao operador são logadas como diagnóstico interno sem linha pública `ERROR`.
- [x] 2026-06-05: rerun live `recoverable-tool-error` em `artifacts/terminal-live/llm-b-tools-ux-recoverable-error-rerun2-20260605` bloqueou por `assistant-empty-turn`; confirmou diagnóstico/export no bloqueio e ausência da linha técnica `TerminalServer`, mas revelou `/tools diag` com cabeçalho duplicado e `/errors` vazio apesar do turno vazio final.
- [x] 2026-06-05: `Turno vazio` final agora alimenta `/errors`, sem transformar falhas BYOK recuperáveis em erro vermelho; `/tools diag` evita cabeçalho duplicado quando a sessão ainda não usou tools; harness reconhece o texto atual `Turno vazio` para diagnóstico imediato.
- [x] 2026-06-05: rerun live `recoverable-tool-error` em `artifacts/terminal-live/llm-b-tools-ux-recoverable-error-rerun3-20260605` bloqueou por `live-timeout` com diagnóstico iniciado; confirmou `/errors` com timeout rastreado e revelou copy antiga `[fila] Mensagem não produziu resposta` e `/export` sem arquivo quando o transcript está vazio.
- [x] 2026-06-05: aviso de turno sem resposta agora usa `terminalThemeRow`; harness detecta `Rota BYOK ficou sem resposta` para diagnóstico imediato; `/export` vazio cria Markdown diagnóstico mínimo para preservar artefatos de live.
- [x] 2026-06-05: rerun live `recoverable-tool-error` em `artifacts/terminal-live/llm-b-tools-ux-recoverable-error-rerun4-20260605` bloqueou por `assistant-empty-turn`; confirmou `/errors` apontando `terminal.dialog.empty_output` e `/export` criado, mas mostrou que `/tools diag` vazio ainda caía no resumo padrão por branch condicional errada.
- [x] 2026-06-05: `/tools diag` vazio agora não imprime `Ferramentas observadas` nem `0 grupos de ação`; teste unitário cobre a regressão.
- [x] 2026-06-05: iniciada Faixa M para UX de modelo/rota; linha viva agora reconhece `Falha da rota BYOK` como estado BYOK compacto, com teste focado.
- [x] 2026-06-05: `/byok auto handoffs`, `confirmations`, `recoveries` e `recovery-fixture` trocaram cabeçalhos crus em inglês por títulos humanos do tema do terminal.
- [x] 2026-06-05: rerun live `recoverable-tool-error` em `artifacts/terminal-live/llm-b-tools-ux-recoverable-error-rerun5-20260605` confirmou `/tools diag` vazio e `/export` mínimo, mas revelou dois gaps: rota BYOK sem resposta era classificada como `FAIL` e `/errors` vazava `SessionError`/`DialogLoopManager`.
- [x] 2026-06-05: harness live agora trata `Rota BYOK ficou sem resposta`/`sendTurn sem progresso` como `byok-route-no-response`; `/errors` traduz timeout de progresso e turno vazio para linhas operacionais com ações `/activity`, `/events` e `/byok health`.
- [x] 2026-06-05: rerun live `recoverable-tool-error` em `artifacts/terminal-live/llm-b-tools-ux-recoverable-error-rerun6-20260605` executou fluxo canônico completo com erro recuperável, deltas, `ask_user`, resposta humana, retomada pós-pergunta e export; sobrou apenas gap de `/events` default por janela bruta curta.
- [x] 2026-06-05: `/events` default agora overfetches a janela bruta sem alterar raw/json/filtros e renderiza até N eventos operacionais humanos; teste cobre eventos de rotina empurrando transcript/pergunta/resposta.
- [x] 2026-06-05: rerun live `recoverable-tool-error` em `artifacts/terminal-live/llm-b-tools-ux-recoverable-error-rerun7-20260605` confirmou `/events` com pergunta/resposta/transcript visíveis no default; revelou vazamentos `Disabled tools`, `session title changed` e `assistant intent`.
- [x] 2026-06-05: `/events` agora traduz `Disabled tools` para `Ferramentas desabilitadas`, `session.title_changed` para `Título da sessão` e `assistant.intent` para `Intenção da LLM-B`; teste cobre a superfície default.
- [x] 2026-06-05: rerun live `recoverable-tool-error` em `artifacts/terminal-live/llm-b-tools-ux-recoverable-error-rerun8-20260605` validou recuperação controlada quando os deltas saem antes de `ask_user`; revelou `tipo configuration` e critério instável de trace stdout quando o raw preview não contém trace visível.
- [x] 2026-06-05: `configuration` agora vira `configuração` em `/events`; o critério de trace stdout virou best-effort quando a tela oculta trace no default e o preview raw não inclui trace, preservando a exigência `sse-trace-envelope`.
- [x] 2026-06-05: rerun live `recoverable-tool-error` em `artifacts/terminal-live/llm-b-tools-ux-recoverable-error-rerun9-20260605` falhou corretamente porque a LLM-B pulou `exec_command`, mas revelou que o runner respondeu `ask_user` mesmo com tool de falha esperada ausente.
- [x] 2026-06-05: checker `findIncompleteExpectedToolChain` agora inclui expectedOutcome=`failure`; falha esperada só conta como materializada com lifecycle falho ou postToolUse failure.
- [x] 2026-06-05: rerun live `recoverable-tool-error` em `artifacts/terminal-live/llm-b-tools-ux-recoverable-error-rerun10-20260605` PASS, cobrindo erro recuperável real, segunda leitura, deltas, recuperação controlada para `ask_user` ausente, resposta humana, final pós-pergunta, SSE/export e ausência de labels crus.
- [x] 2026-06-05: `/byok auto plan` virou alias canônico humano para o antigo `proof-plan`, mantendo compatibilidade; plano de provas BYOK agora usa headline/rows do tema, sem ANSI manual, com contexto por provider/model e garantia read-only.
- [x] 2026-06-05: tela viva de retomada pós-pergunta vazia deixou de exibir badges crus `[RECUPERANDO]`/`[RECUPERAR]` e passou a usar headlines `Retomada automática`/`Continuação vazia` com rows padronizadas.
- [x] 2026-06-05: família `/byok auto on|off|policy|doctor|history|handoffs|confirmations|recoveries|recovery-fixture|standby` passou para headlines/rows/wrapped rows do tema, preservando títulos e automações antigas, removendo corpo ANSI manual das telas de automação.
- [x] 2026-06-05: cenários/harness live passaram a chamar `/byok auto plan` e a aceitar os novos rótulos `Provar`, `Novo boot`, `Retomada automática` e `Continuação vazia`.
- [x] 2026-06-05: bug pré-sessão corrigido: `/byok auto plan/status/...` não explode mais quando o SDK ainda não expõe inventário vivo; o status auto degrada para inventário vazio canônico e mantém plano read-only sem stack trace.
- [x] 2026-06-05: `/byok gateway operator-ready` agora usa painel temático com resumo, política, fronteiras, checks, standby, bancos, lives e próximos comandos em rows estáveis; teste cobre ausência de ANSI manual e comandos quebrados por largura.
- [x] 2026-06-05: `/byok gateway commands`, `/byok gateway` pre-K e `/byok gateway prebuild` migraram para headlines/rows do tema, com checks humanizados, descrições separadas e ausência de ANSI manual nas telas pré-build principais.
- [x] 2026-06-05: `/byok gateway catalog refresh-plan`, `refresh-log`, `diff` e `integrity` migraram para rows temáticas, mantendo comandos literais e recomendações de probe, com testes exigindo ausência de ANSI manual em log/diff.
- [x] 2026-06-05: live `auto-probe` inicial falhou por critérios antigos e excesso de `/byok gateway commands`; default agora limita inventário global a 48/154 com dica `full`, critérios live foram alinhados às novas rows, e rerun `artifacts/terminal-live/llm-b-auto-probe-ux-rerun2-20260605` PASS.
- [x] 2026-06-05: glossário BYOK central agora normaliza espaços, hífens e underscores, traduzindo `candidate alternative`, `selected route`, `new provider`, motivos `runtime health:agent probe ...` e efeitos `prepare_new_sdk_session`/`new_session_not_allowed` antes de chegar ao operador.
- [x] 2026-06-05: harness live auto passou a reprovar esses rótulos crus na superfície default; `test_commands_byok.spec.js` cobre operator-ready, standby e descrições de efeitos pulados.
- [x] 2026-06-05: live `auto-probe` com glossário rígido PASS em `artifacts/terminal-live/llm-b-auto-probe-ux-rerun4-20260605`; corrigidos `new session policy`, `new session requires explicit policy`, `automation decision`, `standby routes`, `terminal boundary` e `effects not enabled` nas superfícies de cockpit/auto.
- [x] 2026-06-05: live `auto-probe` rerun5 PASS em `artifacts/terminal-live/llm-b-auto-probe-ux-rerun5-20260605`; `/byok auto policy` ganhou linha principal sem ID cru e `/byok gateway operator-ready` passou a renderizar preset como nome humano.
- [x] 2026-06-05: `/byok gateway commands` agora preserva o inventário canônico técnico, mas renderiza a superfície terminal por objetos, com fases traduzidas e descrições humanas para os comandos default visíveis.
- [x] 2026-06-05: `/byok auto explain` ganhou cabeçalho próprio `Explicação BYOK auto`; live `auto-probe` rerun7 PASS em `artifacts/terminal-live/llm-b-auto-probe-ux-rerun7-20260605`, validando inventário humano e explain nomeado.
- [x] 2026-06-05: `/byok gateway eligibility runs` e `/byok gateway eligibility diff` migraram para `terminalThemeHeadline`/`terminalThemeWrappedRow`, removendo ANSI manual, traduzindo `disposition_changed` e preservando a fronteira sem runtime.
- [x] 2026-06-05: telas pré-runtime de providers/importers (`providers endpoints`, `gateway importers`, `gateway provider traits`, `gateway probes matrix`, `gateway probes backoff`, `gateway secrets`, `gateway local`) migraram para rows temáticas, com glossário ampliado para fontes, estados, selectors e rate-limit.
- [x] 2026-06-05: `/byok gateway selection audit` passou a usar envelope, comparações, perfis, supply, local/Ollama e fronteira em rows temáticas; IDs internos como `post_runtime_proved_better_route`, `local_provider_requires_explicit_request` e `rate-limit` deixaram de vazar na UX padrão.
- [x] 2026-06-05: validação focada verde: `node --check src/copilot/terminal/commands/byok.js` e `npx vitest run --config vitest.copilot.config.js tests/unit/copilot/terminal/test_commands_byok.spec.js` com 109/109 testes.
- [x] 2026-06-05: `/byok gateway catalog sqlite`, `/byok gateway health sqlite`, `/byok gateway catalog openai`, `/byok gateway catalog explain` e `/byok gateway provider explain` migraram para rows temáticas; novos testes cobrem espelho SQLite, schema OpenAI `x_model_gateway`, explicação de modelo e explicação de provedor sem ANSI manual.
- [x] 2026-06-05: validação focada verde após espelhos/explicações: `node --check src/copilot/terminal/commands/byok.js`, `git diff --check` e `npx vitest run --config vitest.copilot.config.js tests/unit/copilot/terminal/test_commands_byok.spec.js` com 114/114 testes.
- [x] 2026-06-05: `/byok gateway catalog refresh`, `catalog search`, `catalog conflicts`, `catalog freshness` e `gateway eligibility` migraram para rows temáticas; progresso de refresh, diffs, recomendações de prova runtime e exclusões pré-runtime agora usam labels humanos e respeitam wrap.
- [x] 2026-06-05: validação focada verde após refresh/search/eligibility: `node --check src/copilot/terminal/commands/byok.js`, `git diff --check` e `npx vitest run --config vitest.copilot.config.js tests/unit/copilot/terminal/test_commands_byok.spec.js` com 117/117 testes.
- [x] 2026-06-05: `BYOK model route` e `BYOK shortlist agent probe` migraram para rows temáticas; decisão, selecionado, rejeitados, cadeia de alternativas e próximos comandos agora ficam alinhados, com motivos humanos (`capacidade ausente: tools`, `preferido por contexto amplo`, `contexto pequeno demais`).
- [x] 2026-06-05: `src/copilot/terminal/commands/byok.js` zerou literais `\x1b[`; validação verde: `rg -n -F "\\x1b[" src/copilot/terminal/commands/byok.js`, `git diff --check` e `npx vitest run --config vitest.copilot.config.js tests/unit/copilot/terminal/test_commands_byok.spec.js` com 117/117 testes.
- [x] 2026-06-05: linha viva passou a reconhecer `request_user_input`/`ask_user` cru como pergunta humana mesmo antes da pendência estruturada chegar; o estado fica `LLM-B aguardando você · [PERG]`, não vaza `chatcmpl-tool-*`, `report_intent` ou `Executando tool`, e não pulsa periodicamente sobre o input.
- [x] 2026-06-05: `dialog/engine.js` zerou ANSI manual na superfície pública; fallback de espera ganhou ISO 8601 completo, labels humanos para timeout/estratégia, boot/policy/erro/orçamento BYOK passaram para headline/rows do tema, e o rodapé de uso não injeta mais cores hardcoded.
- [x] 2026-06-05: typecheck strict `src/copilot` voltou ao verde; corrigidos fallback de inventário SDK sem `sessionFs`, comandos de prova BYOK opcionais, explainers com chaves nulas, status `selected` do seletor runtime e papel visual `warn` em `/errors`.
- [x] 2026-06-05: aviso de fila do REPL e eventos de stop/recovery da conversa migraram para rows temáticas; removidos `[fila]`, `[conversa]` e ANSI manual das mensagens públicas de input concorrente/restart.
- [x] 2026-06-05: eventos de tarefa e shell migraram para rows temáticas; removidos símbolos/cores hardcoded de raciocínio capturado, thinking finalizado, prompt preservado e shell concluído/destacado.
- [x] 2026-06-05: eventos SDK de contexto, modo, plano, truncamento, snapshot, shutdown, handoff e workspace migraram para rows temáticas; testes de registry agora cobrem card humano de `request_user_input`, sincronização sem `[SYNC]` e completions pobres preservadas até resultado semântico.
- [x] 2026-06-05: comandos locais do REPL (`/restart`, `/dialog-pause`, `/dialog-resume`, `/abort`, `/emergency-reset`, `/handoff`) migraram para headlines/rows temáticas; removidos `[abort]`, `[emergency-reset]`, cabeçalho `Handoff History` e ANSI manual do router.
- [x] 2026-06-05: `dialog/output.js` removeu ANSI manual do prompt humano e da renderização de code blocks em respostas; os escapes restantes no arquivo são apenas estruturais para linha viva/cursor.
- [x] 2026-06-05: bootstrap/lifecycle do REPL removeram ANSI manual da continuação multiline e de erro de boot; erro público agora é row `Boot`, mantendo log técnico separado.
- [x] 2026-06-05: live `diagnostic-ux-cycle` em `artifacts/terminal-live/terminal-ux-themed-repl-20260605-1739` falhou apenas em `/tools` default; a linha `Detalhes` priorizava `/tools fs` antes do diagnóstico.
- [x] 2026-06-05: `/tools` default agora prioriza `/tools diag` como próximo comando primário; rerun live `diagnostic-ux-cycle` PASS em `artifacts/terminal-live/terminal-ux-themed-repl-rerun-20260605-1742` com 30/30 critérios.
- [ ] Próximo gap UX: completar traduções de `/byok gateway commands full` e dos filtros menos usados; decidir se todos os comandos canônicos devem ganhar `terminalSummary` próprio no domínio, em vez de mapa local no terminal.
- [ ] Próximo gap UX: auditar `byok.js` por rótulos ingleses sem ANSI (`high`, `agentic capability`, `remote=1`, `providerId`, aliases raros) e mover mais glossário para domínio canônico quando fizer sentido.
- [ ] Próximo passo: auditar `dialog/output.js` e eventos de sessão por mensagens manuais de espera/erro, especialmente prompt preservado, `sdk-session-events.js`, `agent-runtime-events.js` e `task-stream-events.js`.
