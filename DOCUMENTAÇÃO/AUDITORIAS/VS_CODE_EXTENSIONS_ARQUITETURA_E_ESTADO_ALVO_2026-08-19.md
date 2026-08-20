# Auditoria arquitetural das extensões do VS Code — estado atual, custo-benefício e estado-alvo

**Workspace:** `chatgpt-docker-puppeteer`  
**Escopo:** repositório inteiro, com ênfase no DevContainer, VS Code remoto e `src/copilot`  
**Data da auditoria:** 2026-08-19  
**Natureza:** diagnóstico e proposta. Nenhuma instalação, remoção, reconciliação, limpeza ou
alteração de configuração foi executada como parte desta auditoria. A criação deste documento é a
única mutação deliberada.

---

## 1. Sumário executivo

A arquitetura de extensões do repositório já é mais madura do que uma configuração convencional de
VS Code: existe uma **fonte única de verdade (SSOT)** em `config/vscode/extensions.mjs`, projeções
para `.devcontainer/devcontainer.json` e `.vscode/extensions.json`, validação estática,
reconciliação de runtime e perfis opcionais. Portanto, o problema principal não é ausência de
governança. O problema é que a governança atual **mistura conceitos diferentes** e o runtime
acumulou resíduos suficientes para tornar essa mistura cara.

Os principais achados são:

1. O catálogo canônico contém atualmente **27 extensões `core`**, **21 opcionais**, **10
   classificadas como `hostOnly`** e **34 classificadas como `unwanted`**.
2. O Extension Host remoto continha, durante a coleta, **68 IDs lógicos de extensão de usuário**. A
   classificação física observada foi: 26 IDs `core` de usuário, 20 opcionais, os 10 `hostOnly`, 9
   `unwanted` e 3 dependências/transitivos não geridos diretamente. O 27º requisito `core`,
   `GitHub.copilot-chat`, está entregue como **builtin** do VS Code Server 1.133.0
   (`GitHub.copilot-chat` v0.61.0), de modo que não precisa existir como diretório de extensão de
   usuário.
3. O diretório remoto de extensões passou de aproximadamente **2,8 GiB para 3,1 GiB durante a
   própria auditoria**, porque o VS Code atualizou `Anthropic.claude-code` em paralelo. Ao final da
   coleta havia diretórios físicos 2.1.235, 2.1.236 e 2.1.237; o registro `extensions.json`
   reconhecia apenas 2.1.237 como versão instalada atual. Isso é evidência de retenção
   pós-update/pending cleanup, não prova de corrupção.
4. Antes da terceira cópia do Claude, as extensões classificadas como `core` já ocupavam
   aproximadamente **2.249 MiB** no disco remoto; a terceira versão adicionou ~329 MiB físicos. A
   maior parte desse custo decorre dos agentes de IA e do PowerShell, não das ferramentas de
   linguagem/lint.
5. Somente um **baseline técnico estrito de 11 extensões** — TypeScript 7, ESLint, Prettier,
   Container Tools, Makefile Tools, ShellCheck, YAML, EditorConfig, Volar, GitHub Actions e
   markdownlint — ocupa aproximadamente **85,9 MiB** no estado atual. Isso mostra que é possível
   preservar o toolchain central com uma ordem de grandeza muito menor de provisionamento
   automático.
6. Há **25 diretórios de extensão** cujo manifesto declara `onStartupFinished` ou `*`; os diretórios
   somavam ~2.243 MiB na medição posterior à atualização. Esse número é uma medida de superfície
   potencial de ativação, **não memória residente nem tempo de CPU**. Diretórios antigos do Claude
   não significam três instâncias ativas simultâneas.
7. O runtime contém os **10 IDs que a própria SSOT classifica como `hostOnly`**, somando ~44 MiB
   remotos. Eles não pertencem ao baseline do DevContainer e evidenciam migração/instalação
   histórica do conjunto Remote dentro do host remoto.
8. O runtime contém **9 extensões que a SSOT atual marca como `unwanted`**, somando ~99 MiB antes da
   última atualização: Mermaid Chart, Markdown Mermaid, Indent Rainbow, npm Intellisense, Live
   Preview, Git Graph, Path Intellisense, Test Explorer UI e JSON (`ZainChen.json`).
9. `christian-kohler.npm-intellisense` foi observado nos logs sendo ativado ao abrir JavaScript **no
   mesmo instante que `TypeScriptTeam.native-preview`**. É um exemplo real, não apenas teórico, de
   trabalho redundante no caminho JS/TS.
10. `cSpell.enabled=false` está comprometido em `.vscode/settings.json`, mas
    `streetsidesoftware.code-spell-checker` e o dicionário pt-BR estão instalados e foram observados
    ativando em `onStartupFinished`. O custo não é gigantesco, mas o benefício corrente é
    literalmente desabilitado pela configuração.
11. O log recente contém um `onWillSaveTextDocument` com timeout em `EditorConfig.EditorConfig`,
    erros de descarte em GitLens e Todo Tree, além de ruído de localização do TypeScript 7. Esses
    eventos não bastam para condenar as extensões, mas justificam medição A/B e impedem
    classificá-las como “custo zero”.
12. `.vscode/extensions.json` está **modificado antes desta auditoria**: `oderwat.indent-rainbow`
    foi movida de `unwantedRecommendations` para `recommendations`. A SSOT não foi alterada. Por
    isso `npm run vscode:sync:check` e `node scripts/check-vscode-extensions.js` detectam drift.
    Este documento não corrige nem reverte essa alteração.
13. A CLI remota `code` reporta VS Code Server **1.133.0**, mas `code --list-extensions` e
    `code --status` falham nesta shell devido a um `VSCODE_IPC_HOOK_CLI` órfão (`ENOENT` no socket).
    Logo, os scripts atuais não conseguem fazer inventário normal por CLI neste contexto.
14. Há uma falha de semântica no validador: `vscode:check:runtime --strict-runtime` não marca falha
    quando a CLI está indisponível; apenas avisa que a verificação foi omitida. Um modo chamado
    “strict runtime” não deve poder terminar verde sem ter verificado o runtime.
15. A detecção de builtins usa `VSCODE_CWD`; nesta sessão essa variável está vazia. O builtin
    Copilot só foi identificado ao inferir diretamente a raiz do servidor a partir do executável
    `code`. O detector deve ganhar fallback robusto.
16. Separadamente das extensões, existem **29 builds do VS Code Server** sob
    `/vscode/vscode-server/bin/linux-x64`, ocupando cerca de **10,4 GiB**. Isso é higiene de cache
    do servidor, não catálogo de extensão, e deve ter política própria de retenção.
17. O maior risco não é apenas performance. `.vscode/settings.json` compromete um perfil de alta
    autonomia: `chat.tools.global.autoApprove=true`, auto-approve do terminal,
    `ignoreDefaultAutoApproveRules=true`, `blockDetectedFileWrites="never"`, sandbox de agentes
    desligado, `claudeCode.allowDangerouslySkipPermissions=true` e
    `claudeCodeChat.permissions.yoloMode=true`. Em um workspace deliberadamente autônomo isso pode
    ser intencional, mas **não deveria estar conceitualmente misturado com recomendações de
    extensão**. Extensões executam com os privilégios do Extension Host e podem ler/escrever
    arquivos, executar processos e acessar rede; portanto o conjunto de extensões e o perfil de
    aprovação formam uma mesma superfície de confiança.

