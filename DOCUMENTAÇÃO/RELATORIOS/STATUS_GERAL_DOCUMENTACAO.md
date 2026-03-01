# Status Geral da Documentação

**Propósito**: consolidar o estado atual da documentação canônica, registrar o que já foi feito, o que ainda falta e como continuar a evolução com governança.  
**Status documental**: Canônico.  
**Público**: engenharia, manutenção, governança documental e agentes de IA.  
**Última atualização**: 28 de fevereiro de 2026.

## Resumo executivo

O repositório já passou por uma reorganização estrutural profunda e hoje tem `DOCUMENTAÇÃO/` como
hub canônico. A base está muito mais sólida do que antes, mas a qualidade ainda está desigual entre
áreas, mesmo com a governança estrutural por pasta já concluída.

Estado consolidado após a rodada atual:

- Total de arquivos Markdown presentes no workspace: `575`.
- Total de arquivos Markdown dentro de `DOCUMENTAÇÃO/`: `552`.
- Total de diretórios dentro de `DOCUMENTAÇÃO/`: `50`.
- Diretórios em `DOCUMENTAÇÃO/` que já têm `README.md`: `50`.
- Diretórios em `DOCUMENTAÇÃO/` que ainda não têm `README.md`: `0`.

Leitura correta do momento:

- a taxonomia canônica já existe;
- a arquitetura canônica avançou bastante e já tem hub, baseline e deep-dives;
- a cobertura de navegação por pasta foi concluída em `DOCUMENTAÇÃO/`;
- a próxima fase correta é **consolidação semântica e reclassificação de conteúdo**, não nova
  dispersão.
- a rodada final de consolidação já limpou os principais exemplos operacionais desatualizados nas
  áreas vivas e nos hubs de navegação;
- referências antigas remanescentes em `RELATORIOS/` e `AUDITORIAS/` devem ser lidas como registro
  histórico ou analítico, não como baseline operacional.

## O que já foi concluído

### 1. Reorganização estrutural do hub canônico

Já está consolidado:

- `DOCUMENTAÇÃO/` tornou-se o hub único da documentação oficial.
- `DOCUMENTOS/` foi descontinuada e absorvida.
- As categorias principais foram estabilizadas:
  - `GUIAS/`
  - `ARQUITETURA/`
  - `REFERENCIA/`
  - `OPERACOES/`
  - `PLANOS/`
  - `AUDITORIAS/`
  - `RELATORIOS/`
  - `DECISOES/`
  - `ARQUIVO_MORTO/`
- O histórico foi isolado para não competir visualmente com o material canônico.

### 2. Consolidação do legado

Já está concluído:

- `BUGS/` e `bugs/` foram consolidados.
- `RESUMOS_TECNICOS/` e `resumos_tecnicos_subpastas/` foram consolidados.
- `LEGADO_ARQUIVO/` foi achatado e redistribuído dentro de `ARQUIVO_MORTO/`.
- A árvore histórica de arquitetura foi removida da navegação ativa e arquivada.

### 3. Arquitetura oficial

Já está fortemente avançado:

- `ARQUITETURA/README.md` virou o hub oficial de arquitetura.
- `ARQUITETURA/ARCHITECTURE.md` foi reescrito como documento-mestre.
- A documentação de arquitetura foi reorganizada em:
  - raiz da arquitetura para baseline e documentos estruturais;
  - `ARQUITETURA/SUBSISTEMAS/` para deep-dives canônicos;
  - `ARQUITETURA/ESPECIALIZADOS/` para recortes úteis, mas não-baseline.
- Os principais subsistemas já têm documentação específica.

Cobertura já criada em arquitetura:

- runtime principal (`agent`, `kernel`, `orchestrator`, `driver`, `infra`, `missions`, `server`,
  `nerv`);
- camadas transversais (`shared`, `types`, `logic`, `validation`, `state`);
- superfícies auxiliares (`integration`, `inference_gateway`, `audit_agent`, `dashboard-ui`);
- subtrilhas críticas (`browser_pool`, `infra_db`, `storage`, `locks`, `driver_modules`,
  `kernel_task_runtime`, `nerv_transport`, `server_domain`, `server_realtime`, `server_middleware`,
  `server_handlers`, `server_watchers`).

### 4. Guias permanentes para LLMs

Já está alinhado em alto nível:

- `.github/AGENTS.md`
- `.github/copilot-instructions.md`
- `.github/instructions/project-canon.instructions.md`
- `.github/COPILOT_CONFIG.md`

Esses arquivos já apontam para a documentação canônica e para a arquitetura oficial.

### 5. Estrutura de testes

Já houve uma primeira rodada de padronização:

- `tests/` foi reorganizada para remover arquivos soltos do topo;
- `support/`, `scripts/` e `legacy/` foram introduzidos na raiz local de testes;
- a reorganização de testes já saiu do estado mais caótico inicial.

## O que está parcialmente concluído

### 1. Cobertura por categoria do hub

A taxonomia existe, mas a maturidade ainda é desigual.

Contagem atual de Markdown por macroárea:

