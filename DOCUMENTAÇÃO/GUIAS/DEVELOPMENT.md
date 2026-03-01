# Guia de Desenvolvimento

**Propósito**: documentar o fluxo canônico de desenvolvimento local, validação e debug com base no runtime real do repositório atual.  
**Status documental**: Canônico.  
**Público**: desenvolvimento, manutenção, revisão técnica e agentes de IA.  
**Última atualização**: 28 de fevereiro de 2026.

## Escopo

Este guia cobre:

- setup local;
- ciclo diário de edição e validação;
- comandos canônicos de qualidade;
- rotas de debug seguras;
- pontos de atenção com drift legado.

Arquitetura detalhada fica em [../ARQUITETURA/README.md](../ARQUITETURA/README.md).  
Operação contínua fica em [../OPERACOES/README.md](../OPERACOES/README.md).

## Requisitos reais de desenvolvimento

- Node.js `>=24.0.0`
- npm `>=11.0.0`
- Git funcional
- Chrome/Chromium no host

Suporte adicional reconhecido pelo `package.json`:

- `bun >=1.1.0`
- `pnpm >=9.0.0`

Esses engines são aceitos, mas o fluxo canônico deste repositório continua centrado em `npm`.

## Primeiro setup

Instale dependências:

```bash
npm install
```

Valide o contexto:

```bash
npm run check:env
```

Checagens rápidas recomendadas após um clone novo:

```bash
npm run check:pre-flight
npm run check:envlocal
```

## Fluxo diário recomendado

### 1. Rodar em modo dev

```bash
npm run dev
```

Esse comando usa:

- `nodemon`
- `index.js` como entrypoint de compatibilidade
- inspector em `0.0.0.0:9229`

### 2. Rodar no fluxo PM2 local

Use quando quiser reproduzir o runtime canônico:

```bash
npm run daemon:start
npm run daemon:status
```

Equivalentes via Makefile:

```bash
make start
make status
```

### 3. Rodar o frontend Vite isoladamente

Quando o foco for o dashboard UI:

```bash
npm run dashboard:dev
```

Outros comandos úteis:

```bash
npm run dashboard:build
npm run dashboard:preview
```

## Validação obrigatória antes de consolidar mudanças

### Formatação e lint

```bash
npm run format:check
npm run lint:quiet
```

### Typecheck

```bash
npm run typecheck:node
```

Quando a mudança tocar UI ou ferramentas:

```bash
npm run typecheck:browser
npm run typecheck:tools
npm run typecheck:full
```

### Testes

Fluxo canônico atual:

```bash
npm run test:unit
npm run test:integration
npm run test:regression
```

Coberturas adicionais:

```bash
npm run test:e2e
npm run test:watch
npm run test:coverage
```

O agregador `npm test` encadeia `unit + integration + regression`. Se algum processo ficar
pendurado por handles abertos, trate isso como problema a investigar, não como comportamento normal.

## Estrutura que realmente importa

- `index.js`: proxy de entrypoint para `src/main.js`
- `src/main.js`: bootstrap canônico do runtime
- `src/`: subsistemas do produto
- `dashboard-ui/`: frontend separado do backend
- `tests/`: testes por categoria (`unit`, `integration`, `regression`, `e2e`, `legacy`)
- `scripts/`: automação de build, setup, ops, health, audit e análise
- `DOCUMENTAÇÃO/`: fonte canônica da documentação

## Comandos de produtividade úteis

Diagnóstico:

```bash
npm run diagnose
npm run debug:dev-monitor
npm run debug:runtime-suite
```

Fila e artefatos:

```bash
npm run queue:add
npm run queue:status
npm run queue:flow
```

Auditoria:

```bash
npm run audit:quick
npm run audit:deep
npm run audit:architecture
```

RAG e ferramentas:

```bash
npm run rag:health
npm run rag:index
npm run rag:ask
```

## Debug e observabilidade

Inspector principal em dev:

- `9229` via `npm run dev`

Outras rotas de debug existentes:

- `npm run debug:memory-leak`
- `npm run debug:performance`
- `npm run debug:race-condition`

O backend responde em `3008` por padrão. O frontend Vite, quando isolado, usa o workspace próprio
de `dashboard-ui`.

## Drift legado que ainda existe

Os pontos abaixo ainda aparecem em scripts auxiliares antigos e não devem virar novo baseline:

- alguns helpers de health assumem porta `2998`;
- alguns scripts antigos ainda referenciam `ecosystem.config.js`, enquanto o arquivo canônico é
  `ecosystem.config.cjs`;
- documentação antiga ainda menciona `Node 20`, o que já não corresponde ao `package.json`.

## Guardrails de desenvolvimento

- Não use instruções destrutivas como rotina de “correção” local.
- Não trate wrappers de compatibilidade como fonte canônica.
- Não atualize documentação usando valores inferidos sem conferir `package.json`, `.env.example`,
  `Makefile` e o código do runtime.

## Próxima leitura recomendada

- [./QUICK_START.md](./QUICK_START.md)
- [./TESTES.md](./TESTES.md)
- [./TROUBLESHOOTING.md](./TROUBLESHOOTING.md)
- [../ARQUITETURA/ARCHITECTURE.md](../ARQUITETURA/ARCHITECTURE.md)