### Veredito arquitetural

A SSOT deve ser **preservada e aprofundada**, não descartada. O estado-alvo deve separar:

- **baseline obrigatório/autoinstall**: o mínimo necessário para o código e o toolchain deste repo;
- **workspace recommendations**: recomendações de alto valor, voluntárias;
- **perfis especializados**: IA, Python, PowerShell/Windows, documentação, Docker avançado,
  visualização, UX;
- **host/pessoal**: extensões de transporte remoto, temas, language packs e preferências de edição;
- **not-recommended**: extensões para as quais o repo não deve emitir recomendação;
- **blocked/prunable**: somente extensões objetivamente conflitantes, legadas ou incompatíveis com a
  arquitetura do repo;
- **transitivas/builtins**: capacidades satisfeitas sem instalação direta e que o auditor deve
  reconhecer.

Essa separação preserva a liberdade de ferramentas sem transformar cada abertura/rebuild do
DevContainer numa instalação automática de todo o universo de agentes e preferências pessoais.

---

## 2. Método e fontes de evidência

Foram usadas quatro camadas de evidência:

1. **Estado declarado pelo repositório**
   - `config/vscode/extensions.mjs`;
   - `.vscode/extensions.json`;
   - `.devcontainer/devcontainer.json`;
   - `.vscode/settings.json`;
   - scripts `vscode:*` em `package.json`;
   - `scripts/check-vscode-extensions.js`;
   - `scripts/setup/install-vscode-extensions.mjs`;
   - `scripts/setup/sync-vscode-extensions.mjs`;
   - `scripts/setup/vscode-extension-runtime.mjs`.
2. **Estado físico do Extension Host remoto**
   - manifests em `/home/node/.vscode-server/extensions/*/package.json`;
   - registro `/home/node/.vscode-server/extensions/extensions.json`;
   - tamanhos físicos por diretório;
   - activation events declarados nos manifests.
3. **Evidência de execução**
   - logs recentes `remoteexthost.log`;
   - builtin manifests do VS Code Server 1.133.0;
   - falhas reais da CLI `code` e dos validadores de extensão.
4. **Documentação oficial atual do VS Code**
   - recomendações de workspace;
   - Dev Containers e localização local/remota de extensões;
   - Extension Host e lazy activation;
   - CLI de extensões e instalação versionada;
   - Extension Bisect/Runtime Status;
   - segurança do Extension Host;
   - TypeScript 7;
   - Git Source Control Graph e Mermaid builtin.

### Limitações

- Tamanho em disco **não é** consumo de memória e activation event **não é** tempo de ativação. O
  documento usa esses sinais para priorização, não como substituto de profiling.
- A CLI `code` desta shell estava sem IPC válido. O inventário foi reconstruído diretamente dos
  manifests e do registro físico.
- O diretório de extensões é dinâmico: uma atualização automática do Claude ocorreu durante a
  auditoria. Números de disco devem ser entendidos como snapshot aproximado de 2026-08-19.
- Nenhuma extensão foi desativada para ensaio A/B; logo, erros de log são evidência de observação,
  não demonstração causal de degradação global.

---

## 3. A arquitetura atual

### 3.1. SSOT

`config/vscode/extensions.mjs` define hoje:

- `foundation`;
- `github`;
- `ai`;
- `docs`;
- `python`;
- `VSCODE_DEVCONTAINER_EXTENSIONS`;
- `VSCODE_OPTIONAL_EXTENSIONS`;
- `VSCODE_HOST_ONLY_EXTENSIONS`;
- `VSCODE_UNWANTED_EXTENSIONS`.

`VSCODE_DEVCONTAINER_EXTENSIONS` é a união de `foundation + github + ai + docs`. A constante
`VSCODE_RECOMMENDED_EXTENSIONS` aponta para **a mesma lista**.

Consequência: uma extensão classificada como `core` é simultaneamente:

1. auto-instalada no DevContainer;
2. recomendada no workspace;
3. tratada pelo reconciliador como requisito do perfil `core`.

Essas três semânticas não são equivalentes.

### 3.2. Projeções

`scripts/setup/sync-vscode-extensions.mjs` projeta a SSOT para:

- `.devcontainer/devcontainer.json` → `customizations.vscode.extensions`;
- `.vscode/extensions.json` → `recommendations` e `unwantedRecommendations`.

A documentação oficial do VS Code distingue claramente os dois mecanismos: recomendações do
workspace são apresentadas ao usuário como recomendações; já `customizations.vscode.extensions` no
`devcontainer.json` especifica extensões a instalar no container na criação/reconexão. Portanto, **é
arquiteturalmente correto que essas listas possam ser diferentes**.

### 3.3. Reconciliação

`planExtensionReconciliation()` calcula:

- `install`: requisitos do perfil ausentes;
- `remove`: quando `--prune`, a união de `VSCODE_UNWANTED_EXTENSIONS + VSCODE_HOST_ONLY_EXTENSIONS`
  que estiver instalada.

Aqui há outra fusão indevida: `unwantedRecommendations` é um conceito de recomendação de workspace;
o reconciliador o interpreta como autorização para desinstalação. Isso é excessivo para preferências
pessoais como Vim, keybindings, Bookmarks ou Indent Rainbow.

### 3.4. Validação

`check-vscode-extensions.js` valida corretamente o drift entre SSOT e projeções. A parte de runtime,
porém, precisa ser endurecida:

- se `code --list-extensions` falha, `installed=null`;
- o script apenas imprime “verificação omitida”;
- mesmo com `--strict-runtime`, essa ausência não seta `failed=true`.

**Estado-alvo:** strict runtime deve falhar fechado (“fail closed”) quando não consegue observar o
runtime.

### 3.5. Builtins

`readBuiltInExtensions()` depende de `VSCODE_CWD`. Nesta sessão `VSCODE_CWD` estava vazio, embora o
executável real estivesse em:

`/vscode/vscode-server/bin/linux-x64/a5b500951314efd502d07465bd138dfbd714a960/bin/remote-cli/code`

A raiz desse servidor contém 35 extensões builtin, inclusive:

- `GitHub.copilot-chat` 0.61.0;
- `vscode.git`;
- `vscode.github`;
- `vscode.json-language-features`;
- `vscode.markdown-language-features`;
- `vscode.mermaid-markdown-features`;
- `vscode.typescript-language-features`.

O detector deve inferir a raiz também a partir de `which code`/`readlink`, ou do processo/instalação
ativa, e só então recorrer a `VSCODE_CWD` como hint.

---

## 4. Inventário físico e custo observado

### 4.1. Distribuição lógica

| Classe da SSOT        | Catálogo | IDs de usuário observados | Footprint observado antes do update final |
| --------------------- | -------: | ------------------------: | ----------------------------------------: |
| Core                  |       27 |      26 + Copilot builtin |                               ~2249,2 MiB |
| Optional              |       21 |                        20 |                                ~264,2 MiB |
| Host-only             |       10 |                        10 |                                 ~44,2 MiB |
| Unwanted              |       34 |                         9 |                                 ~98,9 MiB |
| Transitivo/não gerido |        — |                         3 |                                ~123,5 MiB |

