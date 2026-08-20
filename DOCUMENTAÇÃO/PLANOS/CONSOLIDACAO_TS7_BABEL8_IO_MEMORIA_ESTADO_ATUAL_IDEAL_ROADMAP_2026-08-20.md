# Consolidação TS7, Babel 8, I/O e memória — estado atual, estado ideal e roadmap

**Data de referência:** 20 de agosto de 2026  
**Workspace:** `chatgpt-docker-puppeteer`  
**Foco operacional:** `src/copilot`, com governança e validação em todo o workspace  
**Commit-base da consolidação:** `1f75d14a6a4d19472002bea964c889770819d1bb` —
`refactor: consolidate TS7 Babel and Copilot IO architecture`  
**Momento deste documento:** pós-commit/push, pré-rebuild do DevContainer

---

## 1. Resumo executivo

O workspace encerra esta rodada em um estado arquitetural substancialmente mais rigoroso do que o
ponto de partida. O eixo central da transformação foi remover sobreposições e exceções históricas
entre TypeScript, Babel, I/O, VS Code e tooling, transformando convenções implícitas em contratos
executáveis.

A situação atual pode ser sintetizada assim:

- **TypeScript 7.0.2 GA é o compilador, API semântica e language server canônicos.** Não há código
  first-party usando TS6; TS6 permanece somente como ilha de compatibilidade de peer do
  `typescript-eslint`.
- **Babel 8 é o parser estrutural canônico para análise sintática first-party.** O lockfile não
  contém nenhum pacote `@babel/*` anterior à major 8.
- **Babel e TS7 têm responsabilidades separadas.** Babel executa parsing/AST estrutural, grafos,
  símbolos e auditorias estáticas; TS7 executa type semantics, diagnostics, strictness e LSP. Foi
  eliminada a duplicação first-party em que analisadores internos carregavam a API do TypeScript
  apenas para tarefas sintáticas.
- **Madge foi removido.** O grafo de dependências usa Babel + resolução Node/ESM + Tarjan, falha
  fechado em parse error e import local não resolvido e está atualmente em zero ciclos.
- **O I/O de `src/copilot` foi consolidado como subsistema governado.** Escrita atômica, durability,
  fsync, metadata, append, JSONL, copy/move/delete, rollback, fresh reads, cache, invalidation e
  watchers passaram a compartilhar primitives e contratos explícitos.
- **A dívida transitória de acesso direto a filesystem chegou a zero.** Os acessos low-level
  restantes são classificados e protegidos por guards AST executados em CI.
- **A superfície privilegiada `trusted-io` passou a ser fail-closed.** Importadores e caller IDs são
  governados por manifesto e auditor AST.
- **Prettier e ESLint voltaram a ter ownership bem definido.** `prettier-plugin-jsdoc` foi removido
  porque alterava semântica JSDoc; `eslint-config-prettier` passou a participar efetivamente do flat
  config; o formatter não carrega mais `dockerfmt` WASM em fenced blocks Markdown.
- **Os quatro gates solicitados para publicação estão verdes:** typecheck strict completo, lint
  completo, unit tests Copilot e Prettier integral.
- **A configuração do próximo DevContainer está pronta, mas o runtime atual ainda é antigo.** O novo
  volume `devcontainer-vscode-server-ts7-v1`, a baseline de 11 extensões e os limites do TS7 só
  serão provados plenamente depois do rebuild.
- **A principal dívida operacional atual é o VS Code server antigo.** O processo de extension host
  está em ~3,05 GiB PSS, ainda há Gemini/Kilo ativos, há ~916 MiB de swap no cgroup e a sessão TS7
  voltou a acumular falhas de watcher após horas de uso, embora o CLI TS7 permaneça semanticamente
  verde.

A conclusão arquitetural é clara: **a próxima ação de maior retorno é o rebuild controlado do
DevContainer, seguido por uma prova pós-rebuild rigorosa e comparativa**. Não há justificativa para
fazer novas grandes mudanças de código antes dessa prova; o próximo risco relevante é operacional,
não estrutural.

---

## 2. Metodologia e princípios adotados

A rodada seguiu cinco princípios.

### 2.1. Uma responsabilidade canônica por classe de problema

- **TS7:** tipos, diagnostics, type relationships, project model e LSP.
- **Babel 8:** parsing estrutural, AST, imports/exports, outline e análise sintática.
- **Node 24+:** resolução/runtime/filesystem/process primitives.
- **I/O engine:** leitura, escrita, cache, policy, locks, durability, invalidation e
  observabilidade.
- **Prettier:** apresentação textual, sem reinterpretar semântica JSDoc.
- **ESLint:** regras semânticas, de qualidade e de arquitetura, sem competir com decisões de
  formatação do Prettier.

