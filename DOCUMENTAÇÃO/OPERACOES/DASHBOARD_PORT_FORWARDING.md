# Dashboard e Port Forwarding

**Propósito**: documentar o acesso ao dashboard Vite em ambiente devcontainer/VS Code com base no `vite.config.js`, no `devcontainer.json` e nos scripts de diagnóstico atuais.  
**Status documental**: Canônico.  
**Público**: desenvolvimento, operação local em container e agentes de IA.  
**Última atualização**: 28 de fevereiro de 2026.

## O que este guia cobre

Este documento trata do dashboard frontend em `dashboard-ui`, servido pelo Vite em modo de
desenvolvimento.

Não confundir com:

- backend/dashboard principal em `http://localhost:3008`
- API HTTP em `3008`

Aqui o foco é:

- Vite em `5173`
- rota base `/dashboard/`
- port forwarding do VS Code / DevContainer

## Contrato atual do Vite

O arquivo [../../src/dashboard-ui/vite.config.js](../../src/dashboard-ui/vite.config.js) define:

- `base: '/dashboard/'`
- `server.port = 5173`
- `server.host = '0.0.0.0'`
- `strictPort = true`
- HMR com `clientPort = 5173` e `host = 'localhost'`

Isso significa:

- o dev server deve subir em `5173`;
- se `5173` estiver ocupado, o Vite falha em vez de saltar para outra porta;
- a URL correta é `http://localhost:5173/dashboard/`.

## Contrato atual do DevContainer

O arquivo `.devcontainer/devcontainer.json` já declara estas portas em `forwardPorts`:

- `3008`
- `5173`
- `9224`
- `9229`
- `9230`

Leitura correta:

- `5173` já faz parte do contrato do container;
- mesmo assim, dependendo do cliente VS Code, ainda pode ser necessário confirmar ou reativar o
  forward manualmente na aba `PORTS`.

## Fluxo recomendado

### 1. Subir o frontend

```bash
npm run dashboard:dev
```

Alternativa direta no workspace:

```bash
npm --workspace dashboard-ui run dev
```

### 2. Validar internamente no container

```bash
curl -I http://127.0.0.1:5173/dashboard/
```

Ou use o script de diagnóstico:

```bash
bash scripts/check-dashboard-access.sh
```

### 3. Acessar no host

URL canônica:

```text
http://localhost:5173/dashboard/
```

## Quando o port forwarding manual ainda é necessário

Mesmo com `forwardPorts` declarado, o VS Code pode não materializar o túnel automaticamente em
alguns cenários. Quando isso acontecer:

1. abra a aba `PORTS`;
2. confirme que `5173` aparece como forwardada;
3. se não aparecer, adicione `5173` manualmente.

O script [../../scripts/guide-port-forwarding.sh](../../scripts/guide-port-forwarding.sh) existe
como guia operacional assistido para esse fluxo.

## Scripts úteis

- [../../scripts/check-dashboard-access.sh](../../scripts/check-dashboard-access.sh): diagnóstico
  de acessibilidade do Vite
- [../../scripts/guide-port-forwarding.sh](../../scripts/guide-port-forwarding.sh): instruções de
  forward manual
- [../../scripts/open-dashboard-browser.sh](../../scripts/open-dashboard-browser.sh): tentativa de
  abrir o Simple Browser do VS Code

Leitura correta:

- esses scripts ajudam no fluxo local;
- a fonte de verdade para porta e host continua sendo `vite.config.js` e `devcontainer.json`.

## Diagnóstico rápido

### Vite não está rodando

Suba:

```bash
npm run dashboard:dev
```

Depois valide:

```bash
curl -I http://127.0.0.1:5173/dashboard/
```

### Vite responde no container, mas o host não acessa

Isso costuma indicar problema de port forwarding, não de aplicação.

Faça:

```bash
bash scripts/check-dashboard-access.sh
bash scripts/guide-port-forwarding.sh
```

### A URL está certa, mas a tela quebra

Valide:

- se o backend em `3008` está disponível;
- se o proxy Vite para `/api` e `/socket.io` alcança `http://localhost:3008`;
- se há erro no console do navegador.

## O que não assumir

- não assuma que o Vite vai usar `5174`, `5175` etc. como fallback; `strictPort: true` impede isso;
- não assuma que o host correto do Vite é `127.0.0.1`; o servidor escuta em `0.0.0.0`;
- não trate `172.17.x.x` como URL canônica para o navegador do host;
- não trate o Simple Browser do VS Code como substituto da validação real de port forwarding.

## Leituras relacionadas

- [./NETWORKING.md](./NETWORKING.md)
- [./DEVCONTAINER.md](./DEVCONTAINER.md)
- [../GUIAS/MONITORING_GUIDE.md](../GUIAS/MONITORING_GUIDE.md)