A soma acima precede a chegada do Claude 2.1.237. Após o update,
`du -sh /home/node/.vscode-server/extensions` reportou aproximadamente **3,1 GiB**.

### 4.2. Maiores consumidores físicos

| Extensão/diretório              | Tamanho aproximado | Activation event relevante | Leitura arquitetural                                                      |
| ------------------------------- | -----------------: | -------------------------- | ------------------------------------------------------------------------- |
| OpenAI Codex (`openai.chatgpt`) |          531,4 MiB | `onStartupFinished`        | alto valor se usado; caro demais para baseline universal                  |
| Kilo Code                       |          398,6 MiB | `onStartupFinished`        | idem; perfil de agente                                                    |
| Claude Code 2.1.237             |         ~329,2 MiB | `onStartupFinished`        | versão corrente registrada                                                |
| Claude Code 2.1.236             |         ~329,1 MiB | `onStartupFinished`        | diretório antigo após update                                              |
| Claude Code 2.1.235             |         ~325,6 MiB | `onStartupFinished`        | diretório antigo após update                                              |
| PowerShell                      |          301,7 MiB | linguagem/debug/comando    | grande no disco, mas lazy para PowerShell                                 |
| Gemini Code Assist              |          238,9 MiB | `onStartupFinished`        | perfil de agente                                                          |
| Copilot Data Analysis           |           84,3 MiB | chat participant           | transitivo/builtin ecosystem                                              |
| JS CodeFormer                   |           69,7 MiB | comandos                   | custo de disco, baixo custo de startup; utilidade questionável com TS7/IA |
| Python                          |           65,3 MiB | Python/workspace           | perfil Python, não baseline Node                                          |
| Mermaid Chart                   |           46,4 MiB | linguagem                  | redundante no VS Code atual                                               |
| debugpy                         |           43,5 MiB | Python/debug               | perfil Python                                                             |
| Docker DX                       |           40,8 MiB | Dockerfile/compose/debug   | sobrepõe parcialmente Container Tools                                     |
| Python Environments             |           39,1 MiB | Python                     | transitiva do ecossistema Python                                          |
| Markdown Mermaid                |           33,9 MiB | Markdown                   | redundante: Mermaid é builtin no VS Code atual                            |
| TypeScript 7 Native Preview     |           27,8 MiB | JS/TS                      | essencial ao objetivo TS7 do repo                                         |
| GitLens                         |           17,6 MiB | `onStartupFinished`        | alto valor, mas não requisito do build                                    |
| ShellCheck                      |           15,8 MiB | shell                      | justificado: 126 `.sh` rastreados                                         |
| Prettier                        |           14,3 MiB | `onStartupFinished`        | requerido por settings do workspace                                       |
| Indent Rainbow                  |           12,7 MiB | `*`                        | valor visual, custo sempre ativo; deve ser opt-in                         |

### 4.3. O baseline técnico é pequeno

Footprint atual do baseline proposto:

| ID                                |    MiB aprox. |
| --------------------------------- | ------------: |
| `TypeScriptTeam.native-preview`   |          27,8 |
| `dbaeumer.vscode-eslint`          |           0,9 |
| `esbenp.prettier-vscode`          |          14,3 |
| `ms-azuretools.vscode-containers` |           4,3 |
| `ms-vscode.makefile-tools`        |           2,2 |
| `timonwong.shellcheck`            |          15,8 |
| `redhat.vscode-yaml`              |           3,7 |
| `EditorConfig.EditorConfig`       |           1,2 |
| `Vue.volar`                       |           4,2 |
| `github.vscode-github-actions`    |          10,4 |
| `DavidAnson.vscode-markdownlint`  |           1,2 |
| **Total**                         | **~85,9 MiB** |

Isso não significa que o restante deva ser apagado. Significa que **“ser útil” não implica “ser
instalado automaticamente em toda reconstrução”**.

---

## 5. Aderência real ao conteúdo do repositório

O Git rastreia aproximadamente 5,2 mil entradas. Entre as extensões de arquivo mais relevantes para
a política de editor foram observadas:

- ~2592 `.js`;
- ~233 `.mjs`;
- ~30 `.ts`;
- ~557 `.md` com nomes normais, além de muitos artefatos históricos com aspas no nome;
- 126 `.sh`;
- 43 `.vue`;
- 29 `.yml` + 19 `.yaml`;
- 29 `.py`;
- 19 `.bat`;
- 5 `.ps1`;
- 2 Dockerfiles;
- 1 Makefile central.

Portanto:

- TypeScript 7/JS, ESLint e Prettier são centrais;
- ShellCheck é fortemente justificado;
- Volar é justificado;
- YAML é justificado;
- Python merece perfil especializado, mas não precisa estar no baseline Node;
- PowerShell é útil, porém o footprint de ~302 MiB e apenas 5 `.ps1` rastreados favorecem um perfil
  Windows/PowerShell sob demanda;
- ferramentas Markdown são úteis, mas devem evitar duplicar funcionalidades que o VS Code atual
  incorporou, especialmente Mermaid;
- Docker é central, mas isso não exige instalar simultaneamente todas as extensões Docker
  concorrentes.

---

## 6. Avaliação das extensões `core` atuais

Legenda do estado-alvo:

- **BASELINE**: auto-install no DevContainer;
- **RECOMMENDED**: recomendação de workspace, sem obrigação de auto-install;
- **PROFILE**: perfil especializado/on-demand;
- **HOST/PERSONAL**: preferência local do usuário/host;
- **BUILTIN CAPABILITY**: verificar capacidade, não instalar pacote de usuário.

