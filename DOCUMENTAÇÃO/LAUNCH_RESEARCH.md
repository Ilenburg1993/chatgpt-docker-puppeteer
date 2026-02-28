# Pesquisa para Reconstrução de `launch.json`

Este arquivo reúne todo o contexto e informações necessárias ao desenvolver a versão após-migração
do `\.vscode/launch.json`.

## 1. Fundamentação VS Code

### 1.1 Tipos de depuração

- `pwa-node` – novo tipo recomendado para Node.js (JavaScript Debugger). Suporta ESM,
  `autoAttachChildProcesses`, `runtimeArgs`, `envFile` e funciona com o modo híbrido
  `--inspect`/`--inspect-brk`.
- `node` – legado; ainda funciona mas será removido eventualmente. **Não usar** em novos perfis.
- `pwa-chrome` – depuração de código rodando em Chrome/Chromium. Usado para Vue/ dashboard
  front-end.
- `chrome` – tipo antigo; `pwa-chrome` deve substituir.

Referências:

- https://code.visualstudio.com/docs/editor/debugging#_available-debuggers
- https://code.visualstudio.com/docs/nodejs/nodejs-debugging
- https://code.visualstudio.com/docs/editor/debugging#_launchjson-attributes
- https://code.visualstudio.com/docs/editor/debugging#_compound-launch-configurations

### 1.2 Atributos importantes

| Atributo                    | Descrição breve                                                               |
| --------------------------- | ----------------------------------------------------------------------------- |
| `version`                   | Deve ser `0.2.0` (schema atual).                                              |
| `configurations`            | Lista de perfis de lançamento/attach.                                         |
| `compounds`                 | Coleções de perfis que podem iniciar/terminar juntos.                         |
| `type`                      | `pwa-node`, `pwa-chrome`, `node`, etc.                                        |
| `request`                   | `launch` ou `attach`.                                                         |
| `program`                   | Caminho do script (p.ex. `${workspaceFolder}/index.js`).                      |
| `cwd`                       | Diretório de trabalho.                                                        |
| `env`                       | Variáveis de ambiente específicas ao perfil.                                  |
| `envFile`                   | Caminho para arquivo `.env`. Permite manter `.env.example`.                   |
| `runtimeArgs`               | Argumentos para o executável Node. Usado para `--max-old-space-size` etc.     |
| `console`                   | `integratedTerminal` ou `internalConsole`. Deve ser integrado para interagir. |
| `skipFiles`                 | Arquivos a ignorar no step-through (tipicamente `<node_internals>/**`).       |
| `autoAttachChildProcesses`  | Ativa depuração de subprocessos. Importante para testes e PM2.                |
| `sourceMaps`                | Habilita sourcemaps (temos .map graças ao ts-node/compilação).                |
| `resolveSourceMapLocations` | Mapas dinâmicos (use `${workspaceFolder}/**`).                                |
| `preLaunchTask`             | Tarefa de build/uma etapa antes de iniciar (útil para front‑end).             |

### 1.3 Comportamentos úteis

- `port` em configurações `attach` especifica porta de escuta do inspector.
- `localRoot` / `remoteRoot` são essenciais ao depurar dentro de Docker ou PM2 remoto.
- Variáveis `restart` controlam reinício automático do attach.
- Em compounds, `stopAll: true` fecha todos quando qualquer um para.

## 2. Variáveis de ambiente do projeto

Pesquisa no repositório revela as seguintes variáveis amplamente utilizadas (simbolizadas em
`config.json` e `.env.example`):

```text
NODE_ENV, LOG_LEVEL, DEBUG, FORCE_COLOR,
PORT/SERVER_PORT, PUPPETEER_HEADLESS,
CHROME_PROXY_PORT, etc.
```

`.env.example` contém centenas de variáveis organizadas por domínio (ambiente, networking, chrome,
pool, driver, recursos etc.). Para o `launch.json` basta garantir que `envFile` possa carregá-las –
o nome padrão (`.env`) se adequa.

