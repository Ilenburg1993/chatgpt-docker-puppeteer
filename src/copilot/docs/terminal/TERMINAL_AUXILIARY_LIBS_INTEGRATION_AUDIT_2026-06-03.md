# Auditoria de libs auxiliares para UX do Terminal LLM-B

Data: 2026-06-03

Escopo: `src/copilot/terminal`, integrações diretas com `src/copilot/model-gateway`, comandos canônicos e lives da LLM-B.

Documento-guia complementar ao roadmap principal:

- `src/copilot/docs/terminal/TERMINAL_LLM_B_REALTIME_UX_DEEP_AUDIT_ROADMAP_2026-06-02.md`

## 1. Objetivo

Este documento define a arquitetura de adoção, rejeição ou adiamento de ferramentas auxiliares de terminal:

- `gum`
- `fzf`
- `bat`
- `glow`
- `delta`
- `atuin`
- `zoxide`
- `jq`
- `yq`

O objetivo não é "embelezar por dependência". O objetivo é tornar o terminal da LLM-B mais fluido, técnico,
legível, previsível e poderoso, preservando portabilidade e mantendo o prompt vivo sempre pronto.

## 2. Princípios não negociáveis

- [x] Nenhuma dessas ferramentas deve virar dependência obrigatória do terminal.
- [x] Nenhuma dessas ferramentas deve ser instalada automaticamente pelo terminal.
- [x] O terminal deve funcionar igual em CI, devcontainer mínimo, VS Code terminal, SSH e shell comum.
- [x] Quando uma ferramenta existir, ela pode enriquecer preview, seleção, paginação ou validação.
- [x] Quando uma ferramenta não existir, o fallback JavaScript atual deve continuar correto.
- [x] Toda chamada a binário externo deve passar por adaptador central, sem interpolar argumentos em shell livre.
- [x] O input vivo da LLM-B não pode ser ocupado por uma TUI externa sem ação explícita do operador.
- [x] Recursos TUI interativos devem ser opt-in por comando ou configuração, nunca por efeito colateral.
- [x] Saídas com ANSI devem ser normalizadas quando forem reimpressas em superfícies default.
- [x] Logs diagnósticos podem ser detalhados; superfícies default devem ser humanas e curtas.

## 3. Fontes oficiais consultadas

### 3.1 `gum`

Fonte oficial:

- https://github.com/charmbracelet/gum

Achados técnicos:

- [x] `gum` oferece comandos prontos para `choose`, `confirm`, `file`, `filter`, `input`, `write`,
      `pager`, `spin`, `style`, `table` e `log`.
- [x] A documentação oficial explicita customização por flags e variáveis de ambiente.
- [x] `gum confirm` usa código de saída para afirmar ou negar.
- [x] `gum filter` e `gum choose` podem selecionar múltiplos itens.
- [x] `gum input` e `gum write` tomam controle do TTY, portanto competem com o prompt vivo.

Decisão:

- [x] Aceitar como candidato de fase posterior para menus, confirmações explícitas e pickers simples.
- [x] Não usar como base da linha viva, do prompt principal ou de `ask_user` canônico.
- [x] Requer adaptador com guarda `isInteractiveTty`, timeout e fallback textual.

### 3.2 `fzf`

Fontes oficiais:

- https://junegunn.github.io/fzf/
- https://github.com/junegunn/fzf

Achados técnicos:

- [x] `fzf` é filtro fuzzy de propósito geral para listas, arquivos, histórico, processos, hostnames,
      commits e outras coleções.
- [x] A seleção é emitida por stdout, o que encaixa bem em adapters.
- [x] O valor real para nosso terminal está em seleção de arquivos/contexto, comandos, sessões,
      modelos BYOK e resultados de busca.
- [x] Preview com `bat` é padrão de uso documentado pela comunidade do próprio `bat` e compatível
      com arquitetura de preview opcional.

Decisão:

- [x] Aceitar como alto valor para `pickers` opt-in.
- [x] Implementar apenas após existir registry de capacidades e fallback textual.
- [x] Nunca abrir `fzf` durante streaming automático da LLM-B.

### 3.3 `bat`

Fonte oficial:

- https://github.com/sharkdp/bat

Achados técnicos:

