# Terminal Aux Libs UX Architecture Decision - 2026-06-05

## 00. Status

- [x] Documento criado antes de novas integrações de libs auxiliares.
- [x] Escopo: `src/copilot/terminal`, comandos canônicos associados, live runner e smoke de libs.
- [x] Objetivo: decidir como `gum`, `fzf`, `bat`, `glow`, `delta`, `atuin`, `zoxide`, `jq` e `yq`
      entram na UX sem quebrar a linha viva, o prompt, a portabilidade ou os contratos estruturados.
- [x] Regra central: toda lib externa é opcional; fallback JS/textual permanece canônico.
- [x] Regra de segurança: nenhuma lib externa pode ler histórico pessoal, alterar cwd global,
      instalar hook de shell, abrir pager/TUI ou executar shell livre automaticamente.
- [x] Regra de UX: libs auxiliares devem reduzir ruído visual; se aumentarem verborragia, IDs crus
      ou competição pelo TTY, ficam desabilitadas.
- [x] Regra de testes: toda integração nova precisa de teste unitário ou smoke sem LLM; TUI real
      exige live/PTY dedicado.
- [x] Checkboxes são booleanos.

## 01. Fontes Oficiais Consultadas

- [x] Gum: `https://github.com/charmbracelet/gum`.
- [x] fzf: `https://github.com/junegunn/fzf`.
- [x] bat: `https://github.com/sharkdp/bat`.
- [x] Glow: `https://github.com/charmbracelet/glow`.
- [x] delta: `https://dandavison.github.io/delta/`.
- [x] Atuin: `https://docs.atuin.sh/`.
- [x] zoxide: `https://github.com/ajeetdsouza/zoxide`.
- [x] jq: `https://jqlang.org/`.
- [x] yq: `https://github.com/mikefarah/yq` e `https://mikefarah.gitbook.io/yq/`.

## 02. Inventário Local Observado

- [x] `gum`: ausente no ambiente atual.
- [x] `fzf`: presente em `/usr/bin/fzf`, versão `0.38.0 (debian)`.
- [x] `bat`: presente em `/usr/local/bin/bat`, versão `0.22.1`.
- [x] `batcat`: presente em `/usr/bin/batcat`, versão `0.22.1`.
- [x] `glow`: presente em `/usr/local/bin/glow`, versão `2.1.2`.
- [x] `delta`: presente em `/usr/local/bin/delta`, versão `0.19.2`.
- [x] `atuin`: ausente no ambiente atual.
- [x] `zoxide`: presente em `/usr/local/bin/zoxide`, versão `0.9.9`.
- [x] `jq`: presente em `/usr/bin/jq`, versão `1.6`.
- [x] `yq`: presente em `/usr/local/bin/yq`, versão `v4.53.2`.

## 03. Estado Atual do Código

- [x] `src/copilot/terminal/capabilities/external-tools.js` já possui registry declarativo com
      decisão, usos, fallback, risco, docs e exemplos.
- [x] `file-preview.js` já usa `bat`/`batcat` opcionalmente, com fallback JS, limite de linhas,
      limite de bytes, detecção binária e `--paging=never`.
- [x] `markdown-preview.js` já usa `glow` opcionalmente por stdin, sem pager automático, com
      fallback JS.
- [x] `diff-preview.js` já usa `delta` opcionalmente por stdin, sem pager, com fallback JS.
- [x] `structured-preview.js` já usa `jq`/`yq` opcionalmente por stdin, com fallback JS.
- [x] `structured-preview.js` já bloqueia query iniciada por hífen e usa
      `--security-disable-env-ops`/`--security-disable-file-ops` para `yq`.
- [x] `picker-plan.js` já escolhe `fzf`/`gum` somente como plano; o modo externo fica bloqueado
      enquanto não houver controle exclusivo de TTY.
- [x] `scripts/model-gateway/commands/model-gateway-terminal-aux-libs-smoke.mjs` já valida fallback
      sem `PATH` e renderers reais quando disponíveis.
- [x] `package.json` possui `terminal:aux-libs:smoke`.
- [x] `Makefile` possui `make terminal-aux-libs-smoke`.

## 04. Diagnóstico de Arquitetura

- [x] A fundação read-only está boa: preview de arquivo, Markdown, diff e estruturado já respeita
      fallback e limites.
- [x] A fronteira TUI ainda é deliberadamente incompleta: `fzf`/`gum` não devem assumir o terminal
      sem uma API explícita de posse exclusiva do TTY.
- [x] `atuin` deve continuar fora do produto por padrão, porque registra histórico de shell, usa
      hooks e pode sincronizar dados pessoais.
- [x] `zoxide` deve continuar fora do fluxo default, porque aprende cwd/frecency pessoal e pode
      conflitar com o workspace canônico.
- [x] `jq`/`yq` devem ser enrichers de preview/query, não fonte canônica de parse, normalização ou
      contrato com a LLM.
