# terminal/

**Camada**: L6 — frontend operacional da LLM-B.

O terminal é a borda humana do runtime contínuo:

- REPL interativo;
- banners e comandos operacionais;
- SSE/UI local;
- injeção HTTP para integração com LLM-A e outros clientes.

## Papel arquitetural atual

O terminal **não** implementa versões paralelas do SDK.

Ele consome:

- `agent/` para lifecycle e estado do agente;
- `presentation/agent-runtime.js` como accessor compartilhado do runtime default;
- `sdk/` como fonte canônica de contratos vanilla;
- `frontend/` como camada de projeção/consumo do runtime;
- `dialog/` como camada de render/prompt/espera/envio.

## Estrutura recomendada

| Área                        | Função                                                                     |
| --------------------------- | -------------------------------------------------------------------------- |
| `frontend/`                 | consumer layer canônica do runtime para o terminal                         |
| `dialog/`                   | prompt dinâmico, output helpers, waiting UX, engine de diálogo             |
| `commands/`                 | comandos REPL finos, orientados a operações do runtime                     |
| `state.js`                  | estado exclusivamente do terminal (flags, emitter, projeções observadas)   |
| `repl-listeners.js`         | tradução de eventos do agente/SDK para UX local                            |
| `sdk-session-events.js`     | tradução dedicada dos sinais vanilla da sessão SDK para stdout/SSE         |
| `agent-runtime-events.js`   | tradução dedicada dos sinais normalizados do runtime/agent para stdout/SSE |
| `task-stream-events.js`     | render e SSE do streaming de tarefas internas (`task.*`)                   |
| `agent-sse-fallback.js`     | fallback SSE para eventos do agent ainda não tratados manualmente          |
| `terminal-agent-wiring.js`  | SSE + wiring de alto nível entre terminal e agent                          |
| `index.js` / `bootstrap.js` | boot do terminal                                                           |

## Regra de ouro

Se algo já existe no SDK vanilla — por exemplo:

- mode/plan
- streaming
- usage
- workspace file change
- truncation / snapshot rewind / handoff

o terminal deve **observar e ampliar** esse comportamento, não recriá-lo localmente.

## Acesso ao runtime

O terminal ainda tem módulos que operam diretamente sobre a façade pública do agent, mas a direção arquitetural
canônica agora é:

```text
agent/
	-> presentation/agent-runtime.js
		-> terminal/frontend/
			-> terminal/dialog/ e comandos
```

Ou seja: sempre que o acesso ao runtime puder ser compartilhado com outras bordas, ele deve preferir passar por
`presentation/agent-runtime.js`.

## Estado atual relevante

- `/plan` usa somente `mode.get/set` e `plan.read/update/delete` do SDK;
- o prompt dinâmico mostra `MODE:<SDK>` quando a sessão está fora de `interactive`;
- `state.js` não guarda mais um “plan mode local” paralelo — apenas a última projeção observada do SDK;
- `sdk-session-events.js` reflete sinais vanilla da sessão SDK ao operador;
- `agent-runtime-events.js` reflete sinais já normalizados pelo runtime/agent ao operador;
- `task-stream-events.js` concentra a narrativa do streaming de tarefas internas do runtime;
- `agent-sse-fallback.js` explicita o fallback de broadcast SSE para eventos do agent ainda não tratados;
- `repl-listeners.js` agora orquestra essas duas fronteiras em vez de acumular toda a semântica sozinho.

## Regras de importação

- **Pode importar**: qualquer camada abaixo, porque é uma borda
- **Não deve ser importado por**: `sdk/`, `core/`, `config/`, `agent/`

## Nota de clareza arquitetural

Se houver dúvida entre `frontend/` e `dialog/`:

- **`frontend/` responde “de onde vem a verdade consumida pelo terminal?”**
- **`dialog/` responde “como essa verdade vira prompt, espera, render e envio?”**