| Extensão                               | Situação atual | Custo/risco                                         | Benefício no repo                                                       | Estado-alvo                                           |
| -------------------------------------- | -------------- | --------------------------------------------------- | ----------------------------------------------------------------------- | ----------------------------------------------------- |
| `TypeScriptTeam.native-preview`        | core           | ~27,8 MiB; ativa em JS/TS                           | fundamental para TS7/tsgo                                               | **BASELINE**                                          |
| `dbaeumer.vscode-eslint`               | core           | startup; ~0,9 MiB                                   | lint editor integrado, configuração dedicada sem segundo projectService | **BASELINE**                                          |
| `esbenp.prettier-vscode`               | core           | startup; ~14,3 MiB                                  | formatter comprometido para JS/TS/JSON/Vue etc.                         | **BASELINE**                                          |
| `usernamehw.errorlens`                 | core           | startup                                             | excelente UX, mas cosmética                                             | **RECOMMENDED/UX**                                    |
| `ms-azuretools.vscode-containers`      | core           | lazy por Docker                                     | Dockerfile/Compose e integração Docker                                  | **BASELINE**                                          |
| `ms-vscode.makefile-tools`             | core           | workspaceContains Makefile                          | Makefile é interface operacional importante do repo                     | **BASELINE**                                          |
| `eamodio.gitlens`                      | core           | startup; ~17,6 MiB; erros de dispose observados     | histórico/blame avançado                                                | **RECOMMENDED/GIT**                                   |
| `timonwong.shellcheck`                 | core           | lazy por shell                                      | 126 scripts `.sh`                                                       | **BASELINE**                                          |
| `redhat.vscode-yaml`                   | core           | lazy por YAML                                       | workflows/configs YAML                                                  | **BASELINE**                                          |
| `EditorConfig.EditorConfig`            | core           | startup; timeout `onWillSave` observado uma vez     | padronização `.editorconfig`                                            | **BASELINE CONDICIONAL**; medir A/B                   |
| `ms-vscode.powershell`                 | core           | ~301,7 MiB, mas lazy                                | suporte forte a PS; apenas 5 `.ps1` no Git                              | **PROFILE: powershell/windows**                       |
| `MS-CEINTL.vscode-language-pack-pt-BR` | core           | baixo footprint; preferência de UI                  | não é requisito do projeto                                              | **HOST/PERSONAL**                                     |
| `Vue.volar`                            | core           | lazy                                                | 43 `.vue`                                                               | **BASELINE**                                          |
| `GitHub.copilot-chat`                  | core           | builtin no Server 1.133                             | central para fluxo de IA/Copilot                                        | **BUILTIN CAPABILITY**, não pacote remoto obrigatório |
| `github.vscode-github-actions`         | core           | ativa por workflows                                 | integração direta com CI GitHub                                         | **BASELINE**                                          |
| `GitHub.vscode-pull-request-github`    | core           | startup; ~8,9 MiB                                   | PR/issue workflow útil                                                  | **RECOMMENDED/GITHUB**                                |
| `Anthropic.claude-code`                | core           | ~329 MiB/versão; startup; rede/processos            | agente poderoso e efetivamente configurado                              | **PROFILE: agents-selected/full**                     |
| `coderabbit.coderabbit-vscode`         | core           | startup; baixo disco                                | review complementar                                                     | **PROFILE: ai-review**                                |
| `openai.chatgpt`                       | core           | ~531 MiB; startup                                   | Codex/OpenAI muito útil                                                 | **PROFILE: agents-selected/full**                     |
| `google.geminicodeassist`              | core           | ~239 MiB; startup                                   | agente/modelos Google                                                   | **PROFILE: agents-selected/full**                     |
| `HuggingFace.huggingface-vscode-chat`  | core           | baixo disco                                         | amplia providers do Copilot                                             | **PROFILE: ai-providers**                             |
| `kilocode.kilo-code`                   | core           | ~399 MiB; startup                                   | agente amplo/browser automation                                         | **PROFILE: agents-selected/full**                     |
| `sst-dev.opencode`                     | core           | extensão pequena                                    | alternativa de agente                                                   | **PROFILE: agents-selected/full**                     |
| `humao.rest-client`                    | core           | ativa em `.http`/Markdown/comandos                  | excelente para endpoints; não é requisito de build                      | **RECOMMENDED/API**                                   |
| `aaron-bond.better-comments`           | core           | startup; baixo disco                                | UX de comentários                                                       | **RECOMMENDED/UX**                                    |
| `yzhang.markdown-all-in-one`           | core           | ativa por `README.md`; hoje é formatter de Markdown | útil, mas sobrepõe builtins/Prettier                                    | **RECOMMENDED/DOCS** após migrar formatter Markdown   |
| `DavidAnson.vscode-markdownlint`       | core           | lazy por Markdown                                   | disciplina docs num repo documentalmente grande                         | **BASELINE**                                          |

### Decisão para IA

O requisito de máxima liberdade de agentes é legítimo, mas deve ser satisfeito por **perfil
explícito**, não pela definição de `core`. Proposta:

- `agents-selected`: um ou dois agentes preferidos para o ciclo corrente;
- `agents-full`: Claude + OpenAI + Gemini + Kilo + OpenCode + providers auxiliares;
- `ai-review`: CodeRabbit e ferramentas de review;
- Copilot: capability builtin do VS Code atual.

Assim, recriar o DevContainer não precisa baixar automaticamente mais de 1 GiB de agentes para
preservar a possibilidade de usá-los; o perfil `agents-full` continua sendo um comando
determinístico quando desejado.

---

## 7. Avaliação das 21 extensões opcionais atuais

| Extensão                                                     | Diagnóstico                                                    | Estado-alvo                                             |
| ------------------------------------------------------------ | -------------------------------------------------------------- | ------------------------------------------------------- |
| `PKief.material-icon-theme`                                  | preferência visual/UI; não é requisito remoto                  | **HOST/PERSONAL**                                       |
| `gruntfuggly.todo-tree`                                      | útil, mas startup e erro de dispose observado                  | **PROFILE: UX**                                         |
| `pflannery.vscode-versionlens`                               | útil em manifests, baixo custo                                 | **PROFILE: dependencies**                               |
| `bierner.markdown-preview-github-styles`                     | estética de preview                                            | **PROFILE: docs/UX**                                    |
| `tintinweb.graphviz-interactive-preview`                     | especializado e lazy                                           | **PROFILE: diagrams**                                   |
| `ryanluker.vscode-coverage-gutters`                          | ativa no startup mesmo sem cobertura sendo usada               | **PROFILE: testing**                                    |
| `docker.docker`                                              | Docker DX; ~40,8 MiB; sobreposição parcial com Container Tools | **PROFILE: docker-advanced**                            |
| `cmstead.js-codeformer`                                      | ~69,7 MiB; refactors amplamente cobertos por TS7/VS Code/IA    | **PROFILE: refactor** ou retirar se sem uso comprovado  |
| `cmstead.jsrefactor`                                         | meta-extension para CodeFormer                                 | mesma decisão do CodeFormer                             |
| `chris-noring.node-snippets`                                 | snippets, praticamente sem custo de runtime                    | **PERSONAL/optional**                                   |
| `howardzuo.vscode-npm-dependency`                            | niche; sobrepõe Version Lens/npm                               | **PROFILE**; candidato a retirar do catálogo            |
| `jasonnutter.search-node-modules`                            | comando especializado                                          | **PROFILE**                                             |
| `ms-azuretools.vscode-docker`                                | meta-extension que depende de Container Tools                  | **retirar do catálogo** se `vscode-containers` é direto |
| `ms-vscode.azure-repos`                                      | sem evidência de Azure Repos no fluxo central                  | **retirar do catálogo do repo**                         |
| `ms-vscode.vscode-github-issue-notebooks`                    | ferramenta experimental/niche                                  | **PROFILE: github-experimental**                        |
| `GitHub.github-vscode-theme`                                 | tema                                                           | **HOST/PERSONAL**                                       |
| `ms-python.python`                                           | 29 `.py`; também ativa por `.venv`/requirements                | **PROFILE: python**                                     |
| `ms-python.vscode-pylance`                                   | linguagem Python                                               | **PROFILE: python**                                     |
| `ms-python.debugpy`                                          | debug Python                                                   | **PROFILE: python**                                     |
| `streetsidesoftware.code-spell-checker`                      | instalado mas `cSpell.enabled=false`; startup                  | **PROFILE: writing**, somente se habilitado             |
| `streetsidesoftware.code-spell-checker-portuguese-brazilian` | depende do cSpell; startup                                     | **PROFILE: writing-ptbr**                               |

