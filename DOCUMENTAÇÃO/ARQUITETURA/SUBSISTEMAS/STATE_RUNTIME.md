**Status**: Canônico de apoio.  
**Escopo**: aprofundamento da área `src/state/` como raiz de estado runtime em disco.  
**Quando consultar**: ao alterar persistência local de estado transitório, checkpoints em filesystem
ou layout de state on-disk fora do SQLite.  
**Documento-mestre relacionado**: [ARCHITECTURE.md](../ARCHITECTURE.md).

# STATE RUNTIME

**Propósito**: documentar `src/state/` como raiz de estado local em filesystem.  
**Status documental**: Canônico de apoio.  
**Público**: engenharia, manutenção e agentes de IA.  
**Última atualização**: 28 de fevereiro de 2026.

## Papel arquitetural

`src/state/` é uma área auxiliar de persistência local para estado transitório ou recuperável fora
do SQLite. No snapshot atual do repositório, ela está representada principalmente por
`src/state/README.md`, que descreve a estrutura esperada de runtime.

Essa trilha existe para:

- acomodar estado em disco gerado pelo processo;
- permitir recovery de componentes específicos;
- separar state local de arquivos-fonte e do SSOT em SQLite.

## Estrutura observável

### `src/state/README.md`

É o documento local que define a topologia esperada de runtime state:

- `tasks/`
- `workflows/`
- `memory/`
- `kernel/`

No baseline atual, esses diretórios são descritos como áreas de estado JSON com escrita atômica, mas
não aparecem versionados como código-fonte nesta árvore.

## Relação com outros subsistemas

### State Runtime x Infra DB

- SQLite continua sendo o SSOT principal;
- `src/state/` deve ser lido como estado auxiliar/local, não como nova fonte de verdade global.

### State Runtime x Orchestrator

- checkpoints de missão e outros snapshots em arquivo dialogam conceitualmente com esta trilha,
  mesmo quando implementados fora dela.

### State Runtime x Kernel

- a área `kernel/` descrita no README existe para suportar estado runtime do motor quando aplicável,
  sem substituir o estado persistido do domínio.

## Restrições e guardrails

- Não tratar `src/state/` como substituto do banco SSOT.
- O layout on-disk deve permanecer explícito e documentado.
- Novas áreas persistidas em disco devem ser adicionadas ao contrato desta trilha.

## Observação importante

Hoje `src/state/` é mais contrato de layout do que implementação extensa versionada. Isso é
intencional: o diretório descreve o espaço de runtime, enquanto o código efetivo continua espalhado
por subsistemas como `orchestrator`, `kernel` e `infra`.

## Referências no código

- `src/state/README.md`
- `src/orchestrator/checkpoint_manager.js`
- `src/logic/adaptive.js`
