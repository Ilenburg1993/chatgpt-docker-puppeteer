# Guia de decisão para libs auxiliares do Terminal LLM-B

Data: 2026-06-04

Escopo: `src/copilot/terminal`, UX do Terminal LLM-B, comandos canônicos, lives PTY, integração com BYOK/model-gateway e superfícies humanas de operação.

Documento relacionado:

- `src/copilot/docs/terminal/TERMINAL_LLM_B_REALTIME_UX_DEEP_AUDIT_ROADMAP_2026-06-02.md`
- `src/copilot/docs/terminal/TERMINAL_AUXILIARY_LIBS_INTEGRATION_AUDIT_2026-06-03.md`

## 1. Papel deste documento

Este documento substitui o uso informal da lista de ferramentas auxiliares como "coisas legais de terminal" por um contrato de arquitetura.

O terminal da LLM-B deve continuar sendo:

- previsível;
- legível;
- técnico sem ruído;
- bonito por design próprio, não por dependência acidental;
- funcional em devcontainer mínimo, CI, VS Code terminal, SSH e shell comum;
- seguro para readline, linha viva e pergunta humana pendente;
- capaz de explicar renderer, fallback, caminho e risco sem despejar JSON bruto na tela default.

As libs abaixo são enriquecimentos opcionais. Nenhuma é fundação obrigatória.

- `gum`
- `fzf`
- `bat` / `batcat`
- `glow`
- `delta`
- `atuin`
- `zoxide`
- `jq`
- `yq`

## 2. Situação atual verificada

- [x] Existe registry central em `src/copilot/terminal/capabilities/external-tools.js`.
- [x] O registry detecta disponibilidade por `PATH`, path, comando e versão.
- [x] O registry trata `batcat` como alternativa a `bat`.
- [x] `atuin` e `zoxide` são detectáveis, mas ficam `deferred` e `defaultEnabled=false`.
- [x] Todos os itens atuais estão `defaultEnabled=false`.
- [x] Existe `/terminal libs`, `/terminal libs detail`, `/terminal libs json`, `/terminal libs refresh` e `/libs`.
- [x] Existe preview read-only de arquivos com `bat`/`batcat` e fallback JS.
- [x] Existe preview Markdown explícito com `glow` e fallback JS.
- [x] Existe preview de diff explícito com `delta` e fallback JS.
- [x] Existe preview estruturado JSON/YAML com `jq`/`yq` e fallback JS/`js-yaml`.
- [x] Existe planner de picker para `fzf`/`gum`.
- [x] Existe executor opt-in de picker externo.
- [x] Existe gateway de TTY exclusivo em `dialog/output.js`.
- [x] O picker default continua textual e seguro.
- [x] A live filtrada já exercitou `fzf --filter`, seleção e restauração de prompt.
- [x] A live visual TUI completa ainda não foi validada de modo literal no mesmo terminal do operador humano.

## 3. Fontes oficiais reconsultadas em 2026-06-04

### 3.1 Gum

Fonte oficial:

- https://github.com/charmbracelet/gum

Achados:

- [x] `gum` é descrito como ferramenta para scripts shell com utilitários prontos.
- [x] A documentação lista comandos interativos como `choose`, `confirm`, `file`, `filter`, `input`, `write` e `pager`.
- [x] A documentação lista comandos de formatação como `format`, `join`, `style`, `table` e `log`.
- [x] `gum confirm` usa código de saída para afirmar ou negar.
- [x] `gum input`, `gum write`, `gum choose`, `gum filter`, `gum file` e `gum pager` tomam o TTY.

Decisão:

- [x] Aceitar `gum` apenas como UX opt-in e guardada.
- [x] Não usar `gum` para linha viva, prompt principal ou `ask_user` canônico.
- [x] Não chamar `gum` automaticamente durante streaming, tool call, deltas ou pergunta pendente.
- [x] Se usado, deve passar por `withTerminalExclusiveTty()`.
- [x] O fallback textual precisa ser tão funcional quanto o picker externo.

