**Status**: Canônico de apoio.  
**Escopo**: aprofundamento do serviço auxiliar `src/audit_agent/`.  
**Quando consultar**: ao alterar jobs de auditoria, triagem LLM, patch authoring, persistência ou a
API HTTP do agente de auditoria.  
**Documento-mestre relacionado**: [ARCHITECTURE.md](../ARCHITECTURE.md).

# AUDIT AGENT

**Propósito**: documentar `src/audit_agent/` como serviço auxiliar de auditoria em background.  
**Status documental**: Canônico de apoio.  
**Público**: engenharia, manutenção, auditoria e agentes de IA.  
**Última atualização**: 28 de fevereiro de 2026.

## Papel arquitetural

O `audit_agent` é um serviço HTTP separado, opt-in, que executa auditorias e triagens assistidas.

Ele centraliza:

- criação e fila de jobs de auditoria;
- hidratação de jobs a partir de store persistente;
- coleta de contexto;
- integração com clientes de triagem e patch authoring;
- exposição de API para criar, enfileirar, cancelar e consultar jobs.

Não é parte do loop central de execução do produto; é um serviço auxiliar voltado a auditoria e
análise.

## Estrutura interna de `src/audit_agent/`

### `main.js`

É o entrypoint do serviço.

Responsabilidades:

- respeitar `AUDIT_AGENT_ENABLED`;
- resolver configuração de modo, concorrência e persistência;
- montar store, context builder e clientes LLM quando disponíveis;
- iniciar runtime e servidor HTTP;
- rodar heartbeat/ticks do runtime;
- publicar `ready` e coordenar shutdown.

### `runtime.js`

É o núcleo lógico do serviço.

Responsabilidades:

- criar e manter jobs em memória;
- hidratar jobs a partir de store;
- limitar concorrência;
- persistir snapshots, findings e patch proposals;
- coordenar etapas de execução da auditoria;
- manter métricas de tick, conclusão e falha.

### `server.js`

É a borda HTTP do serviço.

Endpoints observáveis:

- `GET /health`
- `GET /metrics`
- `GET /jobs`
- `GET /jobs/:id`
- `POST /jobs`
- `POST /jobs/:id/run`
- `POST /jobs/:id/cancel`

### `contracts.js`

Responsável por:

- declarar `AUDIT_JOB_KIND`, `AUDIT_JOB_STATUS` e `AUDIT_JOB_TRIGGER_TYPE`;
- validar o vocabulário do subsistema.

### `db_store.js`

Responsável por persistência de jobs e resultados quando o modo persistido está habilitado.

### `context_builder.js`

Responsável por coleta e montagem de contexto para a auditoria.

### `triage_llm.js`

Responsável pela integração com o cliente de triagem LLM.

### `patch_author_llm.js`

Responsável pela integração com o cliente que propõe patchs.

## Fluxos principais

### Fluxo de criação de job

1. Um cliente chama `POST /jobs`.
2. O runtime valida kind e trigger.
3. O job é criado em memória.
4. O store persiste o snapshot quando habilitado.

### Fluxo de execução

1. O job é enfileirado ou disparado manualmente.
2. O runtime coleta contexto.
3. O runtime aciona triagem LLM quando disponível.
4. O runtime aciona patch author quando disponível.
5. Findings e patch proposals são persistidos.
6. O status do job é atualizado para concluído ou falho.

### Fluxo de recuperação

1. O serviço sobe.
2. `hydrateFromStore()` traz jobs persistidos.
3. O runtime retoma o estado observável anterior.

## Relação com outros subsistemas

### Audit Agent x Integration

- a montagem de contexto e o uso de tools podem depender da camada de integração.

### Audit Agent x Inference

- clientes de triagem/patch podem depender de serviços de inferência, mas o serviço permanece
  separado do `inference_gateway`.

### Audit Agent x Runtime principal

- ele observa e analisa o repositório/sistema;
- não é o loop soberano de execução do produto.

## Restrições

- O serviço deve continuar opt-in por `AUDIT_AGENT_ENABLED`.
- Falha na disponibilidade de LLM clients não deve impedir o runtime básico do serviço; ele deve
  degradar com clareza.
- Jobs e estados devem continuar usando um vocabulário estável de contrato.

## Referências no código

- `src/audit_agent/main.js`
- `src/audit_agent/runtime.js`
- `src/audit_agent/server.js`
- `src/audit_agent/contracts.js`
- `src/audit_agent/db_store.js`
- `src/audit_agent/context_builder.js`
- `src/audit_agent/triage_llm.js`
- `src/audit_agent/patch_author_llm.js`
