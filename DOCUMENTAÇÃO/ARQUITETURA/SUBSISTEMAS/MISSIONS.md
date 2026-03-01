**Status**: Canônico de apoio.  
**Escopo**: aprofundamento do domínio de missões e workflow em `src/missions/`.  
**Quando consultar**: ao alterar templates, geração de workflow, estado de missão, feedback ou lifecycle de missão de longa duração.  
**Documento-mestre relacionado**: [ARCHITECTURE.md](../ARCHITECTURE.md).

# MISSIONS

**Propósito**: documentar `src/missions/` como o domínio de missões do produto.  
**Status documental**: Canônico de apoio.  
**Público**: engenharia, manutenção, auditoria e agentes de IA.  
**Última atualização**: 28 de fevereiro de 2026.

## Papel arquitetural

`src/missions/` modela o conceito de missão de longa duração. É aqui que vivem:

- definição de missão;
- estado e progresso;
- templates;
- geração de workflow;
- feedback e checkpoint conceitual.

Essa camada representa o domínio. Ela não é a camada que faz o polling contínuo; isso pertence a
`src/agent/`.

## Estrutura interna de `src/missions/`

### `mission_manager.js`

- coordena o ciclo de vida de missão;
- integra missão com NERV;
- lida com criação, leitura, execução, recuperação e sincronização de status.

### `mission_state_manager.js`

- persiste e consulta o estado da missão;
- sustenta a visão de estado e progresso.

### `workflow_generator.js`

- carrega templates;
- valida parâmetros;
- expande steps;
- substitui placeholders;
- gera o workflow estruturado a partir do template escolhido.

### `feedback_processor.js`

- consolida feedback e sinais para evolução da missão e contexto.

### `templates/`

- catálogo versionado de templates de missão;
- define os insumos base para geração de workflows.

## Fluxo canônico de missão

1. Um template é selecionado.
2. `WorkflowGenerator` carrega o template e valida parâmetros.
3. O workflow é expandido e materializado.
4. `MissionManager` cria e inicializa a missão.
5. `src/agent/mission_runner.js` passa a operar essa missão em execução.
6. O progresso é refletido de volta no estado da missão.

## Relação com outros subsistemas

### Missions x Agent

- `src/missions/` define missão, workflow e estado;
- `src/agent/` executa os loops que avançam esse estado.

### Missions x Orchestrator

- o orchestrator ajuda a decidir progressão e contexto de steps;
- o domínio de missão continua separado da estratégia de execução técnica.

### Missions x Infra

- persistência de missão depende de DB e repositórios em `src/infra/db/`.

## Restrições

- Não deslocar o domínio de missão para dentro dos workers de `src/agent/`.
- Não tratar templates como detalhe de UI; eles são parte do contrato de execução.

## Referências no código

- `src/missions/mission_manager.js`
- `src/missions/mission_state_manager.js`
- `src/missions/workflow_generator.js`
- `src/missions/feedback_processor.js`
- `src/missions/templates/`
