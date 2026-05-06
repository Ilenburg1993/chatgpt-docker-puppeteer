# Validação live — terminal LLM-B, comunicação e dialog loop

Data: 2026-05-06 Escopo: `npm run terminal:llm-b`, REPL humano, inject server, status/config HTTP e
comandos de interrupções SDK.

## 1) Objetivo

Validar se a borda viva entre operador humano, Codex e LLM-B se mantém estável para sessões longas,
streaming/realtime e loops contínuos, mesmo quando o provider impõe falhas externas.

## 2) Execução

Comando executado:

```bash
npm run terminal:llm-b
```

Comandos REPL executados:

- `/status`
- `/sdk waits`
- `/permission pending`
- `/exit`

Checks HTTP executados enquanto o terminal estava vivo:

- `GET http://127.0.0.1:3009/health`
- `GET http://127.0.0.1:3009/config`

## 3) Resultado factual

- Boot completo do terminal em modo standalone.
- Inject server disponível em `http://127.0.0.1:3009`.
- `GET /health` retornou `ok=true`, `healthStatus=healthy`, boot `13/13` fases e runtime default
  presente.
- `GET /config` retornou `ok=true`, runtime default, system prompt binding e freshness `ok`.
- REPL aceitou comandos locais após falha do dialog loop.
- `/status` expôs `NOLOOP`, runtime session, hub session, prompt freshness, mismatch de modelo
  cobrado e ação recomendada.
- `/sdk waits` mostrou zero pendências de `elicitation`, `permission` e `ask_user`.
- `/permission pending` reportou indisponibilidade da listagem ativa no SDK atual e fallback local
  explícito.
- `/exit` encerrou o processo; após o encerramento, `GET /health` falhou por conexão recusada, como
  esperado.

## 4) Limitação externa observada

O primeiro turno conversacional da LLM-B não pôde ser validado porque o Copilot SDK retornou
`rate_limit`, com reset indicado em 18 minutos.

Impacto:

- streaming real de resposta LLM não foi exercitado nesta rodada;
- comunicação local/HTTP/REPL permaneceu íntegra;
- o terminal preservou operação em `NOLOOP` e não entrou em restart loop.

Atualização 2026-05-06:

- esse erro foi classificado como limite de sessão, não como limite semanal/modelo;
- o terminal/recovery policy agora deixa explícito que `/model auto` não contorna limite de sessão
  ativo;
- fallback automático de modelo não é mais agendado quando a mensagem do SDK indica aguardar reset;
- `/model auto` segue recomendado apenas quando a mensagem indicar limite semanal/modelo, alinhado à
  política oficial do Copilot.

## 5) Correções aplicadas a partir da auditoria live

- `/permission pending` passou a hidratar o estado local do terminal com requests vindos do RPC
  ativo, evitando o gap em que o operador via uma permissão RPC-only mas não conseguia responder com
  `/permission respond <id>`.
- Strings corrompidas por encoding em `/permission pending` foram corrigidas.
- JSDoc/provider residuais em `agent/*` foram alinhados para `sdk/session/elicitation.js`, evitando
  sinal falso de ownership em `hooks/elicitation`.

## 6) Critério atual

Concluído nesta rodada:

- terminal boot/shutdown;
- REPL local;
- HTTP health/config;
- observabilidade de `NOLOOP`;
- fallback explícito de permissions pending;
- resposta por `/permission respond` para requests hidratados via RPC, coberta por teste unitário.

Pendente por bloqueio externo:

- repetir um turno curto após reset do rate limit para validar streaming conversacional completo;
- repetir com uma permissão real do SDK, quando o namespace expuser pending requests ativos.

## 7) Gates finais do turno

- `npm run typecheck:strict:src.copilot`: verde.
- `npm run lint`: verde.
- `npm run check:copilot:guardrails`: verde.
- `npm run test:copilot:unit`: verde (`146` arquivos, `2.426` testes).

## 8) Reteste live 2026-05-06 — Auto model funcional

Comando executado:

```bash
npm run terminal:llm-b
```

Comandos/ações validados:

- `/status`
- `/sdk quota`
- turno curto: `Responda exatamente: OK-LIVE`
- `GET http://127.0.0.1:3009/health`
- `GET http://127.0.0.1:3009/config`
- `/exit`

Resultado factual:

- boot completo em standalone;
- `GET /health` retornou `ok=true`, `healthStatus=healthy`, boot `13/13`;
- `GET /config` retornou `ok=true`, runtime default, `model="auto"` e prompt freshness `ok`;
- `model="auto"` foi preservado como configuração e o SDK roteou para `claude-haiku-4.5`;
- `/sdk quota` respondeu snapshots de `chat`, `completions` e `premium_interactions`;
- houve warning de quota semanal baixa (`weekly remaining=0.0%`, reset em `2026-05-11`), mas o turno
  curto funcionou via seleção Auto;
- resposta live recebida em cerca de `2.3s`, confirmando canal conversacional, rendering e retorno
  ao prompt;
- o processo foi encerrado via `/exit`.

Sinal importante:

- o comportamento observado confirma a hipótese operacional: `Auto` pode manter um caminho permitido
  quando a escolha manual/modelo premium está limitada, mas isso é diferente de limite de sessão com
  mensagem de aguardar reset.

## 9) Reteste live 2026-05-06 — policy Auto e metadata observada

Comandos/ações validados:

- `/model`
- `/model list`
- `/model gpt-5.4`
- `/model auto`
- turno curto: `Responda exatamente: OK-AUTO-POLICY`
- turno curto pós-correção: `Responda exatamente: OK-USAGE-NORMALIZED`
- `/status`
- `GET http://127.0.0.1:3009/health`
- `GET http://127.0.0.1:3009/config`
- `/exit`

Resultado factual:

- `/model` em `auto` passou a exibir policy Auto: autoridade GitHub Copilot, preferência local
  `gpt-5.4/high`, último modelo observado e status de satisfação da preferência;
- `/model list` retornou `auto`, modelos Claude disponíveis e modelos GPT incluindo `gpt-5.4`;
- `/model gpt-5.4` configurou preferência local, mas o SDK live não confirmou convergência da sessão
  para o modelo concreto; a sessão permaneceu observada como `auto`;
- `/model auto` restaurou explicitamente roteamento nativo do Copilot e informou que `gpt-5.4/high`
  é preferência observável, não parâmetro oficial forçado;
- o turno `OK-AUTO-POLICY` completou com roteamento real para `claude-haiku-4.5`;
- após correção de `usage`, o turno `OK-USAGE-NORMALIZED` preservou no `/status` o modelo concreto
  cobrado/observado;
- `/status` passou a mostrar metadata do modelo observado (`cost=medium`, `speed=fast`,
  `ctx=200.000`) mesmo com `model=auto`;
- `GET /health` permaneceu saudável e `GET /config` continuou projetando runtime default com
  `model=auto`.

Conclusão:

- a borda live Codex ↔ terminal ↔ LLM-B ↔ usuário está estável para comandos locais, HTTP e turnos
  curtos sob `Auto`;
- a seleção `Auto` é utilizável e auditável;
- não há evidência de preferência vinculante `Auto + gpt-5.4/high` no SDK atual; a implementação
  correta é observabilidade, não promessa de roteamento.

## 10) Reteste live 2026-05-06 — read/write/search/scan e comunicação Codex ↔ LLM-B ↔ usuário

Comando executado:

```bash
npm run terminal:llm-b
```

Comandos/ações validados:

- `/status`
- `/workspace list tmp`
- `/workspace write tmp/copilot-live-io-test.md LIVE_IO_OK terminal llm-b canonical io scan search`
- `/workspace read tmp/copilot-live-io-test.md`
- turno natural pedindo list/read/search do token `LIVE_IO_OK`;
- turno natural explícito com `bash`: criar `tmp/copilot-live-io-real.md`, listar e buscar
  `LIVE_IO_OK_REAL`;
- `/tools`
- `/activity 8`
- `/sdk quota`
- `/model list`

Resultado factual:

- boot completo em standalone e dialog loop ativo;
- `/status` reportou `health=healthy`, `ask_user=ready`, `permission mode=approve_all`, runtime
  default e branch `main`;
- `model=auto` permaneceu ativo, com roteamento efetivo observado para `claude-haiku-4.5`;
- `/status` mostrou policy Auto com preferência local `gpt-5.4/high`, mas billing/model real
  `claude-haiku-4.5`;
- o event collector seguiu emitindo `weekly remaining=0.0%`, reset em `2026-05-11T00:00:00.000Z`;
- `/sdk quota` retornou snapshot de `chat`, `completions` e `premium_interactions`, mostrando que a
  leitura de quota do SDK e o warning semanal ainda têm escalas/unidades diferentes;
- `/model list` retornou `auto`, modelos Claude e modelos GPT incluindo `gpt-5.4`;
- `/workspace write/read/list` funcionou, mas no workspace virtual SDK, não no FS local;
- quando a LLM-B usou tools locais (`bash`, `view`, `grep`) para ler/buscar o arquivo criado por
  `/workspace write`, o arquivo não existia no FS real;
- um segundo turno com `bash` explícito criou `tmp/copilot-live-io-real.md` no FS local, listou e
  encontrou `LIVE_IO_OK_REAL` via `grep` com sucesso;
- streaming/tool events apareceram em tempo real (`bash`, `view`, `grep`);
- `/activity 8` mostrou o último turno concluído com `bash · run · completed`;
- `/tools` reportou “Nenhuma tool registrada ainda”, apesar de `/activity` mostrar tool events.

Correção aplicada neste corte:

- a UI de `/workspace` passou a explicitar “Workspace SDK virtual” e “não FS local”, incluindo read,
  write e usage text;
- teste unitário de `/workspace` agora trava essa semântica para evitar regressão de UX.

Gaps abertos para o próximo corte:

1. Unificar ou expor claramente duas superfícies: workspace virtual SDK versus FS local canônico.
2. Fazer o roteamento natural preferir tools semânticas (`list_directory`, `read_file_content`,
   `search_in_files`) quando o usuário pedir read/write/search/scan, em vez de cair em `bash/grep`
   sem explicação.
3. Corrigir `/tools` para refletir tool events observados por `/activity`, ou renomear o comando
   para deixar claro que ele mostra apenas registry persistido.
4. Normalizar a apresentação de quota: warning semanal em porcentagem versus `/sdk quota` em
   unidades brutas ainda induz leitura ambígua.

Conclusão:

- comunicação live Codex ↔ terminal ↔ LLM-B ↔ usuário está funcional e com streaming de tool events;
- write/list/search reais funcionam quando a LLM-B usa tool local `bash`;
- `/workspace` não deve ser usado como prova de materialização no FS local enquanto permanecer SDK
  virtual;
- o próximo melhor ponto de ataque é consolidar a semântica de workspace/FS local para eliminar esse
  caminho paralelo percebido.