### 2.2. Fail-closed em vez de best-effort silencioso

Quando uma análise estrutural não consegue conhecer o programa com integridade, o resultado não é
considerado limpo. Isso agora vale para:

- parse error no grafo;
- import local não resolvido;
- novo bypass de filesystem;
- novo import privilegiado de `trusted-io` sem policy/caller estático;
- reintrodução first-party de TS6;
- reintrodução de Madge/TS5.

### 2.3. Estado parcialmente aplicado é diferente de operação não executada

Uma mutação que já alterou bytes ou namespace e falhou na barreira posterior de durability não pode
ser tratada como se nunca tivesse ocorrido. Por isso, as primitives passaram a transportar
`mutationApplied`, fase e paths afetados, e as camadas de MCP/rollback passam a orientar
`inspect-before-retry`.

### 2.4. Leitura cacheável e leitura fresh são semânticas diferentes

Foram formalizados quatro quadrantes:

1. **workspace-cached:** conteúdo estável do workspace com L1/L2/fingerprint;
2. **workspace-fresh:** containment do workspace, mas snapshot físico sem cache para conteúdo
   alterável externamente;
3. **trusted-fresh:** state/secrets/config operacional fora ou além do containment normal;
4. **system/probe:** `/proc`, cgroup, processos e outros probes cuja freshness física é parte da
   própria operação.

### 2.5. Validação final sobre o estado formatado

Os gates finais foram executados depois do full-format. Isso evita a falsa garantia de validar um
estado e publicar outro.

---

## 3. TypeScript 7: estado consolidado

### 3.1. Engine canônica

A engine canônica é:

- `@typescript/native@7.0.2`;
- CLI/typecheck: TS7;
- Native API: TS7;
- LSP server: `tsc --lsp`, TS7.0.2.

O baseline executável reporta:

```text
TypeScript baseline: OK
canonical: TypeScript 7.0.2 via @typescript/native
compatibility: @typescript/typescript6@6.0.2
forbidden majors: none below 6
first-party TS6 imports: 0
internal TS6 compatibility adapter: absent
Madge: absent
```

### 3.2. Por que TS6 ainda aparece no `node_modules`

O pacote raiz `typescript` ainda é uma alias de compatibilidade para
`@typescript/typescript6@6.0.2`. Isso existe exclusivamente porque `typescript-eslint@8.67.0`
declara peer range:

```text
>=4.8.4 <6.1.0
```

Remover ou forçar essa ilha agora produziria um grafo de peers formalmente incorreto. A política
correta é **não usar TS6 em código first-party e removê-lo somente quando o upstream aceitar TS7**.

### 3.3. O ID `TypeScriptTeam.native-preview`

O nome é historicamente enganoso. O workspace não usa um compilador TypeScript preview. No VS Code
atual, o builtin JS/TS ainda é cliente do `tsserver.js`; ao ativar
`js/ts.experimental.useTsgo=true`, o builtin entrega a responsabilidade ao cliente LSP externo cujo
Marketplace ID histórico continua sendo `TypeScriptTeam.native-preview`.

A função atual dessa extensão é, portanto:

```text
VS Code client bridge -> tsc --lsp 7.0.2 GA
```

Ela deve permanecer somente até a versão de VS Code utilizada incorporar o cliente LSP nativo. O
auditor `scripts/analysis/typescript-lsp-health.mjs` já identifica o processo pelo protocolo/engine
e não depende conceitualmente do nome da extensão, preparando a remoção futura.

### 3.4. Divergência CLI x LSP investigada

O `TS2724` persistente observado no editor não era um erro do compilador. A comparação isomórfica
mostrou:

- `tsc7 -p src/copilot/tsconfig.json`: zero erros;
- mesmo projeto lógico no LSP;
- sessão antiga do Native Preview com falhas de registro de watchers;
- restart completo da sessão LSP eliminou temporariamente o diagnóstico stale;
- `GOMEMLIMIT=1024MiB` passou a ser efetivamente aplicado somente depois de reinicializar a sessão
  da extensão, não apenas matar o processo filho.

A investigação pós-sync mostrou, contudo, que a sessão longa atual voltou a registrar:

```text
watcher failures: current=21, total-log=50
```

Ao mesmo tempo:

```text
TS7 server/workspace: 7.0.2 / 7.0.2
GOMEMLIMIT: 1024MiB
exact project CLI: OK
```

Portanto a dívida restante é **estabilidade de longo prazo da sessão VS Code/LSP**, não correção
semântica do projeto. O rebuild com novo VS Code server volume é a próxima prova correta.

---