O atributo `env` no `launch.json` deverá sobrepor somente as chaves de interesse: normalmente
`NODE_ENV`, `LOG_LEVEL` e a string `DEBUG` usada por
[debug module](https://www.npmjs.com/package/debug) para ativar logs detalhados.

## 3. Padrões existentes no repositório

Ao examinar o arquivo atual (versão histórica em `.vscode/launch.json`), identificam-se os seguintes
padrões repetidos:

- `--max-old-space-size=2048` em quase todos os perfis de `node`.
- `skipFiles` sempre `['<node_internals>/**', 'node_modules/**']`.
- `autoAttachChildProcesses: true` preocupado com testes e PM2.
- Perfis de subsistema somente alteram a variável `DEBUG` para filtrar.
- Modo de teste: `program` igual a `${file}` e `env.NODE_ENV = 'test'`.
- Attach PM2 e Docker usando `localRoot`/`remoteRoot` e comentários instrutivos.
- Perfis de `vite` e `chrome` para frontend sendo nos grupos `vue`.

Esses padrões informarão a estrutura modular do novo JSON: podemos construir uma única
**configuração base** e derivar variações via reutilização (copy‑paste) ou usando `compounds`
inteligentes para combinar diferente `env.DEBUG`.

## 4. Requisitos de depuração específicos

### 4.1 Agente principal

- Deve iniciar `index.js` com `NODE_ENV=development` e `DEBUG=nerv:*,kernel:*,driver:*`.
- Em produção (não usado com frequência) apenas `LOG_LEVEL=info`.
- `runtimeArgs` de memória alta (`--max-old-space-size=2048`).

### 4.2 Dashboard Web

- Programa: `src/server/main.js`.
- Porta 3008; definido em `env` ou `.env`.
- `DEBUG=server:*`.
- `runtimeArgs` menor (1024) porque é menos pesado.

### 4.3 Subsistemas isolados (NERV, Kernel, Driver, Pool, Boot, Crash, Lock,

Memory)

- Todos usam `index.js` mas variantes de `DEBUG` para filtrar eventos. Poderão ser gerados
  dinamicamente via _snippet_; não precisam existir no JSON inicial se a equipe preferir adicionar
  ad-hoc.

### 4.4 Testes

- `program` deve ser `${file}`.
- `cwd` é `${workspaceFolder}` porque o runner `node --test` resolve caminhos.
- `env.NODE_ENV=test` e `LOG_LEVEL=debug`.
- `autoAttachChildProcesses: true` para que processos de teste que espiam chrome sejam presos.

### 4.5 Attaches

#### PM2

- Porta 9229 (ou 9230 para dashboard). Precisam iniciar o processo com `--inspect=0.0.0.0:<porta>`
  conforme comentário do launch original.
- `localRoot` e `remoteRoot` são iguais (`${workspaceFolder}`) em ambiente local.
- `restart: true` permite reconectar se PM2 reiniciar.

#### Docker

- Porta igual, `address: 'localhost'` e `remoteRoot: '/app'`. O workspace dentro do container é
  `/app`.
- Não reiniciar automaticamente (`restart: false`).

### 4.6 Frontend

- Perfil `Vite` executa `npm run dev` no diretório `src/dashboard-ui`.
- Perfil `Chrome` abre uma janela em `http://localhost:5173/dashboard/` com `webRoot` apontando para
  `src/dashboard-ui` e mapeamento de path override para lidar com Vite (`/@fs/*`).

## 5. Ferramentas auxiliares e validação

- `launch.json` é reconhecido automaticamente por VS Code; não há verificação CLI padrão além da
  validação JSON. Um script `jq` poderia verificar `version` e ausência de duplicação.
- Para garantir legibilidade, podemos executar `npm run format` (Prettier) no arquivo depois de
  pronto.

## 6. Dependências de ambiente

- VS Code >= 1.80 é recomendado para suporte ao `pwa-node`/`pwa-chrome`.
- Node.js 24+ (projeto exige isso); `launch.json` não contém nenhuma configuração que seja
  incompatível.
- Para attaches funcionar com PM2, o agente deve ser iniciado via `npm run daemon:start` com
  `--inspect` adicionado no `ecosystem.config.cjs` ou manualmente.

## 7. Resumo das informações coletadas

1. **Uso de `pwa-node` e `pwa-chrome`** em vez de tipos legados.
2. **Variáveis de ambiente** principais (`NODE_ENV`, `LOG_LEVEL`, `DEBUG`, etc.).
3. **Argumentos padrão**: `--max-old-space-size`, `--expose-gc`/`--inspect-brk` para profiling.
4. **Padrões de skipFiles** e `autoAttachChildProcesses` para comportamentos consistentes.
5. **Formato dos attaches** (ports, roots) para PM2 e Docker.
6. **Configurações frontend** idênticas ao original mas simplificadas (Vite + Chrome).
7. **Compounds** desejáveis para iniciar múltiplos subsistemas juntos.
8. **Risco** de VS Code desatualizado; anotar suporte mínimo.

---

Com estes dados em mãos, qualquer desenvolvedor poderá construir um `launch.json` não apenas
funcional, mas também alinhado às práticas oficiais e ao estilo do projeto. O próximo passo é
traduzir este resumo em um arquivo concreto, o que já foi esboçado no plano anterior. Agora posso
aplicar as mudanças de fato.

> 📌 Nota: se for necessário manter compatibilidade com usuários que ainda usam o tipo `node`, a
> configuração nova pode incluir campos `type` alternativos ou dois perfis distintos com instruções
> de seleção; mas isso raramente é necessário.
