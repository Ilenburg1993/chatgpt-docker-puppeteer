**Status**: Canônico de apoio.  
**Escopo**: aprofundamento da subtrilha `src/infra/storage/`.  
**Quando consultar**: ao alterar persistência de artifacts, respostas, DNA, snapshots de tarefa ou
contratos de escrita em disco.  
**Documento-mestre relacionado**: [ARCHITECTURE.md](../ARCHITECTURE.md).

# STORAGE

**Propósito**: documentar `src/infra/storage/` como a camada de materialização em disco do
runtime.  
**Status documental**: Canônico de apoio.  
**Público**: engenharia, manutenção, auditoria e agentes de IA.  
**Última atualização**: 28 de fevereiro de 2026.

## Papel arquitetural

`src/infra/storage/` é a camada que transforma resultados de execução em arquivos concretos. Ela não
substitui o SSOT do banco, mas fornece a persistência física complementar que:

- guarda artifacts textuais, JSON e binários;
- armazena respostas renderizadas em múltiplos formatos;
- preserva snapshots auxiliares de task;
- mantém dados de identidade/DNA onde o runtime ainda usa essa trilha;
- oferece paths estáveis para auditoria, inspeção manual e integração externa.

O banco continua sendo a fonte de verdade transacional. `storage/` é o plano de materialização e
retenção de payloads.

## Componentes principais

### `artifact_store.js`

É o módulo soberano de artifacts.

Responsabilidades observáveis:

- resolver o root de artifacts com precedência de ambiente (`MAESTRO_ARTIFACTS_DIR`,
  `ARTIFACTS_DIR`);
- validar caminhos relativos com normalização POSIX;
- impedir path traversal e escape do root;
- aplicar limites defensivos de tamanho por tipo de artifact;
- escrever com atomicidade;
- interoperar com o repositório de artifacts do banco para leitura/remoção por id.

Esse módulo é a peça mais importante da trilha para evitar corrupção de disco e escrita fora do
escopo permitido.

### `response_store_v2.js`

É a implementação principal de persistência de respostas.

Responsabilidades:

- salvar a mesma resposta em `txt`, `md`, `json` e `html`;
- estruturar a árvore por `taskId` e `attemptId`;
- usar atomic write para todos os formatos;
- manter um espelho legado opcional para compatibilidade com consumidores antigos;
- suportar leitura, listagem, verificação de existência e remoção.

Esse arquivo é o contrato mais moderno da trilha de respostas.

### `response_store.js`

É a trilha legada de persistência de respostas.

Função arquitetural:

- manter compatibilidade com fluxos anteriores que ainda dependem do contrato mais antigo.

Quando possível, mudanças novas devem privilegiar `response_store_v2.js` e tratar este módulo como
compatibilidade.

### `response_adapter.js`

É a camada de adaptação entre formatos internos e o contrato de persistência de respostas.

Função:

- normalizar payloads para a camada de storage;
- reduzir acoplamento entre o produtor da resposta e o formato de escrita final.

### `task_store.js`

É a persistência auxiliar de snapshots de task.

Função:

- materializar dados operacionais de tarefa quando o fluxo precisa de um artefato físico além do
  registro transacional em banco.

### `dna_store.js` e `dna_evolution.js`

Esses módulos acomodam persistência e evolução de identidade/configuração histórica do runtime.

Função arquitetural:

- manter um repositório em disco para dados de DNA/identidade quando esse fluxo estiver ativo;
- separar esse plano de persistência da tabela relacional principal.

### `robot_identity.json`

É um artefato versionado de identidade estática.

Leitura correta:

- faz parte do material auxiliar desta trilha;
- não é um subsistema isolado;
- não deve ser confundido com o SSOT do runtime.

### `artifact_store.js.backup`

Existe como sobra histórica local da trilha.

Política documental:

- não faz parte do contrato canônico;
- não deve guiar mudanças novas;
- só serve como referência de histórico local enquanto permanecer versionado.

## Fluxos principais

### Fluxo de artifact

1. Um driver, worker ou adapter produz um payload.
2. `artifact_store.js` resolve o root e valida o caminho relativo.
3. O módulo cria o diretório necessário.
4. A escrita é feita de forma atômica.
5. O arquivo resultante passa a ser referenciado por URI e, quando aplicável, pelo banco.

### Fluxo de resposta V2

1. Uma execução conclui e produz `responseData`.
2. `response_store_v2.js` calcula o caminho sob `responses/`.
3. Os quatro formatos são persistidos em paralelo.
4. Um espelho legado pode ser escrito para compatibilidade.
5. Consumidores externos podem ler por formato, task e tentativa.

### Fluxo de leitura controlada

1. O caller pede um artifact por id ou caminho lógico.
2. A trilha valida o path contra o root autorizado.
3. O arquivo é lido apenas se permanecer sob o root.
4. O runtime evita vazamento por traversal ou caminho arbitrário.

## Relação com outros subsistemas

### Storage x Infra DB

- o banco guarda metadados, ids, vínculos e estado;
- `storage/` guarda o payload físico complementar.

As duas camadas são complementares e não devem divergir.

### Storage x Driver

- o driver usa essa trilha para artifacts de execução browser, capturas e saídas persistentes;
- mudanças em storage afetam diretamente auditoria e debug do driver.

### Storage x Agent / Kernel

- workers e loops operacionais podem depender da materialização em disco para checkpoint, replay,
  resposta final e rastreabilidade.

## Restrições e guardrails

- Todo path deve permanecer sob o root de artifacts.
- `artifact_store.js` não deve aceitar traversal, caminhos absolutos nem segmentos ambíguos.
- A escrita deve continuar atômica.
- `response_store_v2.js` é o contrato preferencial; compatibilidade legada não deve ditar o novo
  design.
- Dados de storage não substituem o SSOT relacional.

## Sinais de atenção

- crescimento não controlado de artifacts no disco;
- falhas recorrentes de atomic write;
- divergência entre espelho legado e o formato V2;
- caminhos inválidos ou rejeitados por `_safeRel`;
- payloads grandes demais batendo nos limites defensivos.

## Referências no código

- `src/infra/storage/artifact_store.js`
- `src/infra/storage/response_store_v2.js`
- `src/infra/storage/response_store.js`
- `src/infra/storage/response_adapter.js`
- `src/infra/storage/task_store.js`
- `src/infra/storage/dna_store.js`
- `src/infra/storage/dna_evolution.js`
- `src/infra/storage/robot_identity.json`
