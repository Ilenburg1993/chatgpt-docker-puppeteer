# Quick Start

**Propósito**: orientar o primeiro boot local do projeto com o menor caminho seguro possível, usando
os contratos reais do repositório atual.  
**Status documental**: Canônico.  
**Público**: onboarding técnico, manutenção, desenvolvimento local e agentes de IA.  
**Última atualização**: 28 de fevereiro de 2026.

## Quando usar este guia

Use este documento para:

- preparar um ambiente local novo;
- validar se o runtime sobe corretamente;
- iniciar o backend, o dashboard e o Chrome/DevTools no fluxo recomendado.

Se o objetivo for operação contínua, consulte [../OPERACOES/README.md](../OPERACOES/README.md).  
Se o objetivo for desenvolvimento diário, consulte [./DEVELOPMENT.md](./DEVELOPMENT.md).

## Pré-requisitos reais

- Node.js `>=24.0.0`
- npm `>=11.0.0`
- Google Chrome ou Chromium instalado no host
- `npx pm2` disponível via dependências do projeto

Opcional:

- GNU Make, para usar os atalhos do [../../Makefile](../../Makefile)
- Docker/DevContainer, quando o fluxo exigir ambiente containerizado

## Instalação

```bash
npm install
```

Depois da instalação, valide o ambiente:

```bash
npm run check:env
```

Esse comando confirma se você está na raiz ou em `dist/` e já sugere o fluxo correto de execução.

## Configuração mínima

1. Ajuste os arquivos `.env` ou `.env.local` se o seu ambiente exigir overrides.
2. Mantenha `SERVER_PORT=3008` como padrão, salvo necessidade explícita de mudança.
3. Mantenha o fluxo padrão de Chrome Proxy:
   - `CHROME_PROXY_PORT=9224` para o endpoint consumido pelo projeto
   - `CHROME_PORT=9225` para a porta real do Chrome atrás do proxy

Os defaults oficiais vivem em [../REFERENCIA/CONFIGURATION.md](../REFERENCIA/CONFIGURATION.md) e em
`.env.example`.

## Subindo o Chrome no fluxo recomendado

O projeto foi consolidado para operar, por padrão, com um endpoint de DevTools exposto em `9224`
para o runtime e com o Chrome real atrás dele em `9225`.

Se você estiver rodando um Chrome local sem proxy intermediário, alinhe o seu ambiente antes de
subir o sistema. Se estiver usando o fluxo canônico com PM2, o processo `chrome-proxy` é iniciado
via `ecosystem.config.cjs`.

Validação mínima:

```bash
curl http://localhost:9224/json/version
```

Se isso não responder, consulte [../OPERACOES/NETWORKING.md](../OPERACOES/NETWORKING.md) e
[../OPERACOES/CHROME_PROXY_SETUP.md](../OPERACOES/CHROME_PROXY_SETUP.md).

## Primeira execução

### Opção A: fluxo recomendado com PM2

```bash
npm run daemon:start
```

Alternativa equivalente:

```bash
make start
```

Valide o estado:

```bash
npm run daemon:status
curl http://localhost:3008/api/health
```

### Opção B: fluxo de desenvolvimento com auto-reload

```bash
npm run dev
```

Esse modo usa `nodemon`, inicia o entrypoint `index.js` e expõe o inspector em `0.0.0.0:9229`.

## Primeiras verificações

Backend e health:

```bash
curl http://localhost:3008/api/health
curl http://localhost:3008/api/health/chrome
curl http://localhost:3008/api/health/pm2
```

Dashboard:

- backend/dashboard principal: `http://localhost:3008`
- frontend Vite isolado (quando necessário): `npm run dashboard:dev`

## Comandos mínimos que importam

Execução:

```bash
npm start
npm run dev
npm run daemon:start
npm run daemon:stop
npm run daemon:status
npm run daemon:logs
```

Validação:

```bash
npm run check:env
npm run check:pre-flight
npm run validate
make health
```

Testes:

```bash
npm run test:unit
npm run test:integration
npm run test:regression
npm run test:e2e
```

## Estrutura mínima para se orientar

- `src/`: runtime principal
- `tests/`: suíte de testes e bootstrap local
- `scripts/`: automação operacional, health e manutenção
- `dashboard-ui/`: frontend Vite separado do backend
- `DOCUMENTAÇÃO/`: documentação canônica

## Erros iniciais mais comuns

- `EADDRINUSE` em `3008`: outro processo já está usando a porta do backend
- falha em `9224`: Chrome Proxy/DevTools não está acessível
- `npm run daemon:start` sobe parcialmente: algum processo PM2 foi criado com config antiga
- scripts de health antigos podem assumir `2998`; passe a porta explicitamente se necessário:

```bash
bash scripts/health/health-posix.sh 3008
```

## Próxima leitura recomendada

- [./DEVELOPMENT.md](./DEVELOPMENT.md)
- [./TESTES.md](./TESTES.md)
- [../OPERACOES/NETWORKING.md](../OPERACOES/NETWORKING.md)
- [../ARQUITETURA/ARCHITECTURE.md](../ARQUITETURA/ARCHITECTURE.md)