### Dependências transitivas observadas

Três IDs físicos não pertenciam diretamente às listas da SSOT:

- `ms-vscode.vscode-copilot-data-analysis` (~84,3 MiB): ecossistema Copilot;
- `ms-python.vscode-python-envs` (~39,1 MiB): ecossistema Python;
- `ms-vscode.test-adapter-converter` (~0,2 MiB): dependência do Test Explorer legado.

O auditor ideal deve distinguir **extensão solicitada** de **dependência transitiva** para não
acusar drift indevidamente.

---

## 8. Avaliação das 10 `hostOnly`

A classificação conceitual está correta para o objetivo deste DevContainer: extensões que
criam/selecionam transportes remotos e preferências do cliente não devem compor o toolchain remoto
do projeto.

| ID                                             | Estado observado                 | Estado-alvo       |
| ---------------------------------------------- | -------------------------------- | ----------------- |
| `ms-vscode-remote.remote-containers`           | instalado remoto; startup        | **HOST**          |
| `ms-vscode-remote.vscode-remote-extensionpack` | instalado remoto; extension pack | **HOST**          |
| `ms-vscode.remote-explorer`                    | instalado remoto                 | **HOST**          |
| `GitHub.codespaces`                            | instalado remoto                 | **HOST**          |
| `ms-vscode-remote.remote-ssh`                  | instalado remoto                 | **HOST**          |
| `ms-vscode-remote.remote-ssh-edit`             | instalado remoto                 | **HOST**          |
| `ms-vscode.remote-server`                      | instalado remoto                 | **HOST**          |
| `GitHub.remotehub`                             | instalado remoto                 | **HOST/PERSONAL** |
| `ms-vscode.remote-repositories`                | instalado remoto                 | **HOST/PERSONAL** |
| `ms-vscode-remote.remote-wsl`                  | instalado remoto; startup        | **HOST**          |

A política do repo não deve forçar `remote.extensionKind` sem necessidade; deve impedir que o
**perfil do DevContainer** seja usado como mecanismo para instalar ferramentas de conexão ao próprio
DevContainer.

---

## 9. Reclassificação das 34 `unwanted`

O maior problema não é a lista em si, mas o fato de `--prune` tratar todos os itens como removíveis.
A lista deve ser dividida em três conjuntos.

### 9.1. `blocked/prunable`: conflito, legado ou redundância objetiva

Recomendação de manter como removíveis do ambiente remoto do repo:

- `christian-kohler.path-intellisense` — activation `*`; redundante com IntelliSense/TS7;
- `christian-kohler.npm-intellisense` — observado ativando junto com TS7 em JavaScript;
- `hbenl.vscode-test-explorer` — camada legada de Test Explorer + converter;
- `mhutchie.git-graph` — activation `*`; VS Code atual possui Source Control Graph builtin;
- `ZainChen.json` — JSON language features são builtin;
- `MermaidChart.vscode-mermaid-chart` — Mermaid passou a ser builtin no VS Code atual;
- `bierner.markdown-mermaid` — funcionalidade incorporada ao VS Code como
  `vscode.mermaid-markdown-features`;
- `ms-vscode.node-debug`;
- `ms-vscode.node-debug2`;
- `eg2.vscode-npm-script`;
- `octref.vetur` — redundante/inadequado diante do Volar;
- `formulahendry.auto-close-tag`;
- `formulahendry.auto-rename-tag`;
- `CoenraadS.bracket-pair-colorizer`;
- `CoenraadS.bracket-pair-colorizer-2`;
- `2gua.rainbow-brackets`;
- `ms-vscode.vscode-typescript-tslint-plugin`;
- `standard.vscode-standard` — compete com ESLint canônico;
- `dbaeumer.jshint` — compete com ESLint canônico;
- `HookyQR.beautify`;
- `esbenp.beautify` — competem com Prettier;
- `ms-vscode.live-server` e `ritwickdey.LiveServer` — desnecessários no fluxo Vite/Integrated
  Browser do repo.

### 9.2. `notRecommended`, mas **não podar automaticamente**

Ferramentas que podem ser redundantes ou pouco adequadas ao repo, mas não são suficientemente
problemáticas para o reconciliador removê-las sem escolha do usuário:

- `vscjava.migrate-java-to-azure`;
- `DotJoshJohnson.xml`;
- `fabiospampinato.vscode-highlight`;
- `wix.vscode-import-cost`;
- `formulahendry.code-runner`;
- `rangav.vscode-thunder-client`.

### 9.3. Preferência pessoal: retirar de `unwanted` e de qualquer prune

- `oderwat.indent-rainbow`;
- `alefragnani.Bookmarks`;
- `ms-vscode.sublime-keybindings`;
- `ms-vscode.atom-keybindings`;
- `vscodevim.vim`.

Essas extensões podem ser indesejáveis **para um perfil específico**, mas o repo não deveria
tratá-las como resíduos removíveis. Em particular, Indent Rainbow tem custo real porque declara
activation `*`, mas também oferece uma informação visual que as guias nativas não reproduzem
exatamente. O estado-alvo é **UX opt-in**, não core e não bloqueado.

---

## 10. O caso específico de `oderwat.indent-rainbow`

### Estado atual do Git

Antes desta auditoria, `.vscode/extensions.json` já estava modificado para:

- adicionar `oderwat.indent-rainbow` a `recommendations`;
- removê-lo de `unwantedRecommendations`.

A SSOT (`config/vscode/extensions.mjs`) continuou classificando-o como `unwanted`. Consequentemente:

- `node scripts/check-vscode-extensions.js` acusa drift;
- `node scripts/setup/sync-vscode-extensions.mjs` acusa drift;
- um futuro `npm run vscode:sync` voltaria a projetar a decisão da SSOT.

### Recomendação

O melhor compromisso não é escolher um dos extremos atuais. A extensão deve passar a um perfil
`ux`/`personal`:

- **não** auto-instalar no DevContainer;
- **não** entrar na lista de bloqueio/prune;
- permitir instalação explícita por perfil ou configuração pessoal;
- medir seu impacto via Runtime Status/Extension Bisect se houver regressão de edição.

---

## 11. Estado-alvo do catálogo

### 11.1. Perfis propostos

```text
baseline
├─ TypeScript 7
├─ ESLint
├─ Prettier
├─ Container Tools
├─ Makefile Tools
├─ ShellCheck
├─ YAML
├─ EditorConfig (condicional/monitorado)
├─ Volar
├─ GitHub Actions
└─ markdownlint

recommended
├─ Error Lens
├─ GitLens
├─ GitHub PR/Issues
├─ REST Client
└─ Better Comments

agents-selected
└─ um subconjunto explícito escolhido no ciclo atual

agents-full
├─ Claude Code
├─ OpenAI Codex
├─ Gemini Code Assist
├─ Kilo Code
├─ OpenCode
├─ HuggingFace provider
└─ CodeRabbit (ou subperfil ai-review)

python
├─ Python
├─ Pylance
└─ debugpy

powershell
└─ PowerShell

docs
├─ Markdown All in One
├─ Markdown GitHub Preview
├─ cSpell
└─ pt-BR dictionary

docker-advanced
└─ Docker DX

ux/personal
├─ Indent Rainbow
├─ Material Icon Theme
├─ Todo Tree
├─ themes/keybindings/Vim/Bookmarks etc.
└─ language pack pt-BR
```