- [x] `bat` fornece syntax highlighting, integração com Git e visualização de caracteres não imprimíveis.
- [x] A documentação oficial mostra uso com stdin e linguagem explícita.
- [x] A documentação oficial recomenda `--color=always` e `--line-range` para preview com `fzf`.
- [x] Em Debian/Ubuntu antigos o binário pode chamar `batcat`, não `bat`.

Decisão:

- [x] Aceitar como preview read-only de arquivos, snippets e payloads.
- [x] Detectar `bat` e `batcat`.
- [x] Fallback deve permanecer no renderer JS atual com truncamento seguro.

### 3.4 `glow`

Fonte oficial:

- https://github.com/charmbracelet/glow

Achados técnicos:

- [x] `glow` renderiza Markdown no terminal.
- [x] A documentação oficial descreve TUI local e CLI para arquivo, stdin, GitHub/GitLab e HTTP.
- [x] `glow -w` controla largura; `glow -p` usa pager.
- [x] A TUI é útil para docs, mas toma o terminal.

Decisão:

- [x] Aceitar como renderer opcional de Markdown para `/help full`, docs, planos, auditorias e previews.
- [x] Usar preferencialmente modo CLI/pager explícito, não TUI automática.
- [x] Não usar para renderizar deltas da LLM-B em tempo real.

### 3.5 `delta`

Fontes oficiais:

- https://dandavison.github.io/delta/
- https://dandavison.github.io/delta/usage.html

Achados técnicos:

- [x] `delta` é pager com syntax highlighting para `git`, diff e grep.
- [x] Pode ficar próximo ao diff padrão ou mudar layout/estilo profundamente.
- [x] A documentação oficial descreve uso como pager de Git e também sobre unified diff via stdin.
- [x] Para nosso terminal, o valor está em `/git diff`, `/gh pr diff`, previews de patch e revisão.

Decisão:

- [x] Aceitar como enriquecimento opcional de diff.
- [x] Nunca substituir o contrato canônico de diff bruto armazenado/logado.
- [x] Superfície default pode usar resumo humano; preview explícito pode usar `delta`.

### 3.6 `atuin`

Fonte oficial:

- https://docs.atuin.sh/

Achados técnicos:

- [x] Atuin substitui o histórico de shell por SQLite e registra contexto adicional dos comandos.
- [x] Sync é opcional e criptografado ponta a ponta, mas ainda envolve estado sensível do operador.
- [x] A documentação oficial indica hooks de shell e suportes para zsh, bash, fish, nushell, xonsh
      e PowerShell.
- [x] A integração real depende do shell interativo; IDEs podem iniciar shell sem carregar hooks.

Decisão:

- [x] Adiar.
- [x] Não integrar ao terminal LLM-B como backend de histórico neste momento.
- [x] Pode ser documentado como ferramenta pessoal do operador, não como componente do produto.
- [x] Qualquer uso futuro deve ser opt-in, sem sync automático e sem ler histórico externo por padrão.

### 3.7 `zoxide`

Fontes oficiais:

- https://github.com/ajeetdsouza/zoxide
- https://zoxide.org/

Achados técnicos:

- [x] `zoxide` é alternativa a `cd` que ranqueia diretórios usados com frequência.
- [x] A documentação oficial mostra comandos `z`, `zi` e integração interativa com `fzf`.
- [x] A configuração depende de `zoxide init <shell>` e hooks por prompt ou mudança de diretório.
- [x] O terminal LLM-B opera em workspace fixo e tem escopo controlado por segurança/UX.

Decisão:

- [x] Adiar.
- [x] Não usar para navegação automática do terminal LLM-B.
- [x] Pode ser útil para operador humano fora do produto, mas não deve afetar cwd canônico.

### 3.8 `jq`

Fonte oficial:

- https://jqlang.org/

Achados técnicos:

- [x] `jq` é processador JSON leve e flexível.
- [x] A documentação oficial o descreve como ferramenta para filtrar, mapear e transformar JSON.
- [x] É escrito em C portátil e pode existir como binário único sem dependências de runtime.
- [x] Nosso sistema já deve manter parser/validador JS como fonte canônica, mas `jq` é excelente
      para diagnóstico, pretty print, consultas ad hoc e contracts de CLI.

