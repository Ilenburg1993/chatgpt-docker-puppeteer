# Troubleshooting

**Propósito**: registrar diagnósticos e correções seguras para os problemas mais recorrentes do
ambiente atual, sem recorrer a procedimentos destrutivos ou pressupostos antigos.  
**Status documental**: Canônico.  
**Público**: desenvolvimento, operação local, manutenção e agentes de IA.  
**Última atualização**: 28 de fevereiro de 2026.

## Como usar este guia

A sequência recomendada é:

1. confirmar o contexto (`raiz` vs `dist`);
2. validar runtime e portas;
3. isolar se a falha está em PM2, backend HTTP, Chrome/DevTools ou validação local;
4. só então agir sobre configuração, processo ou script.

Comece sempre por:

```bash
npm run check:env
npm run daemon:status
curl http://localhost:3008/api/health
```

## Problema: backend não sobe

Sintomas comuns:

- `EADDRINUSE` em `3008`
- processo sobe e cai logo em seguida
- `npm run daemon:start` cria estado parcial

Diagnóstico:

```bash
npm run daemon:status
lsof -i :3008
curl http://localhost:3008/api/health
```

Tratamento:

- pare processos antigos com `npm run daemon:stop`;
- se houver processos órfãos, finalize o PID responsável pela porta;
- valide se o `.env` não está sobrescrevendo `SERVER_PORT` de forma indevida.

Evite tratar isso com “limpeza total” arbitrária antes de identificar qual processo está ocupando a
porta.

## Problema: health script falha, mas o backend está no ar

Causa frequente:

- `scripts/health/health-posix.sh` ainda assume `2998` como default legado.

Use o comando com a porta explícita:

```bash
bash scripts/health/health-posix.sh 3008
```

Se o endpoint responder manualmente em `3008`, o problema está no helper legado e não
necessariamente no runtime.

## Problema: Chrome/DevTools indisponível

Sintomas:

- `/api/health/chrome` retorna indisponível
- `curl http://localhost:9224/json/version` falha
- o agente não consegue conectar ao browser

Diagnóstico:

```bash
curl http://localhost:9224/json/version
npm run check:chrome
```

Pontos a validar:

- `CHROME_PROXY_PORT=9224`
- `CHROME_PORT=9225`
- o processo `chrome-proxy` está online no PM2
- o Chrome real está acessível no host esperado

Referência:

- [../OPERACOES/NETWORKING.md](../OPERACOES/NETWORKING.md)
- [../OPERACOES/CHROME_PROXY_SETUP.md](../OPERACOES/CHROME_PROXY_SETUP.md)

## Problema: PM2 em estado inconsistente

Sintomas:

- processos `online` e `errored` alternando
- restart loop
- algum processo esperado não aparece

Diagnóstico:

```bash
npm run daemon:status
npm run daemon:logs
```

Tratamento inicial:

```bash
npm run daemon:stop
npm run daemon:start
```

Se persistir:

- confira se algum script auxiliar ainda está usando `ecosystem.config.js`;
- o arquivo canônico atual é `ecosystem.config.cjs`.

## Problema: autenticação do dashboard falha

Se o backend sobe, mas o acesso administrativo falha:

- valide `DASHBOARD_AUTH_REQUIRED`
- valide usuário configurado
- valide a senha mínima exigida
- valide o segredo JWT quando o fluxo exigir autenticação

Cheque a camada HTTP:

```bash
curl http://localhost:3008/api/health
```

Se o backend responde, o problema costuma estar em configuração de auth e não em boot do servidor.

Referência:

- [../OPERACOES/SECURITY.md](../OPERACOES/SECURITY.md)

## Problema: testes não finalizam

Sintoma:

- um comando `node --test` executa, mas não encerra

Diagnóstico:

- o problema costuma ser handle aberto, timer pendente, watcher ativo ou recurso não fechado;
- isso precisa ser tratado como bug da suíte ou do bootstrap, não como “normal”.

Fluxo de isolamento:

```bash
npm run test:unit
node --test tests/unit/**/*.spec.js
```

Depois reduza para o arquivo ou a pasta mínima que reproduz o hang.

Referência canônica:

- [./TESTES.md](./TESTES.md)

## Problema: documentação e comando não batem

Esse repositório passou por forte consolidação documental. Se um guia e o código divergirem:

1. trate o código e os contratos executáveis como fonte primária;
2. valide em `package.json`, `.env.example`, `Makefile` e no módulo relevante;
3. corrija a documentação canônica, não replique a versão antiga.

## Diagnóstico mínimo recomendado

```bash
npm run check:env
npm run check:pre-flight
npm run daemon:status
npm run daemon:logs
curl http://localhost:3008/api/health
curl http://localhost:3008/api/health/chrome
curl http://localhost:3008/api/health/pm2
```

## O que não fazer

- não use `git reset --hard` como rotina de troubleshooting;
- não apague diretórios aleatoriamente sem isolar a causa;
- não assuma que scripts antigos refletem os defaults atuais;
- não trate wrappers documentais como referência principal.

## Escalonamento documental

Se o problema for de:

- runtime/portas: [../OPERACOES/NETWORKING.md](../OPERACOES/NETWORKING.md)
- autenticação e HTTP: [../OPERACOES/SECURITY.md](../OPERACOES/SECURITY.md)
- fluxo de boot local: [./QUICK_START.md](./QUICK_START.md)
- desenvolvimento e validação: [./DEVELOPMENT.md](./DEVELOPMENT.md)
