**Status**: Canônico de apoio.  
**Escopo**: aprofundamento das integrações técnicas em `src/integration/`.  
**Quando consultar**: ao alterar MCP, LSP, tool registry, ferramentas expostas a LLMs ou políticas
de circuit breaker para integrações.  
**Documento-mestre relacionado**: [ARCHITECTURE.md](../ARCHITECTURE.md).

# INTEGRATION

**Propósito**: documentar `src/integration/` como a camada de integração técnica do produto.  
**Status documental**: Canônico de apoio.  
**Público**: engenharia, manutenção, auditoria e agentes de IA.  
**Última atualização**: 28 de fevereiro de 2026.

## Papel arquitetural

`src/integration/` conecta o runtime a ferramentas e protocolos externos. Essa camada existe para:

- expor ferramentas consumíveis por LLMs e clients externos;
- integrar MCP;
- integrar LSP/tsserver;
- coordenar tools compartilhadas sob uma registry única;
- proteger chamadas de integração com circuit breakers e classificação de erro.

Ela é uma camada de integração técnica, não o núcleo do runtime soberano.

## Estrutura interna de `src/integration/`

### `tool-registry.mjs`

É a peça central do subsistema.

Responsabilidades:

- registrar ferramentas em um único registry;
- normalizar metadata e payloads de retorno;
- executar tools com timeout, retries opcionais e integração com circuit breaker;
- permitir que a mesma tool seja reutilizada por MCP, REST e chamadas internas.

Essa registry é o SSOT das tools LLM-facing do projeto.

### `tools/`

Concentra as famílias de tools efetivamente registradas.

Peças observáveis:

- `lsp-tools.mjs`
- `mcp-upstream-tools.mjs`
- `ollama-tools.mjs`
- `rag-tools.mjs`

Responsabilidades:

- definir handlers por família;
- registrar schemas de entrada;
- declarar se a tool é mutante ou requer confirmação explícita.

### `lsp/`

Integra a camada LSP.

Peça principal:

- `tsserver-daemon.mjs`

Responsabilidades:

- manter um daemon lógico para operações com TypeScript;
- suportar `definition`, `references`, `hover`, `document_symbols`, `workspace_symbols`,
  `diagnostics`, `code_actions`, `apply_code_action`;
- enfileirar requisições e aplicar timeout/cancelamento;
- garantir que os caminhos operados permaneçam dentro do workspace.

### `mcp/`

Integra upstreams MCP.

Peças observáveis:

- `upstream-manager.mjs`
- `upstream-http.mjs`
- `upstream-stdio.mjs`
- `upstream-stdio-sdk.mjs`

Responsabilidades:

- ler configuração de upstreams;
- suportar transporte HTTP e stdio;
- registrar ferramentas de upstream com prefixos/aliases;
- manter estado, retries e shutdown hooks.

### `ollama-circuit-breaker.mjs`

Implementa proteção contra cascata de falhas em chamadas de inferência.

Responsabilidades:

- abrir e fechar circuito;
- evitar thundering herd;
- expor estado e métricas do circuito.

### `error-classifier.mjs`

Responsável por normalização/classificação de falhas de integração.

## Fluxos principais

### Fluxo de tool local

1. Uma tool é registrada no `ToolRegistry`.
2. Um caller interno, MCP ou REST solicita a execução.
3. A registry valida a existência e executa o handler.
4. O payload é normalizado e devolvido ao canal chamador.

### Fluxo de LSP

1. A tool LSP é acionada.
2. O daemon tsserver é iniciado se necessário.
3. A operação é serializada em fila.
4. O resultado é devolvido em formato normalizado para a registry.

### Fluxo de MCP upstream

1. Um upstream é configurado por ENV.
2. O manager conecta ao upstream por HTTP ou stdio.
3. As tools desse upstream são importadas e namespaced.
4. O registry local passa a expor essas tools como se fossem locais.

## Relação com outros subsistemas

### Integration x Server

- o server expõe parte dessa camada, especialmente via `/api/mcp` e handlers relacionados.

### Integration x Inference Gateway

- algumas tools e políticas tangenciam inferência, mas o `inference_gateway` continua sendo um
  serviço separado.

### Integration x Agents/LLMs

- essa é a principal camada que transforma recursos internos em ferramentas consumíveis por LLMs.

## Restrições

- A registry deve continuar sendo a fonte única de registro de tools.
- Tools mutantes devem continuar sinalizando mutação e confirmação.
- Upstreams MCP não devem ser tratados como baseline confiável sem isolamento por alias/prefixo.

## Lacunas e observações

- `src/integration/` é uma área ampla e merece, numa próxima passada, docs especializados por trilha
  (`MCP`, `LSP`, `RAG tools`, `Ollama tools`) se o objetivo for documentação máxima.

## Referências no código

- `src/integration/tool-registry.mjs`
- `src/integration/tools/lsp-tools.mjs`
- `src/integration/tools/mcp-upstream-tools.mjs`
- `src/integration/tools/ollama-tools.mjs`
- `src/integration/tools/rag-tools.mjs`
- `src/integration/lsp/tsserver-daemon.mjs`
- `src/integration/mcp/upstream-manager.mjs`
- `src/integration/mcp/upstream-http.mjs`
- `src/integration/mcp/upstream-stdio-sdk.mjs`
- `src/integration/ollama-circuit-breaker.mjs`
- `src/integration/error-classifier.mjs`