Decisão:

- [x] Aceitar como ferramenta opcional de inspeção/validação diagnóstica.
- [x] Não substituir parsers JS canônicos por `jq`.
- [x] Pode alimentar comandos como `/events --jq`, `/byok ... --jq`, `/status --json | jq` quando
      a arquitetura de adapters existir.

### 3.9 `yq`

Fonte oficial:

- https://github.com/mikefarah/yq
- https://mikefarah.gitbook.io/yq/

Achados técnicos:

- [x] `yq` processa YAML, JSON, INI, XML, CSV, TOML, HCL e properties com sintaxe similar a `jq`.
- [x] A documentação oficial ressalta binário Go sem dependências de runtime.
- [x] O README oficial inclui nota de segurança para Docker/Podman com privilégios restritos.
- [x] Valor real para nós: `.env`, YAML de configs futuras, GitHub Actions, manifests, relatórios e
      contratos estruturados externos.

Decisão:

- [x] Aceitar como ferramenta opcional de inspeção/validação diagnóstica.
- [x] Não usar como editor mutável automático sem preview/confirm explícito.
- [x] JS/Node continua responsável pela normalização canônica de configs internas.

## 4. Situação atual do terminal

- [x] O terminal já possui tema central: `terminalThemeHeadline`, `terminalThemeRow`,
      `terminalThemeRows`, `terminalThemeDivider`, `terminalThemeText` e chips.
- [x] O terminal já possui contrato central de tempo: `formatTerminalTimeLabel`.
- [x] O terminal já possui comandos com estilo humano crescente: `/byok`, `/activity`, `/events`,
      `/session sdk`, `/status`, `/now`, `/gh`, `/fs`, `/model`.
- [x] O terminal ainda não possui registry central de binários externos.
- [x] O terminal ainda não possui adapters de preview/picker/pager/structured-data.
- [x] Alguns comandos ainda fazem rendering local de snippets e listas, dificultando enriquecimento
      incremental por `bat`, `fzf`, `glow` ou `delta`.
- [x] O terminal já deve continuar funcional sem qualquer lib externa.

## 5. Situação ideal

### 5.1 Capability registry

- [x] Criar camada `src/copilot/terminal/capabilities` para descobrir binários externos.
- [x] Detectar versão, path, disponibilidade, risco e modo recomendado de cada ferramenta.
- [x] Cachear resultados por processo com comando para refresh.
- [x] Exportar pelos barrels do terminal.
- [x] Expor comando humano `/terminal libs`, `/terminal libs detail` ou equivalente.
- [x] Expor JSON diagnóstico para LLMs sem poluir UX default.

### 5.2 Adapters sem dependência obrigatória

- [x] Criar adapter de preview read-only.
- [ ] Criar adapter de picker interativo.
- [x] Criar adapter de Markdown.
- [x] Criar adapter de diff.
- [ ] Criar adapter de JSON/YAML query/format.
- [ ] Garantir fallback JS para cada adapter.

### 5.3 Integração UX

- [ ] `/menu` pode oferecer picker opcional se `fzf`/`gum` estiverem disponíveis e o operador pedir.
- [ ] `/search` pode oferecer preview com `bat`/`glow` sem mudar resultado canônico.
- [x] `/fs read` pode previewar com `bat` quando explicitamente solicitado.
- [x] `/git diff` e `/gh pr diff` podem previewar com `delta` quando disponível.
- [ ] `/help full` e docs podem usar `glow` em modo explícito.
- [ ] `/events`, `/activity`, `/byok`, `/status` podem oferecer filtros `--json` e documentação de
      pipe para `jq`, mantendo saída humana por padrão.

## 6. Riscos

- [ ] TUI externa sequestrar o prompt vivo.
- [ ] Dependência ausente quebrar fluxo principal.
- [ ] ANSI externo vazar para logs/testes.
- [ ] Tool externa ler arquivo sensível em preview sem ação explícita.
- [ ] Shell quoting inseguro ao montar comandos com paths.
- [ ] Windows/WSL/macOS/Linux divergirem em nomes de binário.
- [ ] Atuin/zoxide alterarem estado do operador fora do controle do produto.
- [ ] `jq`/`yq` virarem fonte canônica paralela e divergente do JS.

