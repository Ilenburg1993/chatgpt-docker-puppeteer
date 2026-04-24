# Boot Copilot

`src/copilot/boot/` é a raiz canônica do processo de boot.

Regras:

- `terminal/bootstrap.js` é o único entrypoint executável canônico.
- `agent.js` é compat operacional e apenas delega para `bootCopilot()`.
- `boot/config.js` concentra workspace, host, porta, token, SDK CLI URL, diretórios de skills e
  diretórios pinados.
- `boot/workspace.js` resolve `COPILOT_WORKING_DIRECTORY` e paths persistentes do workspace.
- `boot/skills.js` resolve `COPILOT_SKILL_DIRECTORIES`, `COPILOT_PINNED_CONTEXT_DIRS` e
  `COPILOT_DISABLED_SKILLS`.
- `boot/plan.js` descreve as fases e donos do boot.

Fronteiras:

- `boot/` não inicia servidor, terminal nem agent.
- `server/` só hospeda HTTP/Socket.IO.
- `terminal/` só hospeda UX e compõe o server recebido por injeção.
- `agent/` só governa sessões e runtime SDK depois que o boot já definiu o ambiente.

Taxonomia curta:

- `boot` decide ambiente, workspace, skills, host/porta/token e plano de subida;
- `server` é host HTTP;
- `terminal` é host de UX local;
- `agent` é host de runtime contínuo;
- contratos internos de `agent/` que usam a palavra `host` referem-se a adapters estreitos de
  capability, não a esses hosts operacionais.
