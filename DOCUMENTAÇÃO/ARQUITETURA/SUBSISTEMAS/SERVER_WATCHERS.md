**Status**: Canônico de apoio.  
**Escopo**: aprofundamento da subtrilha `src/server/watchers/`.  
**Quando consultar**: ao alterar sensores de filesystem, reação a mudanças de fila, monitoramento de
log ou integração desses sinais com o dashboard e o agent.  
**Documento-mestre relacionado**: [ARCHITECTURE.md](../ARCHITECTURE.md).

# SERVER WATCHERS

**Propósito**: documentar `src/server/watchers/` como a camada de sensores reativos do servidor.  
**Status documental**: Canônico de apoio.  
**Público**: engenharia, manutenção, observabilidade e agentes de IA.  
**Última atualização**: 28 de fevereiro de 2026.

## Papel arquitetural

`src/server/watchers/` monitora sinais físicos do ambiente que não dependem de chamadas HTTP. Essa
trilha:

- observa mudanças no filesystem;
- acompanha rotação e disponibilidade do log operacional;
- propaga indícios rápidos para o dashboard e para a malha de execução;
- reduz latência de reação sem criar um novo loop de negócio.

Ela é uma camada de sensoriamento e sinalização, não de processamento de domínio.

## Componentes principais

### `fs_watcher.js`

É o sensor de filesystem da fila.

Responsabilidades observáveis:

- observar a pasta física da fila via `fs.watch`;
- garantir que o alvo exista antes de iniciar o watcher;
- filtrar apenas eventos relevantes de arquivos `.json`;
- aplicar debounce para evitar múltiplos disparos da mesma alteração;
- invalidar cache de infra;
- notificar o dashboard;
- acordar o agent por `notifyAgent('cache_dirty')`.

Esse arquivo é a ligação mais rápida entre mudança física de fila e reação do runtime.

### `log_watcher.js`

É o monitor de integridade do log operacional.

Responsabilidades:

- vigiar `agente_current.log`;
- tolerar ausência inicial do arquivo com retry agendado;
- detectar rotação (`rename`) e perdas de handle;
- reanexar o watcher após rotação;
- proteger o ciclo de vida com cleanup de watcher e timers.

Ele não faz streaming do conteúdo em si; ele garante que a vigilância sobre o arquivo continue viva.

## Fluxos principais

### Fluxo de mudança na fila

1. Um arquivo `.json` da fila é criado, alterado ou removido.
2. `fs_watcher.js` recebe o evento do SO.
3. O debounce consolida eventos redundantes.
4. O cache de infra é marcado como dirty.
5. Dashboard e agent recebem o sinal de mudança.

### Fluxo de rotação de log

1. O arquivo de log é rotacionado.
2. O watcher recebe `rename` ou erro do driver de observação.
3. `log_watcher.js` encerra o watcher atual.
4. Um reconnect é agendado após uma janela curta.
5. A vigilância é restabelecida quando o arquivo reaparece.

## Relação com outros subsistemas

### Server Watchers x Engine Socket

- `fs_watcher.js` usa a camada de socket do servidor para avisar o dashboard;
- a entrega ao cliente continua sendo responsabilidade do hub de realtime.

### Server Watchers x Agent

- o watcher de fila emite sinais rápidos para o plano operacional do agent;
- isso evita depender só de polling mais lento em alguns cenários.

### Server Watchers x Infra

- a trilha depende de caminhos físicos e marca cache de infra como sujo;
- mudanças de filesystem aqui afetam consistência percebida por múltiplos subsistemas.

## Restrições e guardrails

- Watchers devem continuar leves e não executar regra de negócio complexa.
- Debounce e reconnect são parte do contrato de robustez e não devem ser removidos sem substituição
  equivalente.
- O watcher de log deve continuar tolerante à rotação física do arquivo.
- O watcher de fila deve permanecer focado em sinalizar, não em processar tarefas.

## Sinais de atenção

- múltiplos disparos por uma única mudança de fila;
- loops de reconnect no log watcher;
- fila mudando sem emissão de `cache_dirty`;
- watchers órfãos após restart parcial do servidor.

## Referências no código

- `src/server/watchers/fs_watcher.js`
- `src/server/watchers/log_watcher.js`
