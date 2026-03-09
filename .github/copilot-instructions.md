# Copilot Instructions — chatgpt-docker-puppeteer

**Propósito**: contexto operacional e arquitetural para agentes de IA neste repositório. **Status**:
Canônico. **Última atualização**: 10 de março de 2026.

> Responda sempre em **português brasileiro (pt-BR)** ao interagir com humanos ou escrever
> documentação.

---

## ⛔ REGRA ABSOLUTA — Encerrar sem autorização é PROIBIDO

> **APLICA-SE A TODA RESPOSTA. SEM EXCEÇÃO.**

Antes de encerrar qualquer turno, bloco de trabalho ou sessão, o agente **obrigatoriamente** deve
invocar a ferramenta `vscode_askQuestions` e aguardar a resposta do usuário.

**O que NÃO conta como autorização (VIOLAÇÕES):**

- Escrever "O que deseja fazer a seguir?" no texto da resposta
- Terminar a resposta com uma pergunta em texto livre
- Dizer "posso continuar?" ou "concluí a tarefa" sem chamar a ferramenta

**O único método válido:**

- Chamar a **ferramenta** `vscode_askQuestions` (tool call real, não texto)
- Aguardar resposta antes de qualquer ação subsequente

O sistema monitora automaticamente — turnos sem `vscode_askQuestions` geram `turnEnd_UNAUTHORIZED`
no `audit.jsonl` e ativam alertas na próxima sessão.

---

## Projeto em uma frase

Sistema Node.js 24+ (ESM obrigatório) que orquestra missões de longa duração com LLMs via browser
automation, com arquitetura orientada a eventos, separação de domínios e foco em confiabilidade
operacional.

## Arquitetura em camadas

1. **Bootstrap** — `src/main.js` (entrada canônica), `src/core/` (contratos, schemas, validadores).
2. **Barramento de eventos** — `src/nerv/` conecta kernel, drivers, server e serviços auxiliares.
   Quando o módulo já estiver nessa topologia, prefira desacoplamento por eventos.
3. **Decisão / execução** — `src/kernel/` (loop, políticas, telemetria) · `src/orchestrator/`
   (estratégias: `SINGLE_SHOT`, `ITERATIVE`, `MULTI_STEP`) · `src/agent/` (workers: fila, watchdog,
   controle, missão, pós-processamento) · `src/driver/` (atuador browser).
4. **Infra e superfícies externas** — `src/infra/` (pool, DB, FS, queue, locks, proxy) ·
   `src/server/` (API, realtime, middleware) · `src/dashboard-ui/` (frontend Vue/Vite — não
   substitui o backend).
5. **Domínios de apoio** — `src/missions/`, `src/integration/`, `src/inference_gateway/`,
   `src/audit_agent/`, `src/shared/`, `src/state/`, `src/types/`, `src/logic/`, `src/validation/`.

## Mapa de diretórios

| Diretório                         | Papel                                                                                      |
| --------------------------------- | ------------------------------------------------------------------------------------------ |
| `src/`                            | Runtime oficial do produto                                                                 |
| `tests/`                          | Testes unitários, integração, regressão, E2E; quarentena em `tests/legacy/`                |
| `scripts/`                        | Automação por família: `audit/`, `ci/`, `ops/`, `setup/`, `health/`, `build/`, `codemods/` |
| `DOCUMENTAÇÃO/`                   | Hub canônico de documentação (arquitetura, relatórios, bugs, CI/CD, operações)             |
| `.github/`                        | Instruções permanentes, skills, workflows e agentes                                        |
| `agents/`, `tools/`, `assistant/` | Tooling auxiliar externo ao runtime                                                        |

> `agents/` na raiz ≠ `src/agent/` (workers internos do runtime).

## Convenções obrigatórias

- **Runtime**: Node.js 24+, ESM (`import`/`export`). Nunca `require`/`module.exports` sem
  justificativa excepcional. Preserve `"type": "module"` em `package.json`.
