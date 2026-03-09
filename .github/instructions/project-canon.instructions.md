---
name: 'Project Canon'
description: 'Núcleo canônico do repositório para agentes de IA'
applyTo: '**/*'
---

# Project Canon

**Propósito**: baseline curto e estável para tarefas gerais de código neste repositório. **Status**:
Canônico. **Última atualização**: 8 de março de 2026.

Use `DOCUMENTAÇÃO/ARQUITETURA/ARCHITECTURE.md` quando a tarefa exigir a visão oficial completa.

## Linguagem e comunicação

- Responda em **pt-BR** ao interagir com humanos.
- Documentação e instruções permanentes devem ser escritas em pt-BR.

## Runtime

- Node.js >=24, ESM obrigatório. Preserve `"type": "module"` em `package.json`.
- Use `import`/`export`. Evite `require`/`module.exports` sem justificativa excepcional.

## Arquitetura

- `src/main.js` — bootstrap canônico. `src/core/` — contratos centrais.
- **Espinha dorsal**: `src/nerv/` · `src/kernel/` · `src/orchestrator/` · `src/agent/` ·
  `src/driver/` · `src/infra/` · `src/server/`.
- `src/agent/` são workers internos (fila, watchdog, controle, missão, pós-processamento).
- `src/missions/` é o domínio; `src/agent/` executa os loops.
- `agents/` na raiz ≠ (diferente) `src/agent/`.
- Quando o módulo está na topologia NERV, prefira desacoplamento por eventos.

## Restrição crítica

- Não introduza `puppeteer.launch()` neste processo.
- Browser via Chrome externo e infraestrutura DevTools já existente.

## Código

- Aliases: `#core/*`, `#infra/*`, `#driver/*` → prefira a caminhos relativos profundos.
- Estilo: 4 espaços, 120 colunas, aspas simples, ponto-e-vírgula.
- **JSDoc robusto obrigatório**: toda exportação pública deve ter JSDoc com tipos explícitos.
  - Use `@param {type}`, `@returns {type}`, `@throws {ErrorType}`.
  - Skill: `jsdoc-authoring` (`.github/skills/jsdoc-authoring/SKILL.md`)
- **Tipagem**: sempre adicionar tipos via JSDoc ou TypeScript.
  - Skill: `typing-node24-esm-tsserver` (`.github/skills/typing-node24-esm-tsserver/SKILL.md`)
  - Run: `npm run typecheck:node` antes de commitar.
- Novas dependências exigem justificativa clara.

## Ferramentas disponíveis no ambiente

> Todas as ferramentas abaixo estão instaladas no DevContainer. **Nunca use os equivalentes
> legados** listados na tabela de substituições — o moderno é sempre preferível.

### Substituições obrigatórias (legacy → moderno)

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

**Scripts npm essenciais**:

| Script                            | Propósito                           |
| --------------------------------- | ----------------------------------- |
| `npm run lint` / `lint:fix`       | ESLint                              |
| `npm run format:check` / `format` | Prettier                            |
| `npm run test:unit`               | Testes unitários (Node.js `--test`) |
| `npm run test:integration`        | Testes de integração                |
| `npm run typecheck:node`          | TypeScript via tsserver             |
| `npm run audit:quick`             | Auditoria rápida                    |
| `npm run analyze:deps`            | Dependências circulares             |
| `npm run diagnose`                | Diagnóstico do ambiente             |
| `npm run rag:health`              | Saúde do sistema RAG                |
| `npm run lsp:health`              | Saúde do LSP (tsserver)             |

## Quality gates mínimos

- Rode `npm run lint` e `npm run format:check` após mudanças.
- Rode `npm run test:unit` como baseline.
- Se tocar `driver`, `kernel` ou `server` → `npm run test:integration`.

## Roteamento de contexto

| Precisa de          | Onde ir                                                |
| ------------------- | ------------------------------------------------------ |
| Arquitetura oficial | `DOCUMENTAÇÃO/ARQUITETURA/ARCHITECTURE.md`             |
| Status documental   | `DOCUMENTAÇÃO/RELATORIOS/STATUS_GERAL_DOCUMENTACAO.md` |
| Bugs conhecidos     | `DOCUMENTAÇÃO/BUGS/`                                   |
| CI/CD               | `DOCUMENTAÇÃO/CI_CD/` · `.github/README.md`            |
| Skills              | `.github/skills/README.md` + cada `SKILL.md`           |
| Agentes             | `.github/agents/`                                      |
| Operações           | `DOCUMENTAÇÃO/OPERACOES/`                              |

## O que não vira baseline

- `dist`, `node_modules`, `tmp`, caches e artefatos gerados.
- Prompts em `.github/prompts/` e agentes em `.github/agents/` → referência sob demanda.
- Documentos em `DOCUMENTAÇÃO/ARQUIVO_MORTO/` → histórico, não baseline.