- `ARQUITETURA`: `59`
- `ARQUIVO_MORTO`: `222`
- `AUDITORIAS`: `80`
- `DECISOES`: `1`
- `GUIAS`: `14`
- `OPERACOES`: `18`
- `PLANOS`: `40`
- `REFERENCIA`: `19`
- `RELATORIOS`: `97`

Leitura importante:

- `ARQUITETURA` e `ARQUIVO_MORTO` já têm estrutura e volume altos.
- `DECISOES/` ainda está estruturalmente reservada, mas sem conteúdo consolidado.
- `GUIAS/`, `REFERENCIA/` e `OPERACOES/` têm conteúdo relevante, mas ainda não passaram pelo mesmo
  nível de normalização fina que `ARQUITETURA`.

### 2. README por pasta

Esse gap estrutural já foi resolvido.

Situação atual:

- `50` diretórios já possuem `README.md`.
- `0` diretórios ainda não possuem `README.md`.

Isso significa que a cobertura estrutural de navegação foi concluída para toda a árvore
`DOCUMENTAÇÃO/`.

### 3. Índices e hubs

Os hubs principais já existem, mas ainda precisam amadurecer como malha de governança contínua:

- `DOCUMENTAÇÃO/README.md` já é o hub principal.
- `DOCUMENTAÇÃO/INDEX.md` já cumpre papel de índice técnico.
- Ainda faltava um documento central de status e planejamento transversal, lacuna que este arquivo
  passa a preencher.
- `RELATORIOS/RECLASSIFICADOS/README.md` agora concentra material reclassificado retirado de
  categorias vivas.

## O que ainda falta fazer

### 1. Cobertura de `README.md` por diretório

O rollout estrutural de `README.md` por diretório foi concluído em toda a árvore `DOCUMENTAÇÃO/`.

O gap deixa de ser estrutural e passa a ser qualitativo:

- revisar profundidade e precisão dos `README`s recém-criados;
- harmonizar o padrão editorial entre categorias;
- melhorar conteúdo interno, e não mais cobrir diretórios sem índice.

Também faltam `README`s em subárvores históricas de `ARQUIVO_MORTO`, mas essas devem ser tratadas
com prioridade menor e com versões mínimas, não com a mesma profundidade das áreas ativas.

Essa lacuna de cobertura histórica mínima já foi resolvida; o foco agora é manter o caráter
explicitamente não canônico desse material e evitar regressão de navegação.

### 2. Normalização editorial fora de arquitetura

Ainda falta elevar `GUIAS/`, `REFERENCIA/` e `OPERACOES/` ao mesmo padrão já aplicado na
arquitetura:

- cabeçalhos padronizados;
- status documental explícito;
- hierarquia clara entre baseline, apoio, especializado e histórico;
- malha consistente de links entre documentos.

Essa lacuna agora já está auditada em detalhe em:

- [AUDITORIA_QUALITATIVA_CATEGORIAS_VIVAS.md](./AUDITORIA_QUALITATIVA_CATEGORIAS_VIVAS.md)

Estado mais recente desta frente:

- `OPERACOES/NETWORKING.md`, `OPERACOES/SECURITY.md` e `OPERACOES/LAUNCHER.md` já foram
  reescritos com base no código atual;
- o lote principal de `GUIAS/` (`QUICK_START`, `DEVELOPMENT`, `TROUBLESHOOTING`, `FAQ`,
  `MONITORING_GUIDE`) também já foi reescrito com checagem rigorosa;
- `GUIAS/CONTRIBUTING.md` também já foi reescrito com base nos templates e comandos reais;
- `OPERACOES/CHROME_PROXY_SETUP.md`, `OPERACOES/CHROME_PROXY_INTEGRATION_GUIDE.md` e
  `OPERACOES/DASHBOARD_PORT_FORWARDING.md` também já foram reescritos com base nos scripts e
  configs atuais;
- `OPERACOES/DEVCONTAINER.md` e `OPERACOES/PM2_QUICK_REFERENCE.md` também já foram reescritos com
  base no estado atual observado, incluindo os drifts remanescentes;
- os drifts principais do `Makefile` e dos scripts PM2 também já foram corrigidos;
- o próximo foco recomendado é uma passada global de link hygiene e, em seguida, revisão dos
  helpers legados que ainda mantêm diferenças de comportamento.

### 3. Governança de `DECISOES/`

`DECISOES/` existe, mas ainda está vazia.

Falta:

- definir o formato canônico de ADR;
- mover decisões estruturais que hoje estão espalhadas ou implícitas;
- tornar `DECISOES/` uma categoria realmente viva.

### 4. Governança de diretórios históricos

`ARQUIVO_MORTO/` já recebeu cobertura estrutural mínima de navegação. O trabalho restante ali passa
a ser de manutenção seletiva, não de cobertura básica:

- manter contexto mínimo;
- preservar a marcação explícita de “não canônico”;
- evitar que material histórico volte a competir com categorias vivas.

### 5. Revisão contínua de links internos

Como `ARQUITETURA/` passou por reorganização física, ainda é esperado que algumas áreas fora da
arquitetura precisem de uma passada complementar de link hygiene.

