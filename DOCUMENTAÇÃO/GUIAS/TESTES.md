# Guia de Testes

**Propósito**: consolidar a estratégia canônica de testes do repositório após a reorganização
estrutural de `tests/`.  
**Status documental**: Canônico.  
**Público**: engenharia, manutenção, qualidade e agentes de IA.  
**Última atualização**: 28 de fevereiro de 2026.

## Papel deste documento

Este é o baseline oficial para:

- estrutura atual da pasta `tests/`;
- convenções obrigatórias de nomenclatura;
- escolha da suíte correta por objetivo;
- escrita de novos testes sem reintroduzir o legado.

O arquivo legado `TESTING.md` permanece apenas como ponte curta de compatibilidade e não deve mais
ser tratado como segunda fonte principal.

## Estratégia canônica

O repositório adota uma separação explícita por objetivo de validação:

- `unit/`: lógica isolada e contratos locais com execução rápida;
- `integration/`: interação entre subsistemas, adapters, arquivos, rede local e componentes
  acoplados;
- `regression/`: cenários que protegem correções sensíveis e bugs já observados;
- `e2e/`: fluxos completos com maior custo e maior sensibilidade ambiental;
- `nightly/`: verificações mais pesadas ou lentas, não ideais para rodagem constante;
- `manual/`: roteiros e verificações humanas quando a automação ainda não é adequada.

Leitura prática:

- testes novos entram direto na categoria final correta;
- `legacy/` existe apenas como quarentena de material ainda não reclassificado;
- o topo de `tests/` não deve voltar a receber arquivos de teste soltos.

## Estrutura atual

```text
tests/
├── unit/
├── integration/
├── e2e/
├── regression/
├── nightly/
├── manual/
├── fixtures/
├── helpers/
├── mocks/
├── support/            # setup.js, teardown.js e bootstrap compartilhado
├── scripts/            # utilitários de suporte ao sistema de testes
├── python/             # reservado para testes Python canônicos
├── legacy/             # quarentena temporária do legado ainda não reclassificado
└── README.md           # guia operacional local
```

## Convenções obrigatórias

- Testes Node seguem o padrão `*.spec.js`.
- O runner baseline é `node --test`, refletido nos scripts atuais do `package.json`.
- Testes novos devem entrar direto em `unit/`, `integration/`, `e2e/`, `regression/` ou `nightly/`.
- Arquivos antigos fora do padrão ficam em `tests/legacy/` até serem promovidos.
- `tests/support/setup.js` e `tests/support/teardown.js` concentram bootstrap e cleanup.

## Comandos canônicos

```bash
npm run test
npm run test:unit
npm run test:integration
npm run test:regression
npm run test:e2e
npm run test:watch
npm run test:coverage
```

## Como escrever novos testes

- Prefira `node:test` e assertions compatíveis com o stack atual do repositório.
- Organize cada arquivo por cenário: caminho feliz, erro e borda.
- Nomeie casos pelo comportamento observado, não pelo nome interno da função.
- Evite dependência desnecessária de ambiente externo em `unit/` e `integration/`.
- Quando um caso proteger uma correção histórica, ele deve migrar para `regression/`.

## Onde colocar cada coisa

- `fixtures/`: dados estáticos para testes.
- `helpers/`: helpers reutilizáveis.
- `mocks/`: doubles e mocks compartilhados.
- `scripts/`: scripts utilitários de manutenção do sistema de testes.
- `legacy/node/`: testes JS legados ainda não reclassificados.
- `legacy/python/`: testes Python legados.
- `legacy/manual-notes/`: anotações e roteiros manuais.

## Regras de manutenção

- Se o conteúdo orientar estratégia e estrutura vigente de `tests/`, ele deve convergir para este
  arquivo.
- Se o material registrar uma estratégia antiga, ele deve ser absorvido aqui ou rebaixado para
  histórico.
- A documentação de testes deve sempre permanecer coerente com `tests/README.md` e com os scripts
  atuais do `package.json`.

## Documentos relacionados

- Guia local rápido: [../../tests/README.md](../../tests/README.md)
- Plano de consolidação: [../PLANOS/TESTS_CONSOLIDATION_PLAN.md](../PLANOS/TESTS_CONSOLIDATION_PLAN.md)
- Estratégia histórica: [../AUDITORIAS/TESTS_STRATEGY.md](../AUDITORIAS/TESTS_STRATEGY.md)
