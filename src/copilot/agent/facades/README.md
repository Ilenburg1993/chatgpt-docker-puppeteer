# agent/facades/

Fachadas finas do `AlwaysAliveAgent`.

## Pergunta que esta pasta responde

> Quais capabilities públicas do runtime do agente precisamos expor sem obrigar cada caller a conhecer `AgentContext`, sessão SDK ou wiring interno?

## Arquivos

| Arquivo | Função |
| --- | --- |
| `agent-sdk-access.js` | handles crus do SDK + operações vanilla de alto valor (status, mode, plan, sessions, agents) |
| `agent-session-ops.js` | operações diretas de sessão (abort, log, watchdog, histórico) |
| `agent-model-config.js` | modelo, reasoning e listagem de modelos |
| `agent-webhook-ops.js` | operações de webhook/integração expostas pela fachada do agente |

## Regra de uso

- `always-alive.js` deve delegar aqui em vez de carregar lógica operacional densa.
- Toda capability análoga ao SDK deve nascer de `sdk/` e ser exposta aqui só quando fizer sentido como API pública do runtime.
- Esta pasta não é lugar para UI, REPL ou formatting.

## Heurística prática

- Se o caller diz “quero pedir algo ao agent”, provavelmente passa por uma facade.
- Se o código diz “quero abrir o `ctx` e sair mexendo”, provavelmente ainda falta uma facade ou helper semântico.