- **Aliases**: prefira `#core/*`, `#infra/*`, `#driver/*` a caminhos relativos profundos.
- **Estilo**: 4 espaços, 120 colunas, aspas simples, ponto-e-vírgula.
- **JSDoc robusto**: toda exportação pública relevante deve ter JSDoc curto, objetivo e bem tipado.
  Use a skill `jsdoc-authoring` (`.github/skills/jsdoc-authoring/SKILL.md`) para criar/revisar JSDoc
  completo. JSDoc sem tipos são considerados incompletos — utilize `@param {type}`,
  `@returns {type}`, `@throws {ErrorType}`.
- **Tipagem TypeScript/JSDoc**: sempre adicionar tipos explícitos via JSDoc ou TypeScript. Use a
  skill `typing-node24-esm-tsserver` (`.github/skills/typing-node24-esm-tsserver/SKILL.md`) para
  hardening de tipagem. Node.js 24 + ESM exigem clareza de tipos para evitar ambiguidades de
  runtime.
- **Dependências**: não introduza novas sem justificativa clara.
- **Browser**: não use `puppeteer.launch()` neste processo. Use o Chrome externo via DevTools.

## Ferramentas disponíveis no ambiente

### Substituições obrigatórias (legacy → moderno)

> **NUNCA use os comandos da coluna esquerda.** Todos os equivalentes modernos já estão instalados.

| ❌ Nunca use              | ✅ Use em vez disso        | Motivo                                               |
| ------------------------- | -------------------------- | ---------------------------------------------------- |
| `cat arquivo`             | `bat arquivo`              | Syntax highlighting, números de linha, paginação     |
| `grep "x" src/`           | `rg "x" src/`              | Ordens de magnitude mais rápido; respeita .gitignore |
| `find . -name "*.js"`     | `fd "\.js$"`               | Sintaxe intuitiva; respeita .gitignore por padrão    |
| `sed 's/A/B/g' arquivo`   | `sd 'A' 'B' arquivo`       | Regex mais clara; substitui in-place sem flags       |
| `du -sh *`                | `dust src/`                | Visualização hierárquica; proporcional e colorida    |
| `git diff` (puro)         | já configurado com `delta` | Diff semântico com highlighting e contexto rico      |
| `curl -X POST url -d ...` | `xh POST url chave=valor`  | Sintaxe HTTPie-like; sem flags verbosas              |
| `ps aux \| grep x`        | `procs x`                  | Filtro automático; saída colorida e estruturada      |
| `top` / `htop`            | `btm`                      | TUI moderna com gráficos de CPU, memória e rede      |
| `echo '{"k":"v"}'`        | `jo k=v`                   | Constrói JSON válido sem escaping manual             |
| `less arquivo.md`         | `glow arquivo.md`          | Renderiza Markdown formatado no terminal             |
| `cd caminho/longo`        | `z termo` (zoxide)         | Navegação fuzzy por frecency — aprende com o uso     |

### Busca e navegação de arquivos

| Ferramenta   | Exemplos canônicos                                                        |
| ------------ | ------------------------------------------------------------------------- |
| `rg`         | `rg "padrão" src/` · `rg -l "import.*nerv"` · `rg -t js "export default"` |
| `fd`         | `fd "\.spec\.js$" tests/` · `fd -e mjs scripts/` · `fd -H "\.env"`        |
| `fzf`        | `rg -l "todo" \| fzf` · `fd -e js \| fzf \| xargs bat`                    |
| `z` (zoxide) | `z src` (cd inteligente) · `zi` (seletor interativo com fzf)              |
| `tree`       | `tree -L 2 src/` · `tree --gitignore src/`                                |

### Leitura, visualização e diff

| Ferramenta | Exemplos canônicos                                                                    |
| ---------- | ------------------------------------------------------------------------------------- |
| `bat`      | `bat src/nerv/index.js` · `bat --language=json config.json` · `bat -n arquivo`        |
| `glow`     | `glow README.md` · `glow DOCUMENTAÇÃO/ARQUITETURA/ARCHITECTURE.md`                    |
| `delta`    | Pager global do git — ativado automaticamente em `git diff`, `git log -p`, `git show` |

### Manipulação de dados e texto

