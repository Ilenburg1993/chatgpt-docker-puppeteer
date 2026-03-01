**Status**: Canônico de apoio.  
**Escopo**: aprofundamento do serviço auxiliar `src/inference_gateway/`.  
**Quando consultar**: ao alterar políticas de inferência, roteamento de backend/modelo, métricas ou a API HTTP do gateway de inferência.  
**Documento-mestre relacionado**: [ARCHITECTURE.md](../ARCHITECTURE.md).

# INFERENCE GATEWAY

**Propósito**: documentar `src/inference_gateway/` como serviço auxiliar de inferência do produto.  
**Status documental**: Canônico de apoio.  
**Público**: engenharia, manutenção, auditoria e agentes de IA.  
**Última atualização**: 28 de fevereiro de 2026.

## Papel arquitetural

O `inference_gateway` é um serviço HTTP separado que centraliza:

- políticas de inferência;
- validação de rota por client tag/model/backend;
- controle de paralelismo por cliente;
- métricas de uso;
- acesso controlado a operações de `generate`, `embed` e `listModels`.

Ele não substitui o runtime principal e não é o motor da automação browser. Ele é um serviço
auxiliar, ativado por flag, para inferência complementar sob governança.

## Estrutura interna de `src/inference_gateway/`

### `main.js`

É o entrypoint do serviço.

Responsabilidades:

- respeitar `INFERENCE_GATEWAY_ENABLED`;
- carregar policies persistidas;
- iniciar o servidor HTTP;
- publicar `ready`;
- coordenar shutdown.

### `gateway.js`

É o núcleo lógico do subsistema.

Responsabilidades:

- resolver policy efetiva por client tag/profile;
- validar rota de inferência;
- controlar concorrência por cliente;
- contabilizar métricas por operação e por client tag;
- delegar chamadas ao cliente de inferência configurado.

### `server.js`

É a borda HTTP do serviço.

Endpoints observáveis:

- `GET /health`
- `GET /metrics`
- `GET /v1/policies`
- `POST /v1/policies/reload`
- `POST /v1/generate`
- `POST /v1/validate/generate`
- `POST /v1/embed`
- `POST /v1/models`

### `policy_config.js`

Responsável por:

- consolidar policy global, por profile e por client;
- validar rota permitida;
- materializar a policy efetiva usada pelo gateway.

### `persistence.js`

Responsável por recarregar e persistir a configuração de políticas.

### `client_tags.js`

Responsável por exigir e validar a identidade do chamador (`clientTag`).

### `ollama_host_supervisor.js`

Responsável por aspectos de supervisão do backend Ollama/host quando aplicável.

## Fluxos principais

### Fluxo de validação de rota

1. O cliente envia `clientTag`, model/backend e contexto opcional.
2. O gateway resolve a policy efetiva.
3. A rota de inferência é validada.
4. Se a rota for proibida, a chamada é rejeitada antes da execução.

### Fluxo de geração

1. O gateway resolve policy.
2. Verifica concorrência máxima permitida para o cliente.
3. Valida rota de inferência.
4. Chama o backend configurado.
5. Atualiza métricas e devolve payload estruturado.

### Fluxo de reload de policies

1. O endpoint de reload é acionado.
2. `reloadPolicies()` recarrega a configuração persistida.
3. O gateway atualiza policies em memória sem reiniciar o processo.

## Relação com outros subsistemas

### Inference Gateway x Integration

- `integration` pode expor tools e chamadas que tangenciam inferência;
- o gateway continua sendo a fronteira de política e enforcement.

### Inference Gateway x Audit Agent

- o `audit_agent` pode depender de clientes/fluxos de inferência, mas não se confunde com este
  serviço.

## Restrições

- O serviço deve continuar ativado apenas por flag explícita.
- Policies precisam continuar sendo avaliadas antes da chamada ao backend.
- Concurrency limit por client tag não deve ser burlado por handlers diretos.

## Referências no código

- `src/inference_gateway/main.js`
- `src/inference_gateway/gateway.js`
- `src/inference_gateway/server.js`
- `src/inference_gateway/policy_config.js`
- `src/inference_gateway/persistence.js`
- `src/inference_gateway/client_tags.js`
- `src/inference_gateway/ollama_host_supervisor.js`