## 4. Babel 8: estado consolidado e relação com TS7

### 4.1. Inventário atual

O lockfile contém os seguintes pares `@babel/*` efetivos:

```text
@babel/code-frame@8.0.0
@babel/generator@8.0.0
@babel/helper-globals@8.0.0
@babel/helper-string-parser@8.0.0
@babel/helper-validator-identifier@8.0.4
@babel/parser@8.0.4
@babel/template@8.0.0
@babel/traverse@8.0.4
@babel/types@8.0.4
```

**Pacotes `@babel/*` anteriores à major 8: 0.**

Parser/traverse/types são deduplicados em 8.0.4 também para consumidores do dashboard/Vue.
Generator/template/helpers estão em 8.0.0, ainda dentro da major 8. Não há necessidade técnica de
instalar plugins Babel adicionais apenas por precaução: cada plugin futuro deve responder a uma
sintaxe concreta que o parser atual não cubra.

### 4.2. Divisão de responsabilidades Babel 8 x TS7

O estado-alvo adotado não tenta “sincronizar dois parsers fazendo o mesmo trabalho”. Ele evita
justamente o trabalho duplo:

| Classe                           | Engine canônica                    |
| -------------------------------- | ---------------------------------- |
| Parse JS/TS/JSDoc estrutural     | Babel 8                            |
| Imports/exports/símbolos/outline | Babel 8 + policy canônica          |
| Grafo de dependências            | Babel 8 + Node resolution + Tarjan |
| Cobertura e qualidade JSDoc      | Babel 8                            |
| Tipos e relações semânticas      | TS7                                |
| Strict typecheck                 | TS7                                |
| Diagnostics de projeto           | TS7                                |
| Language server                  | TS7 LSP                            |

O antigo `typescript-compat.mjs`, que carregava TS6 em analisadores first-party, foi removido.

### 4.3. Prova de paridade JSDoc

Antes de retirar a engine antiga, o novo parser Babel foi comparado contra um snapshot TS6. A prova
final abrangeu:

- 1.528 arquivos comuns não modificados;
- 10.612 símbolos exportados;
- zero divergências de métricas;
- zero divergências nos campos semânticos comparados.

Foram adicionadas fixtures para os casos que mais facilmente divergiam:

- `@typedef` / `@property`;
- nested `@param`;
- comentários JSDoc compactos;
- overload ordering;
- parâmetros default parentetizados.

Isso transforma a retirada da API TS6 interna em uma migração comprovada, não aproximativa.

---

## 5. Grafo de dependências e arquitetura estática

Madge foi removido do runtime, package graph, scripts e tipos ativos.

O analisador canônico agora usa:

```text
Babel parser/policy
    -> resolução Node/ESM/#imports
    -> grafo de módulos
    -> Tarjan SCC
    -> relatório/CI/audit
```

Estado pós-sync:

```text
root=src
files=1685
edges=5131
circular dependency components: none
```

Além de ciclos, a CLI falha com exit `2` quando há:

- parse errors;
- imports locais não resolvidos.

O audit collector converte essas condições em findings P1. Assim, um grafo incompleto não pode
aparecer como “verde”.

---

## 6. Consolidação profunda do I/O

### 6.1. Escrita atômica

O caminho canônico de replacement ficou ordenado como:

```text
open staging inode
-> write
-> mode/chmod final
-> fsync do mesmo FileHandle
-> close
-> publish por rename/link
-> fsync do diretório
```

Isso corrige uma lacuna anterior em que o flush podia ocorrer antes da última alteração de metadata.

Também foram eliminados:

- cópia duplicada de payload entre wrappers;
- `access()` redundante para `failIfExists`;
- prechecks distantes demais da fronteira de publicação.

### 6.2. Estado parcial e retry seguro

Foi criado `mutation-state.js` com uma linguagem única para mutações fisicamente aplicadas cuja
confirmação posterior falhou.

Esse estado percorre:

- write;
- append;
- copy;
- move;
- delete/remove;
- truncate/repair;
- rollback;
- MCP error envelopes;
- health/observability.

Em vez de retry cego, a camada superior recebe semanticamente:

```text
failureClass = applied-but-unconfirmed
retryability = inspect-before-retry
recoveryRequired = true
```

### 6.3. Append e JSONL

O append passou a usar `FileHandle` e perfis explícitos de durability.

Foram corrigidas classes reais de bugs:

- cache de tamanho stale depois de rotação;
- retry que poderia duplicar lote já aplicado;
- rotação/durability do audit log;
- diferença entre “append não começou” e “bytes já foram escritos, confirmação falhou”.

O audit log usa perfil forte; streams de alto volume não recebem fsync de diretório
indiscriminadamente.