| Ferramenta | Exemplos canônicos                                                            |
| ---------- | ----------------------------------------------------------------------------- |
| `jq`       | `jq '.server.port' config.json` · `jq '.[] \| select(.status=="done")'`       |
| `yq`       | `yq '.on' .github/workflows/ci.yml` · `yq -i '.version = "2.0"' arquivo.yml`  |
| `sd`       | `sd 'require\(' 'import(' src/legacy.js` · `fd -e js \| xargs sd 'OLD' 'NEW'` |
| `jo`       | `jo name=task status=done` · `jo -a item1 item2` (arrays JSON)                |

### Filesystem e recursos do sistema

| Ferramenta | Exemplos canônicos                                                  |
| ---------- | ------------------------------------------------------------------- |
| `dust`     | `dust src/` · `dust -r -n 20 node_modules/` (top 20 maiores)        |
| `ncdu`     | `ncdu .` (TUI interativo de uso de disco)                           |
| `procs`    | `procs node` · `procs --sort cpu` · `procs --watch-interval 1`      |
| `btm`      | `btm` (monitor TUI: CPU, memória, disco, rede, processos)           |
| `lsof`     | `lsof -i :3008` (porta em uso) · `lsof -p <PID>` (arquivos abertos) |
| `pv`       | `cat grande.log \| pv \| rg "error"` (progresso no pipe)            |

### Rede e HTTP

| Ferramenta | Exemplos canônicos                                                       |
| ---------- | ------------------------------------------------------------------------ |
| `xh`       | `xh GET localhost:3008/health` · `xh POST api/task name=foo priority:=1` |
| `nmap`     | `nmap -p 9224 localhost` (verifica porta Chrome/CDP)                     |
| `socat`    | Proxy TCP/Unix · `socat TCP-LISTEN:9999,fork TCP:host:9224`              |

### Git e GitHub

| Ferramenta | Exemplos canônicos                                                    |
| ---------- | --------------------------------------------------------------------- |
| `gh`       | `gh run list` · `gh pr view` · `gh issue list --label bug`            |
| `delta`    | Pager automático do git — configure via `git config core.pager delta` |
| `git-lfs`  | Automático para arquivos binários tracked por LFS                     |

### Lint, qualidade e segurança

| Ferramenta   | Exemplos canônicos                                           |
| ------------ | ------------------------------------------------------------ |
| `shellcheck` | `shellcheck scripts/**/*.sh` · `shellcheck -f gcc script.sh` |
| `hadolint`   | `hadolint .devcontainer/Dockerfile`                          |
| `actionlint` | `actionlint .github/workflows/*.yml`                         |
| `yamllint`   | `yamllint .github/workflows/ci.yml`                          |

### Desenvolvimento, benchmark e análise

| Ferramenta  | Exemplos canônicos                                                              |
| ----------- | ------------------------------------------------------------------------------- |
| `hyperfine` | `hyperfine 'npm run lint'` · `hyperfine --warmup 3 'cmd1' 'cmd2'`               |
| `entr`      | `fd -e js src/ \| entr npm run test:unit` (re-roda ao salvar)                   |
| `cloc`      | `cloc src/` · `cloc --by-file src/kernel/` (contagem de linhas de código)       |
| `sqlite3`   | `sqlite3 state.db '.tables'` · `sqlite3 state.db 'SELECT * FROM tasks LIMIT 5'` |
| `graphviz`  | `dot -Tsvg graph.dot -o graph.svg`                                              |
| `moreutils` | `ts` (timestamps em pipes) · `sponge` (write seguro) · `errno` · `parallel`     |

### Scripts npm essenciais

| Script                     | Propósito                                          |
| -------------------------- | -------------------------------------------------- |
| `npm run lint`             | ESLint em todo o projeto                           |
| `npm run lint:fix`         | ESLint com auto-fix                                |
| `npm run format:check`     | Prettier dry-run (não modifica arquivos)           |
| `npm run format`           | Prettier apply                                     |
| `npm run test:unit`        | Testes unitários (runner nativo Node.js `--test`)  |
| `npm run test:integration` | Testes de integração                               |
| `npm run test:regression`  | Testes de regressão                                |
| `npm run typecheck:node`   | TypeScript check (tsconfig.node.json)              |
| `npm run typecheck:full`   | TypeScript check completo (node + tools + browser) |
| `npm run audit:quick`      | Auditoria rápida (mode reactive_bug)               |
| `npm run audit:nightly`    | Auditoria completa (mode exploratory_bug)          |
| `npm run analyze:deps`     | Dependências circulares via madge                  |
| `npm run analyze:circular` | Análise de grafo de código circular                |
| `npm run check:workflows`  | Validação estrutural dos workflows locais          |
| `npm run diagnose`         | Diagnóstico completo do ambiente                   |
| `npm run rag:health`       | Saúde do sistema RAG                               |
| `npm run lsp:health`       | Saúde do servidor LSP (tsserver)                   |
| `npm run jsdoc:coverage`   | Cobertura de JSDoc do projeto                      |

