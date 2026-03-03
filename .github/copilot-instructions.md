# Copilot Instructions — chatgpt-docker-puppeteer

**Propósito**: contexto operacional e arquitetural para agentes de IA neste repositório.  
**Status**: Canônico. **Última atualização**: 1 de março de 2026.

> Responda sempre em **português brasileiro (pt-BR)** ao interagir com humanos ou escrever
> documentação.

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

### CLI instalados no DevContainer

Use estas ferramentas diretamente no terminal — são instaladas e disponíveis no DevContainer:

| Ferramenta     | Uso típico                                                           |
| -------------- | -------------------------------------------------------------------- |
| `rg` (ripgrep) | Busca de texto rápida: `rg "padrão" src/` · `rg -l "import.*nerv"`   |
| `fd`           | Localizar arquivos: `fd "\.spec\.js$" tests/` · `fd -e mjs scripts/` |
| `bat`          | `cat` com syntax highlight: `bat src/nerv/index.js`                  |
| `fzf`          | Fuzzy finder interativo para arquivos, histórico e seleção           |
| `jq`           | Processar JSON: `cat config.json \| jq '.server.port'`               |
| `yq`           | Processar YAML: `yq '.on' .github/workflows/ci.yml`                  |
| `sqlite3`      | Acesso direto ao banco de estado local                               |
| `gh`           | GitHub CLI: PRs, issues, runs: `gh run list` · `gh pr view`          |
| `actionlint`   | Lint de workflows: `actionlint .github/workflows/*.yml`              |
| `hadolint`     | Lint do Dockerfile: `hadolint .devcontainer/Dockerfile`              |
| `shellcheck`   | Lint de shell scripts                                                |
| `hyperfine`    | Benchmark de comandos: `hyperfine 'npm run lint'`                    |
| `graphviz`     | Gerar diagramas: `dot -Tsvg graph.dot -o graph.svg`                  |

**Regra de ouro**: prefira `rg` a `grep` e `fd` a `find` em qualquer busca.

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
| `typing-node24-esm-tsserver`     | Tipagem TypeScript/JSDoc para Node 24 + ESM                        |
| `jsdoc-authoring`                | Criação e revisão de JSDoc completo                                |
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
