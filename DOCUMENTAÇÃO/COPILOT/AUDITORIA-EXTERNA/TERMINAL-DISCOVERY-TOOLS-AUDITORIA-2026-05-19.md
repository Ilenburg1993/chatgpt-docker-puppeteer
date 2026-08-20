# Terminal LLM-B: Config Discovery e UX de Tools — 2026-05-19

## Situação Atual Investigada

- O SDK documenta `enableConfigDiscovery` como descoberta automática de MCP configs (`.mcp.json`,
  `.vscode/mcp.json`) e `skillDirectories` a partir do `workingDirectory`, com merge sobre
  `mcpServers` e `skillDirectories` explícitos.
- O mesmo SDK documenta que nomes de tools precisam ser únicos em todas as extensões carregadas;
  colisões fazem a extensão/sessão falhar.
- O workspace contém `.vscode/mcp.json` apontando para `http://localhost:3008/api/mcp` e
  `.kilocode/mcp.json`.
- Em live via `npm run terminal:llm-b`, `enableConfigDiscovery` já havia gerado
  `Tool names must be unique`, compatível com discovery implícito carregando MCP/extensões fora da
  nossa superfície governada.
- O fluxo de sessão tinha uma inconsistência: `initOrResumeSession` respeitava
  `bootConfig.sessionDefaults.enableConfigDiscovery`, mas `buildSessionOptions` não projetava
  explicitamente esse flag no builder.
- A UX de tools voltou a aparecer, mas o live mostrou gaps:
  - warnings ruidosos de `excludedTools` para nomes legados não existentes no SDK moderno (`create`,
    `edit`, `grep`);
  - `read_file_content` podia narrar início duplicado quando eventos externos/nativos chegavam no
    mesmo tool call lógico;
  - `tool.execution_complete` do SDK nem sempre traz nome/alvo suficiente, fazendo o terminal cair
    para `callId` em vez de arquivo;
  - o fallback semântico de reply do dialog loop logava como `WARN` e podia vazar dentro do
    transcript.

## Situação Ideal

- Discovery automático deve ser opt-in e recuperável: se uma sessão falhar por colisão de tools
  causada por discovery, o runtime deve preservar `mcpServers`, `skillDirectories`, tools locais e
  sessão persistente, mas retryar com discovery implícito desligado.
- A configuração de sessão deve ser única e explícita: todo caminho de
  `createSession`/`resumeSession` deve projetar `enableConfigDiscovery` e
  `includeSubAgentStreamingEvents` a partir do boot canônico.
- O terminal deve narrar tools por ação lógica, não por ruído de evento. Eventos `external_tool.*`,
  `tool.execution_*`, hooks e IO precisam convergir em um registry session-scoped.
- Completion de tool deve preservar o alvo conhecido no start sempre que o SDK omitir `toolName`,
  trocar `toolCallId` ou enviar payload parcial.
- Denylists devem evitar warnings inúteis. Nomes historicamente conhecidos, mas ausentes no SDK
  atual, ficam documentados como compatibilidade e não são enviados por padrão.
- Logs internos de heurística normal não devem poluir transcript humano; fallback esperado é
  `DEBUG`, não `WARN`.

## Mudanças Aplicadas Nesta Rodada

- `buildSessionOptions` agora injeta explicitamente:
  - `enableConfigDiscovery(bootConfig.sessionDefaults.enableConfigDiscovery)`;
  - `includeSubAgentStreamingEvents(bootConfig.sessionDefaults.includeSubAgentStreamingEvents)`.
- `initOrResumeSession` ganhou guard de recuperação:
  - tenta criar/retomar com discovery quando configurado;
  - se a falha indicar colisão de nomes de tools, retrya uma vez com `enableConfigDiscovery=false`;
  - mantém superfície explícita de sessão.
- `ToolCallRegistry` ganhou resolução por nome e por única tool ativa, cobrindo completions pobres
  do SDK.
- `tool-lifecycle-runtime` passou a:
  - resolver nome real de external tool a partir de payloads aninhados;
  - registrar starts nativos silenciosamente quando já existe narração em voo;
  - preservar apresentação/alvo no completion mesmo com `toolCallId` divergente.
- `LEGACY_SDK_LOCAL_FS_TOOL_NAMES` foi reduzido para `view` e `glob`; `grep`, `create`, `edit`
  ficaram em `COMPAT_SDK_LOCAL_FS_TOOL_NAMES`, sem envio default para `excludedTools`.
- `turn-output-collector` rebaixou o log de fallback semântico de `WARN` para `DEBUG`.

## Validação

- `npx vitest run` nos contratos próximos passou com 71 testes:
  - registry de tool calls;
  - runtime de events do terminal;
  - sdk-session-events;
  - roteamento SDK/FS;
  - setup de sessão;
  - initializer/sessionFs.
- Live canônico via `npm run terminal:llm-b` confirmou:
  - warnings `Unknown tool name` para `create`, `edit`, `grep` não aparecem mais;
  - `read_file_content` mostra um único start;
  - completion final preserva `arquivo: package.json`;
  - não há heartbeat órfão de `read_file_content` após o turno;
  - resposta da LLM-B permanece visível no transcript.

## Próximos Pontos

- Rodar novo live com tool call para confirmar ausência de duplicate start, ausência dos warnings
  `create/edit/grep` e completion com alvo.
- Expandir `/sdk status` ou `/sdk doctor` para listar discovery files detectados e explicar por que
  discovery implícito está off por padrão.
- Avaliar se `session.tools_updated` deve buscar detalhes reais por RPC/SDK quando o evento só traz
  `{ model }`, evitando a mensagem enganosa de `0 tools`.
