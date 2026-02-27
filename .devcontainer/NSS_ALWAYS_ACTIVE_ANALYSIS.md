# Análise de Upgrade do NSS Wrapper (Gatekeeper)

**Objetivo**: tornar o suporte a identidade dinâmica (NSS wrapper) **sempre ativo** – não apenas em
shells interativos – e corrigir todos os comportamentos falhos.

Este documento mergulha na implementação actual, identifica falhas, e define um plano preciso de
upgrade.

---

## 1. Situação Actual

- A imagem instala `libnss-wrapper` e um script de _profile_
  (`/etc/profile.d/10-gatekeeper-nss.sh`).
- O script é executado **somente em shells interativos** (guard `[[ $- != *i* ]] && return`).
- O `post-create.sh` gera artefatos em `/tmp/devcontainer-nss/{passwd,group}` durante a fase de
  criação.
- O gatekeeper define `NSS_WRAPPER_PASSWD`, `NSS_WRAPPER_GROUP`, e `LD_PRELOAD` **somente se**:
  1. o shell for interativo
  2. o ficheiro de passwd existir e
  3. a biblioteca estiver instalada
- Há uma variável de bypass (`DEVCONTAINER_SKIP_NSS`) e um mecanismo de falha elegante.

### Falhas observadas

1. **Não funciona para shells não interativos** (scripts `npm run …`, CI, `docker exec` etc.).
2. **Dependência frágil de post‑create**: se o script não rodar, o NSS nunca é activado.
3. **Arquivo PASSWD estático**: só contém a identidade detectada na primeira invocação, não se
   actualiza se o UID do container mudar (ex.: `updateRemoteUserUID` habilitado).
4. **Guard interativo** impede utilitários não‑shell de usufruir da correção — ferramenta node
   executada por PM2 não resolve o usuário em alguns cenários.
5. **Estado inconsistente**: artefatos vazios podem levar a shells sem nome (já corrigido
   parcialmente no post-create, mas não no profile).

## 2. Requisitos do Upgrade

1. **Ativação universal** – trabalhar em qualquer contexto (interactivo, não–interactivo, login ou
   não).
2. **Auto‑reparo** – regenerar /tmp/devcontainer-nss/passwd sempre que o UID corrente não está nele.
3. **Independência de post‑create** – caso o post-create não tenha corrido ou tenha falhado, o
   gatekeeper deve corrigir-se sozinho.
4. **Performance razoável** – pequenas operações shell no início de cada sessão são aceitáveis.
5. **Transparência auditável** – logs claros se o NSS foi activado ou se ocorreu fallback.
6. **Compatibilidade** – manter `DEVCONTAINER_SKIP_NSS` e permitir desactivar manualmente se
   necessário.

## 3. Opções de Implementação

| Abordagem                                                                          | Vantagens                                                              | Desvantagens                                                                     |
| ---------------------------------------------------------------------------------- | ---------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| 1. Alterar apenas `/etc/profile.d/` (remover guard, acrescentar lógica de criação) | Mais simples; continua a usar mecanismo já existente                   | Não afeta process runners que não carregam profile (`systemd`, `node` sem shell) |
| 2. Adicionar **entrypoint wrapper** que executa código NSS antes de `CMD`          | Garante ambiente para todos os processos                               | Introduz complexidade e possível conflito com devcontainer default entrypoint    |
| 3. Exportar variáveis via `ENV` na Dockerfile e gerir artefatos via cron/daemon    | Adequado para processos não-shell; precisa de mecanismo de atualização | Overkill para um DevContainer; cron desnecessário e pode atrasar startup         |
| 4. Combinar 1+2: profile continue para shells, entrypoint leve para o resto        | Equilibrado; permite melhoria incremental                              | Maior manutenção (duas vias de activação)                                        |

Decisão inicial: **Iniciar pelo perfil** (opção 1) porque já existe e resolve a maior parte dos
incidentes relatados. A opção 2 pode ser adicionada mais tarde se processos não–shell continuarem a
falhar.

## 4. Detalhes de Design (perfil modificado)

