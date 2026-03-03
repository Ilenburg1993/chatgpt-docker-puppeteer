# Plano de Upgrade / Reconstrução do `.vscode/tasks.json`

Assim como fizemos com o `launch.json`, o arquivo de tasks cresceu ao longo de anos e hoje contém
centenas de linhas com comandos redundantes, escapes complexos e lógica de "debug mode" que poderia
residir em scripts ou no Makefile. Este plano descreve a investigação e os passos para substituir o
arquivo atual por uma versão enxuta, mais exibível e fácil de manter.

---

## 1. Objetivos

1. **Simplificar**: manter apenas tarefas úteis, removendo variantes duplicadas (por exemplo,
   diferentes filtros de ESLint que podem ser cobertos por um só script `make lint`).
2. **Delegar ao Make/npm**: todos os comandos de build/test/lint/deploy já existem como alvos Make
   ou scripts npm; as tasks só devem chamar `make …` ou `npm run …` para evitar reescrever lógica
   nos dois lugares.
3. **Agrupar** por categorias lógicas com `group` e `dependsOn` em vez de 50 entradas soltas.
4. **Compatibilidade**: preservar os comportamentos existentes para quem usa o arquivo hoje
   (compounds de validação, health checks, PM2, etc.).
5. **Documentar**: inserir comentários e instruções no README ou plano explicando como estender o
   conjunto de tasks.

## 2. Escopo de limpeza

- Eliminar seções inteiras à base de `npx eslint` e `bash -c "…"` e criar um único `make lint`
  equivalente (Makefile já tem). O mesmo vale para testes, health, PM2, logs, fila, git,
  dependências etc.
- Remover tasks dedicadas a "Debug Mode" (source-only, tests-only, stats, export HTML/JSON). Se
  ainda úteis, podem ser transformadas em targets Make ou npm e invocadas via uma task única
  `Debug Scan`.
- Conservar apenas as tarefas de validação (JSON, shellcheck, git diff, node --check), porque são
  pequenas e úteis, mas talvez movê‑las para um compound chamado `Validate All`.
- Reduzir ou eliminar explicitações de `presentation` repetidas – podemos usar configurações globais
  (por exemplo, `presentation` no nível superior) ou deixar o default do sistema.
- Introduzir inputs/variables se aparecer necessidade de selecionar portas ou perfis.
- Garantir que as tarefas continuem a funcionar em Windows/Linux/macOS através de `make` (que já
  trata de cross‑platform) ou `npm`.

## 3. Etapas da migração

1. **Mapear alvos existentes**: listar todos os `Makefile` e scripts npm que correspondem a tarefas
   do `tasks.json` atual.
2. **Escrever novo tasks.json** contendo:
   - Tarefas de build & qualidade (`lint`, `format`, `typecheck`).
   - Tarefas de teste (unit, integration, all).
   - Tarefas de verificação de saúde, PM2, logs, queue, git, deps, manutenção.
   - Composite tasks (`Validate All`, `Pre-commit Check`, `Full CI Check`).
   - Um ou dois "Debug" helpers para executar scans ou abrir o workspace em modo especial (usando
     `make debug` ou `npm run debug:*`).
3. **Remover a velha tasks.json** e substituir pelo novo (mantendo backup `tasks.legacy.json` se
   desejado). 4. **Ajustar README/doc** com as novas instruções (mencionadas no upgrade de
   launch). 5. **Validar** abrindo o painel de tarefas e executando cada uma em um ambiente de
   teste; corrigir erros de caminho ou de sintaxe. 6. **Executar `npm run lint` e `make`** para
   garantir que nada quebre. 7. **Rodar `npm run test:unit` / `make test-unit`** através das tasks
   para confirmar.

## 4. Exemplo de novo `tasks.json`

```json
{
  "version": "2.0.0",
  "presentation": { "panel": "shared" },
  "tasks": [
    {
      "label": "lint",
      "type": "shell",
      "command": "make lint",
      "problemMatcher": ["$eslint-stylish"],
      "group": { "kind": "build", "isDefault": true }
    },
    { "label": "format", "type": "shell", "command": "make format", "group": "build" },

    { "label": "test:unit", "type": "shell", "command": "make test-unit", "group": "test" },
    {
      "label": "test:integration",
      "type": "shell",
      "command": "make test-integration",
      "group": "test"
    },
    { "label": "test:all", "type": "shell", "command": "make test-all", "group": "test" },

    { "label": "health:core", "type": "shell", "command": "make health-core" },
    { "label": "health:full", "type": "shell", "command": "make health" },

    { "label": "pm2:start", "type": "shell", "command": "make start" },
    { "label": "pm2:stop", "type": "shell", "command": "make stop" },
    { "label": "pm2:status", "type": "shell", "command": "make status" },
    {
      "label": "pm2:monitor",
      "type": "shell",
      "command": "npm run daemon:monit",
      "isBackground": true
    },

    { "label": "logs:follow", "type": "shell", "command": "make logs", "isBackground": true },

    { "label": "queue:status", "type": "shell", "command": "npm run queue:status" },
    { "label": "queue:add", "type": "shell", "command": "make queue-add" },

    { "label": "git:safe-push", "type": "shell", "command": "make git-push-safe" },
    { "label": "git:changed", "type": "shell", "command": "make git-changed" },

    { "label": "deps:check", "type": "shell", "command": "make deps-consistency" },
    { "label": "deps:install", "type": "shell", "command": "make install-deps" },
    { "label": "deps:update", "type": "shell", "command": "make update-deps" },

    { "label": "clean", "type": "shell", "command": "make clean" },
    { "label": "diagnose", "type": "shell", "command": "make diagnose" },
    { "label": "clean", "type": "shell", "command": "make clean" },

    { "label": "info", "type": "shell", "command": "make info" },
    { "label": "version", "type": "shell", "command": "make version" },
    { "label": "check-env", "type": "shell", "command": "npm run check:env" },

    {
      "label": "validate-all",
      "dependsOn": ["lint", "test:unit", "health:core", "git:changed"],
      "dependsOrder": "sequence"
    },

    { "label": "debug-scan", "type": "shell", "command": "npx eslint . --format=stylish" }
  ]
}
```

Os detalhes acima são um ponto de partida; durante a implementação serão ajustados os nomes de
targets e as opções de apresentação para manter o conjunto anteriormente usado pelos
desenvolvedores.

## 5. Cronograma sugerido

Similar ao plano do `launch.json`:

1. 1 dia para mapear e escrever novo `tasks.json`.
2. 1/2 dia para testes e ajustes.
3. 1 dia para revisão de PR e comentários da equipe.
4. 2 horas para documentar alterações e exemplos (já começamos no README).

## 6. Critérios de aceitação

- O novo `tasks.json` é significativamente mais curto (<200 linhas em vez de 800+) e não repete
  ignore-patterns ou comandos shell complexos.
- Todos os workflows listados anteriormente (lint, build, test, health, PM2, logs, queue, git, deps,
  maintenance, info, validações) ainda executam corretamente via as tarefas correspondentes.
- O comando `validate-all` continua a agregar verificações transversais.
- A documentação do README está atualizada com instruções de uso e extensões.
- O build/lint/testa local e no CI passam usando os novos tasks.

---

Com esse plano em vigor, o próximo passo é codificar o novo `tasks.json`, o que farei em seguida.