## 3.2 fzf

Fontes oficiais:

- https://junegunn.github.io/fzf/
- https://github.com/junegunn/fzf

Achados:

- [x] `fzf` é filtro fuzzy interativo de propósito geral.
- [x] A seleção via stdout se encaixa bem em adapters sem shell livre.
- [x] O preview do `fzf` usa comando shell configurável.
- [x] A documentação/manpage descreve placeholders no preview e variáveis como `FZF_PREVIEW_LINES`.
- [x] O preview embutido é poderoso, mas é exatamente a parte mais perigosa se receber path ou conteúdo sem tokenização.

Decisão:

- [x] Aceitar `fzf` para seleção explícita de menus, arquivos, sessões, resultados, comandos e modelos.
- [x] Continuar evitando `fzf --preview` até existir adapter próprio sem shell livre.
- [x] Usar `fzf --filter` em automação PTY quando a intenção é provar handoff/seleção sem emular TUI visual completa.
- [x] Validar visualmente a TUI completa em terminal real antes de promovê-la como recomendação default.

## 3.3 bat / batcat

Fonte oficial:

- https://github.com/sharkdp/bat

Achados:

- [x] `bat` fornece syntax highlighting, line numbers e integração Git.
- [x] A própria documentação recomenda `--paging=never` quando se quer comportamento semelhante a `cat`.
- [x] A documentação mostra uso típico com `fzf --preview`, incluindo `--color=always`, `--style=numbers` e `--line-range`.
- [x] Em alguns ambientes Debian/Ubuntu o binário pode se chamar `batcat`.

Decisão:

- [x] Aceitar como preview read-only.
- [x] Forçar `--paging=never`.
- [x] Detectar binário `bat` ou `batcat`.
- [x] Não previewar conteúdo binário, NUL, bytes inválidos ou excesso de caracteres de controle.
- [x] Manter fallback JS com truncamento e numeração.

## 3.4 Glow

Fonte oficial:

- https://github.com/charmbracelet/glow

Achados:

- [x] `glow` renderiza Markdown no terminal.
- [x] A documentação separa TUI local e uso CLI/stdin.
- [x] A documentação expõe largura com `-w` e pager com `-p`.
- [x] TUI/pager podem melhorar leitura longa, mas tomam o terminal.

Decisão:

- [x] Aceitar `glow` para preview Markdown explícito.
- [x] Preferir stdin/CLI não interativo.
- [x] Não renderizar deltas da LLM-B em tempo real com `glow`.
- [x] Não abrir pager automaticamente.
- [ ] Avaliar `/help full --glow` ou `/docs preview --glow` com ação explícita.

## 3.5 Delta

Fonte oficial:

- https://dandavison.github.io/delta/
- https://dandavison.github.io/delta/usage.html

Achados:

- [x] `delta` é pager/syntax highlighter para Git, diff e grep.
- [x] Pode ser usado com unified diff via stdin.
- [x] Como é pager por vocação, precisa ser forçado para superfície não paginada quando a UX default é persistente.

Decisão:

- [x] Aceitar para diff explícito.
- [x] Usar sem pager.
- [x] Manter diff bruto canônico separado da apresentação colorida.
- [x] Não deixar ANSI externo vazar em logs raw ou JSON.

## 3.6 jq

Fonte oficial:

- https://jqlang.org/manual/

Achados:

- [x] `jq` processa stream de JSON e aplica filtros.
- [x] O filtro `.` valida e pretty-printa entradas JSON.
- [x] A documentação alerta para regras de quoting de shell.
- [x] `jq` tem recursos avançados e pode virar linguagem paralela se usado como fonte canônica.

Decisão:

- [x] Aceitar para inspeção, pretty print e filtros diagnósticos.
- [x] Executar por stdin e args tokenizados, sem shell livre.
- [x] Não substituir parser/normalizador JS.
- [x] Não aplicar mutação de estado interno do terminal a partir de filtro `jq`.

## 3.7 yq

Fonte oficial:

- https://mikefarah.gitbook.io/yq/
- https://github.com/mikefarah/yq

Achados:

- [x] `yq` processa YAML, JSON, INI, XML, CSV, TSV, TOML, HCL e properties.
- [x] A sintaxe é similar a `jq`.
- [x] A documentação mostra leitura por stdin e atualização in-place.
- [x] Também há operadores de env/file, o que exige guardas quando usado com conteúdo não confiável.

Decisão:

- [x] Aceitar para preview estruturado e query explícita.
- [x] Usar flags de segurança para desabilitar operações de env/file quando disponíveis.
- [x] Não permitir edição in-place automática.
- [x] Manter JS/`js-yaml` como fallback e contrato interno.

## 3.8 Atuin

Fontes oficiais:

- https://docs.atuin.sh/cli/
- https://docs.atuin.sh/cli/guide/agent-hooks/
- https://docs.atuin.sh/cli/ai/introduction/
- https://docs.atuin.sh/cli/ai/tools-permissions/

Achados:

- [x] Atuin substitui histórico shell por SQLite e registra contexto adicional de comandos.
- [x] Sync é opcional e criptografado, mas ainda envolve estado pessoal sensível.
- [x] A documentação lista hooks para agentes, inclusive Codex, gravando comandos de ferramenta Bash.
- [x] Atuin AI tem sua própria UX de LLM, permissões e detecção de comandos perigosos.
- [x] Integrar isso diretamente ao Terminal LLM-B criaria paralelismo de histórico, permissões e assistência.

Decisão:

- [x] Adiar integração ativa.
- [x] Não ler histórico externo por padrão.
- [x] Não instalar hooks Atuin automaticamente.
- [x] Não chamar `atuin search`, `atuin history`, `atuin sync` ou `atuin hook install` automaticamente.
- [x] Futuro possível: comando de diagnóstico opt-in que apenas explique status local, sem capturar histórico.

## 3.9 zoxide

Fontes oficiais:

- https://github.com/ajeetdsouza/zoxide
- https://zoxide.org/

Achados:

- [x] `zoxide` é um `cd` inteligente baseado em diretórios usados com frequência.
- [x] A documentação exige `zoxide init <shell>` para integração com shell.
- [x] `zi` usa seleção interativa com `fzf`.
- [x] O valor da ferramenta vem de memória pessoal de navegação.
- [x] O terminal LLM-B deve preservar workspace/cwd canônico e escopo controlado.

Decisão:

- [x] Adiar integração ativa.
- [x] Não mudar cwd canônico com base em ranking pessoal.
- [x] Futuro possível: `/cd --interactive --zoxide` somente se houver comando de navegação explícito, escopo permitido e rollback claro.

## 4. Arquitetura ideal

### 4.1 Camadas

- [x] Camada 1: registry read-only de capacidades.
- [x] Camada 2: adapters por uso (`preview`, `markdown`, `diff`, `structured`, `picker`).
- [x] Camada 3: comandos humanos que explicam renderer/fallback.
- [x] Camada 4: lives PTY para provar que o terminal continua usável.
- [ ] Camada 5: validação visual literal da TUI completa em terminal real.
- [x] Camada 6: exemplos guiados em `/terminal libs detail` e `/help full`.

### 4.2 Regras para adapters

- [x] Nunca usar `shell: true`.
- [x] Sempre passar argumentos como array.
- [x] Usar stdin para conteúdo sensível quando possível.
- [x] Ter timeout.
- [x] Ter `maxBuffer`.
- [x] Ter truncamento explícito.
- [x] Ter fallback JS equivalente.
- [x] Nunca abrir pager/TUI sem comando explícito do operador.
- [x] Nunca iniciar TUI se houver pergunta humana pendente.
- [x] Nunca iniciar TUI se houver input digitado na linha.
- [x] Nunca iniciar TUI durante turno em execução, salvo comando futuro de pausa explícita.
- [x] Restaurar prompt, linha viva e readline ao final.

### 4.3 Superfícies humanas

