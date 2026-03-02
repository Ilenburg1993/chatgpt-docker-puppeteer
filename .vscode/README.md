# .vscode/

**Propósito**: Configuração do VS Code para o projeto — settings, extensões recomendadas, launch configurations, tasks, keybindings e snippets de código.  
**Status**: Canônico de apoio.  
**Público**: Desenvolvedores que usam VS Code ou VS Code Remote (DevContainer).  
**Última atualização**: 2 de março de 2026.

## O que esta pasta contém

- Configurações do editor e workspace
- Extensões recomendadas
- Configurações de debug (launch)
- Tasks e keybindings personalizados
- Configuração MCP para assistentes

## O que não deve ficar aqui

- Configurações pessoais que não se aplicam ao projeto
- Segredos ou tokens de acesso

## Entradas principais

| Arquivo | Descrição |
|---|---|
| `settings.json` | Configurações do workspace VS Code |
| `extensions.json` | Extensões recomendadas para o projeto |
| `launch.json` | Configurações de debug e launch |
| `tasks.json` | Tasks automatizadas do VS Code |
| `keybindings.json` | Atalhos de teclado customizados |
| `mcp.json` | Configuração do Model Context Protocol |
| `*.code-snippets` | Snippets de código do projeto |

## Links relacionados

- DevContainer: [`.devcontainer/`](../.devcontainer/)
- Documentação de debug: [`DEBUG_MODE_DOCS.md`](./DEBUG_MODE_DOCS.md)
