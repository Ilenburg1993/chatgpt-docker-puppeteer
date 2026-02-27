---
name: lsp-ops
description:
  "Skill para operações LSP internas (tsserver daemon) disponíveis no projeto. Use-a quando
envolver navegação semântica, diagnósticos ou edição de código via MCP/LSP."
---

# LSP Ops

## Visão geral

Este skill capta o conjunto de ferramentas `lsp_*` expostas pelo servidor de linguagem implementado
em `src/integration/lsp/tsserver-daemon.mjs` e documenta o fluxo de uso padrão. Ela é destinada a
qualquer assistente que precise consultar código, obter completions, ou aplicar alterações de
refatoração sem sair do contexto da conversa. O mesmo conjunto de operações pode ser invocado via
MCP tools (`tools/call`).

### Operações suportadas

- **definition** – localiza a definição de um símbolo em um arquivo dado
- **references** – lista todas as referências de um símbolo
- **hover** – mostra informações de tooltip/type no cursor
- **document_symbols** – retorna símbolos do documento
- **workspace_symbols** – busca símbolos em todo o workspace
- **diagnostics** – relatório de erros/avisos de compilação
- **code_actions** – ações corretivas sugeridas
- **apply_code_action** – aplica edições propostas
- **completion** – (médio prazo) fornece sugestões de código
- **updateFile** – atualiza o conteúdo de um arquivo no servidor e incrementa a versão

A lista acima pode crescer à medida que o `TsserverDaemon` for expandido.

## Quando usar

- Precisa saltar diretamente para a implementação de uma função ou classe
- Quer descobrir todos os usos de um método antes de alterar sua assinatura
- Está analisando relatórios de erros e precisa localizar rapidamente a origem
- Deseja automatizar refatorações simples (renomear, importar, etc.) usando comandos de ação
- Precisa de completions contextuais em uma função ou bloco específico

## Contexto de execução

O daemon roda **no mesmo processo** da aplicação, sem IPC adicional. Ele mantém um `LanguageService`
em memória e acompanha alterações enviadas via `updateFile`. Por padrão, carrega o
`tsconfig.json`/`jsconfig.json` da raiz e observa arquivismo manual apenas em `execute` (não há
watch de FS automático).

### Gestão de conteúdo

- Quando o cliente faz uma edição não salva, chame `updateFile(path, newText)` para manter o
  snapshot sincronizado. Isso incrementa `scriptVersion` internamente.
- Após mutações (apply_code_action ou atualizações manuais), é aconselhável disparar um
  `diagnostics` para revalidar o estado.

## Fluxo canônico de uso via MCP tools

1. Invocar `tools/call` com `method: "lsp_definition"` e parâmetros `{file, position}`.
2. Se necessário, seguir com `lsp_references` ou `lsp_hover` para contexto adicional.
3. Para correção de erro, solicitar `lsp_code_actions` e aplicar com `lsp_apply_code_action` (o
   resultado já faz `updateFile` internamente se a ação alterar o arquivo).
4. Para edição proativa, enviar `lsp_completion` e depois `lsp_update_file` com o snippet escolhido.

## Exemplos expressos em YAML (para MCP)

```yaml
- type: tool
  name: lsp_definition
  input:
    file: src/driver/ChatGPTDriver.js
    position: { line: 42, character: 15 }

- type: tool
  name: lsp_completion
  input:
    file: src/kernel/kernel.js
    position: { line: 120, character: 8 }

- type: tool
  name: lsp_apply_code_action
  input:
    file: src/server/api/tasks.js
    action: 0 # índice retornado por code_actions
```

## Dicas

- Combine com `rag_search` quando precisar de contexto textual amplo antes de invocar a LSP.
- Use `workspace_symbols` com filtros (prefixo/nome) para localizar pontos de entrada de API.
- O servidor não reinicia automaticamente; se alterar `tsconfig.json`, execute uma operação qualquer
  (`definition` etc.) para forçar reload.

## Informações técnicas

- A implementação atual reside em `src/integration/lsp/tsserver-daemon.mjs`.
- Tests estão em `tests/unit/lsp/test_tsserver_daemon.spec.js`.
- O skill não descreve nem controla o lifecycle do daemon; veja `DOCUMENTAÇÃO/LSP_UPGRADE_AUDIT.md`
  para análises de upgrade e manutenção.

## Quando não usar

- Quando a pergunta é puramente lexical (busca de texto) sem necessidade de compreensão semântica
  profunda; neste caso, `grep` ou `rag_search` podem ser mais rápidas.
- Para projetos fora do workspace (`ensureWorkspacePath` vigente, caminho fora bloqueado).

```

Let's also update rag-mcp-lsp-ops to reference this new skill.
But maybe not necessary. We can add a pointer at top. We'll patch file slightly.
Let’s add a line in rag-mcp-lsp-ops near overview referencing lsp-ops skill.
We'll apply multi_replace_string_in_file to modify rag-mcp-lsp-ops accordingly.

The user requested
```