### 6.4. Copy, move, delete, mkdir e metadata

- Move deixou de combinar `stat` e `readFile` potencialmente pertencentes a inodes diferentes.
- Delete/remove passaram a ter parent-directory fsync no perfil forte.
- `mkdir` não-recursivo teve a semântica `created` corrigida.
- `mkdir` recursivo sincroniza os diretórios-pai que receberam novas entradas.
- `chmod` ganhou primitive canônica, lock, FileHandle sync, invalidation e estado parcial.
- sidecars de rollback deixaram de copiar cada chunk desnecessariamente.

### 6.5. Reads e cache

O workspace passou a distinguir leitura cacheável de leitura fresh. Snapshot fresh usa identidade do
inode e validação antes/depois, sem contaminar L1/L2.

TLS, secrets, state, PID files, Model Gateway state, Cloudflare state, snapshots e outros consumers
sensíveis foram migrados para facades coerentes com sua semântica.

### 6.6. Governança AST

Estado pós-sync:

```text
Copilot filesystem mutation boundary: OK
scanned source files: 1381
direct mutation sites: 50
application boundary violations: 0
exact exceptions: 4

Copilot filesystem read boundary: OK
direct read sites: total=65, low-level=36, application=29
classified application files: 16
transitional debt sites: 0

Copilot trusted IO boundary: OK
trusted importers: 42
policy entries: 42
trusted calls: 128
```

Os 29 reads classificados não são dívida transitória: são bootstrap/probe/adapters explicitamente
conhecidos. Qualquer novo acesso não classificado passa a quebrar o gate.

---

## 7. Formatter, lint e JSDoc

### 7.1. Prettier

O workspace inteiro foi formatado e o gate final reportou:

```text
All matched files use Prettier code style!
```

Duas correções de tooling foram necessárias.

#### `prettier-plugin-sh` / dockerfmt

O plugin transitivo `@reteps/dockerfmt` podia entrar em deadlock Go/WASM ao formatar fenced code
`dockerfile` dentro de Markdown. A solução não foi desabilitar Markdown: o workspace mantém o
Markdown formatado, mas não tenta reformatar linguagens embutidas nos `.md`.

#### `prettier-plugin-jsdoc`

Foi removido porque não era semanticamente neutro. Ele chegou a:

- reordenar `@template` / `@overload` de forma inválida para TS7;
- alterar forma de casts JSDoc;
- mutar internamente opções durante uma execução ampla.

O ownership correto agora é:

```text
Prettier -> preserva JSDoc
TS7      -> valida semântica/tipos
Babel    -> mede/audita estrutura JSDoc
```

### 7.2. ESLint

`eslint-config-prettier` estava instalado, mas não fazia parte do flat config. Isso fazia o ESLint
rejeitar centenas de quebras de linha que o próprio Prettier produzia.

O config Prettier foi colocado por último no `tseslint.config(...)`, neutralizando somente regras
estilísticas incompatíveis com o formatter. Regras de segurança, imports, boundaries e
type-awareness continuam ativas.

Gate final:

```text
lint: 0 errors, 0 warnings
```

---

## 8. Validação de publicação

Os quatro gates solicitados foram executados sobre o estado final formatado.

### 8.1. Typecheck strict

```text
npm run -s typecheck:strict
exit 0
```

É o build integral de `tsconfig.strict.json`, não apenas lanes parciais.

### 8.2. Lint

```text
npm run -s lint
exit 0
0 errors
0 warnings
```

### 8.3. Unit tests Copilot

```text
selected files: 630
tests total: 7100
passed: 7054
failed: 0
pending: 28
suites total: 2147
suites passed: 2146
suites failed: 0
suites pending: 1
```

Os warnings simulados do detached LLM-B reaper são parte de testes de falha e não representam suites
falhas.

### 8.4. Prettier

```text
npm run -s format:check
exit 0
```

### 8.5. Dependências e baseline

```text
npm ls --all -> exit 0
check:typescript-baseline -> OK
```

A árvore de dependências também foi corrigida para compatibilizar `proxy-agent` do Puppeteer com a
versão exigida pelo PM2, sem override incompatível, e os peers `vis-*` do dashboard passaram a ser
explícitos.

### 8.6. Publicação Git

Commit principal publicado:

```text
1f75d14a6a4d19472002bea964c889770819d1bb
refactor: consolidate TS7 Babel and Copilot IO architecture
```

Após o push, `main` e `origin/main` ficaram com `ahead=0 / behind=0` e o worktree ficou limpo antes
desta investigação.

---

## 9. Situação atual do DevContainer e memória — pré-rebuild

