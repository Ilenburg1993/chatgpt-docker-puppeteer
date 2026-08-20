# Auditoria dos Hooks do DevContainer

Este documento analisa os scripts que participam do ciclo de vida do devcontainer (`post-create.sh`,
`post-start.sh`, `post-attach.sh`, `validate-env.sh` e `healthcheck.sh`), apontando correções,
aprimoramentos e oportunidades de upgrade. O objetivo é manter um conjunto coerente, resiliente e
auto-documentado.

## Políticas relacionadas a mounts

Como o devcontainer depende de vários **bind mounts** (volume do código, socket do Docker,
ssh-agent, etc.), existe uma superfície de risco consistente entre a imagem, o `Dockerfile` e os
hooks. Esta seção consolida os contratos que devem estar sincronizados em todos os lugares:

- O `Dockerfile` documenta o comportamento: **nunca assumimos volumes montados** e **não fazemos
  `chown -R` em caminhos que possam corresponder a mounts** (ver seção 8 e SSH_AGENT_ANCHOR).
- `post-create.sh` reforça o mesmo com um _contrato de chown_ (ver 2.1.1) e realiza uma auditoria
  explícita (`mount` + `VOLUME_DIRS`). Mantê‑lo alinhado com quaisquer alterações no `Dockerfile`.
- Outros scripts (`post-start.sh`, `healthcheck.sh`) devem ser cientes de que qualquer classificação
  de arquivo pode ser alterada por um bind mount e, quando apropriado, limpar ou revalidar dados
  após cada execução.
- Testes unitários devem simular montagens inconsistentes e verificar que o código não tenta forçar
  propriedade ou criar diretórios sobre um caminho já montado.

> **Meta‑check:** A cada refatoração, faça uma revisão cruzada entre o `Dockerfile` e os scripts
> para garantir que os comentários de política de mount permaneçam em sintonia.

---

---

## 1. post-create.sh

### Observações atuais

- Ganho recente: detecção automática do GID do socket `/var/run/docker.sock` e injeção no arquivo
  NSS. O trecho existente já gera `/tmp/devcontainer-nss/{passwd,group}` e garante permissions.
- Há várias fases (identity, nss, groups, docker, workspace ownership, etc.) espelhando o documento
  de análise interna.
- A primeira linha `set -euo pipefail` é usada e o script falha se algo crítico quebrar, o que
  condiz com a função de `post-create`.

### Sugestões

- [ ] **Modularizar**: extrair blocos repetitivos (`mkdir -p`, `chown`) em funções no topo,
      facilitando leitura e testes. Já existe lógica duplicada entre a preparação de `NSS` e de
      `workspace`.
- [ ] **Reforçar contrato de chown**: o script declara explicitamente que _não_ deve executar
      `chown -R` sobre diretórios montados do host (especialmente o `PROJECT_ROOT`). Inserir uma
      verificação/aviso em runtime e documentar este contrato no topo do arquivo. Verificar também
      que o `Dockerfile` (seção 8) contenha comentários idênticos para não gerar divergência.
- [ ] **Evitar parsing de `id` repetido**: calcular `CURRENT_UID/GID/USER` uma única vez e reusar,
      em vez de chamar `id` em cada branch.
- [ ] **Reavaliar uso de `usermod`**: operações como `usermod -aG docker` exigem privilégio root; em
      container unprivileged podem falhar silenciosamente. O script já tolera erros, mas um log
      explícito ajudaria.
- [ ] **Adicionar flag DEBUG**: documentar fallback e permitir impressão de cada passo quando
      `DEBUG` estiver definido.
- [ ] **Teste de sanity final**: verificar se `/etc/passwd` (ou NSS) está legível e contém a entrada
      esperada após execução.
- [ ] **Compatibilidade POSIX**: decidir se o script deve suportar `/bin/sh`; caso contrário,
      reforçar no cabeçalho que só funciona com bash.
- [ ] **Cache de estado**: gravar hora/versão em `.devcontainer/.initialized` para pular partes
      redundantes em reconstruções.
- [ ] **Isolar lógica de docker group**: mover detecção de socket/GID para um helper reutilizável
      (`scripts/docker-group.sh`).

---

## 2. post-start.sh

### Observações atuais

- Bastante simples e não bloqueante. Executa `make info` para coletar informações e grava status em
  `/tmp/devcontainer-health.status` (consumido pelo `healthcheck.sh` e pelo `post-attach.sh`).
- Usa logs informativos/avisos mas sempre sai com `0`.

### Sugestões

- [ ] **Possibilidade de `exit` com erro opcional**: em alguns workflows o devcontainer pode querer
      sinalizar falha (ex: se `make info` retorna código específico). Poderia haver uma variável
      `DEVCONTAINER_START_STRICT` que, quando definida, faz o script repassar o código de `make`.
- [x] **Link com healthcheck**: o `healthcheck.sh` já consome `/tmp/devcontainer-health.status` para
      respeitar o estado observacional emitido pelo `post-start.sh`.
- [ ] **Incrementar verificações**: além de `make info`, poderia checar a presença de artefatos
      criados pela `post-create` (ex.: `/tmp/devcontainer-nss/passwd`) para detectar inicialização
      parcial.
