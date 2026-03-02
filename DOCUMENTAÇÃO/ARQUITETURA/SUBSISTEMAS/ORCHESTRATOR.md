**Status**: Canônico de apoio.  
**Escopo**: aprofundamento do subsistema `src/orchestrator/`.  
**Quando consultar**: ao alterar estratégias `SINGLE_SHOT`/`ITERATIVE`/`MULTI_STEP`, contexto de
missão, checkpoints, memória adaptativa ou validação pós-execução.  
**Documento-mestre relacionado**: [ARCHITECTURE.md](../ARCHITECTURE.md).

# ORCHESTRATOR

**Propósito**: documentar `src/orchestrator/` como a camada de estratégia e coordenação de execução
acima do kernel.  
**Status documental**: Canônico de apoio.  
**Público**: engenharia, manutenção e agentes de IA.  
**Última atualização**: 28 de fevereiro de 2026.

## Papel arquitetural

`src/orchestrator/` decide como uma tarefa ou missão deve evoluir quando a execução exige mais do
que um disparo simples. Essa trilha:

- escolhe e sustenta estratégias de execução;
- mantém contexto incremental;
- oferece checkpoints para recovery;
- guarda memória adaptativa de padrões;
- valida resultados antes de decidir continuação, retry ou próximo step.

Ela não substitui o kernel. O kernel executa; o orchestrator define a estratégia de continuidade.

## Componentes principais

### `orchestrator_engine.js`

É a peça soberana do subsistema.

Responsabilidades observáveis:

- expor `shouldOrchestrate(task)`;
- preparar tarefas antes da execução com `beforeExecution(task)`;
- processar o resultado com `afterExecution(task, executionResult)`;
- sustentar estratégias `SINGLE_SHOT`, `ITERATIVE` e `MULTI_STEP`;
- manter `activeWorkflows` e `activeIterations` em memória;
- usar lock resiliente por workflow para evitar races;
- emitir eventos de orquestração via NERV.

### `context_manager.js`

É a memória de contexto por missão.

Responsabilidades:

- inicializar contexto por `mission_id`;
- anexar outputs de steps;
- estimar tokens;
- aplicar chunking (`none`, `sliding_window`, `hierarchical`, `token_limit`);
- decidir quando resumir ou podar contexto;
- expor o contexto relevante para o próximo step.

### `checkpoint_manager.js`

É a camada de crash recovery baseada em snapshot.

Responsabilidades:

- salvar checkpoint completo por step;
- manter `checkpoint-latest.json`;
- listar, carregar e excluir checkpoints;
- fazer cleanup LRU por missão.

### `memory_store.js`

É a memória adaptativa leve do subsistema.

Responsabilidades:

- registrar padrões por tipo (`feedback`, `validation`, `error`, `success`, `custom`);
- buscar padrões relevantes por keyword;
- aplicar eviction LRU;
- manter métricas de acerto, busca e evicção.

### `validation/validation_service.js`

É a malha de validação de outputs no nível de orquestração.

Responsabilidades:

- executar validadores compostos (`regex`, `length`, `schema`, `format`, `llm_judge`, `custom`);
- calcular `overall_score`;
- consolidar issues e feedback;
- decidir aprovação com base em `min_quality_score`.

Observação importante: no baseline atual, `llm_judge` dentro deste serviço está explicitamente em
modo bypass quando não implementado, retornando `score = null` em vez de um score arbitrário.

### `index.js`

Barrel de compatibilidade que reexporta os pontos públicos do subsistema.

## Fluxos principais

### Fluxo iterativo

1. A task é marcada como `ITERATIVE`.
2. `beforeExecution()` inicializa o estado de iteração.
3. O kernel executa a task.
4. `afterExecution()` chama a validação.
5. O orchestrator decide `DONE` ou `RETRY` com feedback.

### Fluxo multi-step

1. A task pertence a um workflow `MULTI_STEP`.
2. `beforeExecution()` inicializa o estado do workflow.
3. O step executa.
4. O resultado é validado e o contexto atualizado.
5. O orchestrator decide `NEXT_STEP` ou encerramento do workflow.

### Fluxo de recovery

1. Um step é concluído.
2. O estado é serializado em checkpoint.
3. Em reinício ou crash, o último checkpoint pode ser recarregado.

## Relação com outros subsistemas

### Orchestrator x Kernel

- o orchestrator decide a estratégia e o próximo movimento;
- o kernel continua sendo o motor de execução efetiva.

### Orchestrator x Agent

- workers podem acionar execução de tasks que depois entram em fluxo iterativo ou multi-step;
- o orchestrator não substitui a malha operacional de `src/agent/`.

### Orchestrator x Missions

- workflows e contexto de missão se conectam diretamente a esta trilha;
- multi-step é a ponte mais direta entre domínio de missão e execução.

### Orchestrator x Validation

- o subsistema possui sua própria camada de validação de saída;
- isso convive com a trilha `src/logic/validation/` e com `src/validation/` como camadas
  complementares, não idênticas.

## Restrições e guardrails

- Não empurrar estratégia de workflow para dentro do kernel por conveniência.
- Não usar `memory_store` como fonte de verdade persistida.
- Checkpoints devem continuar sendo recovery auxiliar, não substituto do SSOT.
- Mudanças nas estratégias de execução impactam `task_orchestration_worker` e `missions`.

## Referências no código

- `src/orchestrator/orchestrator_engine.js`
- `src/orchestrator/context_manager.js`
- `src/orchestrator/checkpoint_manager.js`
- `src/orchestrator/memory_store.js`
- `src/orchestrator/validation/validation_service.js`
- `src/orchestrator/index.js`