Esta é a parte que **ainda não representa o estado-alvo configurado**. O container atual nasceu
antes das mudanças recentes e continua usando a geração antiga do VS Code server.

### 9.1. Memória atual

Snapshot isolado:

```text
system total        15.56 GiB
system available     7.62 GiB
cgroup current       8.30 GiB
cgroup peak         13.82 GiB
cgroup anon          6.47 GiB
cgroup file          1.55 GiB
cgroup swap        916.1 MiB
OOM events               0
OOM kills                0
high events              0
max events               0
```

Principais grupos por PSS:

```text
vscode:extension-host   ~3.05 GiB
typescript:tsgo-lsp     ~978.4 MiB
vscode:infrastructure   ~1013 MiB
workspace:node-mcp      ~583 MiB
agent:gemini            ~545 MiB
agent:kilo              ~366 MiB
browser:chromium        ~140 MiB
network:cloudflared      ~41 MiB
agent:openai-codex       ~39 MiB
```

Não há evidência de OOM, mas existe pressão residente e swap relevante. O maior problema não é o
kernel cache: é memória anônima do extension host e agentes.

### 9.2. TS7 LSP atual

```text
server/workspace: 7.0.2 / 7.0.2
GOMEMLIMIT: 1024MiB
PSS: ~978 MiB
exact project CLI: OK
watcher failures current session: 21
```

`GOMEMLIMIT` deve ser entendido como target de heap do Go, não como hard cap de RSS/PSS. O valor
atual perto de 1 GiB é compatível com um projeto grande, mas precisa ser comparado pós-rebuild e
após warm-up equivalente.

### 9.3. Extensões atuais x target

Configuração desejada:

```text
auto-install core: 11
recommended: 21
optional on-demand: 38
prunable catalog: 12
```

As 11 auto-install são:

```text
TypeScriptTeam.native-preview
dbaeumer.vscode-eslint
esbenp.prettier-vscode
ms-azuretools.vscode-containers
ms-vscode.makefile-tools
timonwong.shellcheck
redhat.vscode-yaml
EditorConfig.EditorConfig
Vue.volar
github.vscode-github-actions
DavidAnson.vscode-markdownlint
```

Runtime antigo observado:

```text
56 extensões instaladas pelo usuário
0 core ausentes
6 unwanted advisory presentes
0 prunable presentes
0 host-only no remoto
```

Os seis advisories atuais são:

```text
christian-kohler.path-intellisense
christian-kohler.npm-intellisense
mhutchie.git-graph
MermaidChart.vscode-mermaid-chart
bierner.markdown-mermaid
ms-vscode.live-server
```

O `vscode:check` levou cerca de 70 s no runtime atual, outro sinal de que a sessão antiga não é uma
boa baseline de performance.

### 9.4. Nova geração de VS Code server

O `devcontainer.json` está preparado para:

```text
source=devcontainer-vscode-server-ts7-v1
target=/home/node/.vscode-server
type=volume
```

O volume anterior `devcontainer-vscode-server` permanece intacto para rollback/forense.

As configurações TS7 preparadas incluem:

```text
js/ts.experimental.useTsgo = true
js/ts.server.goMemLimit = 1024MiB
js/ts.trace.server = off
```

### 9.5. Gates do DevContainer

`check:devcontainer` passou:

- JSONC válido;
- environment validation sem erros/avisos;
- portas coerentes;
- sync check executado.

O sync check reportou que assets do DevContainer mudaram depois que o VS Code atual iniciou e
classificou a ação como `reload_or_rebuild`. Como a mudança inclui **mount de volume**, reload da
janela não é suficiente para provar o estado-alvo.

`network:syntax` também passou:

```text
13 files
13 passed
0 failed
```

Portanto não há blocker estrutural conhecido para o rebuild.

---

## 10. Análise da situação atual

### 10.1. Pontos fortes

1. **A arquitetura de tipos está coerente.** TS7 é canônico e TS6 não vaza para código first-party.
2. **Babel 8 está uniformizado.** Não há major antiga de `@babel/*` no lockfile.
3. **O grafo está simplificado.** Madge e dependência TS6 interna foram retirados.
4. **O I/O deixou de ser um conjunto de helpers dispersos.** Existem primitives e policies
   compartilhadas, com observabilidade e fault semantics.
5. **A governança está automatizada.** Regressões de filesystem, trusted IO, TS6 e grafo quebram
   gates.
6. **Os testes de camada alta foram desacoplados de syscalls.** Isso permite evoluir a implementação
   de I/O sem quebrar fixtures por detalhes internos irrelevantes.
7. **Formatter e linter não competem mais.** O resultado publicado é simultaneamente
   Prettier-idempotent, strict e lint-clean.