### 11.2. Separar projeções

A SSOT deve deixar de fazer:

```js
VSCODE_RECOMMENDED_EXTENSIONS = VSCODE_DEVCONTAINER_EXTENSIONS
```

E passar conceitualmente a expor algo como:

```js
VSCODE_DEVCONTAINER_AUTO_EXTENSIONS
VSCODE_WORKSPACE_RECOMMENDATIONS
VSCODE_PROFILE_EXTENSIONS
VSCODE_HOST_EXTENSIONS
VSCODE_NOT_RECOMMENDED_EXTENSIONS
VSCODE_PRUNABLE_EXTENSIONS
```

O nome exato pode variar; a separação semântica é o requisito.

---

## 12. Proposta para `.vscode/extensions.json`

Após a refatoração da SSOT e dos settings associados, a proposta **mínima e rigorosa** é:

```jsonc
{
  "recommendations": [
    "TypeScriptTeam.native-preview",
    "dbaeumer.vscode-eslint",
    "esbenp.prettier-vscode",
    "ms-azuretools.vscode-containers",
    "ms-vscode.makefile-tools",
    "timonwong.shellcheck",
    "redhat.vscode-yaml",
    "EditorConfig.EditorConfig",
    "Vue.volar",
    "github.vscode-github-actions",
    "DavidAnson.vscode-markdownlint"
  ],
  "unwantedRecommendations": [
    "christian-kohler.path-intellisense",
    "christian-kohler.npm-intellisense",
    "hbenl.vscode-test-explorer",
    "mhutchie.git-graph",
    "ZainChen.json",
    "MermaidChart.vscode-mermaid-chart",
    "bierner.markdown-mermaid",
    "ms-vscode.node-debug",
    "ms-vscode.node-debug2",
    "eg2.vscode-npm-script",
    "octref.vetur",
    "formulahendry.auto-close-tag",
    "formulahendry.auto-rename-tag",
    "CoenraadS.bracket-pair-colorizer",
    "CoenraadS.bracket-pair-colorizer-2",
    "2gua.rainbow-brackets",
    "ms-vscode.vscode-typescript-tslint-plugin",
    "standard.vscode-standard",
    "dbaeumer.jshint",
    "HookyQR.beautify",
    "esbenp.beautify",
    "ms-vscode.live-server",
    "ritwickdey.LiveServer"
  ]
}
```

### Observações

1. Essa lista é deliberadamente pequena. Recomendações de workspace devem ser
   **projeto-específicas**, não uma réplica de preferências pessoais.
2. Agentes de IA continuam disponíveis por perfis determinísticos, mas não são requisitos universais
   do código.
3. `GitHub.copilot-chat` deve ser tratado como capability builtin no VS Code atual; se o projeto
   decidir suportar versões antigas do editor, pode haver uma regra de compatibilidade separada.
4. `yzhang.markdown-all-in-one` sai do baseline somente depois de mudar
   `[markdown].editor.defaultFormatter` para Prettier ou outra solução escolhida. Enquanto a
   configuração atual persistir, removê-lo do baseline quebraria uma dependência declarativa dos
   settings.
5. `EditorConfig.EditorConfig` é mantido provisoriamente no baseline. O timeout observado justifica
   um A/B antes de decidir se Prettier + settings nativos já tornam a extensão dispensável.
6. `oderwat.indent-rainbow` não aparece nem em `recommendations` nem em `unwantedRecommendations`:
   deve pertencer ao perfil UX/pessoal.

---

## 13. Proposta para `.devcontainer/devcontainer.json`

O array `customizations.vscode.extensions` deveria projetar apenas
`VSCODE_DEVCONTAINER_AUTO_EXTENSIONS`, idealmente o baseline de ~86 MiB acima.

Isso atende à semântica correta do DevContainer: extensões que devem estar **dentro do container**
por necessidade do projeto. Agentes pesados, temas, language packs e transportes Remote não precisam
estar nessa lista para continuarem disponíveis ao usuário.

### Não usar `remote.extensionKind` como correção geral

O VS Code já escolhe local vs remoto com base no manifesto da extensão. `remote.extensionKind` deve
ser exceção de compatibilidade/teste, não mecanismo para compensar um catálogo mal classificado.

---

## 14. Ajustes associados em `.vscode/settings.json`

Não foram aplicados nesta auditoria, mas o estado-alvo exige revisar settings junto com a política
de extensões.

### 14.1. Markdown

Hoje:

```jsonc
"[markdown]": {
  "editor.defaultFormatter": "yzhang.markdown-all-in-one"
}
```

Se Markdown All in One deixar o baseline, mudar para Prettier ou para a política de formatação
escolhida antes de remover a extensão.

### 14.2. cSpell

Hoje:

```jsonc
"cSpell.enabled": false,
"cSpell.language": "en,pt-BR"
```

Não faz sentido auto-provisionar cSpell e dicionário pt-BR enquanto o próprio workspace o mantém
desativado. Ou o perfil `writing` o habilita explicitamente, ou as extensões não devem ser parte do
ambiente padrão.

### 14.3. GitLens

Já há mitigação útil:

```jsonc
"gitlens.codeLens.enabled": false,
"gitlens.currentLine.enabled": false
```

Ainda assim GitLens declara `onStartupFinished` e teve erro de dispose nos logs. Manter como
recommended/opt-in é mais coerente do que core.

### 14.4. IA e confiança

O workspace compromete atualmente:

```jsonc
"chat.tools.global.autoApprove": true,
"chat.tools.terminal.enableAutoApprove": true,
"chat.tools.terminal.ignoreDefaultAutoApproveRules": true,
"chat.tools.terminal.blockDetectedFileWrites": "never",
"chat.agent.sandbox.enabled": "off",
"claudeCode.allowDangerouslySkipPermissions": true,
"claudeCodeChat.permissions.yoloMode": true,
"github.copilot.chat.claudeAgent.allowDangerouslySkipPermissions": true
```

Esse é um **perfil de autonomia máxima**, não uma configuração neutra de projeto. O estado-alvo deve
movê-lo para um perfil explicitamente nomeado — por exemplo `high-autonomy-personal` — ou para
Remote/User Settings não compartilhados, mantendo no Git apenas as capacidades que o repositório
realmente exige.

A razão é estrutural: extensões no Extension Host executam com privilégios do processo do VS Code e
podem ler/escrever arquivos, executar processos e fazer rede. Quanto maior o conjunto de agentes de
terceiros simultaneamente instalado e quanto menores os gates de aprovação, maior a superfície de
confiança. Isso não proíbe autonomia; exige que a autonomia seja **deliberada, visível e
reversível**.

---

## 15. Robustez dos scripts de instalação e auditoria

### 15.1. Corrigir `--strict-runtime`

Estado atual: se `code --list-extensions` falha, o checker omite o runtime e pode não falhar por
isso.

Estado-alvo:

- `--strict-runtime` deve retornar código != 0 se a observação de runtime não estiver disponível;
- modo não estrito pode continuar degradando para warning.

