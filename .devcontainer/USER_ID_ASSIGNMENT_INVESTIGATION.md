# Investigação: problema de nome de usuário no DevContainer

## Sintoma

Ao reconstruir o DevContainer, o prompt de shell aparece como

```
Eu não tenho nome@<hostname>:/workspaces/chatgpt-docker-puppeteer$
```

ou, ao executar `whoami`/`id -un` dentro do container, o resultado é um

enumérico ou `unknown` em vez de `node`. Em outras palavras, a identidade do usuário não está sendo
resolvida e o sistema declara literalmente "Eu não tenho nome".

O comportamento esperado é que o usuário seja sempre `node` (UID 1000) e que todas as ferramentas e
scripts respeitem essa identidade.

> ⚠️ o artefato não ocorre durante o _build_ do Docker, mas sim na fase de execução/attach do
> DevContainer. Um rebuild simples (sem cache) e/ou fechamento e reabertura no VS Code faz o
> problema reaparecer em algumas máquinas.

## Onde o nome vem? Entendendo a pilha

1. **Imagem base** (`mcr.microsoft.com/devcontainers/javascript-node:24-bookworm`) já define um
   usuário `node` com UID/GID 1000.
2. O `Dockerfile` deste projeto propaga o valor de `REMOTE_USER` (sempre `node`) e cria variáveis de
   ambiente como `USER_NAME`, `HOME_DIR`, etc.
3. O VS Code lê `remoteUser` e `updateRemoteUserUID` de `devcontainer.json` para decidir com qual
   UID/GID iniciar o container.
4. Para dar flexibilidade adicional o repositório implementa o "Gatekeeper" (`libnss-wrapper`) que
   gera dinamicamente um arquivo de passwd em `/tmp/devcontainer-nss/passwd` e faz o preload da
   biblioteca para que o conjunto de chamadas `getpwnam(3)`/`getpwuid(3)` resolva o usuário ativo.
   Essa camada permite que a identidade seja alterada em tempo de execução sem modificar o
   `/etc/passwd` original.
5. O script `post-create.sh` é responsável por criar/atualizar o arquivo de sobrenome (`passwd`) com
   base nas variáveis `CURRENT_USER`, `CURRENT_UID` e `CURRENT_GID` detectadas no container.

Todo o fluxo aparece linear e, em teoria, garante que `whoami`/mensagens de prompt mostrem sempre o
nome correto.

## Causa raiz(es)

A investigação revelou dois vetores que podem levar à mensagem “Eu não tenho nome”:

1. **UID em uso não existe no `/etc/passwd`**
   - O DevContainer pode ser executado com o UID do usuário do host quando `updateRemoteUserUID`
     está habilitado (valor `true`). Quando a opção está _desabilitada_ (`false`), a extensão não
     altera `/etc/passwd` e o container continua com a entrada fixa 1000.
   - Em máquinas onde o usuário local não tem UID 1000 (por exemplo, 1001 ou 1002, comum em WSL2 ou
     ambientes remotos), a sessão inicia com esse UID estrangeiro. Como `/etc/passwd` não possui
     essa entrada, a chamada `id -un` retorna erro e a prompt do Bash substitui o nome por "Eu não
     tenho nome".
   - O gatekeeper ainda tenta gerar um arquivo em `/tmp/devcontainer-nss` mas registra apenas o
     `CURRENT_USER` (obtido com `id -un`) – ou seja, o valor vazio/`unknown` – e o resultado é um
     arquivo `passwd` que também não contém a linha necessária. Quando o wrapper é carregado, o
     processo fica preso sem nome definido.

2. **Artefatos NSS corrompidos ou ausentes**
   - Se a execução de `post-create.sh` for abortada antes de escrever o arquivo de identidade (por
     exemplo, por um erro anterior ou um signal de reinício), o diretório `/tmp/devcontainer-nss`
     pode acabar existente mas vazio. O perfil interativo carrega o gatekeeper devido ao arquivo
     presente, mas como ele não contém nenhuma entrada, o lookup também falha e o prompt descreve a
     situação exatamente como no sintoma.
   - Este caso é mais raro, mas explica por que o problema pode ocorrer mesmo com
     `updateRemoteUserUID` corretamente configurado.

Ambos os vetores resultam em um contêiner **executando sob um UID sem registro no NSS**; a tradução
portuguesa de `libc` então concatena o texto "Eu não tenho nome" no prompt e em `whoami`.