### 10.2. Riscos e dívidas residuais

1. **Runtime VS Code antigo.** A configuração-alvo ainda não foi aplicada porque não houve rebuild.
2. **Extension host muito pesado.** ~3,05 GiB PSS é incompatível com o objetivo de uma sessão remota
   enxuta.
3. **Agentes opcionais ainda residentes.** Gemini e Kilo juntos consomem perto de 1 GiB PSS no
   runtime atual.
4. **Watchers TS7 voltam a degradar em sessão longa.** A causa pode estar na geração atual do VS
   Code server/client bridge ou na combinação de extensões do volume antigo.
5. **TS6 ainda existe como peer compatibility island.** É aceitável hoje, mas não é o estado final
   desejado.
6. **Cliente externo TypeScript ainda é necessário.** Deve desaparecer quando o VS Code utilizado
   incorporar o cliente LSP nativo.
7. **O volume antigo precisa ser preservado até a prova pós-rebuild.** Removê-lo antes disso
   eliminaria a rota simples de comparação/rollback.

### 10.3. O que não deve ser feito agora

- Não remover TS6 à força enquanto o peer range do `typescript-eslint` não suportar TS7.
- Não remover `TypeScriptTeam.native-preview` apenas por causa do nome histórico enquanto o VS Code
  ainda depender dele como client bridge.
- Não instalar plugins Babel por completude abstrata; instalar somente diante de sintaxe/capability
  concreta não atendida.
- Não apagar o volume antigo do VS Code server antes de completar a comparação pós-rebuild.
- Não reinstalar os agentes pesados como parte do baseline automático.

---

## 11. Situação ideal proposta

O estado ideal de médio prazo é:

### 11.1. TypeScript

- TS7 como única major TypeScript no grafo quando o ecossistema permitir;
- zero adapter interno de compatibilidade;
- CLI, CI e LSP na mesma versão canônica;
- cliente LSP nativo bundled pelo VS Code, sem extensão transitória externa;
- LSP estável por sessões longas, sem crescimento persistente de watcher errors.

### 11.2. Babel

- todos os `@babel/*` em major 8 ou superior compatível, sem regressão para majors antigas;
- uma única policy de parser;
- plugins apenas por necessidade sintática explícita;
- nenhuma análise first-party carregando TS compiler API para tarefas puramente sintáticas;
- fixtures de alinhamento Babel/TS7 mantidas para JSDoc e constructs críticos.

### 11.3. I/O

- zero bypass de aplicação não classificado;
- todas as mutações com atomicity/durability/state semantics explícitas;
- reads classificados por freshness/cache semantics;
- cross-process invalidation comprovado em soak;
- thresholds operacionais para `applied-but-unconfirmed`;
- benchmarks periódicos de read/patch/write para evitar regressões de syscall, cópia ou lock
  contention.

### 11.4. VS Code / DevContainer

- volume novo e limpo;
- somente 11 extensões core auto-instaladas;
- agentes pesados somente opt-in;
- extension host dentro de orçamento definido e observável;
- TS7 LSP em ~1 GiB ou menos de PSS após warm-up equivalente, sem swap crescente por long sessions;
- zero prunable/host-only no remoto;
- watcher health estável.

### 11.5. CI e manutenção

- `validate:all` estável e suficientemente rápido para uso regular;
- guards arquiteturais executados cedo no pipeline;
- documentação ativa descrevendo somente engines atuais;
- arquivos históricos preservados como históricos, não tratados como instrução operacional vigente.

---

## 12. Roadmap futuro

Os checkboxes abaixo representam **trabalho futuro a comprovar depois deste documento**. Permanecem
deliberadamente desmarcados.

### Faixa 0 — Baseline e referência pós-publicação

#### Fase 0.1 — Snapshot de referência

- [ ] Registrar o SHA final que contém este relatório e confirmar `HEAD == origin/main`.
- [ ] Guardar a fotografia pré-rebuild de memória/cgroup como baseline comparativa.
- [ ] Registrar a lista runtime atual de 56 extensões para comparação pós-rebuild.
- [ ] Registrar a contagem atual de watcher failures da sessão TS7 antiga.

#### Fase 0.2 — Critérios de aceite do rebuild

- [ ] Definir limites comparativos para extension-host PSS, TS7 PSS e swap.
- [ ] Definir que zero `oom`, `oom_kill`, `high` e `max` continua obrigatório.
- [ ] Definir que regressão de watcher failures em sessão nova bloqueia a limpeza do volume antigo.

### Faixa 1 — Rebuild do DevContainer e prova imediata

#### Fase 1.1 — Rebuild

