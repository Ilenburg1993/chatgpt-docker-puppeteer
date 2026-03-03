# Instruções para todos os agentes

**Propósito**: baseline curto e permanente para agentes de IA neste workspace.  
**Status**: Canônico. **Última atualização**: 1 de março de 2026.

Este arquivo é lido automaticamente por agentes de IA (Copilot, Claude, ChatGPT, etc.) que interagem
com o workspace. Ele complementa `.github/copilot-instructions.md` e usa
`.github/instructions/project-canon.instructions.md` como baseline estável.

## Regras universais

- Responder em **português brasileiro (pt-BR)** ao interagir com humanos ou ao escrever
  documentação.
- Presumir Node.js 24+ com ESM obrigatório (`import` / `export`).
- Tratar `DOCUMENTAÇÃO/ARQUITETURA/ARCHITECTURE.md` como a arquitetura oficial.
- Aplicar estas instruções junto com `.github/copilot-instructions.md` e os `*.instructions.md`
  relevantes.

## Mapa estável do repositório

| Diretório           | Papel                                                                       |
| ------------------- | --------------------------------------------------------------------------- |
| `src/`              | Runtime do produto — `src/agent/` são workers internos, ≠ `agents/` na raiz |
| `tests/`            | Testes, harness e quarentena em `legacy/`                                   |
| `scripts/`          | Automação operacional, auditoria e tooling interno                          |
| `DOCUMENTAÇÃO/`     | Documentação canônica (arquitetura, bugs, CI/CD, relatórios, operações)     |
| `.github/`          | Instruções permanentes, skills, workflows e agentes                         |
| `agents/`, `tools/` | Tooling auxiliar externo ao runtime                                         |

## Ferramentas CLI disponíveis (DevContainer)

## Code quality — JSDoc e tipagem

**Regra universal**: toda exportação pública relevante deve ter JSDoc robusto e tipagem explícita.

| Task                               | Skill                        | Detalhes                                                               |
| ---------------------------------- | ---------------------------- | ---------------------------------------------------------------------- |
| Criar/revisar JSDoc                | `jsdoc-authoring`            | JSDoc curto, objetivo, com tipos completos (@param, @returns, @throws) |
| Adicionar tipagem TypeScript/JSDoc | `typing-node24-esm-tsserver` | Hardening de tipos para Node.js 24 + ESM (evita ambiguidades runtime)  |
| Verificar tipos                    | `npm run typecheck:node`     | Lint automático de tipos via tsserver                                  |

**Exemplo**:

```javascript
/**
 * Valida um payload de tarefa.
 * @param {Object} payload - Payload a validar
 * @returns {Promise<boolean>} true se válido
 * @throws {ValidationError} se inválido
 */
export async function validateTask(payload) {
  /* ... */
}
```

**Use sempre `rg` em vez de `grep` e `fd` em vez de `find`.**

- `rg "padrão" src/` — busca de texto (ripgrep)
- `fd "\.js$" src/` — localização de arquivos (fd-find)
- `bat arquivo.js` — leitura com syntax highlighting
- `jq` / `yq` — processamento de JSON e YAML
- `gh` — GitHub CLI (PRs, issues, runs, releases)
- `actionlint` / `hadolint` / `shellcheck` — lint de workflows, Dockerfile e shell scripts
- `hyperfine` — benchmark de comandos
- `sqlite3` — banco de estado local

## Scripts npm essenciais

```
npm run lint             # ESLint
npm run format:check     # Prettier (dry-run)
npm run test:unit        # Testes unitários
npm run test:integration # Testes de integração
npm run typecheck:node   # TypeScript via tsserver
npm run audit:quick      # Auditoria rápida
npm run diagnose         # Diagnóstico do ambiente
npm run rag:health       # Saúde do RAG
npm run lsp:health       # Saúde do LSP
```

## Rotas canônicas

| Necessidade             | Onde ir                                                |
| ----------------------- | ------------------------------------------------------ |
| Arquitetura oficial     | `DOCUMENTAÇÃO/ARQUITETURA/ARCHITECTURE.md`             |
| Índice da arquitetura   | `DOCUMENTAÇÃO/ARQUITETURA/README.md`                   |
| Status da documentação  | `DOCUMENTAÇÃO/RELATORIOS/STATUS_GERAL_DOCUMENTACAO.md` |
| Bugs e auditorias       | `DOCUMENTAÇÃO/BUGS/`                                   |
| CI/CD e workflows       | `DOCUMENTAÇÃO/CI_CD/`                                  |
| Operações e runbooks    | `DOCUMENTAÇÃO/OPERACOES/`                              |
| Skills especializadas   | `.github/skills/README.md`                             |
| Hub de automação GitHub | `.github/README.md`                                    |
| Baseline curto          | `.github/instructions/project-canon.instructions.md`   |

> Estas instruções têm prioridade equivalente às do `copilot-instructions.md` e são carregadas
> automaticamente pelo VS Code via `chat.useAgentsMdFile`.
