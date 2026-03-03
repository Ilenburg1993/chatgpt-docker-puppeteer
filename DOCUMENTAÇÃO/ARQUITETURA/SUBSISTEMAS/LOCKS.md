**Status**: Canônico de apoio.  
**Escopo**: aprofundamento da subtrilha `src/infra/locks/`.  
**Quando consultar**: ao alterar exclusão mútua, recuperação de locks órfãos, cleanup em crash ou
proteção de concorrência entre processos.  
**Documento-mestre relacionado**: [ARCHITECTURE.md](../ARCHITECTURE.md).

# LOCKS

**Propósito**: documentar `src/infra/locks/` como a camada de coordenação concorrente do runtime.  
**Status documental**: Canônico de apoio.  
**Público**: engenharia, manutenção, auditoria e agentes de IA.  
**Última atualização**: 28 de fevereiro de 2026.

## Papel arquitetural

`src/infra/locks/` protege o runtime contra colisões de execução entre processos e contra locks
abandonados. Essa trilha existe para:

- garantir exclusão mútua em operações críticas;
- evitar dupla execução sobre o mesmo alvo;
- detectar e recuperar locks órfãos;
- liberar recursos em cenários de crash e encerramento abrupto.

Ela é uma camada de coordenação operacional. Não é scheduler, nem substitui o SSOT.

## Componentes principais

### `lock_manager.js`

É o lock manager baseado em arquivo e ownership.

Responsabilidades observáveis:

- gerar arquivos de lock com prefixo `RUNNING_`;
- adquirir lock por two-phase commit usando arquivo temporário + `fs.link()`;
- evitar overwrite acidental do lock final;
- verificar se o lock atual ainda pertence a um processo vivo;
- recuperar locks órfãos com janela de disputa e recovery lock;
- liberar lock apenas para o owner correto ou por ordem administrativa.

Esse módulo é o núcleo da exclusão mútua entre processos.

### `process_guard.js`

É o verificador soberano de liveness de PID.

Responsabilidades:

- usar `process.kill(pid, 0)` como probe POSIX;
- distinguir `EPERM` (processo existe, mas não é sinalizável) de `ESRCH` (processo ausente);
- oferecer a confirmação mínima para quebra segura de lock órfão.

Sem ele, a trilha correria o risco de apagar locks válidos.

### `resilient_lock.js`

É a camada de proteção contra deadlocks em crash.

Responsabilidades:

- registrar locks ativos em memória;
- anexar handlers de `SIGINT`, `SIGTERM`, `beforeExit`, `uncaughtException` e `unhandledRejection`;
- liberar todos os locks conhecidos em cenários de falha;
- registrar estatísticas de aquisição/liberação e pico de concorrência;
- evitar que o próprio helper assuma controle indevido do lifecycle do processo.

É um wrapper de robustez sobre o ato de adquirir e liberar locks.

## Fluxos principais

### Fluxo de aquisição

1. O caller solicita um lock para um alvo.
2. `lock_manager.js` cria um arquivo temporário com metadados de owner.
3. O módulo tenta promover esse arquivo ao lock final via hard link atômico.
4. Se o lock final já existir, a trilha analisa ocupação e liveness do owner atual.
5. O lock é concedido apenas se a exclusividade puder ser garantida.

### Fluxo de recuperação de lock órfão

1. A trilha encontra um lock já existente.
2. `process_guard.js` verifica se o PID ainda vive.
3. Se o processo morreu, `lock_manager.js` cria um recovery lock temporário.
4. Após uma curta janela de contenção, o owner órfão é revalidado.
5. O lock antigo é removido e a aquisição é tentada novamente.

### Fluxo de cleanup resiliente

1. Um caller adquire lock via `resilient_lock.js`.
2. O lock é registrado em `activeLocks`.
3. O processo sofre sinal ou falha fatal.
4. Os handlers de cleanup chamam `releaseAll()`.
5. Os locks ativos são liberados antes do encerramento efetivo.

## Relação com outros subsistemas

### Locks x Agent

- workers operacionais dependem dessa trilha para evitar concorrência indevida em tasks e alvos;
- bugs em locks normalmente aparecem primeiro como task presa, dupla execução ou starvation.

### Locks x Infra DB

- locks em arquivo e locks lógicos em banco podem coexistir;
- a trilha de locks não substitui transação, mas protege fronteiras de processo.

### Locks x Kernel / Orchestrator

- o plano de decisão assume que a infraestrutura de lock garante serialização onde o contrato exige.

## Restrições e guardrails

- O owner do lock deve continuar identificável por PID e metadados.
- `fs.link()` é parte importante da atomicidade; não deve ser trocado por uma estratégia que permita
  overwrite silencioso.
- Break de lock só pode ocorrer após verificação de processo órfão.
- `resilient_lock.js` pode limpar recursos, mas não deve tomar posse do lifecycle completo do
  processo.

## Sinais de atenção

- locks persistindo após crash;
- recovery loops frequentes;
- aumento de `totalFailedAcquire`;
- lock files órfãos acumulados em disco;
- `EPERM` sendo interpretado incorretamente como processo morto.

## Referências no código

- `src/infra/locks/lock_manager.js`
- `src/infra/locks/process_guard.js`
- `src/infra/locks/resilient_lock.js`
