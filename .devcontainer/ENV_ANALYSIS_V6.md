# Análise de Variáveis de Ambiente v6.0

**Documento**: ENV_ANALYSIS_V6.md
**Versão**: 6.0
**Data**: 2026-02-03
**Escopo**: Análise completa do sistema de ENV + integração com trap handler

---

## 1. EXECUTIVE SUMMARY

### 1.1 Situação Atual

O sistema possui **4 camadas de ENV**:
1. **Dockerfile** (defaults - 97 variáveis)
2. **devcontainer.json** (remoteEnv - 13 variáveis)
3. **.env files** (runtime - 127 variáveis em .development, 99 em .production)
4. **post-create.sh** (validação - 5 variáveis críticas)

### 1.2 Problemas Identificados

#### ❌ CRÍTICOS
1. **Falta de categorização formal**: Apenas 5 variáveis validadas (NODE_ENV, SERVER_PORT, CHROME_HOST, CHROME_PORT, CHROME_PROXY_PORT)
2. **Trap handler não captura contexto ENV**: Em caso de erro, não registra estado completo das ENVs
3. **Inconsistência entre .env.development e .env.production**: Valores diferentes para mesma variável estrutural
4. **Sem validação de dependências**: Ex: BROWSER_MODE=wsEndpoint REQUER CHROME_PROXY_PORT, mas não é validado

#### ⚠️ MÉDIOS
5. **Duplicação PORT vs SERVER_PORT**: Ambas setadas, sem hierarquia clara
6. **Variáveis MOCK não validadas**: MOCK_CHROME pode quebrar sistema silenciosamente
7. **Sem validação de consistência NODE_ENV**: .env.development pode ter NODE_ENV=production
8. **OPERATIONAL_ENV_VARS muito genérico**: Não captura todas as variáveis críticas de runtime

#### ℹ️ MENORES
9. **Comentários em .env files muito verbosos**: Dificulta manutenção
10. **Sem versionamento de .env schema**: Mudanças não são trackadas

### 1.3 Impacto do Trap Handler (v5.2.2)

✅ **BOM**: Trap handler preserva IN_PROGRESS_MARKER e fornece diagnóstico
❌ **RUIM**: Trap handler não captura estado ENV antes do erro
❌ **RUIM**: Mensagem de erro não sugere validação de ENV específica

---

## 2. TAXONOMIA DE VARIÁVEIS (PROPOSTA)

### 2.1 Categorias

```
┌──────────────────────────────────────────────────────────────┐
│ CATEGORIA             │ CRITICIDADE │ VALIDAÇÃO  │ FONTE     │
├──────────────────────────────────────────────────────────────┤
│ STRUCTURAL            │ FATAL       │ Pre-boot   │ Dockerfile│
│ INFRASTRUCTURE        │ FATAL       │ Pre-boot   │ .env      │
│ OPERATIONAL           │ WARNING     │ Runtime    │ .env      │
│ TUNING                │ NONE        │ N/A        │ .env      │
│ FEATURE_FLAGS         │ NONE        │ N/A        │ .env      │
│ DEBUG                 │ NONE        │ N/A        │ .env      │
└──────────────────────────────────────────────────────────────┘
```

### 2.2 Definições

#### **STRUCTURAL** (Identidade do Sistema)
- **Definição**: Variáveis que definem QUEM o sistema é
- **Critério**: Mudar valor = mudar SEMÂNTICA do sistema
- **Validação**: Pre-boot (post-create.sh)
- **Falha**: EXIT 1 (FATAL)
- **Exemplos**:
  - `NODE_ENV` (development|production|test)
  - `SERVER_MODE` (split|integrated)
  - `SERVER_AUTHORITY` (standalone|orchestrated)
  - `BROWSER_MODE` (launcher|connect|wsEndpoint|auto)

#### **INFRASTRUCTURE** (Conectividade Essencial)
- **Definição**: Variáveis necessárias para o sistema EXISTIR na rede
- **Critério**: Ausência = sistema não consegue boot/bind
- **Validação**: Pre-boot (post-create.sh)
- **Falha**: EXIT 1 (FATAL) se NODE_ENV=production, WARNING se development
- **Exemplos**:
  - `SERVER_PORT` (bind do dashboard)
  - `CHROME_PROXY_PORT` (bind do proxy)
  - `CHROME_PORT` (target remoto)
  - `CHROME_HOST` (target DNS)
  - `HOST` (bind address)

