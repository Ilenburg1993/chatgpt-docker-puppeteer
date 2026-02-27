# NSS Gatekeeper – Fluxo, Falhas e Plano de Upgrades

Este documento descreve o fluxo completo associado ao _gatekeeper_ de identidade baseado em
**libnss-wrapper** utilizado pelo devcontainer, identifica gaps e propõe um conjunto detalhado de
correções e melhorias. A intenção é servir como referência técnica para auditorias futuras ou
modificações relacionadas.

---

## 1. Visão Geral do Fluxo

1. **Instalação da biblioteca**
   - `Dockerfile` instala pacote `libnss-wrapper`.
   - `/etc/profile.d/10-gatekeeper-nss.sh` fornecido pelo pacote cria artefatos e exporta variáveis
     quando a shell é iniciada (interativa por padrão).

2. **`post-create.sh`**
   - Validadores, permissões e validação de ENV.
   - _Seção 9 – Gatekeeper NSS_:
     - cria `${NSS_BASE_DIR}` (por padrão `/tmp/devcontainer-nss`).
     - gera inicial `passwd` e `group` para o usuário canônico.
     - verifica existência de `libnss_wrapper.so` e emite warning.
     - grava `.devcontainer/.initialized`.

3. **`post-start.sh`**
   - executa `make info`, define `status`.
   - checa e repara artefatos NSS se ausentes (regeneração minimalista).
   - verifica `.initialized` presente, exibe instruções.
   - realiza inspeção SSH (chaves + sshd).
   - escreve `/tmp/devcontainer-health.status`.

4. **`post-attach.sh`**
   - estado UX, contagem de attaches, exibe banner/contexto/ENV status.
   - não interage diretamente com NSS mas supõe que o gatekeeper já funcionou.

5. **`healthcheck.sh`** (não parte de fluxo primário mas consultado pelo Docker)
   - reproduz algumas verificações de `post-start.sh` e executa checks adicionais.

---

## 2. Problemas e Gaps Identificados

### 2.1. Configuração do gateway

- Shell interativo somente → processos não‑shell não recebem o wrapper.
- Dependência frágil em `post-create` (se pulado, ninguém ativa o NSS).
- Artefatos estáticos: UID mudado durante a sessão não é re‑registrado até `post-start` ou nova
  shell.
- `/tmp` escolhido por conveniência; não explicita local configurável.
- **LD_PRELOAD string management:** valor construído em profile pode exceder limites do kernel,
  incluir caminhos relativos, ou vir vazio; shells não‑login/exec não herdam. Erros silenciosos
  resultam em NSS não ativado sem aviso (ver mensagens de "object cannot be preloaded").

### 2.2. `post-create.sh`

- nenhum retorno de erro se o wrapper não for ativado (a validação é warning‑only).
- não regenera artefatos em re‑execução (embora provavelmente nunca seja re‑exec).
- log de falhas NSS minimal; não orienta usuário.

### 2.3. `post-start.sh`

- timeout do `make info` fixo e não configurável (sugestão de variável mas não implementada).
- arquivo de status escrito, mas não utilizado pelo healthcheck.
- recheio do `status` com degradado/OK é simples, mas não distingue entre causas.
- reparo NSS pode gerar entrada de root se UID for 0.
- SSH check ignora agente encaminhado.
- `sshd` verificação irrelevante para maior parte dos usos.

### 2.4. `post-attach.sh`

- escrituras a cada attach, provocando I/O frequente.
- nenhuma cobertura por testes.
- não lê eventuais variáveis de configuração relevantes (ex.: caminho NSS customizado).

### 2.5. Healthcheck duplication

- condições verificadas duas vezes; aumenta risco de divergência.

### 2.6. Gerais

- falta de testes específicos para os scripts de lifecycle (exceto gatekeeper unit tests
  existentes).
- inexistência de mecanismo para serviços não-baseados em shell receberem o gatekeeper (entrypoint
  wrapper, etc.).
- **LD_PRELOAD collisions:** outras ferramentas que também usem LD_PRELOAD (google-chrome, wine,
  debugging libs) podem sobrescrever ou ser sobrescritas; não há checagem ou concatenação segura no
  perfil/entrypoint.

---

## 3. Recomendações de Correção / Upgrades

Cada item abaixo tem um bloco "✅" quando já realizado ou uma caixa de seleção para acompanhamento.

### 3.1. Gatekeeper NSS

- [x] **Auto‑reparo em `post-start.sh`** (gera arquivos ausentes/atuais).
- [x] Documentação explicando o papel de `/tmp/devcontainer-nss` e a opção `DEVCONTAINER_NSS_DIR`.
- [x] **Adicionar variável `DEVCONTAINER_NSS_DIR`** nas duas hooks e no profile.
- [x] **Implementar wrapper de entrypoint** que ativa NSS antes de qualquer comando
      (`ENTRYPOINT ["/usr/local/bin/nss-gatekeeper"]`).
- [x] Publicar `NSS_ALWAYS_ACTIVE_ANALYSIS` e escrever testes de regressão para o wrapper
      modificado.
- [ ] **LD_PRELOAD robustness**: add validation to ensure the string is non-empty, below kernel
      limit, uses absolute paths and merges existing LD_PRELOAD values instead of overwriting.
      Provide helper to log the final value for diagnostics.
