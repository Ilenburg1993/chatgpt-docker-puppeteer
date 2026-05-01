# terminal/frontend/

Consumer layer canônica do terminal.

## Pergunta que esta pasta responde

> Como o terminal lê e executa operações do runtime **sem** conhecer a topologia interna do agent,
> SDK, hub ou transportes?

## Arquivos

| Arquivo                     | Função                                                                                   |
| --------------------------- | ---------------------------------------------------------------------------------------- |
| `llm-b-runtime.js`          | gateway de runtime: agent, hub, snapshots, binding de sessão, operações do dialog loop   |
| `llm-b-frontend.js`         | compat shim temporário com projections legadas e operações ainda não fatiadas            |
| `projections/`              | famílias de projections fatiadas (`status`, `config`, `metrics`, `usage`, `sdk-session`) |
| `sdk-session-projection.js` | consumo vanilla de `mode/plan` da sessão SDK para comandos e UX do terminal              |
| `index.js`                  | barrel público do submódulo                                                              |

## Regra de uso

- `commands/`, `repl.js` e `dialog/` devem preferir esta pasta quando precisarem **consumir**
  runtime.
- Esta pasta pode ampliar a ergonomia do runtime, mas sempre usando `agent/` + `sdk/` como base
  canônica.
- Não deve recriar semântica do SDK (ex.: mode/plan, streaming, usage).
- `sdk-session-projection.js` é a fonte preferida quando o problema for especificamente `mode/plan`
  vanilla.
- Para novas leituras de UX, prefira `projections/*.js`; `llm-b-frontend.js` permanece apenas como
  compatibilidade transitória até a migração completa.

## Heurística prática

- Se o problema é **“preciso de uma projeção pronta para a UX”**, provavelmente entra aqui.
- Se o problema é **“preciso renderizar/mostrar/enviar algo no REPL”**, provavelmente entra em
  `terminal/dialog/`.
