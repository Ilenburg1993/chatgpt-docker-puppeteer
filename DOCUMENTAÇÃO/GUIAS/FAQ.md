# FAQ

**Propósito**: responder rapidamente às dúvidas recorrentes sem repetir versões antigas da
documentação nem apontar para caminhos obsoletos.  
**Status documental**: Canônico.  
**Público**: onboarding, operação local, manutenção e agentes de IA.  
**Última atualização**: 28 de fevereiro de 2026.

## O que este projeto faz?

É um runtime Node.js orientado a automação de tarefas, com arquitetura baseada em eventos, uso de
browser automation e uma camada HTTP/dashboard própria. A documentação estrutural oficial está em
[../ARQUITETURA/ARCHITECTURE.md](../ARQUITETURA/ARCHITECTURE.md).

## Qual é o entrypoint principal?

O entrypoint compatível é [../../index.js](../../index.js), que delega para `src/main.js`.  
Para arquitetura e bootstrap, o ponto canônico é `src/main.js`.

## Qual é a porta padrão do backend?

`3008`, via `SERVER_PORT` no runtime atual.

Se algum script legado mencionar `2998`, trate isso como drift e valide o contrato em `.env.example`
e `src/core/config.js`.

## Quais portas de Chrome/DevTools importam?

No fluxo padrão consolidado:

- `9224`: endpoint consumido pelo projeto (Chrome Proxy / container-facing)
- `9225`: porta real do Chrome atrás do proxy

## Preciso usar PM2?

Para desenvolvimento rápido, não.  
Para reproduzir o runtime canônico local, sim, o fluxo recomendado é:

```bash
npm run daemon:start
```

## Posso usar `npm start`?

Sim. `npm start` executa `node index.js` e é útil para um boot direto.  
Mas o fluxo mais fiel ao runtime operacional do projeto continua sendo `npm run daemon:start`.

## Como verifico se o sistema está saudável?

Comece por:

```bash
curl http://localhost:3008/api/health
curl http://localhost:3008/api/health/chrome
curl http://localhost:3008/api/health/pm2
curl http://localhost:3008/api/health/kernel
curl http://localhost:3008/api/health/disk
```

Também existem:

```bash
npm run daemon:status
make health
make pm2-check
```

## Como executo os testes?

O projeto usa `node --test` como base.

Comandos principais:

```bash
npm run test:unit
npm run test:integration
npm run test:regression
npm run test:e2e
```

O agregador `npm test` encadeia `unit + integration + regression`.

## Onde está a documentação canônica de testes?

Em [./TESTES.md](./TESTES.md).  
`TESTING.md` existe apenas como compatibilidade de nomenclatura.

## Onde está a documentação oficial de arquitetura?

- hub: [../ARQUITETURA/README.md](../ARQUITETURA/README.md)
- baseline principal: [../ARQUITETURA/ARCHITECTURE.md](../ARQUITETURA/ARCHITECTURE.md)

## Onde encontro configuração e API?

- configuração: [../REFERENCIA/CONFIGURATION.md](../REFERENCIA/CONFIGURATION.md)
- API: [../REFERENCIA/API_REFERENCE.md](../REFERENCIA/API_REFERENCE.md)

Os arquivos `CONFIG_FILES.md` e `API.md` foram mantidos só como wrappers de compatibilidade.

## O dashboard é o mesmo que `dashboard-ui/`?

Não exatamente.

- o backend/dashboard principal é servido pelo runtime HTTP em `3008`;
- `dashboard-ui/` é o workspace Vite do frontend, usado para desenvolvimento e build isolados.

## Como rodo só o frontend?

```bash
npm run dashboard:dev
```

## O projeto depende só de browser automation?

O núcleo histórico é fortemente orientado a browser automation, mas o repositório também inclui
camadas auxiliares como `integration`, `inference_gateway`, `audit_agent` e ferramentas de RAG/MCP.

## Preciso criar diretórios manualmente (`fila`, `logs`, etc.)?

Não trate isso como etapa canônica obrigatória.  
Se algum fluxo específico exigir inicialização auxiliar, ele deve vir dos scripts e do runtime
atual, não de uma lista manual herdada de documentação antiga.

## Onde vejo o estado da documentação?

Em [../RELATORIOS/STATUS_GERAL_DOCUMENTACAO.md](../RELATORIOS/STATUS_GERAL_DOCUMENTACAO.md).

## Um documento antigo contradiz este FAQ. Em qual confiar?

Confie primeiro em:

1. `package.json`
2. `.env.example`
3. `Makefile`
4. código do runtime
5. documentação canônica mais recente

Se o documento antigo divergir, ele precisa ser corrigido ou reclassificado.