- [x] `bat`/`glow`/`delta` devem ser renderers de inspeção explícita, não pagers globais.
- [x] O runner live já tem critérios para `/fs preview`, `/terminal libs`, `/git diff`,
      `/menu picker`; estes critérios devem ser ampliados quando a TUI exclusiva existir.

## 05. Decisões por Ferramenta

### 05.1 Gum

- [x] Decisão: aceitar apenas de forma guardada.
- [x] Uso ideal: menus, confirmações e inputs explícitos quando o operador pede uma TUI.
- [x] Não usar por padrão porque `gum choose`, `gum input`, `gum confirm`, `gum file`, `gum pager` e
      similares tomam o TTY.
- [x] Não instalar automaticamente.
- [x] Não substituir `request_user_input`/`ask_user`.
- [x] Pré-requisito de implementação: `withTerminalExclusiveTty` robusto em PTY real, pausa da linha
      viva, restauração do prompt e timeout/cancelamento.
- [x] Fallback: menus textuais atuais, chips e comandos numerados.

### 05.2 fzf

- [x] Decisão: aceitar com TTY exclusivo e comando explícito.
- [x] Uso ideal: seleção de arquivos, contexto, sessões, modelos, buscas e resultados.
- [x] Risco oficial relevante: preview de `fzf` executa comando externo via shell; portanto preview
      embutido precisa adapter fechado, não string livre.
- [x] Não ativar keybindings de shell.
- [x] Não usar `--preview` com templates arbitrários vindos da LLM.
- [x] Fallback: listas numeradas e `/menu <n>`.

### 05.3 bat

- [x] Decisão: aceito para preview explícito read-only.
- [x] Uso atual correto: `--paging=never`, `--line-range`, fallback JS.
- [x] Manter suporte `bat` e `batcat`.
- [x] Não configurar alias global `cat=bat`.
- [x] Não abrir pager automático.
- [x] Prioridade de upgrade: expor melhor no `/terminal libs` e em `/fs preview` qual renderer foi
      usado.

### 05.4 Glow

- [x] Decisão: aceito para Markdown explícito.
- [x] Uso atual correto: stdin, width controlado, estilo controlado, sem pager.
- [x] Não usar modo TUI default `glow` sem argumento.
- [x] Não buscar URLs automaticamente.
- [x] Prioridade de upgrade: docs/auditorias grandes com preview navegável apenas quando TTY
      exclusivo existir.

### 05.5 delta

- [x] Decisão: aceito para diff explícito.
- [x] Uso atual correto: stdin, `--paging=never`, sem depender de `core.pager`.
- [x] Não alterar configuração global do Git.
- [x] Não tornar `delta` obrigatório para diffs.
- [x] Prioridade de upgrade: `/git diff` deve reportar renderer, fallback e truncamento de forma
      compacta.

### 05.6 Atuin

- [x] Decisão: adiar.
- [x] Motivo: substitui histórico shell por SQLite, usa hooks, registra cwd/exit/duração e pode
      sincronizar histórico.
- [x] Não consultar histórico pessoal do operador.
- [x] Não rodar `atuin init`, `atuin import` ou `atuin sync`.
- [x] Possível futuro: apenas detector de disponibilidade em `/terminal libs detail`, sem leitura de
      dados.

### 05.7 zoxide

- [x] Decisão: adiar.
- [x] Motivo: navegação por frecency depende de dados pessoais e pode alterar cwd mental do
      operador.
- [x] Não alterar cwd canônico do terminal.
- [x] Não rodar `zoxide query` por default.
- [x] Possível futuro: sugestão opt-in para operador humano fora do runtime da LLM-B.

### 05.8 jq

- [x] Decisão: aceito para preview/query JSON explícito.
- [x] jq é filtro JSON poderoso; no sistema, o parser JS continua fonte canônica.
- [x] Não executar filtros vindos da LLM sem validação.
- [x] Não usar jq para mutações.
- [x] Prioridade de upgrade: permitir presets seguros de query, não linguagem livre em superfícies
      automáticas.

### 05.9 yq

- [x] Decisão: aceito para preview/query YAML e formatos estruturados explícitos.
- [x] Uso atual correto: `--security-disable-env-ops` e `--security-disable-file-ops`.
- [x] Não usar `yq -i` automaticamente.
- [x] Não permitir file/env ops.
- [x] Prioridade de upgrade: preservar formato original no preview e reportar `queryApplied`.

## 06. Situação Ideal

- [x] `/terminal libs` deve mostrar inventário bonito, compacto e acionável: disponível, decisão,
      uso, fallback e risco.
- [x] `/terminal libs detail` deve mostrar versões, caminhos, docs oficiais, política de execução e
      exemplos.
- [x] `/fs preview` deve mostrar renderer, fallback, truncamento e comandos relacionados sem poluir
      o conteúdo.