## Diagnóstico rápido

Dentro do container afetado, execute:

```sh
id -u; id -un
ls -l /tmp/devcontainer-nss/passwd /etc/passwd
cat /tmp/devcontainer-nss/passwd || true
cat /etc/passwd | grep node || true
```

Os sinais clássicos de problema são:

- O primeiro `id` retorna uma ID diferente de `1000`.
- `id -un` não imprime `node` ou imprime `unknown`.
- `/tmp/devcontainer-nss/passwd` existe mas está vazio ou não contém o UID em uso.
- `/etc/passwd` só tem a entrada `node:x:1000:1000:...`.

Os logs do `post-create.sh` (normalmente em `~/.devcontainer/logs/post-create.log`) também listarão
a verificação de identidade e poderão conter a mensagem "CONTRATO DE IDENTIDADE VIOLADO".

## Correções e mitigação

1. **Habilitar `updateRemoteUserUID`** (fixar a configuração do projeto):

   ```jsonc
   // .devcontainer/devcontainer.json
   "updateRemoteUserUID": true,
   ```

   Essa alteração garante que a extensão adapte `/etc/passwd` à UID que o VS Code estiver usando. Só
   é necessário reconstruir/reatachar o container após a mudança.

2. **Adicionar lógica resiliente ao Gatekeeper**
   - Já há um bloco de verificação de identidade no começo de `post-create.sh` que aborta se
     `CURRENT_USER` não for `node`. Ele é válido para detectar configurações incorretas, mas falha
     quando `id -un` retorna vazio/`unknown` -- nesse caso o script deveria assumir `node` e gerar
     um passwd estável em vez de parar.
   - Proposta de patch (exemplo) inserido em `post-create.sh`:
     ```bash
     readonly CURRENT_USER="$(id -un 2>/dev/null || echo unknown)"
     readonly CURRENT_UID="$(id -u 2>/dev/null || echo unknown)"
     if [[ "${CURRENT_USER}" == "unknown" ]]; then
         warn "UID ${CURRENT_UID} sem nome no NSS, forçando 'node' temporário."
         CURRENT_USER=node
     fi
     ```
   - Essa cadeia garante que o artefato `/tmp/devcontainer-nss/passwd` sempre terá pelo menos a
     linha `node:x:<uid>:<gid>...`, evitando o prompt vazio.
   - Alternativamente, configurar `DEVCONTAINER_SKIP_NSS=true` para desativar o wrapper, caindo de
     volta ao `/etc/passwd` estático (útil como workaround imediato).

3. **Procedimentos operacionais**
   - Sempre reconstruir o container completamente (`Rebuild without cache`) ao alterar o usuário ou
     após atualizar a UID do host.
   - Verificar o `remoteUser` no `devcontainer.json` e certificar-se de que ele seja `node` — não
     misturar com `containerUser` ou outras variáveis.
   - Se o problema reaparecer, limpar manualmente o diretório NSS antes de reconectar:
     `rm -rf /tmp/devcontainer-nss && exit` e abrir nova sessão.

4. **Documentação e auditoria**
   - O arquivo .devcontainer/USER_ID_ASSIGNMENT_INVESTIGATION.md (este arquivo) serve como
     referência e deve ser citado em qualquer auditoria relacionada a identidade de usuário ou ao
     gatekeeper.
   - Atualizar os relatórios de auditoria (em DOCUMENTAÇÃO/AUDITORIAS) para incluir essa explicação
     — já existem menções a `updateRemoteUserUID` que agora devem apontar para o incidente.

## Conclusão

O navegador de containers não estava "esquecendo" o nome de propósito; o problema ocorreu porque o
processo rodava com um UID que não existia no sistema de nomes. A combinação de
`updateRemoteUserUID=false` e/ou artefatos NSS insuficientes permitiu que um `node` invisível se
tornasse um UID anônimo.

A correção definitiva é manter a UID em sincronia com a sessão e tornar o Gatekeeper mais tolerante,
conforme descrito acima. Após aplicar essas mudanças e reconstruir, o prompt volta a mostrar

```
node@<hostname>:/workspaces/chatgpt-docker-puppeteer$
```

sem mais intermitências.

---

_Arquivo gerado automaticamente em 2026‑02‑25 como parte da investigação solicitada._