### 15.2. Fallback de inventário sem IPC

O runtime helper deve tentar, em ordem:

1. `code --list-extensions --show-versions` quando IPC estiver saudável;
2. registro físico `~/.vscode-server/extensions/extensions.json`;
3. manifests de `~/.vscode-server/extensions/*/package.json` para diagnóstico/recovery.

A etapa 2 é particularmente útil quando a shell preservou `VSCODE_IPC_HOOK_CLI` de uma janela que já
morreu.

### 15.3. Descoberta de builtins

Não depender exclusivamente de `VSCODE_CWD`. Inferir a instalação ativa a partir de:

- `readlink -f $(command -v code)`;
- subir de `.../bin/remote-cli/code` até a raiz do server;
- ler `<server-root>/extensions/*/package.json`.

### 15.4. Dependências transitivas

O checker deve classificar IDs extras como:

- `direct`;
- `builtin`;
- `dependency`/`extensionPack` transitiva;
- `host leakage`;
- `unknown`.

“Extra” não deve significar automaticamente “resíduo”.

### 15.5. Snapshot para disaster recovery

Não transformar versões de extensão em lock permanente do toolchain. Em vez disso, criar futuramente
um **snapshot datado de recuperação**, contendo:

- ID;
- versão;
- target platform;
- origem (`builtin`, user, transitive);
- data da captura;
- VS Code Server commit.

Esse snapshot é evidência/recovery, não SSOT de provisionamento.

---

## 16. Como reinstalar todas as extensões — procedimento futuro

> **Nada desta seção foi executado durante a auditoria.** É um runbook para uso posterior.

### 16.1. Pré-condição: recuperar a CLI remota

Hoje `code --list-extensions` falha com socket IPC inexistente. Antes de reinstalar:

1. `Developer: Reload Window`, ou
2. fechar/reabrir a janela no DevContainer, e
3. confirmar:

```bash
code --status
code --list-extensions --show-versions
```

Não iniciar reinstalação se a CLI ainda estiver presa a um socket morto.

### 16.2. Capturar snapshot exato antes de qualquer remoção

Quando a CLI estiver saudável:

```bash
mkdir -p .tmp/vscode-recovery
code --list-extensions --show-versions \
  > .tmp/vscode-recovery/extensions-remote-$(date +%Y%m%d-%H%M%S).txt
```

Para um snapshot independente da CLI em caso de emergência, o registro remoto atual existe em:

```text
~/.vscode-server/extensions/extensions.json
```

Ele deve ser lido/copiado para backup, não editado manualmente.

### 16.3. Ver o plano canônico sem instalar

```bash
node scripts/setup/install-vscode-extensions.mjs core --dry-run
```

Após a futura refatoração dos perfis, usar o perfil correspondente (`baseline`, `agents-full`,
`python`, etc.).

### 16.4. Reinstalar o baseline canônico

Com a arquitetura atual:

```bash
npm run vscode:extensions:core
```

No estado-alvo, esse comando deveria equivaler ao baseline mínimo, e perfis adicionais seriam
explícitos.

### 16.5. Reinstalar perfis atuais opcionais

Enquanto os scripts atuais existirem:

```bash
npm run vscode:extensions:optional
npm run vscode:extensions:python
```

Não usar `optional` indiscriminadamente no estado-alvo; ele deve ser substituído por perfis menores.

### 16.6. Restauração exata por versão

Dado um snapshot produzido por `--show-versions`:

```bash
while IFS= read -r extension; do
  [ -n "$extension" ] || continue
  code --install-extension "$extension" --force
done < .tmp/vscode-recovery/extensions-remote-YYYYMMDD-HHMMSS.txt
```

A CLI do VS Code aceita `publisher.extension@version`. Esse é o caminho para recovery fiel. Para
operação normal, prefira versões correntes compatíveis em vez de manter pin permanente.

### 16.7. Atualizar extensões instaladas

```bash
code --update-extensions
```

Depois, recarregar a janela e verificar Runtime Status.

### 16.8. Rebuild do DevContainer

Para reconstrução determinística do conjunto auto-install:

1. capturar snapshot;
2. confirmar que a SSOT/projeções estão corretas;
3. executar `Dev Containers: Rebuild Container`;
4. aguardar auto-install de `customizations.vscode.extensions`;
5. instalar perfis adicionais explicitamente.

### 16.9. Não usar `rm -rf ~/.vscode-server/extensions` como manutenção ordinária

Se houver corrupção real, fazer procedimento de recuperação controlado, de preferência:

- fechar Extension Hosts conectados;
- registrar o inventário;
- usar uninstall/reinstall oficial;
- reiniciar o servidor remoto;
- só recorrer a quarentena/rename do diretório como último recurso e com rollback.

Diretórios de versões antigas após auto-update podem desaparecer após reload/cleanup normal; a
simples presença física de duas versões não é motivo suficiente para apagar manualmente.

### 16.10. Extensões host-only

Remote - Containers, WSL, SSH, Remote Explorer e afins devem ser instaladas no **VS Code
local/host** quando necessárias, não provisionadas pelo perfil remoto do repo.

---

## 17. Reconciliação futura: sequência segura

Depois de implementar a nova semântica de categorias:

1. **Static check**
   ```bash
   npm run vscode:sync:check
   npm run vscode:check
   ```
2. **Inventory snapshot**.
3. **Dry-run do reconciliador**.
4. Conferir manualmente cada item da classe `prunable`.
5. Só então aplicar remoções.
6. Recarregar Extension Host.
7. Executar `vscode:check:runtime` em modo fail-closed.
8. Abrir JS, Vue, Markdown, YAML, Shell e Dockerfile para validar activation/language servers.
9. Usar `Developer: Show Running Extensions`/Runtime Status para tempos de ativação.
10. Se houver regressão de editor, usar **Extension Bisect**, não remoção aleatória.

---

## 18. Métricas e SLOs propostos

### Provisionamento

- baseline remoto auto-install: **< 150 MiB** de footprint instalado; alvo atual calculado ~86 MiB;
- nenhum agente de IA pesado auto-instalado sem perfil explícito;
- nenhuma extensão host-only no perfil do DevContainer;
- zero extensões `blocked` após reconciliação concluída.

### Integridade

- `vscode:sync:check`: verde;
- `vscode:check:runtime --strict-runtime`: verde **somente se runtime foi de fato observado**;
- zero drift manual em arquivos gerados;
- builtins corretamente reconhecidos sem depender de `VSCODE_CWD`.

### Runtime

- extensões `*` não essenciais no baseline: **zero**;
- extensões `onStartupFinished` no baseline: apenas as indispensáveis e medidas;
- nenhum Extension Host timeout recorrente atribuído a baseline;
- qualquer extensão com warning/error recorrente recebe A/B antes de permanecer baseline.

### Recovery

- snapshot de extensões disponível antes de mudanças grandes/rebuilds;
- reinstalação canônica e reinstalação por versão documentadas e testáveis;
- sem manutenção por deleção cega de diretórios.

---

## 19. Cache de VS Code Server — domínio associado, mas separado

Foram encontrados **29 builds stable do VS Code Server**, totalizando cerca de **10,4 GiB**, além de
um build Insiders (~233 MiB).

