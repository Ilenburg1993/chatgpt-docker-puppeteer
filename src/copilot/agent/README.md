# agent/

**Camada**: L4 — runtime contínuo do agente (`AlwaysAliveAgent`).

O `agent/` é o núcleo operacional que mantém sessão, loop, reconnect, health e wiring de eventos do SDK.

## Estrutura por domínio

| Área         | Função                                                                |
| ------------ | --------------------------------------------------------------------- |
| `lifecycle/` | boot, reconnect, shutdown, setup de sessão, persistência auxiliar     |
| `dialog/`    | dialog loop, turn executor, input/output de `ask_user`, waiting state |
| `session/`   | wiring, snapshots, boot steps, rotação, recovery                      |
| `messaging/` | envio de prompts e coordenação de turnos                              |
| `state/`     | snapshots, status e projeções do runtime                              |
| `facades/`   | API pública e acesso canônico ao SDK                                  |
| `infra/`     | executores, filas, webhooks e integrações auxiliares                  |

## Arquivos raiz

| Arquivo            | Função                                                     |
| ------------------ | ---------------------------------------------------------- |
| `always-alive.js`  | fachada pública fina do runtime do agente                  |
| `agent-context.js` | composição do estado interno + mutation/read API semântica |
| `runtime-registry.js` | registry explícita dos runtimes de agent conhecidos     |
| `types.js`         | typedefs do módulo                                         |
| `index.js`         | barrel                                                     |

## Diretriz arquitetural atual

O objetivo **não** é mais “explodir um monólito”.

O objetivo agora é:

- endurecer contratos;
- centralizar policy de erro;
- manter o SDK como base canônica das features análogas;
- reduzir mutação crua do contexto;
- deixar `AlwaysAliveAgent` como fachada previsível.

## Runtime default vs runtimes registrados

O `agent/` agora opera com duas noções compatíveis:

- `getAgent()` continua sendo o accessor lazy do runtime default para compatibilidade;
- `runtime-registry.js` passa a registrar explicitamente o runtime default e futuros runtimes nomeados.

Em outras palavras:

- `AlwaysAliveAgent` continua sendo a fachada principal;
- a `AgentRuntimeRegistry` prepara o caminho para multi-agent futuro sem quebrar o singleton atual.

## Relação com `presentation/`

`agent/` continua sendo o dono do runtime.

Mas as bordas compartilhadas (`server/`, partes compartilhadas do `terminal/`) não devem decidir sozinhas como obter esse
runtime. Essa função agora começa a ser centralizada em `presentation/agent-runtime.js`.

## Relação com o SDK

Sempre que a capacidade nasce no SDK vanilla, o `agent/` deve consumi-la por `sdk/` ou `facades/agent-sdk-access.js`.

Exemplos já consolidados:

- mode/plan da sessão
- foreground/last session
- server/session RPC handles
- hooks tipados
- `onUserInputRequest` / `allowFreeform`
- eventos vanilla como `session.plan_changed`, `assistant.streaming_delta`, `tool.execution_progress`, `session.workspace_file_changed`

## Regras de importação

- **Pode importar**: `core/`, `config/`, `observability/`, `sdk/`, `hooks/`, `bridges/`, `tools/`
- **Não deve importar**: `terminal/`, `server/`, `presentation/` como fonte de verdade operacional

## Nota de clareza

Se a dúvida for “onde uma feature do SDK deve entrar?”:

1. primeiro em `sdk/`;
2. depois em `agent/facades/` se virar capability pública do runtime;
3. só então em `terminal/` ou `server/` como consumidor.
