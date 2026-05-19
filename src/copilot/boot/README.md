# Boot Copilot

`src/copilot/boot/` é a raiz canônica do processo de boot.

Regras:

- `terminal/bootstrap.js` é o único entrypoint executável canônico.
- `terminal/bootstrap.js` injeta o host terminal em `boot/runtime-bootstrap.js`.
- `boot/config.js` concentra workspace, host, porta, token, SDK CLI URL, diretórios de skills e
  diretórios pinados.
- `boot/config.js` também projeta os defaults efetivos de sessão (`sessionDefaults`) usados como
  baseline declarativa para discovery, skills e streaming de subagentes.
- `boot/workspace.js` resolve `COPILOT_WORKING_DIRECTORY` e paths persistentes do workspace.
- `boot/skills.js` resolve `COPILOT_SKILL_DIRECTORIES`, `COPILOT_PINNED_CONTEXT_DIRS` e
  `COPILOT_DISABLED_SKILLS`.
- `boot/plan.js` descreve as fases, donos e timeouts do boot.
- `boot/lifecycle-runner.js` executa o plano por handlers de fase, produz `BootLifecycleReport` e
  executa rollbacks best-effort quando uma fase falha.
- `boot/surface-validation.js` valida, antes de HTTP/REPL, se SDK, agent, terminal e handlers do
  plano foram carregados com as superfícies mínimas esperadas.
- `sdk/telemetry/preflight.js` é o owner do preflight SDK/CLI; `agent/lifecycle` não participa dessa checagem.

Semântica importante:

- `sdk.enabled` no boot config governa a superfície HTTP `/sdk/*`; ele **não** significa que o
  runtime deixou de depender do SDK, porque o boot canônico, o preflight e o `AlwaysAliveAgent`
  continuam sendo SDK-first.
- `terminal.enabled` é uma flag declarativa do perfil canônico do processo; o entrypoint
  operacional continua sendo `terminal/bootstrap.js`.

Fronteiras:

- `boot/` não importa `terminal/`; ele apenas orquestra fases via host surface injetado pela borda terminal.
- `server/` só hospeda HTTP/Socket.IO.
- `terminal/` só hospeda UX e compõe o server recebido por injeção.
- `agent/` só governa sessões e runtime SDK depois que o boot já definiu o ambiente.
- `config/` declara defaults e knobs; `boot/` transforma isso em perfil efetivo de processo;
  `agent/session` aplica o perfil em uma sessão concreta; `dialog/` governa o loop de input sobre
  a sessão viva.

Lifecycle:

- `boot/runtime-bootstrap.js` monta o plano com `createCopilotBootPlan()` e executa via `runCopilotBootPlan()`.
- as fases do terminal são executadas separadamente: `terminal-init`, `terminal-aliases`,
  `terminal-runtime-config`, `terminal-pinned-context`, `terminal-conversation-hub`,
  `copilot-http-server`, `terminal-runtime-listeners` e `repl`;
- `boot-surface-validation` roda depois de `runtime-wiring` e antes de qualquer exposição HTTP,
  convertendo exports/paths quebrados em falha explícita de boot;
- fases sem handler ficam como `skipped` no relatório; isso é intencional apenas para fases
  documentais ou compat que sejam deliberadamente delegadas a outro host;
- o último relatório fica disponível por `getLastBootLifecycleReport()` e é projetado por
  `presentation/runtime/lifecycle.js`;
- novas fases que alocarem recursos devem declarar `timeoutMs` e, quando possível, handler
  `rollback`.

Taxonomia curta:

- `boot` decide ambiente, workspace, skills, host/porta/token e plano de subida;
- `server` é host HTTP;
- `terminal` é host de UX local;
- `agent` é host de runtime contínuo;
- contratos internos de `agent/` que usam a palavra `host` referem-se a adapters estreitos de
  capability, não a esses hosts operacionais.