- [x] `/git diff` deve usar `delta` quando adequado e declarar fallback sem depender de pager
      global.
- [x] `/fs preview --markdown` deve usar `glow` quando disponível e nunca abrir TUI/pager sem
      comando explícito.
- [x] `/fs preview --json|--yaml --query` deve diferenciar query aplicada, query bloqueada e
      fallback JS.
- [ ] `/menu picker --interactive` deve permanecer textual até existir TTY exclusivo real.
- [ ] A LLM-B deve ter comandos claros para pedir previews estruturados sem inventar shell livre.
- [x] O operador deve entender rapidamente quais libs estão instaladas e quais são deliberadamente
      recusadas/adiadas.

## 07. Roadmap

### Faixa AUX-A - Inventário e Governança

- [x] AUX-A.1: detectar disponibilidade e versão das libs.
- [x] AUX-A.2: manter registry declarativo com decisão, risco, fallback e docs.
- [x] AUX-A.3: enriquecer `/terminal libs` com status por categoria e sem excesso de texto.
- [ ] AUX-A.4: adicionar critério live específico para `gum`/`atuin` ausentes não gerarem erro.
- [ ] AUX-A.5: documentar comandos canônicos em `package.json`, `Makefile` e `/help`.

### Faixa AUX-B - Preview Read-Only

- [x] AUX-B.1: `bat` para arquivos com fallback JS.
- [x] AUX-B.2: `glow` para Markdown com fallback JS.
- [x] AUX-B.3: `delta` para diff com fallback JS.
- [x] AUX-B.4: `jq`/`yq` para JSON/YAML com fallback JS.
- [x] AUX-B.5: padronizar footer de renderer/fallback/truncamento entre todos os previews.
- [x] AUX-B.6: fazer previews estruturados respeitarem `--lines`, inclusive quando `jq`/`yq`
      renderizam saída externa.
- [x] AUX-B.7: impedir que output externo ANSI apareça em logs/export default.
- [x] AUX-B.8: live dedicada de `/fs preview` cobrindo JS, Markdown, JSON, YAML e diff.

### Faixa AUX-C - TTY Exclusivo

- [ ] AUX-C.1: auditar `withTerminalExclusiveTty` em PTY real.
- [ ] AUX-C.2: definir contrato de pausa da linha viva antes de TUI externa.
- [ ] AUX-C.3: definir cancelamento, timeout e restauração de prompt.
- [ ] AUX-C.4: criar adapter `fzf` fechado sem shell preview livre.
- [ ] AUX-C.5: avaliar `gum` apenas se instalado e sem competir com `request_user_input`.
- [ ] AUX-C.6: live dedicada com abort/cancel/resize.

### Faixa AUX-D - Structured Contracts

- [ ] AUX-D.1: criar presets de query seguros para JSON/YAML.
- [ ] AUX-D.2: separar `query livre do operador` de `query sugerida pela LLM`.
- [ ] AUX-D.3: bloquear filtros com risco de execução, file/env ops ou opção injetada.
- [ ] AUX-D.4: registrar query aplicada em `/activity` e `/events` sem vazar conteúdo sensível.
- [ ] AUX-D.5: manter parse JS como fonte canônica para testes.

### Faixa AUX-E - História e Navegação

- [x] AUX-E.1: decidir `atuin` como deferred.
- [x] AUX-E.2: decidir `zoxide` como deferred.
- [ ] AUX-E.3: `/terminal libs detail` deve explicar por que histórico/cwd pessoais ficam fora do
      default.
- [ ] AUX-E.4: se houver integração futura, exigir opt-in explícito do operador.

### Faixa AUX-F - Live e Validação

- [x] AUX-F.1: smoke sem `PATH` cobre fallbacks JS.
- [x] AUX-F.2: smoke com `PATH` cobre renderers reais disponíveis.
- [x] AUX-F.3: live UX dedicada para `/terminal libs`, `/fs preview`, `/git diff`, `/menu picker`.
- [ ] AUX-F.4: critérios live devem rejeitar `chatcmpl-tool`, `request_user_input`, ANSI literal,
      IDs crus e shell livre.
- [ ] AUX-F.5: relatório final por artefato com screenshots/log plain quando PTY expuser
      discrepância.

## 08. Próximas Ações Recomendadas

- [x] Primeiro: melhorar `/terminal libs` para ser a superfície canônica de decisão e
      disponibilidade.
- [x] Segundo: padronizar footer de preview nos comandos que usam `bat`, `glow`, `delta`, `jq` e
      `yq`.
- [x] Terceiro: ampliar `terminal:aux-libs:smoke` para verificar ausência de ANSI em JSON/log,
      presença de fallback reasons humanos e respeito a `--lines` em preview estruturado.
- [x] Quarto: rodar live de libs auxiliares antes de qualquer TUI real.
- [ ] Quinto: só depois desenhar `withTerminalExclusiveTty` para `fzf`/`gum`.