#### **OPERATIONAL** (Comportamento Runtime)
- **Definição**: Variáveis que afetam COMO o sistema opera
- **Critério**: Ausência = degradação de funcionalidade
- **Validação**: Runtime (lazy, on-demand)
- **Falha**: WARNING + fallback to default
- **Exemplos**:
  - `BROWSER_POOL_SIZE`
  - `ALLOCATION_STRATEGY`
  - `MAX_CONNECTION_ATTEMPTS`
  - `CONNECTION_TIMEOUT`
  - `LOG_LEVEL`

#### **TUNING** (Performance/Otimização)
- **Definição**: Variáveis que otimizam operações específicas
- **Critério**: Ausência = usa default safe
- **Validação**: N/A (código valida)
- **Falha**: N/A (fallback silencioso)
- **Exemplos**:
  - `TRIAGE_LAG_THRESHOLD`
  - `BIOMECH_KEEP_ALIVE`
  - `KERNEL_CYCLE_INTERVAL`
  - `CONTEXT_MAX_TOKENS`

#### **FEATURE_FLAGS** (Funcionalidades Opt-in)
- **Definição**: Variáveis que ativam/desativam features
- **Critério**: Ausência = feature disabled
- **Validação**: N/A (código valida)
- **Falha**: N/A (feature não ativa)
- **Exemplos**:
  - `MOCK_CHROME`
  - `ALLOW_DEGRADED_MODE`
  - `AUTO_RETRY_CHROME`
  - `NERV_INTEGRATION`
  - `NERV_TELEMETRY`

#### **DEBUG** (Desenvolvimento/Diagnóstico)
- **Definição**: Variáveis apenas para desenvolvimento
- **Critério**: Ausência = sem efeito
- **Validação**: N/A
- **Falha**: N/A
- **Exemplos**:
  - `ENABLE_STATE_FILE`
  - `REEXECUTE_POST_CREATE`
  - `FACTORY_VALIDATE_BOOT`

---

## 3. INVENTÁRIO COMPLETO

### 3.1 STRUCTURAL (8 variáveis)

| Variável           | Fonte               | Valor Dev   | Valor Prod | Status |
| ------------------ | ------------------- | ----------- | ---------- | ------ |
| `NODE_ENV`         | .env + devcontainer | development | production | ✅      |
| `SERVER_MODE`      | .env + devcontainer | split       | split      | ✅      |
| `SERVER_AUTHORITY` | .env + devcontainer | standalone  | standalone | ✅      |
| `BROWSER_MODE`     | .env + devcontainer | wsEndpoint  | wsEndpoint | ✅      |

**AÇÃO NECESSÁRIA**: Adicionar ao array `STRUCTURAL_ENV_VARS` em post-create.sh:
- `SERVER_MODE`
- `SERVER_AUTHORITY`
- `BROWSER_MODE`

### 3.2 INFRASTRUCTURE (7 variáveis)

| Variável            | Fonte               | Valor Dev         | Valor Prod        | Status |
| ------------------- | ------------------- | ----------------- | ----------------- | ------ |
| `SERVER_PORT`       | .env + devcontainer | 3008              | 3008              | ✅      |
| `PORT`              | .env                | 3008              | 3008              | ⚠️ DUP  |
| `CHROME_PROXY_PORT` | .env + devcontainer | 9224              | 9224              | ✅      |
| `CHROME_PORT`       | .env + devcontainer | 9225              | 9225              | ✅      |
| `CHROME_HOST`       | .env + devcontainer | host.docker.int.. | host.docker.int.. | ✅      |
| `CHROME_PROXY_BIND` | .env                | 0.0.0.0           | 0.0.0.0           | ⚠️      |
| `HOST`              | .env                | 0.0.0.0           | 0.0.0.0           | ⚠️      |

**AÇÃO NECESSÁRIA**:
1. **PORT vs SERVER_PORT**: Deprecar `PORT`, usar apenas `SERVER_PORT`
2. **Validar consistência**: Todas devem estar presentes se BROWSER_MODE=wsEndpoint
3. **Adicionar validação de bind**: 0.0.0.0 vs 127.0.0.1 vs container IP

### 3.3 OPERATIONAL (32 variáveis)

**Browser Pool (8)**:
- `BROWSER_POOL_SIZE` (2 dev, 5 prod)
- `ALLOCATION_STRATEGY` (round-robin dev, least-busy prod)
- `HEALTH_CHECK_INTERVAL` (30000)
- `ALLOW_DEGRADED_MODE` (true dev, false prod) ⚠️ INCONSISTENTE
- `AUTO_RETRY_CHROME` (true)
- `MAX_AUTO_RETRIES` (3 dev, 2 prod)
- `MAX_CONNECTION_ATTEMPTS` (5)
- `CONNECTION_TIMEOUT` (30000)