- [x] Default humano deve ser curto.
- [x] Detail deve explicar path, versão, risco e fallback.
- [x] JSON deve existir para scripts/LLMs, mas não aparecer por fallback default.
- [x] Cada ferramenta aceita deve ter exemplo humano claro de uso.
- [x] Cada ferramenta adiada deve explicar o motivo em termos operacionais, não apenas "adiada".
- [x] O terminal deve sugerir comandos canônicos, não flags obscuras.

## 5. Gaps atuais

- [x] `/terminal libs detail` mostra exemplos por ferramenta.
- [x] `/terminal libs detail` diferencia `aceita`, `aceita com guardas` e `adiada` em termos de política de execução.
- [x] `/help full` tem uma seção rica de libs auxiliares com exemplos e fallbacks.
- [ ] O picker externo ainda não tem preview seguro integrado; decisão atual é manter sem preview embutido.
- [x] Há comando de auditoria único que roda bateria local não interativa de previews para demonstrar renderer/fallback.
- [ ] A TUI visual completa de `fzf`/`gum` ainda depende de validação manual/assistida em terminal real.
- [x] `atuin` e `zoxide` estão corretamente adiados e o terminal explica que aparecem apenas como
      inventário/planejamento, sem chamada automática.

## 6. Roadmap

### Faixa A: documentação e decisão

- [x] Fase A.1: reconsultar documentação oficial de todas as libs.
- [x] Fase A.2: classificar uso real por valor, risco e fallback.
- [x] Fase A.3: declarar `atuin` e `zoxide` como adiados.
- [x] Fase A.4: declarar `fzf --preview` como bloqueado até adapter tokenizado.
- [x] Fase A.5: criar este guia de decisão.
- [x] Fase A.6: referenciar este guia no roadmap principal de terminal.

### Faixa B: UX de inspeção das libs

- [x] Fase B.1: `/terminal libs` compacto.
- [x] Fase B.2: `/terminal libs detail`.
- [x] Fase B.3: `/terminal libs json`.
- [x] Fase B.4: adicionar exemplos por ferramenta em detail.
- [x] Fase B.5: adicionar política curta por ferramenta em detail.
- [x] Fase B.6: adicionar nota explícita de que `defaultEnabled=false` preserva portabilidade.

### Faixa C: Help e descoberta

- [x] Fase C.1: `/menu` contém `Libs auxiliares`.
- [x] Fase C.2: `/help full` deve listar comandos de preview com `--plain`, `--markdown`, `--json`, `--yaml`, `/git diff`, `/gh pr diff`.
- [x] Fase C.3: `/help full` deve listar que `atuin` e `zoxide` são detectados, mas não usados.
- [x] Fase C.4: `/help full` deve apontar `/terminal libs detail` como diagnóstico.

### Faixa D: Preview read-only

- [x] Fase D.1: `bat`/`batcat` sem pager.
- [x] Fase D.2: fallback JS.
- [x] Fase D.3: detecção de binário/controle.
- [x] Fase D.4: comando de smoke local para provar fallback em `PATH` vazio e renderer real quando disponível.

### Faixa E: Markdown

- [x] Fase E.1: `glow` por stdin.
- [x] Fase E.2: fallback JS.
- [ ] Fase E.3: avaliar `/help full --glow` como explícito.
- [ ] Fase E.4: garantir que docs longos não ocupem input sem consentimento.

### Faixa F: Diff

- [x] Fase F.1: `delta` por stdin.
- [x] Fase F.2: fallback JS.
- [x] Fase F.3: `/git diff` e `/gh pr diff`.
- [x] Fase F.4: documentar relação entre diff bruto canônico e apresentação colorida.

### Faixa G: Structured preview

- [x] Fase G.1: `jq` JSON.
- [x] Fase G.2: `yq` YAML.
- [x] Fase G.3: flags de segurança em `yq`.
- [x] Fase G.4: exemplos humanos de query em `/terminal libs detail`.
- [x] Fase G.5: docs de pipe seguro para operador e LLM.

### Faixa H: Picker e TTY