## 7. Decisões de arquitetura

- [x] Adoção deve começar por detecção, não por uso.
- [x] O registry deve ser read-only e seguro.
- [x] O registry deve ter fallback determinístico quando `PATH` não contiver a ferramenta.
- [x] O terminal deve explicar "disponível", "ausente", "adiado" e "não recomendado por default".
- [x] Cada adapter deve receber argumentos já tokenizados, nunca uma string shell livre.
- [x] `execFile`/`spawn` com array de args é o padrão; `shell: true` fica proibido para estes adapters.
- [x] Saídas externas devem ter limite de bytes, timeout e truncamento explícito.
- [x] `atuin` e `zoxide` não entram em adapters ativos nesta etapa.

## 8. Roadmap

### Faixa A: documentação e contrato

- [x] Fase A.1: consultar documentação oficial das ferramentas candidatas.
- [x] Fase A.2: classificar valor real para o terminal LLM-B.
- [x] Fase A.3: separar aceito, aceito com guarda, adiado e rejeitado.
- [x] Fase A.4: definir princípios de fallback e segurança.
- [x] Fase A.5: referenciar este documento no roadmap principal.

### Faixa B: capability registry

- [x] Fase B.1: criar `terminal/capabilities/external-tools.js`.
- [x] Fase B.2: detectar `gum`, `fzf`, `bat`, `batcat`, `glow`, `delta`, `jq`, `yq`.
- [x] Fase B.3: registrar `atuin` e `zoxide` como detectáveis, mas `defaultEnabled=false`.
- [x] Fase B.4: criar tipos JSDoc para capability report.
- [x] Fase B.5: exportar via barrel.
- [x] Fase B.6: criar testes unitários com PATH controlado.

### Faixa C: comando de inspeção

- [x] Fase C.1: criar comando humano para listar libs auxiliares.
- [x] Fase C.2: mostrar status, decisão, uso recomendado e fallback.
- [x] Fase C.3: oferecer modo `detail` com path/versão/risco.
- [x] Fase C.4: oferecer modo `json` para contratos estruturados com LLM.
- [x] Fase C.5: adicionar ao `/help`, `/menu`, `/terminal libs` e `/libs`.

### Evidência 2026-06-03

- [x] `src/copilot/terminal/capabilities/external-tools.js` implementa registry read-only, cache,
      detecção por `PATH`, suporte a `batcat` e version probe com timeout.
- [x] `src/copilot/terminal/commands/terminal.js` expõe `/terminal libs`,
      `/terminal libs detail`, `/terminal libs json`, `/terminal libs refresh` e atalho `/libs`.
- [x] `src/copilot/terminal/capabilities/file-preview.js` implementa preview read-only com
      `bat`/`batcat`, `spawnSync` sem shell, timeout, `maxBuffer`, limite de linhas e fallback JS.
- [x] `/fs preview <path>` e `/fs read <path> --preview` ativam preview explicitamente sem alterar
      `/fs read` default.
- [x] Achado live/standalone: `read_file_content` imprimia `[copilot/read_file_content] <path>`
      antes da superfície humana do terminal, parecendo log técnico cru para o operador.
- [x] Correção: `read_file_content` ganhou `quietLog` opcional e `/fs` passa a usá-lo; outros
      callers preservam o log informativo original.
- [x] Testes escopados passaram:
      `npx vitest run tests/unit/copilot/terminal/test_external_tool_capabilities.spec.js tests/unit/copilot/terminal/test_commands_terminal.spec.js tests/unit/copilot/terminal/test_commands_menu.spec.js tests/unit/copilot/terminal/test_commands_help.spec.js tests/unit/copilot/terminal/test_repl_command_router_routes.spec.js`.
- [x] Resultado: 5 arquivos, 17 testes.
- [x] Testes escopados adicionais passaram:
      `npx vitest run tests/unit/copilot/terminal/test_external_tool_capabilities.spec.js tests/unit/copilot/terminal/test_commands_terminal.spec.js tests/unit/copilot/terminal/test_commands_fs.spec.js tests/unit/copilot/terminal/test_commands_help.spec.js`.
