**Status**: Canônico de apoio.  
**Escopo**: aprofundamento da subtrilha `src/server/handlers/`.  
**Quando consultar**: ao alterar superfícies MCP, compatibilidade OpenAI, transformação de payloads
de inferência ou endpoints protocolados montados pelo servidor.  
**Documento-mestre relacionado**: [ARCHITECTURE.md](../ARCHITECTURE.md).

# SERVER HANDLERS

**Propósito**: documentar `src/server/handlers/` como a camada de protocolos especiais expostos pelo
servidor.  
**Status documental**: Canônico de apoio.  
**Público**: engenharia, integração, manutenção e agentes de IA.  
**Última atualização**: 28 de fevereiro de 2026.

## Papel arquitetural

`src/server/handlers/` acomoda superfícies HTTP que não se encaixam apenas no padrão CRUD da API
interna. Essa trilha:

- expõe protocolos especializados para LLMs e ferramentas externas;
- adapta contratos de entrada e saída para ecossistemas já existentes;
- reaproveita o runtime interno sem forçar clientes externos a conhecer a topologia interna.

Ela é uma camada de compatibilidade de protocolo, não a regra de negócio central.

## Componentes principais

### `mcp-handler.js`

É a superfície MCP do produto.

Responsabilidades observáveis:

- expor um endpoint HTTP compatível com o fluxo MCP baseado em JSON-RPC;
- responder `initialize`, `ping`, `tools/list`, `tools/call`, `resources/list` e `resources/read`;
- encapsular timeouts e cancelamento para execução de tools;
- reutilizar o tool registry por trás da interface MCP;
- expor recursos auxiliares como estatísticas de RAG e templates de missão quando disponíveis.

Esse módulo é a principal ponte formal entre o runtime e clientes MCP.

### `openai-handler.js`

É a superfície OpenAI-compatible.

Responsabilidades:

- registrar `POST /v1/chat/completions`;
- registrar `GET /v1/models`;
- validar e traduzir a requisição recebida;
- chamar o cliente Ollama subjacente;
- devolver um payload compatível com o ecossistema OpenAI/Copilot.

Esse handler existe para compatibilidade de consumo, não para substituir a API interna do produto.

### `openai-transformer.js`

É a camada pura de tradução de schema.

Responsabilidades:

- validar o payload do formato OpenAI;
- traduzir mensagens OpenAI para o formato esperado pelo backend Ollama;
- converter a resposta recebida em um payload OpenAI-compatible;
- produzir objetos de erro padronizados sem acoplar IO à transformação.

A separação aqui é importante: protocolo e transformação ficam testáveis e desacoplados.

## Fluxos principais

### Fluxo MCP

1. Um cliente externo chama `/api/mcp`.
2. `mcp-handler.js` identifica o método protocolado.
3. O handler consulta capacidades, tools ou resources.
4. Quando necessário, a execução é roteada para o tool registry.
5. O cliente recebe uma resposta protocolada e compatível com MCP.

### Fluxo OpenAI-compatible

1. Um cliente envia `POST /v1/chat/completions`.
2. `openai-handler.js` valida o request.
3. `openai-transformer.js` converte para o formato do backend.
4. O cliente Ollama é chamado.
5. A resposta é traduzida de volta para o formato OpenAI.

### Fluxo de erro protocolado

1. O request falha por validação, timeout ou backend.
2. O handler traduz a falha para o contrato do protocolo exposto.
3. O cliente recebe erro compatível com o ecossistema que ele espera.

## Relação com outros subsistemas

### Server Handlers x Integration

- essa trilha expõe protocolos externos;
- `src/integration/` e `tools/` concentram parte dos recursos e ferramentas reutilizados por esses
  protocolos.

### Server Handlers x Missions

- o MCP pode consultar templates e recursos ligados ao domínio de missões;
- isso faz desta trilha uma ponte, não o dono desse domínio.

### Server Handlers x Inference Gateway / Ollama

- a compatibilidade OpenAI reaproveita a infraestrutura de inferência já existente;
- mudanças nessa trilha afetam integração com clientes externos de LLM.

## Restrições e guardrails

- `mcp-handler.js` deve permanecer uma camada protocolada, não um repositório de lógica de negócio.
- Timeouts e cancelamentos não devem ser removidos da execução de tool.
- `openai-transformer.js` deve continuar puro e focado em transformação de dados.
- A compatibilidade OpenAI não deve prometer recursos que o backend real não suporta.

## Sinais de atenção

- clientes MCP falhando no `initialize`;
- timeouts excessivos em `tools/call`;
- divergência entre o schema OpenAI recebido e o traduzido;
- payloads protocolados fugindo do formato esperado por Copilot ou outros clientes.

## Referências no código

- `src/server/handlers/mcp-handler.js`
- `src/server/handlers/openai-handler.js`
- `src/server/handlers/openai-transformer.js`
