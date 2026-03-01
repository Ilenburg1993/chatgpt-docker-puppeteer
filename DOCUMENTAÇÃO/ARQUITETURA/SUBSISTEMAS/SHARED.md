**Status**: Canônico de apoio.  
**Escopo**: aprofundamento de `src/shared/` como base transversal de contratos e helpers reutilizáveis.  
**Quando consultar**: ao alterar helpers compartilhados entre subsistemas, protocolo NERV compartilhado, biomecânica, estabilização de página ou utilitários transversais.  
**Documento-mestre relacionado**: [ARCHITECTURE.md](../ARCHITECTURE.md).

# SHARED

**Propósito**: documentar `src/shared/` como a camada de primitivas compartilhadas do repositório.  
**Status documental**: Canônico de apoio.  
**Público**: engenharia, manutenção e agentes de IA.  
**Última atualização**: 28 de fevereiro de 2026.

## Papel arquitetural

`src/shared/` existe para evitar duplicação de contratos e algoritmos entre subsistemas. Essa
trilha concentra:

- vocabulário compartilhado;
- helpers utilitários;
- primitivas físicas reutilizadas por driver e runtime;
- contratos de envelope e leitura canônica do protocolo.

Ela não é um subsistema soberano de runtime. É uma base transversal.

## Estrutura principal

### `shared/nerv/`

É a base compartilhada do protocolo NERV.

Peças observáveis:

- `constants.js`
- `envelope.js`
- `schemas.js`
- `envelope_reader.js`
- `utils.js`

Função:

- definir o vocabulário;
- construir envelopes;
- validar estrutura;
- ler campos padronizados sem acoplar todos os consumidores aos detalhes internos.

### `shared/ipc/`

Preserva artefatos e helpers de envelope/constantes de IPC compartilhado em trilhas ainda
compatíveis com esse contrato.

### `shared/biomechanics/`

Fornece primitivas usadas pelo `BiomechanicsEngine`.

Peça principal observável:

- `human.js`

Função:

- encapsular comportamento de typing/interação mais biomimético.

### `shared/page_stability/`

Peça principal:

- `stabilizer.js`

Função:

- medir estabilidade visual/DOM para reduzir interações em página ainda instável.

### `shared/sadi/`

Peça principal:

- `analyzer.js`

Função:

- apoiar análise semântica/estrutural usada no pipeline de input e execução.

### `shared/telemetry/`

Peça principal:

- `snapshot.js`

Função:

- auxiliar snapshots e agregação de sinais técnicos compartilhados.

### `shared/utils/`

Peça observável:

- `execution_context_filler.js`

Função:

- preencher/normalizar contexto de execução usado por mais de um subsistema.

### Arquivos transversais

- `inference-gateway-client.js`
- `health-check.js`

Esses helpers fazem a ponte entre domínios sem justificar um subsistema próprio.

## Relação com outros subsistemas

### Shared x NERV

- `src/nerv/` usa `src/shared/nerv/` como vocabulário comum do protocolo.

### Shared x Driver

- o pipeline físico do driver depende diretamente de `biomechanics`, `page_stability` e `sadi`.

### Shared x Server / Integration

- helpers de health e clientes utilitários podem ser consumidos fora do núcleo de execução.

## Restrições e guardrails

- Não transformar `src/shared/` em "pasta de qualquer coisa".
- O que entra aqui precisa ser realmente transversal e estável.
- Contratos compartilhados devem permanecer pequenos e claros.
- Documentação interna em `src/shared/*/README.md` pode existir, mas a referência canônica continua
  nesta árvore em `DOCUMENTAÇÃO/`.

## Lacunas e observações

- Como `shared/` cruza muitos domínios, ele tende a acumular legados; novos módulos devem entrar
  apenas quando o reuso entre subsistemas for real.

## Referências no código

- `src/shared/nerv/`
- `src/shared/ipc/`
- `src/shared/biomechanics/`
- `src/shared/page_stability/`
- `src/shared/sadi/`
- `src/shared/telemetry/`
- `src/shared/utils/`
- `src/shared/inference-gateway-client.js`
- `src/shared/health-check.js`
