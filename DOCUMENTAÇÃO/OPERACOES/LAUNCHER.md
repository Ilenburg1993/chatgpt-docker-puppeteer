# Launcher e Operação PM2

**Propósito**: documentar o caminho canônico de operação via PM2, o papel dos launchers e as
divergências conhecidas dos helpers legados.  
**Status documental**: Canônico.  
**Público**: engenharia, operação, troubleshooting e agentes de IA.  
**Última atualização**: 28 de fevereiro de 2026.

## Leitura correta

Hoje existem **três camadas** de operação relacionadas a launcher:

- **caminho canônico**: scripts `npm run daemon:*` sobre
  [ecosystem.config.cjs](/workspaces/chatgpt-docker-puppeteer/ecosystem.config.cjs);
- **launchers interativos**: [launcher.sh](/workspaces/chatgpt-docker-puppeteer/launcher.sh) e
  [LAUNCHER.bat](/workspaces/chatgpt-docker-puppeteer/LAUNCHER.bat);
- **helpers legados de conveniência**: `quick-ops`, `pm2-startup`, `pm2-check` e scripts similares.

Se houver divergência entre essas camadas, o contrato principal é:

- `package.json` + `ecosystem.config.cjs`

## Caminho canônico de operação

### Processos esperados

O ecossistema PM2 observado hoje trabalha, no mínimo, com:

- `agente-gpt`
- `dashboard-web`
- `chrome-proxy`

Esse conjunto é o baseline operacional documentado e também o conjunto esperado pelos checks atuais
de PM2.

### Comandos canônicos

Os comandos de referência estão em `package.json`:

```bash
npm run daemon:start
npm run daemon:stop
npm run daemon:reload
npm run daemon:restart
npm run daemon:status
npm run daemon:logs
npm run daemon:kill
```

Eles são a forma mais confiável de operar o runtime hoje.

## Papel do `launcher.sh`

O shell launcher em [launcher.sh](/workspaces/chatgpt-docker-puppeteer/launcher.sh) ainda é um
front-end operacional útil para humanos.

Fluxo observado:

1. valida locale/UTF-8;
2. valida Node.js e PM2;
3. garante `node_modules`;
4. garante `chrome-config.json`;
5. detecta crashes anteriores;
6. cria backup rápido de configuração;
7. tenta preparar Chrome via `scripts/start-chrome.sh`;
8. executa `npm run daemon:start`.

Leitura correta:

- o launcher shell é um orquestrador de conveniência;
- ele não substitui o contrato canônico do PM2;
- quando ele falhar, o fallback operacional deve ser o uso direto de `npm run daemon:*`.

## Papel do `LAUNCHER.bat`

O launcher de Windows existe e oferece paridade funcional parcial, mas hoje apresenta **drift** em
relação ao runtime canônico.

Divergências observadas:

- usa `SERVER_PORT=2998`, enquanto o ecossistema canônico está em `3008`;
- o health check embutido usa `http://localhost:2998/api/health`;
- isso não reflete o `PORT=3008` definido no ecossistema PM2 atual.

Conclusão operacional:

- o arquivo ainda pode servir como interface legada;
- ele **não** deve ser tratado como descrição fiel do runtime atual sem revisão adicional;
- em caso de dúvida, use os comandos `npm run daemon:*`.

## Helpers de conveniência

### `quick-ops`

Há dois helpers:

- [quick-ops.sh](/workspaces/chatgpt-docker-puppeteer/scripts/ops/quick-ops.sh)
- [quick-ops.bat](/workspaces/chatgpt-docker-puppeteer/scripts/quick-ops.bat)

Eles seguem a ideia certa de facilitar `start`, `stop`, `restart`, `status`, `health`, `logs` e
`backup`, mas hoje ainda carregam drift relevante:

- health check em `2998`, não `3008`.

Logo:

- são utilitários úteis, mas não o baseline documental da operação.

### `pm2-startup.sh`

O script [pm2-startup.sh](/workspaces/chatgpt-docker-puppeteer/scripts/setup/pm2-startup.sh)
continua útil como referência de sequência validada e já foi alinhado ao contrato atual:

- usa `ecosystem.config.cjs`;
- valida `Node 24+`;
- opera via `npx pm2`.

### `pm2-check.sh`

O script [pm2-check.sh](/workspaces/chatgpt-docker-puppeteer/scripts/ops/pm2-check.sh) ainda é útil
como diagnóstico de processo, memória e ambiente, e agora também já foi alinhado ao contrato atual
em `ecosystem.config.cjs`.

## O que este documento considera canônico

### Operação normal

Use:

```bash
npm run daemon:start
npm run daemon:status
npm run daemon:logs
```

### Diagnóstico complementar

Use, quando necessário:

```bash
bash scripts/ops/pm2-check.sh
bash scripts/health/doctor.sh
```

### Bootstrap guiado por humano

Use:

```bash
./launcher.sh
```

com a leitura correta de que ele é uma camada de conveniência, não a fonte única da verdade.

## Sequência operacional recomendada

### Subida

```bash
npm run daemon:start
npm run daemon:status
curl -sf http://localhost:3008/api/health
```

### Reinício

```bash
npm run daemon:reload
```

### Diagnóstico

```bash
bash scripts/ops/pm2-check.sh
bash scripts/health/doctor.sh
```

## Riscos e divergências conhecidas

- `launcher.sh` e `LAUNCHER.bat` não estão em paridade total.
- `LAUNCHER.bat` e `quick-ops` ainda verificam `2998`.

Esses helpers não devem ser usados como base para documentação normativa sem revalidação.

## Regras de manutenção

- Sempre documentar `package.json` e `ecosystem.config.cjs` como baseline.
- Launchers e helpers devem ser descritos como camadas auxiliares, não como contrato principal.
- Quando um helper divergir do runtime canônico, a divergência deve ser explicitada no documento.
- Se os scripts forem corrigidos no futuro, este documento deve ser atualizado com base no código
  real, não no texto histórico.

## Links relacionados

- Deploy: [DEPLOYMENT.md](./DEPLOYMENT.md)
- Networking: [NETWORKING.md](./NETWORKING.md)
- DevContainer: [DEVCONTAINER.md](./DEVCONTAINER.md)
- PM2 quick reference: [PM2_QUICK_REFERENCE.md](./PM2_QUICK_REFERENCE.md)