## Quality gates mínimos por alteração

1. `npm run lint`
2. `npm run format:check`
3. `npm run test:unit`
4. Se tocar `driver`, `kernel` ou `server` → `npm run test:integration`
5. Atualizar `DOCUMENTAÇÃO/` e `.github/` quando um conceito estrutural mudar.

## Onde buscar mais informações

| Necessidade                  | Onde ir                                                |
| ---------------------------- | ------------------------------------------------------ |
| Arquitetura completa         | `DOCUMENTAÇÃO/ARQUITETURA/ARCHITECTURE.md`             |
| Índice de arquitetura        | `DOCUMENTAÇÃO/ARQUITETURA/README.md`                   |
| Status e backlog documental  | `DOCUMENTAÇÃO/RELATORIOS/STATUS_GERAL_DOCUMENTACAO.md` |
| Bugs conhecidos e auditorias | `DOCUMENTAÇÃO/BUGS/`                                   |
| CI/CD e workflows            | `DOCUMENTAÇÃO/CI_CD/`                                  |
| Operações e runbooks         | `DOCUMENTAÇÃO/OPERACOES/`                              |
| Skills especializadas        | `.github/skills/README.md` (catálogo)                  |
| Cada skill em detalhes       | `.github/skills/<nome>/SKILL.md`                       |
| Agentes especializados       | `.github/agents/`                                      |
| Baseline curto e estável     | `.github/instructions/project-canon.instructions.md`   |
| Hub de automação .github     | `.github/README.md`                                    |

## Catálogo de skills disponíveis

Skills são procedimentos especializados. Carregue o `SKILL.md` da skill relevante antes de iniciar o
trabalho. Todas ficam em `.github/skills/`:

| Skill                            | Quando usar                                                        |
| -------------------------------- | ------------------------------------------------------------------ |
| `code-audit-and-fix`             | Auditar e corrigir código diretamente                              |
| `exploratory-bug-hunt`           | Caça proativa de bugs sem pista prévia                             |
| `reactive-bug-audit`             | Auditoria focada em bug operacional específico                     |
| `audit-system-analysis-planning` | Análise arquitetural e planejamento                                |
| `typing-node24-esm-tsserver`     | Tipagem TypeScript/JSDoc para Node 24 + ESM (arquitetura de lanes) |
| `jsdoc-authoring`                | Cookbook completo de JSDoc: padrões por TS code, cascata, batch    |
| `typing-fix-protocol`            | Protocolo operacional de scan+triagem+fix por lane ou arquivo      |
| `lsp-ops`                        | Operações LSP (definições, referências, diagnósticos via tsserver) |
| `context7-docs-ops`              | Documentação de libs externas via Context7 MCP                     |
| `documentation-governance`       | Auditoria e governança de documentação                             |
| `env-governance`                 | Gestão de variáveis de ambiente e templates `.env*`                |
| `readme-standardization`         | Padronização de READMEs por módulo                                 |
| `performance-audit`              | Profiling e análise de performance                                 |
| `security-checklist`             | Revisão de segurança                                               |
| `skill-creator-pt-br`            | Criar nova skill neste repositório                                 |

## Notas finais

- Documentos históricos → `DOCUMENTAÇÃO/ARQUIVO_MORTO/` — não formam baseline automático.
- Prompts em `.github/prompts/` e agentes em `.github/agents/` são referência sob demanda.
- A arquitetura oficial vive em `DOCUMENTAÇÃO/ARQUITETURA/ARCHITECTURE.md`.
