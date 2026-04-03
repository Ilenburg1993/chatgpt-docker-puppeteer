# custom-agents.js — Auditoria

**Módulo**: `src/copilot/config/` **Arquivo**: `custom-agents.js` **LOC**: 325 | **Score**: 9.0/10

## Responsabilidade

Define dois tipos de agentes:

1. **BUILTIN_AGENTS** (Map): 3 agentes REPL/terminal — `auditor`, `docs`, `reviewer`
2. **SDK_AGENTS** (array): 6 sub-agentes SDK — `task`, `explore`, `diagnostic`, `planner`,
   `git-ops`, `shell-ops`

## ACHADO C12-07 — P5

**`DISABLED_AGENTS` Set module-level não resetado entre testes**

```js
const DISABLED_AGENTS = new Set(
  (process.env['COPILOT_DISABLED_AGENTS'] ?? '').split(',').filter(Boolean),
);
```

Estado module-level avaliado uma vez no import. Testes que alteram
`process.env['COPILOT_DISABLED_AGENTS']` após o import não refletem no Set. Testes que dependem do
estado inicial podem interferir uns nos outros.

## Destaques Positivos

- Separação clara entre agentes internos (BUILTIN_AGENTS) e agentes SDK (SDK_AGENTS)
- `registerCustomAgent` valida todos os campos obrigatórios com erros descritivos
- `getCustomAgent` aceita `@nome` com normalização do at-sign
- GAP-Q03 fix: `COPILOT_DISABLED_AGENTS` permite desabilitar sub-agentes sem alterar
  `COPILOT_CUSTOM_AGENTS`
- SDK agents têm prompts especializados e tool sets restritos (least-privilege por agente)
- `git-ops` inclui `report_intent` em tool list — auditoria antes de commits
- `planner` inclui `session_plan_read/update` para controle de estado de plano

---

_Gerado automaticamente pelo COPILOT-FULL-AUDIT MF-II._