## Avaliação da melhor estratégia para `README.md` em cada pasta

A melhor estratégia **não** é criar `README`s em todas as pastas de uma vez, com o mesmo nível de
detalhe. Isso tende a produzir volume rápido, mas fraco, e gera manutenção ruim.

A estratégia correta é em ondas:

### Onda 1: diretórios canônicos ativos

Prioridade máxima:

- `GUIAS/`
- `OPERACOES/`
- `PLANOS/`
- `REFERENCIA/`
- `RELATORIOS/`
- `DECISOES/`
- `ARQUITETURA/DIAGRAMS`
- `ARQUITETURA/TECHNICAL`

Status:

- concluída nesta rodada.

Esses `README`s agora existem e já funcionam como entrypoints locais.

### Onda 2: subpastas vivas e específicas

Prioridade alta:

- `REFERENCIA/INTEGRACOES`
- `RELATORIOS/RESUMOS_TECNICOS`
- `AUDITORIAS/BUGS/rodadas`
- subárvores técnicas que já viraram estáveis

Aqui o foco é navegação e escopo local, com menos densidade que no topo da categoria.

Status:

- concluída nesta rodada para o primeiro lote prioritário.

### Onda 3: histórico e arquivo morto

Prioridade menor:

- subpastas de `ARQUIVO_MORTO/`

Aqui os `README`s devem ser curtos e minimalistas:

- o que é este diretório;
- por que ele existe;
- por que não é canônico;
- quando consultar.

Status:

- concluída nesta rodada.

## Padrão recomendado para os futuros `README.md` por pasta

O template recomendado para diretórios ativos é:

1. Título da pasta
2. Propósito
3. Status documental
4. Público
5. O que esta pasta contém
6. O que não deve ficar aqui
7. Entradas principais
8. Regras de manutenção
9. Links relacionados

Para diretórios históricos:

1. Título
2. Natureza histórica
3. O que há aqui
4. O que não é canônico
5. Relação com o material vivo

## Riscos atuais se não houver a próxima rodada

- A estrutura já está navegável, mas alguns `README`s ainda podem ficar superficiais demais.
- Áreas muito densas (`RELATORIOS`, `AUDITORIAS`, `ARQUIVO_MORTO`) ainda precisam de refinamento de
  conteúdo, não só de índice local.
- Pode haver inconsistência editorial entre categorias que já têm `README`, mas em níveis diferentes
  de maturidade.
- Sem revisão de conteúdo, a estrutura fica correta, porém com semântica desigual.

## Decisões tomadas nesta atualização

- Este arquivo passa a ser a referência transversal de status da documentação.
- A criação de `README`s por pasta será tratada por ondas, não por ataque único.
- Serão usadas duas skills dedicadas:
  - uma de governança documental contínua;
  - uma específica para padronização futura de `README`s.

## Próximas ações recomendadas

### Imediatas

- Executar o [PLANO_CONSOLIDACAO_CATEGORIAS_VIVAS.md](../PLANOS/PLANO_CONSOLIDACAO_CATEGORIAS_VIVAS.md)
  a partir do rewrite dos documentos vivos prioritários e da revisão de links após a
  reclassificação já aplicada.
- Revisar a qualidade e a profundidade dos `README.md` criados nas três ondas.
- Definir o primeiro lote canônico de ADRs em `DECISOES/`.

### Próxima fase de governança

- Reescrever os documentos vivos mais frágeis em `GUIAS/` e `OPERACOES/`.
- Fazer uma passada de link hygiene após a movimentação de conteúdo.
- Revisar se parte do material em `RELATORIOS/RECLASSIFICADOS/` já pode seguir para
  `ARQUIVO_MORTO/`.

Atualização de progresso:

- `OPERACOES/NETWORKING.md`, `OPERACOES/SECURITY.md` e `OPERACOES/LAUNCHER.md` já foram
  reescritos contra o código atual;
- o próximo lote prioritário de rewrite ficou concentrado em `GUIAS/` e nos guias operacionais
  especializados restantes.

## Referências relacionadas

- Hub principal: [../README.md](../README.md)
- Índice técnico: [../INDEX.md](../INDEX.md)
- Arquitetura oficial: [../ARQUITETURA/README.md](../ARQUITETURA/README.md)
- Plano de rollout de `README`s: [../PLANOS/PLANO_READMES_PADRONIZADOS.md](../PLANOS/PLANO_READMES_PADRONIZADOS.md)
- Auditoria qualitativa das categorias vivas: [./AUDITORIA_QUALITATIVA_CATEGORIAS_VIVAS.md](./AUDITORIA_QUALITATIVA_CATEGORIAS_VIVAS.md)
- Relatórios reclassificados: [./RECLASSIFICADOS/README.md](./RECLASSIFICADOS/README.md)
- Plano de consolidação: [../PLANOS/PLANO_CONSOLIDACAO_CATEGORIAS_VIVAS.md](../PLANOS/PLANO_CONSOLIDACAO_CATEGORIAS_VIVAS.md)