- [ ] Fazer rebuild do DevContainer com o `main` sincronizado.
- [ ] Confirmar uso efetivo de `devcontainer-vscode-server-ts7-v1`.
- [ ] Confirmar que o volume antigo permanece intacto.

#### Fase 1.2 — Extensões

- [ ] Executar `npm run vscode:sync:check`.
- [ ] Executar `npm run vscode:check`.
- [ ] Confirmar 11 extensões core auto-instaladas.
- [ ] Confirmar ausência de agentes pesados salvo instalação opt-in explícita.
- [ ] Confirmar zero prunable e zero host-only no remoto.

#### Fase 1.3 — TS7 LSP

- [ ] Executar `npm run analyze:typescript:lsp:verify`.
- [ ] Confirmar server/workspace `7.0.2 / 7.0.2`.
- [ ] Confirmar `GOMEMLIMIT=1024MiB` no processo real.
- [ ] Confirmar `js/ts.trace.server=off` efetivo.
- [ ] Confirmar CLI exato verde.
- [ ] Confirmar zero watcher failures na sessão nova após warm-up inicial.

#### Fase 1.4 — Memória pós-rebuild

- [ ] Executar `npm run analyze:memory` imediatamente após estabilização.
- [ ] Repetir após warm-up de TS7 e abertura dos projetos principais.
- [ ] Comparar cgroup current/anon/swap com o baseline pré-rebuild.
- [ ] Comparar extension-host PSS.
- [ ] Comparar TS7 LSP PSS.
- [ ] Confirmar ausência de Gemini/Kilo/Codex, exceto os explicitamente ativados.

### Faixa 2 — Soak de sessão longa

#### Fase 2.1 — Watchers TS7

- [ ] Manter sessão VS Code ativa por algumas horas de edição real.
- [ ] Reexecutar `analyze:typescript:lsp:verify` periodicamente.
- [ ] Confirmar que `watcher failures` não reaparecem de forma cumulativa.
- [ ] Se reaparecerem, correlacionar timestamps com extensão, reload, index e número de file
      watchers.

#### Fase 2.2 — Memória

- [ ] Coletar snapshots de PSS/anon/swap durante a sessão longa.
- [ ] Verificar se extension host ou TS7 exibem crescimento monotônico não reclamável.
- [ ] Definir budget operacional para extension host.
- [ ] Definir budget operacional para TS7 warm.

### Faixa 3 — Convergência final do ecossistema TypeScript

#### Fase 3.1 — `typescript-eslint`

- [ ] Monitorar release que aceite TS7 no peer range.
- [ ] Quando disponível, atualizar `typescript-eslint`.
- [ ] Remover a alias root TS6.
- [ ] Reexecutar `npm ls --all`.
- [ ] Exigir zero TS6 no grafo completo.

#### Fase 3.2 — Cliente LSP do VS Code

- [ ] Detectar versão do VS Code que bundle o client TS7 nativo.
- [ ] Testar sem `TypeScriptTeam.native-preview` em ambiente descartável.
- [ ] Remover a extensão do profile `foundation` apenas quando o client bundled estiver provado.
- [ ] Atualizar auditor e documentação para o client bundled.

### Faixa 4 — Babel 8 e alinhamento sintático

#### Fase 4.1 — Baseline Babel

- [ ] Transformar “zero `@babel/*` < 8” em gate executável específico se o custo justificar.
- [ ] Revalidar deduplicação do dashboard após upgrades Vue/Vite.
- [ ] Revisar necessidade de cada plugin Babel quando nova sintaxe entrar no workspace.

#### Fase 4.2 — Paridade

- [ ] Manter fixtures JSDoc de paridade como regressão permanente.
- [ ] Ampliar fixtures para novos constructs TS7 que Babel parseie estruturalmente.
- [ ] Evitar reintroduzir TypeScript compiler API em ferramentas puramente estruturais.

### Faixa 5 — I/O: prova de produção

#### Fase 5.1 — Fault injection

- [ ] Executar soak de falhas entre write/mode/fsync/publish/directory-fsync.
- [ ] Executar soak de append/JSONL pós-apply.
- [ ] Executar fault injection de delete/remove/mkdir/metadata.
- [ ] Confirmar invariantes de `mutationApplied` em todas as falhas pós-mutação.

#### Fase 5.2 — Cross-process e cache

- [ ] Executar soak de invalidation multi-processo.
- [ ] Medir stale detection em workspace-cached x fresh reads.
- [ ] Verificar comportamento sob replace de inode concorrente.
- [ ] Verificar rotação JSONL sob writer externo.

#### Fase 5.3 — Performance