- [x] Resultado: 4 arquivos, 17 testes.
- [x] Testes escopados após `quietLog` passaram:
      `npx vitest run tests/unit/copilot/terminal/test_commands_fs.spec.js tests/unit/copilot/terminal/test_external_tool_capabilities.spec.js tests/unit/copilot/terminal/test_commands_terminal.spec.js`.
- [x] Resultado: 3 arquivos, 15 testes.
- [x] Lint escopado passou nos arquivos alterados de terminal/capabilities/commands e testes.
- [x] Typecheck strict de `src/copilot` passou:
      `npm run typecheck:strict:src.copilot`.
- [x] Live PTY diagnóstico passou:
      `node scripts/model-gateway/commands/model-gateway-terminal-llm-b-live-test.mjs --diagnostic-ux-cycle --timeout-ms=190000 --transport=pty --out-dir=artifacts/terminal-live/diagnostic-ux-aux-libs-20260603-1950`.
- [x] Resultado live: PASS em 24/24 critérios, incluindo `diagnostic-ux-fs-preview` e
      `diagnostic-ux-terminal-libs`.
- [x] Continuação D.5: `file-preview.js` passou a omitir conteúdo com NUL, bytes inválidos ou muitos
      caracteres de controle antes de chamar preview externo ou fallback textual bruto.
- [x] Testes/lint D.5 passaram:
      `node --check src/copilot/terminal/capabilities/file-preview.js && npx eslint src/copilot/terminal/capabilities/file-preview.js tests/unit/copilot/terminal/test_file_preview.spec.js`.
- [x] Testes D.5 passaram:
      `npx vitest run tests/unit/copilot/terminal/test_file_preview.spec.js tests/unit/copilot/terminal/test_commands_fs.spec.js`.
- [x] Resultado: 2 arquivos, 9 testes.
- [x] Faixa E: `markdown-preview.js` implementa Markdown explícito com `glow` via stdin,
      sem pager/TUI automático, com fallback JS e truncamento.
- [x] `/fs preview <path> --markdown` e `/fs read <path> --preview --markdown` ativam renderer
      Markdown explicitamente.
- [x] Testes/lint Faixa E passaram:
      `node --check src/copilot/terminal/capabilities/markdown-preview.js && node --check src/copilot/terminal/commands/fs.js && npx eslint src/copilot/terminal/capabilities/markdown-preview.js src/copilot/terminal/commands/fs.js tests/unit/copilot/terminal/test_markdown_preview.spec.js tests/unit/copilot/terminal/test_commands_fs.spec.js`.
- [x] Testes Faixa E passaram:
      `npx vitest run tests/unit/copilot/terminal/test_markdown_preview.spec.js tests/unit/copilot/terminal/test_file_preview.spec.js tests/unit/copilot/terminal/test_commands_fs.spec.js`.
- [x] Resultado: 3 arquivos, 13 testes.
- [x] Typecheck strict de `src/copilot` passou após Faixa E.
- [x] Live PTY Faixa E passou:
      `node scripts/model-gateway/commands/model-gateway-terminal-llm-b-live-test.mjs --diagnostic-ux-cycle --timeout-ms=200000 --transport=pty --out-dir=artifacts/terminal-live/diagnostic-ux-markdown-clean-20260603-2000`.
- [x] Resultado: PASS em 25/25 critérios, incluindo `diagnostic-ux-fs-markdown-preview`.
- [x] Faixa F: `diff-preview.js` implementa preview explícito de unified diff com `delta`
      via stdin, `--paging=never`, fallback JS, truncamento, timeout e `maxBuffer`.
- [x] `/git diff [--staged] [--plain] [file]` e `/gh pr diff <n> [--plain]` usam o adapter
      comum, com cabeçalho humano e indicação de renderer/fallback.
- [x] Achado live: o bridge Git executava a partir de `/src`, embora o operador use paths
      repo-relativos; `/git diff src/copilot/...` podia retornar vazio sem erro.
- [x] Correção: bridges Git de leitura e escrita agora executam a partir da raiz do repositório.
- [x] Testes/lint Faixa F passaram:
      `node --check src/copilot/bridges/git-bridge-read.js && node --check src/copilot/bridges/git-bridge-write.js && node --check src/copilot/terminal/capabilities/diff-preview.js && node --check src/copilot/terminal/commands/git.js && node --check scripts/model-gateway/commands/model-gateway-terminal-llm-b-live-test.mjs`.