```bash
# /etc/profile.d/10-gatekeeper-nss.sh
# "Universal Gatekeeper" — ativa sempre

# Bypass explícito (humano/makefile/debug)
[ -n "${DEVCONTAINER_SKIP_NSS:-}" ] && return

NSS_BASE_DIR="/tmp/devcontainer-nss"
PASSWD_FILE="${NSS_BASE_DIR}/passwd"
GROUP_FILE="${NSS_BASE_DIR}/group"
NSS_SO_PATH="/usr/lib/$(uname -m)-linux-gnu/libnss_wrapper.so"

# preparar diretório
mkdir -p "${NSS_BASE_DIR}" 2>/dev/null || true
chmod 700 "${NSS_BASE_DIR}" 2>/dev/null || true

# detectar identidade activa
CURRENT_UID="$(id -u 2>/dev/null || echo unknown)"
CURRENT_GID="$(id -g 2>/dev/null || echo unknown)"
CURRENT_USER="$(id -un 2>/dev/null || echo unknown)"
[ "${CURRENT_USER}" = unknown ] && CURRENT_USER=node

# regenerar passwd sempre que necessário
if ! grep -q "^${CURRENT_USER}:x:${CURRENT_UID}:" "${PASSWD_FILE}" 2>/dev/null; then
  cat > "${PASSWD_FILE}.tmp" <<EOF
${CURRENT_USER}:x:${CURRENT_UID}:${CURRENT_GID}:${CURRENT_USER} user:${HOME_DIR}:/bin/bash
EOF
  mv "${PASSWD_FILE}.tmp" "${PASSWD_FILE}" 2>/dev/null || true
fi

# grupo auxiliares (regera sempre, best-effort)
{
  id -G | xargs -n1 getent group 2>/dev/null | cut -d: -f1,2,3 | sed 's/$/:/' | grep -v '^::$' || true
  if getent group docker >/dev/null 2>&1 && ! id -Gn | grep -qw docker; then
    D_GID=$(getent group docker | cut -d: -f3)
    echo "docker:x:${D_GID}:"
  fi
} > "${GROUP_FILE}.tmp" && mv "${GROUP_FILE}.tmp" "${GROUP_FILE}" 2>/dev/null || true

# ativação do wrapper se a biblioteca existir
if [ -f "${PASSWD_FILE}" ] && \
   { [ -f "${NSS_SO_PATH}" ] || ldconfig -p 2>/dev/null | grep -q libnss_wrapper.so; }; then
  export NSS_WRAPPER_PASSWD="${PASSWD_FILE}"
  export NSS_WRAPPER_GROUP="${GROUP_FILE}"
  export LD_PRELOAD="libnss_wrapper.so${LD_PRELOAD:+:$LD_PRELOAD}"
  # opcional: log de debug
  [ -n "${DEBUG:-}" ] && echo "[gatekeeper] NSS active for UID ${CURRENT_UID}" >&2
fi
```

Notas importantes:

- A remoção do guard `$-` permite execução em shells não interativos.
- A regeneração on‑the‑fly corrige artefatos ausentes ou desactualizados.
- O script é idempotente e silencioso; regressa sem erro se qualquer passo falhar.

## 5. Testes sugeridos

1. **Unitário (bash):** simular diferentes UIDs e verificar saída de `env`.
2. **Integração:** em contêineres de teste com `updateRemoteUserUID` `true` e `false`, executar:

   ```sh
   docker exec <id> bash -c 'echo $NSS_WRAPPER_PASSWD; whoami; id'
   ```

   - deve sempre mostrar o ficheiro correcto e `whoami` nunca vazio.

3. **Batch/CI:** rodar `node -e 'console.log(process.getuid())'` em non-interactive e garantir que
   `getpwuid` devolve nome (pode ser verificado via um pequeno script C compilado).
4. **Regression:** criar container, abortar `post-create` propositadamente, e confirmar que o perfil
   corrige no próximo `exec`.

## 6. Modificações complementares no `post-create.sh`

Apesar da nova lógica no perfil, manter geração inicial continua útil. Sugestões:

- Simplificar a seção NSS (remover id check, agora redundante).
- Não falhar se `CURRENT_USER=unknown` – já tratado no perfil.
- Opcionalmente, executar `source /etc/profile.d/10-gatekeeper-nss.sh` no fim para garantir que o
  ambiente corrente (o próprio script) usa o wrapper.

## 7. Passos seguintes / checklist

- [x] Atualizar `/etc/profile.d/10-gatekeeper-nss.sh` como acima.
- [x] Revisar Dockerfile para garantir que o script está instalado com permissão 444.
- [x] Ajustar `post-create.sh` conforme comentários anteriores (já introduzimos fallback em edição
      recente).
- [x] Escrever testes declarados em `tests/` que confirmem NSS em non‑interactive.
- [x] Atualizar documentação (`.md` e `DOCUMENTAÇÃO/`) com novo comportamento.

---

_Documento gerado 2026‑02‑25 como análise para upgrade do NSS (Gatekeeper)._