- [ ] Test scenario where another LD_PRELOAD user exists (Chrome debug) to verify coexistence.

### 3.2. post-create.sh

- [x] Converter warning crítico de NSS em **fail-fast** quando a biblioteca falta ou os arquivos não
      são graváveis.
- [x] Regerar artefatos caso UID/GID atual não esteja presente (agora feito em post-start; talvez
      duplicar aqui).
- [x] Expor `DEVCONTAINER_MAKE_TIMEOUT` e `DEVCONTAINER_NSS_DIR` na taxonomia de ENV e no validador.
- [x] Adicionar teste unitário para a rotina NSS do post-create.

### 3.3. post-start.sh

- [x] Verificação/auto-reparo dos artefatos (com explicações no terminal).
- [x] Mensagens de orientação aos usuários adicionadas.
- [x] Suportar `DEVCONTAINER_MAKE_TIMEOUT` e `DEVCONTAINER_ENABLE_SSHD_CHECK`.
- [x] Evitar autoreparo quando UID=0 (não gerar entrada root).
- [x] Melhorar detecção de chave SSH encaminhada (`ssh-add -L` test).
- [x] Atualizar `healthcheck.sh` para ler `/tmp/devcontainer-health.status` ou removê-lo se
      redundante.
- [x] Adicionar testes de fluxo simulado (use o padrão do `nss_wrapper.spec.js`).

### 3.4. post-attach.sh

- [x] Amortizar I/O do contador (somente escrever se `ATTACH_COUNT % 10 == 0`).
- [x] Adicionar suporte aos flags `--brief`, `--help` e `--version`.
- [x] Injetar `DEVCONTAINER_NSS_DIR` no diagnóstico se presente.
- [x] Cobertura por testes unitários (criar `tests/unit/devcontainer/attach.spec.js`).
- [x] Permitir internacionalização básica.
- [ ] Display current LD_PRELOAD value and warn if it doesn't include the gatekeeper library or has
      suspicious entries (empty, broken path etc.).

### 3.5. Healthcheck / meta

- [x] Consolidar healthcheck logic: consumir arquivo de status, expor alertas detalhados.
- [x] Adicionar `make info` status code categorization ao healthcheck output.
- [ ] Documentar no README a ligação `post-start → healthcheck`.
- [ ] Healthcheck should inspect LD_PRELOAD and report if gatekeeper library is missing or broken;
      current warnings from `ld.so` should fail the check.

### 3.6. Processos não‑shell

- [x] Investigar e, se necessário, implementar **entrypoint wrapper** para que qualquer
      `CMD`/`ENTRYPOINT` execute código que ative NSS (ver design doc).
- [ ] Extend wrapper to handle LD_PRELOAD inheritance for non‑shell processes by exporting
      `DEVCONTAINER_LD_PRELOAD_FROM_PROFILE` and merging at invocation time.

### 3.7. Testing & CI

- [x] Incluir em `npm run test:unit --grep=devcontainer` as novas especificações.
- [x] Criar `tests/unit/devcontainer/post-start.spec.js` para validar:
  - variável `status` após diferentes cenários
  - reparo automático e regeneração de UID
  - mensagem de orientação

- [ ] Adicionar verificação de lint/`bash -n` contra os scripts em pipeline.

### 3.8. Documentation & Checklists

- [ ] Atualizar `.devcontainer/POST_CREATE_AUDIT.md` com os resultados e planos desta análise.
- [ ] Criar lista de verificação (`REBUILD_READY_CHECKLIST.md`) que inclui gatekeeper e health
      rules.

---

## 4. Checklist resumida (para tarefas imediatas)

- [ ] Exportar `DEVCONTAINER_NSS_DIR` em schema & validador.
- [ ] `post-create.sh` deve `exit 1` se `libnss_wrapper.so` não for detectada.
- [ ] `post-start.sh` adicionar suporte à variável de timeout.
- [ ] Ajustar healthcheck para ler `/tmp/devcontainer-health.status`.
- [ ] Criar testes unitários para `post-start` e `post-attach`.
- [ ] Avaliar se o entrypoint wrapper é necessário e, se sim, esboçar oferta.
- [ ] Add LD_PRELOAD validation step to tests (empty, too long, missing gatekeeper lib).
- [ ] Ensure wrapper concatenates instead of overwriting existing LD_PRELOAD values.

---

## 5. Conclusão

O gatekeeper NSS é um mecanismo crítico que corrige um problema clássico de identidade em
contêineres. O fluxo atual cobre a maior parte dos casos, mas vários pontos fracos foram
identificados – principalmente convolvendo shells não-interativos, dependência de `post-create` e
fissuras na validação/recuperação.

O conjunto de upgrades propostos transforma o sistema em algo resiliente, autocorretivo e fácil de
diagnosticar, além de promover cobertura de testes e melhor integração com o healthcheck. Uma
implementação faseada (perfil → entrypoint → testes) permite entregar valor incremental sem grandes
riscos.

⚙️ **Próximos passos sugeridos**: aplicar os itens da checklist, rodar a suíte de unitários e, se
possível, executar um rebuild completo para confirmar que a atalha de `status=degraded` desaparece
em containers saudáveis.

---

_Documento gerado automaticamente pelo AI assistant a pedido do time._
