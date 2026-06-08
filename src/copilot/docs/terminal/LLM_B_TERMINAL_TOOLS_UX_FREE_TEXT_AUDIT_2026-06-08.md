# Auditoria UX/tools LLM-B: texto livre universal e perguntas humanas

Data local: 2026-06-08T00:00:00-03:00

Escopo: `src/copilot`, com prioridade em `src/copilot/terminal`, `src/copilot/agent`,
`src/copilot/sdk/session`, `src/copilot/tools` e acoplamentos diretos das tools usadas
pela LLM-B.

Este documento complementa e atualiza:

- `src/copilot/docs/terminal/LLM_B_TOOLS_DEEP_AUDIT_ROADMAP_2026-06-05.md`
- `src/copilot/docs/terminal/SRC_COPILOT_TERMINAL_MCP_AGENT_DEEP_AUDIT_ROADMAP_2026-06-05.md`
- `src/copilot/docs/terminal/TERMINAL_AUX_LIBS_UX_ARCHITECTURE_DECISION_2026-06-05.md`

## 01. Diagnostico visual e operacional

- [x] As screenshots anteriores mostravam ruído de superfície: nomes crus de tools,
  IDs técnicos, linhas desalinhadas, repetições de espera e perguntas humanas
  parecendo tools comuns.
- [x] A virada atual menciona duas screenshots novas, mas os anexos não ficaram
  disponíveis nesta sessão. A auditoria segue baseada no código, nos artefatos live
  já gravados e nas discrepâncias descritas pelo operador.
- [x] O comportamento desejado foi reafirmado: a linha viva deve ficar fora do input,
  sempre informando atividade real da LLM-B, e perguntas humanas devem ser claras,
  compactas e respondíveis por texto normal.
- [x] Novo requisito explícito: texto livre deve ser sempre permitido, mesmo quando
  houver alternativas/opções.

## 02. Fontes oficiais verificadas

- [x] OpenAI Apps SDK: `Build your MCP server` mostra tools com `inputSchema`,
  `outputSchema`, `annotations` e resultados estruturados.
- [x] OpenAI Apps SDK Reference: tool descriptors podem declarar `_meta` de status
  curto enquanto a tool roda e após concluir; resultados separam `structuredContent`,
  `content` e `_meta`.
- [x] MCP 2025-11-25 `server/tools`: tools têm nomes estáveis, schemas de input e
  output, annotations e resultados estruturados/unstructured.
- [x] MCP 2025-11-25 `client/elicitation`: elicitation é interface controlada pelo
  cliente; a especificação não impõe padrão visual único e explicita ações de resposta.

## 03. Decisão central: texto livre universal

- [x] O terminal deve tratar escolhas como sugestões e atalhos, nunca como uma
  validação excludente.
- [x] Índices `1`, `2`, `3` continuam mapeando para a opção correspondente.
- [x] Texto exatamente igual a uma opção continua sendo normalizado para essa opção.
- [x] Texto livre diferente das opções deve ser aceito e roteado para a pergunta
  pendente.
- [x] `requires_selection` passa a ser compatibilidade legada de entrada, sem força
  efetiva de bloqueio no Terminal LLM-B.
- [x] `allowFreeform=false` vindo do SDK, de fixtures ou de chamadas antigas deve ser
  normalizado para `allowFreeform=true` nas superfícies do terminal/agente.
- [x] A UX deve evitar rótulos como "seleção obrigatória" e "resposta inválida" para
  alternativas não escolhidas.

## 04. Situação atual confirmada no código

- [x] `request_user_input` em `tools/hook/hook-tools.js` ainda possui descrição
  pública dizendo que `requires_selection=true` obriga escolha sem texto livre.
- [x] O handler de `request_user_input` calcula `allowFreeform = !requires_selection`.
- [x] `agent/dialog/wiring/user-input-handler.js` rejeita texto livre quando
  `allowFreeform=false`.
- [x] `terminal/state/pending-question-answer.js` rejeita `/answer` ou texto comum
  quando `allowFreeform=false`.
- [x] `terminal/events/human-question-renderer.js` mostra "Escolha uma opção" quando
  `allowFreeform=false`.
- [x] `/sdk waits` e `/sdk simulate pergunta --required` ainda comunicam "seleção
  obrigatória".
- [x] Testes unitários existentes comprovam o comportamento antigo de rejeição; eles
  devem ser atualizados para provar a política nova.

## 05. Situação ideal

- [x] Pergunta humana aparece como card único e sem nomes de tool.
- [x] Opções aparecem como "Sugestões" ou "Opções" numeradas.
- [x] A linha de ação deve dizer: `Digite o número, o texto da opção ou qualquer texto livre`.
- [x] `/answer <texto>` deve aceitar qualquer texto não vazio para perguntas humanas.
- [x] Texto livre digitado sem `/answer` deve destravar `request_user_input` pendente.
- [x] O retorno ao SDK deve preservar `wasFreeform=false` quando o operador escolhe
  opção por número ou texto exato, e `wasFreeform=true` quando escrever algo próprio.
- [x] Logs/eventos podem registrar que uma chamada pediu seleção obrigatória, mas a
  política efetiva do terminal deve ser `freeform_always`.