- [x] Fase H.1: planner textual seguro.
- [x] Fase H.2: executor opt-in.
- [x] Fase H.3: handoff exclusivo.
- [x] Fase H.4: live filtrada com `fzf --filter`.
- [ ] Fase H.5: live visual/manual de `fzf` TUI completa.
- [ ] Fase H.6: live visual/manual de `gum` quando instalado.
- [ ] Fase H.7: decidir se preview embutido será rejeitado permanentemente ou implementado via adapter seguro.

### Faixa I: Atuin e zoxide

- [x] Fase I.1: detectar sem ativar.
- [x] Fase I.2: documentar risco de estado pessoal.
- [x] Fase I.3: melhorar copy em `/terminal libs detail` sobre libs detectadas mas não acionáveis.
- [ ] Fase I.4: rejeitar qualquer chamada automática em teste.
- [ ] Fase I.5: avaliar futuro comando opt-in de diagnóstico sem leitura de histórico.

### Faixa J: Lives e validação

- [x] Fase J.1: live PTY de previews e libs.
- [x] Fase J.2: live PTY de picker filtrado.
- [x] Fase J.3: live canônica após novos textos de `/terminal libs detail`.
- [x] Fase J.4: validação unitária dos exemplos sem depender de ferramentas instaladas.
- [ ] Fase J.5: validação visual manual/assistida da TUI completa.

## 8. Evidência 2026-06-04

- [x] Registry ampliado com `executionPolicy` e `exampleCommands`.
- [x] `/terminal libs detail` renderiza `Política` e `Exemplo n` por ferramenta.
- [x] `/help full` inclui `Previews e libs auxiliares`, com comandos canônicos para preview, diff,
      structured preview, picker e a decisão adiada de `atuin/zoxide`.
- [x] O renderer de `/help full` quebra comandos longos em duas linhas alinhadas, preservando
      legibilidade em colunas.
- [x] Validação focada passou:
  - `node --check src/copilot/terminal/capabilities/external-tools.js src/copilot/terminal/commands/terminal.js src/copilot/terminal/commands/help.js`;
  - `npx vitest run tests/unit/copilot/terminal/test_commands_terminal.spec.js tests/unit/copilot/terminal/test_external_tool_capabilities.spec.js tests/unit/copilot/terminal/test_commands_help.spec.js --hookTimeout=30000`;
  - `npx eslint src/copilot/terminal/capabilities/external-tools.js src/copilot/terminal/commands/terminal.js src/copilot/terminal/commands/help.js tests/unit/copilot/terminal/test_commands_terminal.spec.js tests/unit/copilot/terminal/test_external_tool_capabilities.spec.js tests/unit/copilot/terminal/test_commands_help.spec.js`.
- [x] Live PTY default passou:
  - `node scripts/model-gateway/commands/model-gateway-terminal-llm-b-live-test.mjs --ux-cycle --label terminal-ux-aux-libs-help-detail-20260604 --timeout-ms 140000`;
  - artefato: `artifacts/terminal-live/2026-06-04T15-52-52-818Z/summary.md`;
  - resultado: PASS em 20/20 critérios, incluindo `ux-cycle-terminal-libs-detail`.
- [x] Smoke read-only criado:
  - `npm run terminal:aux-libs:smoke`;
  - `npm --silent run terminal:aux-libs:smoke -- --json` para pipe JSON sem banner do npm;
  - `make terminal-aux-libs-smoke`;
  - o smoke prova fallbacks com `PATH` vazio e renderers reais com `PATH` do operador.
- [x] Bug corrigido no adapter `delta`:
  - quando a superfície exige `color=never`, o adapter não passa mais flag inválida ao `delta`;
  - nesses casos, o fallback JS é usado de propósito para preservar saída sem ANSI;
  - quando a intenção é exercitar `delta`, o smoke usa `color=always`.
- [x] Validação final do smoke:
  - `npm run terminal:aux-libs:smoke` passou;
  - `npm --silent run terminal:aux-libs:smoke -- --json | jq -r '.ok'` retornou `true`;
  - `make terminal-aux-libs-smoke` passou.