Esse footprint é muito maior que o próprio conjunto de extensões e pode ser confundido com “peso das
extensões”. O estado-alvo deve ter uma política de retenção separada, por exemplo:

- manter build ativo;
- manter um pequeno número de builds recentes para rollback;
- nunca remover o build em uso;
- fazer dry-run e verificar processos/sessões antes de limpeza;
- tratar Stable e Insiders separadamente.

Não houve limpeza nesta auditoria.

---

## 20. Documentação existente que ficou obsoleta

### `.vscode/EXTENSIONS_REPORT.md`

Datado de 2026-01-21. Hoje contém números e IDs históricos, como 24 recomendadas, 10 instaladas,
`ms-azuretools.vscode-docker` como Docker central e `GitHub.copilot` separado. Não representa o
estado corrente.

### `.vscode/EXTENSIONS_SETUP.md`

Datado de 2026-01-22. Além de números antigos, contém contradições internas:

- declara Indent Rainbow removida/problemática;
- depois declara “ADICIONADA DE VOLTA”;
- em outra seção volta a dizer que não é necessária;
- classifica `node-debug2` como deprecated e posteriormente recomenda instalá-la para debugging.

### Estado-alvo documental

Depois que a política nova for implementada:

- este documento passa a ser o diagnóstico/roadmap histórico datado;
- criar um runbook curto e canônico, gerado/validado a partir da SSOT;
- arquivar ou substituir os dois documentos de janeiro para evitar instruções conflitantes.

---

## 21. Roadmap recomendado — nenhuma etapa executada ainda

### Fase 0 — preservar e medir

- preservar a alteração pré-existente em `.vscode/extensions.json` até decisão explícita;
- recuperar IPC da CLI e capturar inventário versionado;
- medir Runtime Status de baseline e agentes;
- confirmar se diretórios antigos do Claude são coletados após reload normal.

### Fase 1 — corrigir semântica da SSOT

- separar auto-install, recommendation, profile, host, not-recommended e prunable;
- reclassificar Indent Rainbow como UX/pessoal;
- impedir `--prune` de remover preferências pessoais;
- tratar builtins/transitivos explicitamente.

### Fase 2 — endurecer auditoria/recovery

- `strict-runtime` fail-closed;
- fallback físico quando `code` IPC falhar;
- descoberta robusta do server root/builtins;
- snapshot de recovery com versões/target platform/server commit;
- relatório de diretórios físicos obsoletos separado do estado lógico instalado.

### Fase 3 — reduzir baseline

- projetar somente baseline no DevContainer;
- mover PowerShell, language pack, GitLens, Error Lens e helpers para perfis;
- migrar o formatter Markdown antes de retirar Markdown All in One do baseline;
- criar perfis de agentes (`selected` e `full`).

### Fase 4 — reconciliação controlada

- snapshot;
- dry-run;
- remover apenas `prunable` + host leakage remoto;
- validar linguagens e extensões de runtime;
- nunca apagar diretórios diretamente como primeira opção.

### Fase 5 — segurança e autonomia

- separar “capacidade instalada” de “autorização automática”;
- mover o perfil de autonomia máxima para configuração explicitamente pessoal/remota ou perfil
  nomeado;
- manter o repo compartilhável sem implicitamente desligar gates para qualquer clone confiado.

### Fase 6 — documentação e cache

- substituir docs de janeiro;
- documentar reinstalação canônica/exata;
- criar política separada de retenção dos 29 builds do VS Code Server.

---

## 22. Prioridades finais

### P0 — correção arquitetural

1. separar as semânticas da SSOT;
2. corrigir `strict-runtime` e builtins;
3. resolver o drift de `extensions.json` na SSOT, não editando a projeção à mão;
4. retirar `unwanted` pessoal da classe podável.

### P1 — custo/runtime

1. baseline mínimo;
2. agentes em perfis;
3. PowerShell sob demanda;
4. cSpell somente quando habilitado;
5. remover redundâncias comprovadas (Mermaid, npm/path IntelliSense, legacy Test Explorer, Git Graph
   se a UI builtin for suficiente ao fluxo).

### P1 — segurança

Separar o perfil de auto-approve/yolo do arquivo de configuração compartilhado. A autonomia pode
continuar máxima para o operador que a deseja, mas deve ser **explícita e local**, não uma
propriedade implícita de qualquer clone do repo.

### P2 — higiene

1. retenção de versões antigas de extensões;
2. retenção de VS Code Server builds;
3. documentação antiga.

---

## 23. Fontes oficiais consultadas

As conclusões de estado do repo vêm primariamente dos próprios arquivos/manifests/logs. Para
semântica do VS Code, foram consultadas fontes oficiais:

- Visual Studio Code — **Extension Marketplace / Workspace recommended extensions**:
  `https://code.visualstudio.com/docs/configure/extensions/extension-marketplace`
- Visual Studio Code — **Developing inside a Container / Managing extensions**:
  `https://code.visualstudio.com/docs/devcontainers/containers`
- Visual Studio Code Extension API — **Extension Host**:
  `https://code.visualstudio.com/api/advanced-topics/extension-host`
- Visual Studio Code — **Command Line Interface / Working with extensions**:
  `https://code.visualstudio.com/docs/configure/command-line`
- Visual Studio Code — **Extension runtime security**:
  `https://code.visualstudio.com/docs/configure/extensions/extension-runtime-security`
- Visual Studio Code — **Source Control Graph**:
  `https://code.visualstudio.com/docs/sourcecontrol/overview`
- Visual Studio Code 1.121 — **Mermaid builtin**: `https://code.visualstudio.com/updates/v1_121`
- Visual Studio Code — **Markdown / Mermaid rendering**:
  `https://code.visualstudio.com/docs/languages/markdown`
- Visual Studio Code — **Extension Bisect**:
  `https://code.visualstudio.com/blogs/2021/02/16/extension-bisect`
- Visual Studio Code — **Iterating faster with TypeScript 7**:
  `https://code.visualstudio.com/blogs/2026/06/26/iterating-faster-with-ts-7`

---

## 24. Conclusão

O workspace não precisa escolher entre **máxima funcionalidade** e **disciplina arquitetural**. A
situação ideal é mais sofisticada: um baseline pequeno, previsível e rigoroso; perfis ricos que
devolvem em um comando toda a liberdade de IA, Python, PowerShell, Docker avançado ou UX; host e
preferências pessoais fora do runtime remoto; e um reconciliador que só remove aquilo que é
objetivamente seguro remover.

A maior melhoria não virá de “desinstalar muitas extensões”, e sim de **tornar a intenção
explícita**. Hoje uma mesma lista tenta responder a perguntas diferentes — o que instalar, o que
recomendar, o que considerar obrigatório e o que remover. Separadas essas perguntas, o custo cai, a
segurança melhora, a reinstalação fica determinística e a liberdade do operador aumenta em vez de
diminuir.

**Nenhuma das mudanças propostas acima foi aplicada nesta auditoria.** O próximo passo, quando
autorizado, deve começar pela Fase 0/Fase 1 e por planos/dry-runs, preservando o working tree atual
e a alteração pré-existente em `.vscode/extensions.json`.