- [x] Consumers de diagnóstico devem mostrar "texto livre permitido" em vez de
  "seleção obrigatória".

## 06. Roadmap desta rodada

### Faixa FT-A - Politica de input humano

- [x] FT-A1. Auditar todos os pontos que leem `allowFreeform` e `requires_selection`.
- [x] FT-A2. Criar constante/helper canônico para política `freeform_always`.
- [x] FT-A3. Normalizar `request_user_input` para sempre registrar `allowFreeform=true`.
- [x] FT-A4. Normalizar `ask_user` para persistir e emitir `allowFreeform=true`.
- [x] FT-A5. Manter compatibilidade com escolhas numeradas e match exato.
- [x] FT-A6. Remover rejeição `invalid_choice`/`choice_required` da rota normal.

### Faixa FT-B - UX e linguagem pública

- [x] FT-B1. Trocar "Escolha uma opção" por ação com texto livre universal.
- [x] FT-B2. Trocar "seleção obrigatória" por "texto livre permitido".
- [x] FT-B3. Atualizar `/sdk simulate` para aceitar `--required` como alias legado
  sem bloquear texto livre.
- [x] FT-B4. Atualizar `/answer` e REPL para não mostrar erro de escolha inválida.
- [x] FT-B5. Preservar ISO 8601 completo e cards humanos sem IDs crus.

### Faixa FT-C - Testes unitários

- [x] FT-C1. Atualizar testes de `request_user_input` para `requires_selection`
  legado com freeform efetivo.
- [x] FT-C2. Atualizar testes de `agent/dialog/user-input-handler` para aceitar
  texto livre mesmo quando input antigo envia `allowFreeform=false`.
- [x] FT-C3. Atualizar testes de `pending-question-answer` para roteamento de texto
  livre com choices.
- [x] FT-C4. Atualizar testes do renderer de pergunta humana.
- [x] FT-C5. Atualizar testes de `/sdk waits` e `/sdk simulate`.

### Faixa FT-D - Lives e regressao visual

- [x] FT-D1. Rodar live/probe com pergunta estruturada simulada e resposta textual
  fora das opções.
- [ ] FT-D2. Rodar live/probe com `ask_user` com choices e resposta textual fora
  das opções.
- [x] FT-D3. Confirmar que a linha viva não pulsa `request_user_input`, IDs ou
  nomes crus.
- [x] FT-D4. Salvar artefatos e comparar plain log com critérios da UX.

### Faixa FT-E - Tools LLM-B e padrões MCP/OpenAI

- [ ] FT-E1. Reauditar `read_file_content` e `patch_file` contra metadata,
  schemas e resultados estruturados já planejados.
- [ ] FT-E2. Garantir que tools mais usadas tenham `terminalSummary`,
  `llmNextAction` e presentation hints.
- [ ] FT-E3. Confirmar que lifecycle de tool mostra solicitação, início, progresso,
  resultado e falha sem heurística frágil quando metadata existir.
- [ ] FT-E4. Comparar affordances locais com MCP annotations e Apps SDK status
  text, sem transformar LLM-B tools em MCP tools.

## 07. Criterios de aceite

- [ ] Nenhuma rota normal de pergunta humana rejeita texto livre por não estar nas
  opções.
- [ ] Choices continuam úteis como atalhos, sugestões e normalização.
- [ ] Superfície pública não mostra `selection required`, `seleção obrigatória`,
  `choice_required`, `invalid_choice`, `request_user_input` ou IDs crus em cards
  default.
- [ ] Testes unitários focados provam a política nova.
- [ ] Live/probe confirma o comportamento como o operador vê.

## 08. Registro de execução

- [x] 2026-06-08: retomada a partir do objetivo persistente; workspace limpo para
  escopo salvo `.codex/config.toml` local não relacionado.
- [x] 2026-06-08: identificados pontos de enforcement antigo:
  `hook-tools.js`, `user-input-handler.js`, `pending-question-answer.js`,
  `human-question-renderer.js`, `commands/sdk.js`, `commands/session.js` e
  `repl-lifecycle.js`.
- [x] 2026-06-08: consultadas fontes oficiais OpenAI Apps SDK e MCP 2025-11-25
  para alinhar tools/resultados/elicitation sem criar contrato paralelo.
- [x] 2026-06-08: criada política `USER_INPUT_FREEFORM_POLICY` em
  `src/copilot/sdk/session/user-input-policy.js`; `request_user_input`, `ask_user`,
  `/answer`, traces e cards passaram a tratar choices como sugestões e texto livre
  como permitido sempre.
- [x] 2026-06-08: testes focados de input humano passaram em 8 arquivos e 130 testes.
- [x] 2026-06-08: harness live `invalid-choice` reaproveitado como compatibilidade
  de texto livre com options; ciclo estruturado `/sdk simulate` agora responde fora
  das opções.
- [x] 2026-06-08: live PTY `--structured-input-cycle` PASS em
  `artifacts/terminal-live/free-text-structured-input-rerun-20260608-0348/summary.md`;
  critérios confirmaram card humano com `qualquer texto livre`, ausência de IDs
  crus e resposta `TALVEZ LIVRE - fora das opções` roteada com sucesso.
