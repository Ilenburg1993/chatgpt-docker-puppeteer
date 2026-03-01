---
name: 'Project Canon'
description: 'Núcleo canônico do repositório para agentes de IA'
applyTo: '**/*'
---

# Project Canon

**Propósito**: baseline curto e estável para tarefas gerais de código neste repositório. **Status**:
Canônico. **Última atualização**: 1 de março de 2026.

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

**CLI preferidos** (sempre disponíveis no DevContainer — use em vez de grep/find):

| Ferramenta                               | Uso                                      |
| ---------------------------------------- | ---------------------------------------- |
| `rg "padrão" src/`                       | Busca de texto rápida (ripgrep)          |
| `fd "\.js$" src/`                        | Localização de arquivos rápida (fd-find) |
| `bat arquivo.js`                         | Leitura com syntax highlighting          |
| `jq '.chave' arquivo.json`               | Processamento de JSON                    |
| `yq '.campo' arquivo.yml`                | Processamento de YAML                    |
| `gh run list`                            | GitHub CLI — runs, PRs, issues           |
| `actionlint` / `hadolint` / `shellcheck` | Lint de workflows, Dockerfile e scripts  |
| `hyperfine`                              | Benchmark de comandos                    |
| `sqlite3`                                | Banco de estado local                    |

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