- [x] Lint escopado Faixa F passou:
      `npx eslint src/copilot/bridges/git-bridge-read.js src/copilot/bridges/git-bridge-write.js src/copilot/terminal/capabilities/diff-preview.js src/copilot/terminal/commands/git.js src/copilot/terminal/commands/gh.js tests/unit/copilot/terminal/test_diff_preview.spec.js tests/unit/copilot/terminal/test_commands_git.spec.js tests/unit/copilot/terminal/test_commands_gh.spec.js`.
- [x] Testes Faixa F passaram:
      `npx vitest run tests/unit/copilot/terminal/test_diff_preview.spec.js tests/unit/copilot/terminal/test_commands_git.spec.js tests/unit/copilot/terminal/test_commands_gh.spec.js`.
- [x] Resultado: 3 arquivos, 8 testes.
- [x] Live PTY Faixa F passou:
      `node scripts/model-gateway/commands/model-gateway-terminal-llm-b-live-test.mjs --diagnostic-ux-cycle --timeout-ms=220000 --transport=pty --out-dir=artifacts/terminal-live/diagnostic-ux-diff-preview-20260603-2030`.
- [x] Resultado live: PASS em 26/26 critérios, incluindo `diagnostic-ux-git-diff-preview`.

### Faixa D: preview read-only

- [x] Fase D.1: criar adapter de preview com `bat`/`batcat`.
- [x] Fase D.2: fallback JS com largura, limite e linguagem opcional.
- [x] Fase D.3: plugar primeiro em comando diagnóstico/explicitamente solicitado, não em fluxo automático.
- [x] Fase D.4: validar que arquivos grandes não travam o terminal via timeout/maxBuffer/truncamento.
- [x] Fase D.5: adicionar detecção fina de binários antes de preview externo em arquivos não-textuais.

### Faixa E: Markdown e documentação

- [x] Fase E.1: criar adapter `glow` para Markdown explícito.
- [x] Fase E.2: fallback JS com texto plano e seções compactas.
- [x] Fase E.3: plugar em `/fs preview --markdown` como comando opt-in inicial.
- [ ] Fase E.4: avaliar `/help full --glow` e docs/roadmaps com pager explícito.

### Faixa F: diff

- [x] Fase F.1: criar adapter `delta` para unified diff.
- [x] Fase F.2: fallback JS atual para diff bruto.
- [x] Fase F.3: aplicar em `/git diff` e `/gh pr diff` apenas por flag ou preferência.
- [x] Fase F.4: corrigir raiz Git para paths repo-relativos consistentes.

### Faixa G: pickers interativos

- [ ] Fase G.1: criar adapter `fzf` para listas.
- [ ] Fase G.2: avaliar `gum filter`/`gum choose` como alternativa.
- [ ] Fase G.3: plugar em `/menu` como opção explícita.
- [ ] Fase G.4: impedir execução em modo não interativo, live streaming ativo ou pergunta pendente.

### Faixa H: contratos estruturados

- [ ] Fase H.1: criar adapter opcional de pretty/query JSON com `jq`.
- [ ] Fase H.2: criar adapter opcional de YAML/multiformato com `yq`.
- [ ] Fase H.3: manter parsers JS como fonte canônica.
- [ ] Fase H.4: documentar pipe seguro para LLM e operador.

### Faixa I: lives e validação UX

- [ ] Fase I.1: live PTY com todas as libs ausentes.
- [ ] Fase I.2: live PTY com libs simuladas no PATH.
- [ ] Fase I.3: live real quando ferramentas existirem no ambiente.
- [ ] Fase I.4: confirmar que prompt vivo não é roubado.
- [ ] Fase I.5: confirmar que `ask_user` segue nobre e não vira tool comum.

## 9. Próxima ação recomendada

Implementar Faixas B e C primeiro.

Motivo:

- Elas não mudam o fluxo principal.
- Elas criam transparência para operador e LLM.
- Elas dão base para qualquer uso posterior.
- Elas reduzem risco antes de acoplar preview, picker ou pager.