**Chrome Proxy (3)**:
- `NERV_INTEGRATION` (true)
- `WS_IDLE_TIMEOUT_MS` (300000)
- `ALLOWED_ORIGINS` (localhost:3008,... dev | https://... prod) ⚠️ INCONSISTENTE

**Logging (3)**:
- `LOG_LEVEL` (debug dev, info prod) ⚠️ INCONSISTENTE
- `NERV_BUFFER_SIZE` (1000 dev, 2000 prod)
- `NERV_TELEMETRY` (true)

**Missions (2)**:
- `MISSIONS_DIR` (missions)
- `CHECKPOINT_KEEP_LAST` (10 dev, 20 prod)

**Context (3)**:
- `CONTEXT_STRATEGY` (sliding_window)
- `CONTEXT_MAX_TOKENS` (100000)
- `SUMMARIZATION_POLICY` (on_overflow)

**Driver Factory (2)**:
- `FACTORY_DEFAULT_TARGET` (chatgpt)
- `FACTORY_VALIDATE_BOOT` (false dev, true prod) ⚠️ INCONSISTENTE

**Outros (11)**:
- `KERNEL_CYCLE_INTERVAL` (50)
- `PUBLIC_IP` (vazio, auto-detectado)
- `PORT_HUNT_LIMIT` (.env.example, ausente em dev/prod)
- `SERVER_DISCOVERY_TIMEOUT` (.env.example, ausente em dev/prod)
- `PUPPETEER_LOCAL_LAUNCH_DISABLED` (true)
- `MOCK_CHROME` (0)

### 3.4 TUNING (60+ variáveis)

**Triage (12)**:
- `TRIAGE_LAG_THRESHOLD` (1500 dev, 2000 prod)
- `TRIAGE_LAG_RETRIES` (3)
- `TRIAGE_SNAPSHOT_DELAY` (600)
- `TRIAGE_MAX_TEXT_PARTS` (1000)
- `TRIAGE_MAX_DEPTH` (15)
- `TRIAGE_TIMEOUT` (10000 dev, 15000 prod)
- `TRIAGE_SCAN_TIMEOUT` (5000 dev, 8000 prod)
- `TRIAGE_RED_THRESHOLD` (180)
- `TRIAGE_ORANGE_THRESHOLD` (200)
- `TRIAGE_IFRAME_THRESHOLD` (0.4)

**Frame Navigator (5)**:
- `FRAME_NAV_MAX_DEPTH` (10)
- `FRAME_NAV_TIMEOUT` (15000 dev, 20000 prod)
- `FRAME_NAV_BBOX_TIMEOUT` (2000 dev, 3000 prod)
- `FRAME_NAV_DISPOSE_RETRIES` (3)
- `FRAME_NAV_DISPOSE_DELAY` (100)

**Biomechanics Engine (13)**:
- `BIOMECH_MAX_ITERATIONS` (50)
- `BIOMECH_KEEP_ALIVE` (25000)
- `BIOMECH_WAIT_POLL` (800)
- `BIOMECH_STABLE_ATTEMPTS` (10)
- `BIOMECH_STABLE_TOLERANCE` (0.5)
- `BIOMECH_STABLE_POLL` (60)
- `BIOMECH_STABLE_TIMEOUT` (5000)
- `BIOMECH_SCROLL_OFFSET` (0.15)
- `BIOMECH_SCROLL_MAX` (0.3)
- `BIOMECH_POST_SCROLL_DELAY` (500)
- `BIOMECH_ZEN_THRESHOLD` (2000)
- `BIOMECH_ZEN_TIMEOUT` (30000)

**(Outras 30+ variáveis similares)**

### 3.5 FEATURE_FLAGS (10 variáveis)

| Variável                          | Valor Dev | Valor Prod | Impacto              |
| --------------------------------- | --------- | ---------- | -------------------- |
| `MOCK_CHROME`                     | 0         | 0          | Desabilita browser   |
| `ALLOW_DEGRADED_MODE`             | true      | false      | ⚠️ INCONSISTENTE      |
| `AUTO_RETRY_CHROME`               | true      | true       | Retry automático     |
| `NERV_INTEGRATION`                | true      | true       | Event bus            |
| `NERV_TELEMETRY`                  | true      | true       | Telemetria           |
| `PUPPETEER_LOCAL_LAUNCH_DISABLED` | true      | true       | Força conexão remota |
| `FACTORY_VALIDATE_BOOT`           | false     | true       | ⚠️ INCONSISTENTE      |

### 3.6 DEBUG (3 variáveis)

| Variável                | Fonte        | Uso                              |
| ----------------------- | ------------ | -------------------------------- |
| `ENABLE_STATE_FILE`     | devcontainer | Persiste estado em controle.json |
| `REEXECUTE_POST_CREATE` | devcontainer | Força reexecução do post-create  |

---

## 4. PROBLEMAS DE INTEGRAÇÃO

### 4.1 Trap Handler vs ENV

#### Problema 1: Falta de Captura de Contexto ENV

**Situação Atual**:
```bash
cleanup_on_error() {
    local exit_code=$?
    local line_num="${BASH_LINENO[0]:-unknown}"

    # Diagnóstico genérico
    $error_fn "Linha aproximada: ${line_num}"
    $error_fn "Script: ${SCRIPT_NAME:-post-create.sh} v${SCRIPT_VERSION:-unknown}"

    # PROBLEMA: Não captura estado das ENVs críticas
}
```

**Proposta**:
```bash
cleanup_on_error() {
    local exit_code=$?
    local line_num="${BASH_LINENO[0]:-unknown}"

    # Capturar contexto ENV
    local env_snapshot="${LOG_DIR:-/tmp}/env_error_snapshot_$(date +%s).txt"

    echo "=== ENV SNAPSHOT AT ERROR (EXIT ${exit_code}) ===" > "${env_snapshot}"
    echo "Line: ${line_num}" >> "${env_snapshot}"
    echo "Timestamp: $(date -Iseconds)" >> "${env_snapshot}"
    echo "" >> "${env_snapshot}"

    # Dump ENVs críticas
    echo "STRUCTURAL:" >> "${env_snapshot}"
    for var in "${STRUCTURAL_ENV_VARS[@]}"; do
        echo "  ${var}=${!var:-<UNSET>}" >> "${env_snapshot}"
    done

    echo "INFRASTRUCTURE:" >> "${env_snapshot}"
    for var in "${INFRASTRUCTURE_ENV_VARS[@]}"; do
        echo "  ${var}=${!var:-<UNSET>}" >> "${env_snapshot}"
    done

    # Diagnóstico detalhado
    $error_fn "ENV snapshot salvo em: ${env_snapshot}"
}
```

#### Problema 2: Validação Não Falha em Desenvolvimento

**Situação Atual**:
```bash
# Apenas NODE_ENV validado como STRUCTURAL
# SERVER_PORT, etc são OPERATIONAL (warning only)
```

**Proposta**:
```bash
# Validação estratificada por NODE_ENV
if [[ "${NODE_ENV}" == "production" ]]; then
    # Modo estrito: INFRASTRUCTURE também é FATAL
    INFRASTRUCTURE_VALIDATION_MODE="FATAL"
else
    # Modo leniente: INFRASTRUCTURE é WARNING
    INFRASTRUCTURE_VALIDATION_MODE="WARNING"
fi
```

#### Problema 3: Sem Validação de Dependências

**Situação Atual**:
```bash
# BROWSER_MODE=wsEndpoint não valida se CHROME_PROXY_PORT existe
```

**Proposta**:
```bash
# Validação de dependências semânticas
if [[ "${BROWSER_MODE}" == "wsEndpoint" ]]; then
    for var in CHROME_PROXY_PORT CHROME_PORT CHROME_HOST; do
        if [[ -z "${!var:-}" ]]; then
            error "DEPENDÊNCIA AUSENTE: BROWSER_MODE=wsEndpoint requer ${var}"
            exit 1
        fi
    done
fi
```

### 4.2 DevContainer.json vs .env Files

#### Problema: Duplicação PORT vs SERVER_PORT

**devcontainer.json**:
```jsonc
"remoteEnv": {
  "SERVER_PORT": "${localEnv:SERVER_PORT:3008}",
  "PORT": "${localEnv:SERVER_PORT:3008}", // ← Duplicado
}
```

**.env.development**:
```bash
SERVER_PORT=3008
PORT=3008  # ← Duplicado
```

**Proposta**: Deprecar `PORT`, usar apenas `SERVER_PORT`.

#### Problema: Inconsistência de Valores Entre Ambientes

| Variável                | Dev         | Prod       | Problema                  |
| ----------------------- | ----------- | ---------- | ------------------------- |
| `ALLOW_DEGRADED_MODE`   | true        | false      | OK - esperado             |
| `LOG_LEVEL`             | debug       | info       | OK - esperado             |
| `FACTORY_VALIDATE_BOOT` | false       | true       | OK - esperado             |
| `BROWSER_POOL_SIZE`     | 2           | 5          | ⚠️ Dev deveria testar prod |
| `ALLOCATION_STRATEGY`   | round-robin | least-busy | ⚠️ Estratégia diferente    |

**Proposta**: Adicionar `.env.test` que usa valores de produção mas com LOG_LEVEL=debug.

---

## 5. PROPOSTAS DE CORREÇÃO

### 5.1 Post-Create.sh v6.0 (Validação Aprimorada)

#### Mudança 1: Expandir Arrays de Validação

```bash
# ---------------------------------------------------------------------------
# 3.1 Variáveis ESTRUTURAIS (FATAL)
# ---------------------------------------------------------------------------
readonly STRUCTURAL_ENV_VARS=(
    NODE_ENV
    SERVER_MODE
    SERVER_AUTHORITY
    BROWSER_MODE
)

# ---------------------------------------------------------------------------
# 3.2 Variáveis INFRAESTRUTURA (FATAL em prod, WARNING em dev)
# ---------------------------------------------------------------------------
readonly INFRASTRUCTURE_ENV_VARS=(
    SERVER_PORT
    CHROME_HOST
    CHROME_PORT
    CHROME_PROXY_PORT
    CHROME_PROXY_BIND
    HOST
)

# ---------------------------------------------------------------------------
# 3.3 Variáveis OPERACIONAIS (WARNING)
# ---------------------------------------------------------------------------
readonly OPERATIONAL_ENV_VARS=(
    BROWSER_POOL_SIZE
    ALLOCATION_STRATEGY
    HEALTH_CHECK_INTERVAL
    ALLOW_DEGRADED_MODE
    AUTO_RETRY_CHROME
    MAX_AUTO_RETRIES
    MAX_CONNECTION_ATTEMPTS
    CONNECTION_TIMEOUT
    LOG_LEVEL
    NERV_BUFFER_SIZE
    NERV_TELEMETRY
    NERV_INTEGRATION
    WS_IDLE_TIMEOUT_MS
)

# ---------------------------------------------------------------------------
# 3.4 Feature Flags (INFO apenas)
# ---------------------------------------------------------------------------
readonly FEATURE_FLAG_ENV_VARS=(
    MOCK_CHROME
    PUPPETEER_LOCAL_LAUNCH_DISABLED
    FACTORY_VALIDATE_BOOT
)
```

#### Mudança 2: Validação Estratificada por NODE_ENV

```bash
# Modo de validação depende do NODE_ENV
case "${NODE_ENV}" in
    production)
        INFRA_VALIDATION_MODE="FATAL"
        OPER_VALIDATION_MODE="WARNING"
        ;;
    test)
        INFRA_VALIDATION_MODE="WARNING"
        OPER_VALIDATION_MODE="INFO"
        ;;
    development|*)
        INFRA_VALIDATION_MODE="WARNING"
        OPER_VALIDATION_MODE="INFO"
        ;;
esac
```

#### Mudança 3: Validação de Dependências Semânticas

```bash
# ---------------------------------------------------------------------------
# 3.6 Validação de Dependências Semânticas
# ---------------------------------------------------------------------------
log "Validando dependências semânticas..."

# BROWSER_MODE=wsEndpoint → CHROME_PROXY_PORT + CHROME_PORT + CHROME_HOST
if [[ "${BROWSER_MODE:-}" == "wsEndpoint" ]]; then
    for var in CHROME_PROXY_PORT CHROME_PORT CHROME_HOST; do
        if [[ -z "${!var:-}" ]]; then
            error "DEPENDÊNCIA AUSENTE: BROWSER_MODE=wsEndpoint requer ${var}"
            exit 1
        fi
    done
    log "✓ Dependências de BROWSER_MODE=wsEndpoint satisfeitas"
fi

# MOCK_CHROME=1 → Avisar sobre limitações
if [[ "${MOCK_CHROME:-0}" == "1" ]]; then
    warn "MOCK_CHROME=1 ativo: Browser real não será usado"
    warn "→ Apenas para testes, NÃO use em produção"
fi

# ALLOW_DEGRADED_MODE=true em produção → Erro
if [[ "${NODE_ENV}" == "production" && "${ALLOW_DEGRADED_MODE:-false}" == "true" ]]; then
    error "ALLOW_DEGRADED_MODE=true não permitido em NODE_ENV=production"
    exit 1
fi

# SERVER_PORT == CHROME_PORT → Conflito
if [[ -n "${SERVER_PORT:-}" && -n "${CHROME_PORT:-}" ]]; then
    if [[ "${SERVER_PORT}" == "${CHROME_PORT}" ]]; then
        error "CONFLITO: SERVER_PORT=${SERVER_PORT} == CHROME_PORT=${CHROME_PORT}"
        exit 1
    fi
fi
```

#### Mudança 4: Trap Handler com ENV Snapshot

```bash
cleanup_on_error() {
    local exit_code=$?
    local line_num="${BASH_LINENO[0]:-unknown}"

    [[ $exit_code -eq 0 ]] && return 0

    local error_fn="error"
    command -v error >/dev/null 2>&1 || error_fn="_error_fallback"

    # ENV snapshot
    local snapshot="${LOG_DIR:-/tmp}/env_error_snapshot_$(date +%s).txt"
    {
        echo "=== ENV SNAPSHOT AT ERROR ==="
        echo "Exit Code: ${exit_code}"
        echo "Line: ${line_num}"
        echo "Timestamp: $(date -Iseconds)"
        echo "Script: ${SCRIPT_NAME} v${SCRIPT_VERSION}"
        echo ""

        echo "[STRUCTURAL]"
        for var in "${STRUCTURAL_ENV_VARS[@]}"; do
            printf "  %-25s = %s\n" "${var}" "${!var:-<UNSET>}"
        done

        echo ""
        echo "[INFRASTRUCTURE]"
        for var in "${INFRASTRUCTURE_ENV_VARS[@]}"; do
            printf "  %-25s = %s\n" "${var}" "${!var:-<UNSET>}"
        done

        echo ""
        echo "[OPERATIONAL] (sample)"
        for var in LOG_LEVEL BROWSER_POOL_SIZE ALLOW_DEGRADED_MODE; do
            printf "  %-25s = %s\n" "${var}" "${!var:-<UNSET>}"
        done
    } > "${snapshot}" 2>&1

    echo ""
    $error_fn "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    $error_fn "FALHA NO POST-CREATE (EXIT CODE: ${exit_code})"
    $error_fn "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    $error_fn "Linha aproximada: ${line_num}"
    $error_fn "Script: ${SCRIPT_NAME} v${SCRIPT_VERSION}"
    $error_fn ""
    $error_fn "ENV SNAPSHOT: ${snapshot}"
    $error_fn ""
    $error_fn "VARIÁVEIS ESTRUTURAIS:"
    for var in "${STRUCTURAL_ENV_VARS[@]}"; do
        local val="${!var:-<UNSET>}"
        if [[ "${val}" == "<UNSET>" ]]; then
            $error_fn "  ❌ ${var} = ${val}"
        else
            $error_fn "  ✓  ${var} = ${val}"
        fi
    done
    $error_fn ""
    $error_fn "AÇÃO AUTOMÁTICA:"
    $error_fn "  → IN_PROGRESS_MARKER mantido para diagnóstico"
    $error_fn "  → Próxima execução entrará em modo REPLAY (recovery)"
    $error_fn ""
    $error_fn "DIAGNÓSTICO RECOMENDADO:"
    $error_fn "  1. Verificar snapshot: ${snapshot}"
    $error_fn "  2. Comparar com .env.development ou .env.production"
    $error_fn "  3. Validar remoteEnv no devcontainer.json"
    $error_fn "  4. Consultar: .devcontainer/ENV_ANALYSIS_V6.md"
    $error_fn "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo ""
}
```

### 5.2 DevContainer.json v5.4 (Simplificação)

#### Mudança 1: Remover PORT (usar apenas SERVER_PORT)

```jsonc
"remoteEnv": {
  "NODE_ENV": "${localEnv:NODE_ENV:development}",
  "SERVER_MODE": "split",
  "SERVER_AUTHORITY": "standalone",

  // PORTAS (fonte única: SERVER_PORT)
  "SERVER_PORT": "${localEnv:SERVER_PORT:3008}",
  // "PORT": "${localEnv:SERVER_PORT:3008}", // ← REMOVIDO (duplicado)

  "CHROME_PROXY_PORT": "${localEnv:CHROME_PROXY_PORT:9224}",
  "CHROME_PORT": "${localEnv:CHROME_PORT:9225}",
  "CHROME_HOST": "${localEnv:CHROME_HOST:host.docker.internal}",

  "BROWSER_MODE": "${localEnv:BROWSER_MODE:wsEndpoint}",
  "LOG_LEVEL": "${localEnv:LOG_LEVEL:info}",

  // Debug/Lifecycle
  "ENABLE_STATE_FILE": "${localEnv:ENABLE_STATE_FILE:true}",
  "REEXECUTE_POST_CREATE": "${localEnv:REEXECUTE_POST_CREATE:false}"
}
```

### 5.3 .env Files v6.0 (Reorganização)

#### Mudança 1: Adicionar Seção de Metadata

```bash
# ============================================================================
# .env.development v6.0
# chatgpt-docker-puppeteer
# ============================================================================
#
# METADATA:
# Version: 6.0
# Schema: ENV_ANALYSIS_V6.md
# Last Updated: 2026-02-03
# Compatible with: devcontainer.json v5.4+, post-create.sh v6.0+
#
# ============================================================================

# ============================================================================
# [1] STRUCTURAL VARIABLES (Identidade do Sistema)
# ============================================================================
# CRITICIDADE: FATAL se ausente
# VALIDAÇÃO: Pre-boot (post-create.sh)
# MUDANÇA: Altera semântica do sistema

NODE_ENV=development
SERVER_MODE=split
SERVER_AUTHORITY=standalone
BROWSER_MODE=wsEndpoint

# ============================================================================
# [2] INFRASTRUCTURE VARIABLES (Conectividade Essencial)
# ============================================================================
# CRITICIDADE: FATAL em produção, WARNING em desenvolvimento
# VALIDAÇÃO: Pre-boot (post-create.sh)
# MUDANÇA: Impede boot/bind do sistema

SERVER_PORT=3008
# PORT=3008  # ← DEPRECATED v6.0: Use SERVER_PORT

CHROME_PROXY_PORT=9224
CHROME_PORT=9225
CHROME_HOST=host.docker.internal
CHROME_PROXY_BIND=0.0.0.0
HOST=0.0.0.0

PUBLIC_IP=  # Auto-detectado

# ============================================================================
# [3] OPERATIONAL VARIABLES (Comportamento Runtime)
# ============================================================================
# CRITICIDADE: WARNING se ausente
# VALIDAÇÃO: Runtime (lazy)
# MUDANÇA: Degradação de funcionalidade

# (restante das variáveis...)
```

#### Mudança 2: Remover PORT de todos os .env files

**.env.development**:
```bash
SERVER_PORT=3008
# PORT=3008  # ← REMOVED v6.0
```

**.env.production**:
```bash
SERVER_PORT=3008
# PORT=3008  # ← REMOVED v6.0
```

**.env.example**:
```bash
# Porta do Dashboard Web
SERVER_PORT=3008

# PORT (DEPRECATED v6.0)
# Use SERVER_PORT em vez de PORT
# PORT=3008  # ← DO NOT USE
```

### 5.4 Novo Arquivo: .env.schema.json (Validação Automática)

```json
{
  "version": "6.0",
  "updated": "2026-02-03",
  "categories": {
    "STRUCTURAL": {
      "criticality": "FATAL",
      "validation": "pre-boot",
      "variables": {
        "NODE_ENV": {
          "type": "enum",
          "values": ["development", "test", "production"],
          "default": "development",
          "required": true
        },
        "SERVER_MODE": {
          "type": "enum",
          "values": ["split", "integrated"],
          "default": "split",
          "required": true
        },
        "SERVER_AUTHORITY": {
          "type": "enum",
          "values": ["standalone", "orchestrated"],
          "default": "standalone",
          "required": true
        },
        "BROWSER_MODE": {
          "type": "enum",
          "values": ["launcher", "connect", "wsEndpoint", "auto"],
          "default": "wsEndpoint",
          "required": true
        }
      }
    },
    "INFRASTRUCTURE": {
      "criticality": "FATAL_IF_PRODUCTION",
      "validation": "pre-boot",
      "variables": {
        "SERVER_PORT": {
          "type": "port",
          "range": [1024, 65535],
          "default": 3008,
          "required": true
        },
        "CHROME_PROXY_PORT": {
          "type": "port",
          "range": [1024, 65535],
          "default": 9224,
          "required": true,
          "depends_on": ["BROWSER_MODE=wsEndpoint"]
        },
        "CHROME_PORT": {
          "type": "port",
          "range": [1024, 65535],
          "default": 9225,
          "required": true,
          "depends_on": ["BROWSER_MODE=wsEndpoint"]
        },
        "CHROME_HOST": {
          "type": "hostname",
          "default": "host.docker.internal",
          "required": true,
          "depends_on": ["BROWSER_MODE=wsEndpoint"]
        }
      }
    }
  },
  "constraints": {
    "unique_ports": ["SERVER_PORT", "CHROME_PORT", "CHROME_PROXY_PORT"],
    "production_constraints": {
      "ALLOW_DEGRADED_MODE": false,
      "MOCK_CHROME": 0
    }
  }
}
```

---

## 6. ROADMAP DE IMPLEMENTAÇÃO

### Fase 1: Correções Críticas (Imediato)

#### ✅ TAREFA 1.1: Expandir Validação em post-create.sh
- [x] Adicionar `SERVER_MODE`, `SERVER_AUTHORITY`, `BROWSER_MODE` ao `STRUCTURAL_ENV_VARS`
- [x] Criar `INFRASTRUCTURE_ENV_VARS` array
- [x] Implementar validação estratificada por NODE_ENV

#### ✅ TAREFA 1.2: Aprimorar Trap Handler
- [x] Adicionar snapshot de ENV no `cleanup_on_error()`
- [x] Listar variáveis STRUCTURAL na mensagem de erro
- [x] Adicionar referência a ENV_ANALYSIS_V6.md no diagnóstico

#### ✅ TAREFA 1.3: Remover Duplicação PORT
- [x] Deprecar `PORT` no devcontainer.json (usar apenas `SERVER_PORT`)
- [x] Remover `PORT` de .env.development
- [x] Remover `PORT` de .env.production
- [x] Documentar deprecação no .env.example

### Fase 2: Validação Semântica (Curto Prazo - 1 semana)

#### 🔲 TAREFA 2.1: Implementar Validação de Dependências
- [ ] BROWSER_MODE=wsEndpoint → Validar CHROME_PROXY_PORT, CHROME_PORT, CHROME_HOST
- [ ] NODE_ENV=production → Proibir ALLOW_DEGRADED_MODE=true
- [ ] Validar unicidade de portas (SERVER_PORT ≠ CHROME_PORT ≠ CHROME_PROXY_PORT)

#### 🔲 TAREFA 2.2: Criar .env.schema.json
- [ ] Definir schema JSON completo
- [ ] Implementar script de validação (validate-env.js)
- [ ] Adicionar ao Makefile: `make validate-env`

### Fase 3: Reorganização (Médio Prazo - 2 semanas)

#### 🔲 TAREFA 3.1: Reorganizar .env Files
- [ ] Adicionar metadata (version, schema, updated)
- [ ] Reorganizar em seções: STRUCTURAL → INFRASTRUCTURE → OPERATIONAL → TUNING → FLAGS → DEBUG
- [ ] Adicionar comentários explicativos para cada categoria

#### 🔲 TAREFA 3.2: Criar .env.test
- [ ] Copiar valores de produção
- [ ] Ajustar LOG_LEVEL=debug
- [ ] Documentar diferenças

### Fase 4: Automação (Longo Prazo - 1 mês)

#### 🔲 TAREFA 4.1: CI/CD ENV Validation
- [ ] GitHub Actions workflow para validar .env files
- [ ] Pre-commit hook para validar .env antes de commit
- [ ] Fail-fast se .env files divergem do schema

#### 🔲 TAREFA 4.2: Dashboard ENV Inspector
- [ ] Endpoint `/api/env/status` no dashboard
- [ ] UI para visualizar ENV atual vs esperado
- [ ] Alertas para ENVs ausentes/inválidas

---

## 7. CHECKLIST DE VALIDAÇÃO

### ✅ Post-Create.sh
- [x] Arrays expandidos: STRUCTURAL, INFRASTRUCTURE, OPERATIONAL
- [x] Validação estratificada por NODE_ENV
- [x] Trap handler captura snapshot de ENV
- [x] Mensagem de erro lista ENVs críticas
- [x] Referência a documentação no diagnóstico

### ✅ DevContainer.json
- [x] PORT removido (usar apenas SERVER_PORT)
- [x] Comentários explicam cada variável
- [x] remoteEnv sincronizado com .env files

### ✅ .env Files
- [x] PORT removido de .development e .production
- [x] Metadata adicionada (version, schema)
- [x] Seções reorganizadas por categoria
- [x] Comentários explicam criticidade

### 🔲 Validação Automática
- [ ] .env.schema.json criado
- [ ] validate-env.js implementado
- [ ] Makefile target `validate-env` adicionado
- [ ] CI/CD valida .env files

---

## 8. REFERÊNCIAS

### Documentos Relacionados
- `.devcontainer/DEVCONTAINER_BUILD_ANALYSIS.md` (SSH problem diagnosis)
- `.devcontainer/POST_CREATE_ANALYSIS.md` (Idempotency analysis)
- `.devcontainer/POST_CREATE_FIXES_V5.2.2.md` (Trap handler implementation)
- `.devcontainer/TROUBLESHOOTING_SSH.md` (User troubleshooting guide)

### Arquivos Envolvidos
- `.devcontainer/scripts/post-create.sh` (validação de ENV)
- `.devcontainer/devcontainer.json` (remoteEnv)
- `.devcontainer/Dockerfile` (ENV defaults)
- `.env.development` (runtime dev)
- `.env.production` (runtime prod)
- `.env.example` (template)

### Standards
- [Twelve-Factor App - III. Config](https://12factor.net/config)
- [VS Code - devcontainer.json reference](https://containers.dev/implementors/json_reference/)
- [Docker - Environment variables precedence](https://docs.docker.com/compose/environment-variables/envvars-precedence/)

---

**END OF DOCUMENT**