- [x] Live PTY repetida após expor o smoke em `/help full` e `/terminal libs detail`:
  - `node scripts/model-gateway/commands/model-gateway-terminal-llm-b-live-test.mjs --ux-cycle --label terminal-ux-aux-libs-smoke-command-20260604 --timeout-ms 140000`;
  - artefato: `artifacts/terminal-live/2026-06-04T16-00-21-072Z/summary.md`;
  - resultado: PASS em 20/20 critérios.
- [x] Picker interativo filtrado validado após a camada de smoke:
  - `node scripts/model-gateway/commands/model-gateway-terminal-llm-b-live-test.mjs --picker-interactive-cycle --timeout-ms 90000 --label terminal-picker-filtered-after-smoke-20260604`;
  - artefato: `artifacts/terminal-live/2026-06-04T16-02-16-650Z/summary.md`;
  - resultado: PASS em 5/5 critérios;
  - escopo real da prova: `fzf --filter`, handoff exclusivo, seleção, roteamento por `/status` e
    restauração de prompt;
  - limite conhecido: não é prova visual completa de TUI fullscreen, porque o harness PTY não
    emula todas as respostas de terminal necessárias para esse modo.
- [x] Reconciliação documental pós-commit:
  - checklist de gaps ajustada para refletir que exemplos por ferramenta, política por ferramenta,
    seção rica de `/help full` e smoke local já foram implementados e validados;
  - lacuna remanescente focada: copy operacional de libs adiadas e prova visual literal de TUI
    fullscreen.
- [x] Copy operacional de libs auxiliares fortalecida:
  - `/terminal libs detail` passa a renderizar `Estado` e `Default`;
  - libs aceitas ficam como `acionável por comando explícito`;
  - libs aceitas com guardas ficam como `acionável por opt-in com TTY exclusivo`;
  - libs adiadas ficam como inventário/planejamento, sem chamada automática.
- [x] Bug de poluição visual corrigido:
  - importar e executar `/terminal libs detail` isoladamente não inicializa mais log lateral de DB;
  - `terminal/commands/terminal.js` usa o registry específico de external tools em vez do barrel amplo;
  - `diff-preview.js` usa o módulo específico de tema visual em vez do barrel amplo de state;
  - teste de processo filho garante ausência de `[db]` e `SQLite copilot ready` no output do comando.
- [x] Boot humano protegido contra INFO precoce do DB:
  - o logger default do SQLite só imprime WARN/ERROR/FATAL antes da observabilidade central;
  - INFO de prontidão do DB deixa de ocupar a primeira linha do terminal;
  - teste de processo filho cobre abertura/fechamento do DB sem stdout/stderr.
- [x] Live PTY final com guardrail de ruído DB:
  - `node scripts/model-gateway/commands/model-gateway-terminal-llm-b-live-test.mjs --ux-cycle --label terminal-ux-no-db-criterion-20260604 --timeout-ms 140000`;
  - artefato: `artifacts/terminal-live/2026-06-04T16-13-42-410Z/summary.md`;
  - resultado: PASS em 21/21 critérios, incluindo `ux-cycle-no-db-console-noise`.
- [x] Wrapping visual da superfície de libs:
  - `terminalThemeWrappedRow()` evita que exemplos longos em `/terminal libs detail` estourem a
    largura visual;
  - live final: `artifacts/terminal-live/2026-06-04T16-23-18-007Z/summary.md`;
  - medição final não encontrou linhas internas acima de 120 colunas no `plain.log`.

## 9. Próxima execução recomendada

1. Planejar validação visual assistida de TUI completa (`fzf` e `gum` quando instalado).
2. Refinar docs de pipe seguro para `jq`/`yq` em comandos específicos, se surgirem novas superfícies.
3. Avaliar `/help full --glow` apenas como comando explícito, sem pager automático.
4. Expandir smoke para cenários de erro/truncamento se a próxima rodada de UX pedir.
