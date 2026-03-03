# src

**Propósito**: Código-fonte oficial do runtime do sistema. Contém todos os módulos de produção
organizados por domínio.  
**Status**: Canônico.  
**Público**: Desenvolvedores e mantenedores do projeto.  
**Última atualização**: 2 de março de 2026.

## O que esta pasta contém

- Módulos de runtime em Node.js 24+ (ESM obrigatório).
- Camadas da arquitetura: bootstrap, barramento de eventos, kernel, driver, infra, server e tipos.

## O que não deve ficar aqui

- Scripts de automação, CI e operações → `scripts/`
- Ferramentas auxiliares externas ao runtime → `agents/`, `tools/`, `assistant/`
- Testes → `tests/`
- Frontend (exceto `dashboard-ui/`) → fora de `src/`

## Entradas principais

| Arquivo/Pasta        | Descrição                                                        |
| -------------------- | ---------------------------------------------------------------- |
| `main.js`            | Bootstrap canônico da aplicação                                  |
| `core/`              | Configuração, logger, schemas, validadores e constantes centrais |
| `nerv/`              | Barramento de eventos central (NERV)                             |
| `kernel/`            | Loop de execução, políticas e telemetria                         |
| `orchestrator/`      | Estratégias de orquestração de missões                           |
| `agent/`             | Workers internos: fila, watchdog, controle, missão               |
| `driver/`            | Automação de browser via Chrome DevTools                         |
| `infra/`             | Pool de browsers, DB, fila, locks, storage                       |
| `server/`            | API REST, Socket.io e dashboard                                  |
| `missions/`          | Domínio de missões e templates                                   |
| `integration/`       | Integrações com LSP, MCP e ferramentas externas                  |
| `inference_gateway/` | Gateway para modelos de inferência (LLMs)                        |
| `audit_agent/`       | Agente de auditoria autônomo                                     |
| `shared/`            | Módulos compartilhados entre domínios                            |
| `types/`             | Definições de tipos TypeScript/JSDoc                             |
| `validation/`        | Lógica de validação global                                       |
| `logic/`             | Lógica de negócio e regras de validação                          |
| `state/`             | Gerenciamento de estado global                                   |
| `dashboard-ui/`      | Frontend Vue/Vite do dashboard                                   |

## Regras de manutenção

- Preserve `"type": "module"` em `package.json`; use `import`/`export`.
- Use aliases `#core/*`, `#infra/*`, `#driver/*` em vez de caminhos relativos profundos.
- Toda exportação pública deve ter JSDoc com tipos explícitos.
- Não introduza `puppeteer.launch()` aqui; use Chrome externo via DevTools.

## Links relacionados

- Arquitetura completa: `DOCUMENTAÇÃO/ARQUITETURA/ARCHITECTURE.md`
- Bootstrap: `src/main.js`
- Instructions canônicas: `.github/instructions/project-canon.instructions.md`