- [ ] **Timeout configurável no `make info`**: já há variável, mas seria conveniente aceitar
      `DEVCONTAINER_MAKE_TIMEOUT` ambiente, com fallback ao default.

---

## 3. post-attach.sh

Este é o mais elaborado dos hooks. O design por fases e a API de mensagens são exemplares. Pontos de
ação:

- [ ] **Reduzir I/O repetido**: amortizar atualizações de estado UX em attaches frequentes.
- [ ] **Escrever testes unitários** para cada fase (1ª attach, contagem, state file, etc.).
- [ ] **Adicionar `DEBUG` flag** que ativa logs adicionais ou rastreia ações internas.
- [ ] **Rotação de namespace UX** se o número de arquivos/attaches exceder threshold.
- [ ] **Internacionalização das mensagens** ou oferecer variante EN/pt com base em `${LANG}`.
- [ ] **Implementar `--version`/`--help`** para execução manual do script.

---

## 4. validate-env.sh

O validador de variáveis está bem estruturado. Melhorias possíveis:

- [ ] **Adicionar validações extras**: incluir `DOCKER_GID` (se usado), `DEVCONTAINER_SKIP_NSS`,
      `DEBUG`, `ALLOWED_ORIGINS` e outros tokens que são críticos para o container funcionar.
      Documentar polimorfismo em `BROWSER_MODE`.
- [ ] **Suporte a `--quiet`/`--json`**: permitir saída mínima ou estruturada para CI.
- [ ] **Verificação de valores duplicados no .env**: detectar chaves repetidas que podem causar
      confusão.
- [ ] **Test coverage**: acionar este validador nos testes unitários com entradas falsas para
      garantir permanência das regras.

---

## 5. healthcheck.sh

Excelente definição de filosofia (Node é crítico, resto é avisos). Pequenas áreas de afinamento:

- [x] **Consumir /tmp/devcontainer-health.status**: implementado. O healthcheck já respeita estados
      `fatal` / `unhealthy` como falha e trata estados advisory como warnings.
- [ ] **Verificação de `docker`**: incluir um teste de socket para fornecer aviso se a máquina host
      não está expondo o Docker, útil para workflows com CI (especialmente agora que o post-create
      injeta grupo based on socket).
- [ ] **Timeouts configuráveis via ENV**: `NODE` timeout, `curl` timeouts já existem mas poderiam
      ser expostos para facilitar debugging em redes lentas.
- [x] **Documentar no README/arquitetura**: a documentação canônica do DevContainer agora registra
      explicitamente que a imagem declara `HEALTHCHECK` nativo sincronizado com
      `/usr/local/bin/devcontainer-healthcheck.sh`.

---

## 6. General proposals

1. **Centralização de helpers**: mover funções comuns (`log_info`, palette de cores, `color_enabled`
   detection) para um script `devcontainer-common.sh` que é `source`d pelos hooks. Facilita
   manutenção e reduz duplicação.

2. **Mechanismo de versionamento global**: cada hook declara sua versão mas não há modo automático
   de relatar se todos estão alinhados com a mesma release. Um meta‑script podia verificar
   consistência (usar `grep` em todos e comparar). Isso ajuda em auditorias.

3. **Auditoria de permissões**: scripts escrevem em vários locais (`/tmp`, `$HOME`,
   `.devcontainer/state`). Poderia haver um `post-check` que garante permissões mínimas e ownerships
   após cada hook, evitando leaks quando um `bind mount` altera algo.

4. **Security review**: verificar se algum dos hooks executa `curl` sem `-f` ou `wget` sem TLS. O
   healthcheck e color detection usam `curl` com `-sf` ok. Ainda assim, valeria adicionar
   disclaimers no topo dos scripts.

5. **Documentation**: adicionar índice dos hooks em
   `DOCUMENTAÇÃO/DEVCONTAINER_SCRIPTS_ANALYSIS_V5.md` (já existe título similar) e referenciar este
   novo arquivo de auditoria.

6. **Automated tests**: em `tests/unit/devcontainer/` já há NSS tests; criar specs adicionais para
   each hook (dummy environment, verifying exit codes, message formats, socket detection, state
   files, healthcheck outcomes). Algumas já existem? search quickly. (search for `post-create`
   tests.)

7. **Improve error handling**: although many scripts adopt fail‑safe, a couple still assume `bash`
   builtins (`[[`, `local`). Document at top that `bash` is required and treat as lint rule in the
   audit script.

8. **Upgrade hints**:
   - Consider offering a `devcontainer-helpers` npm package in future, rewriting some shell logic in
     JS/Node for portability. Not urgent.
   - Move healthcheck to a lightweight binary (tiny Go) for speed in large deployments.

---

### Resumo

O conjunto de scripts é robusto, bem comentado e adere às políticas de projeto. As melhorias
listadas são em grande parte _incrementais_ — modularização, melhor cobertura de validações, um
pouco mais de automatismo no `post-create` (e já implementado o auto‑DOCKER_GID), e documentação.
Nenhuma alteração fundamental é necessária; a auditoria tende a reduzir a complexidade de manutenção
e aumentar a testabilidade.

Sinta‑se à vontade para usar este arquivo como checklist ao preparar o PR de integração. As
sugestões podem ser implementadas conforme prioridades do release.

---

_Documento gerado 2026‑02‑25 23:xx por auditoria automática._