- [ ] Medir reads pequenos/grandes cache cold/warm.
- [ ] Medir patch pequeno/grande com expected hash.
- [ ] Medir write atomic com `none`, `file` e `file-and-directory` quando aplicável.
- [ ] Comparar syscalls e bytes copiados com a baseline anterior.
- [ ] Definir regressão máxima aceitável para hot paths MCP.

### Faixa 6 — Observabilidade e health

#### Fase 6.1 — Estado parcial

- [ ] Definir threshold de alerta para `appliedButUnconfirmed`.
- [ ] Verificar que eventos são raros/zero em operação normal.
- [ ] Exercitar recuperação `inspect-before-retry` em ambiente controlado.

#### Fase 6.2 — Payloads e round-trip

- [ ] Monitorar tamanho default de `mcp_runtime_health`.
- [ ] Manter estado detalhado sob opt-in.
- [ ] Medir round-trip real de reads/patches/tools mais usados.

### Faixa 7 — CI e documentação

#### Fase 7.1 — Gates integrados

- [ ] Rodar `validate:all` pós-rebuild em ambiente limpo.
- [ ] Confirmar ordem fail-fast dos guards baratos antes das suítes caras.
- [ ] Avaliar tempo total e paralelismo seguro do pipeline.

#### Fase 7.2 — Documentação ativa

- [ ] Revisar documentos ativos que ainda mencionem arquitetura pré-TS7/Babel8.
- [ ] Manter referências históricas apenas como histórico, sem tratá-las como runbook vigente.
- [ ] Consolidar links deste documento nos índices de planos relevantes.

### Faixa 8 — Rollback e limpeza final

#### Fase 8.1 — Volume VS Code antigo

- [ ] Manter `devcontainer-vscode-server` antigo durante a primeira prova pós-rebuild.
- [ ] Manter durante pelo menos um soak longo sem watcher regression.
- [ ] Só então decidir se o volume antigo pode ser removido.

#### Fase 8.2 — Quarantine e artefatos

- [ ] Revisar itens de quarantine ainda necessários para rollback.
- [ ] Eliminar somente artefatos comprovadamente obsoletos.
- [ ] Preservar evidências úteis à comparação pré/pós-rebuild.

---

## 13. Recomendações priorizadas

### Prioridade 1 — Fazer o rebuild controlado do DevContainer

Os gates estruturais estão verdes e a configuração que exige rebuild inclui mudança de mount. O
runtime atual é comprovadamente uma baseline antiga e pesada. Continuar otimizando o código antes de
aplicar a configuração nova produziria retornos marginais inferiores à informação que o rebuild
fornecerá.

### Prioridade 2 — Medir imediatamente depois do rebuild

A sequência recomendada é:

```bash
npm run analyze:memory
npm run analyze:typescript:lsp:verify
npm run vscode:sync:check
npm run vscode:check
npm run check:copilot:guardrails
npm run check:typescript-baseline
```

Depois do warm-up, repetir pelo menos memória e LSP health.

### Prioridade 3 — Não remover TS6 nem o client bridge prematuramente

Ambos têm razões upstream concretas hoje. A meta é removê-los assim que os respectivos bloqueios
externos caírem, não antes.

### Prioridade 4 — Usar a sessão pós-rebuild como experimento de causalidade

O ponto mais importante não é somente “RAM caiu?”. É separar:

- efeito do volume limpo;
- efeito da redução de extensões;
- efeito do `GOMEMLIMIT` aplicado desde o activation time;
- efeito da ausência de agentes opcionais;
- persistência ou desaparecimento dos watcher timeouts.

### Prioridade 5 — Só depois retomar transformações profundas

Se o rebuild confirmar a arquitetura, a próxima frente de alto valor deve ser **soak/benchmark de
I/O e estabilidade de sessão longa**, não mais refatoração básica de parser/typecheck/filesystem.

---

## 14. Conclusão

A rodada concluiu a maior parte da migração estrutural pretendida: TS7 é canônico, Babel 8 domina a
análise sintática, TS6 first-party desapareceu, Madge desapareceu, o grafo está acíclico, I/O possui
boundaries executáveis, formatter/linter estão reconciliados e os gates de publicação estão verdes.

O principal ponto não comprovado está fora do código que acabou de ser publicado: **o container em
execução ainda não materializa a nova geração do VS Code server**. A memória alta, os agentes
residentes e a volta dos watcher failures pertencem a esse runtime antigo.

Por isso, o estado técnico deste documento é um marco apropriado para encerrar a fase de
transformação e iniciar a fase de prova operacional. O próximo rebuild deve ser tratado como
experimento controlado: preservar a baseline atual, aplicar o volume novo, medir, aquecer, medir
novamente e só então decidir por qualquer limpeza irreversível.
