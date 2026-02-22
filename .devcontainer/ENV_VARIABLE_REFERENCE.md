# ENV Variable Reference Guide

**Version**: 1.0 **Date**: 2026-02-03 **Status**: ✅ Comprehensive Audit Completed

---

## 📋 Executive Summary

Este documento cataloga **TODAS** as variáveis utilizadas no sistema DevContainer, classificadas por
camada de processamento e escopo de expansão.

### Camadas de Processamento

```
┌─────────────────────────────────────────────────────────────┐
│ LAYER 1: VS Code (DevContainer Extension)                  │
│ • Expande: ${localEnv:*}, ${localWorkspaceFolder}, etc.    │
│ • Timing: ANTES de docker build/run                         │
│ • Contexto: Host machine + VS Code settings                 │
└─────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────┐
│ LAYER 2: Docker Build (Dockerfile)                          │
│ • Expande: ARG variables                                     │
│ • Timing: Durante docker build                               │
│ • Contexto: Build args passados por devcontainer.json        │
└─────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────┐
│ LAYER 3: Docker Runtime (Container)                          │
│ • Expande: ENV variables                                     │
│ • Timing: Container execution                                │
│ • Contexto: Container environment + .env files               │
└─────────────────────────────────────────────────────────────┘
```

---

## 🔍 Variable Inventory

### 1. VS Code DevContainer Variables

**Source**: `.devcontainer/devcontainer.json` **Expansion**: VS Code Extension (Layer 1) **Usage**:
Passadas como build args, container env, mounts source

| Variable                            | Type     | Usage                                | Example Value                                        |
| ----------------------------------- | -------- | ------------------------------------ | ---------------------------------------------------- |
| `${containerUser}`                  | Built-in | remoteUser, ARG REMOTE_USER          | `node`                                               |
| `${containerWorkspaceFolder}`       | Built-in | postCreateCommand, postAttachCommand | `/workspaces/chatgpt-docker-puppeteer`               |
| `${localWorkspaceFolder}`           | Built-in | mounts source=, .env file paths      | `/home/ilenburg/workspaces/chatgpt-docker-puppeteer` |
| `${localWorkspaceFolderBasename}`   | Built-in | workspaceFolder, PROJECT_NAME        | `chatgpt-docker-puppeteer`                           |
| `${localEnv:NODE_ENV}`              | Host Env | containerEnv NODE_ENV                | `development`                                        |
| `${localEnv:SERVER_PORT}`           | Host Env | containerEnv SERVER_PORT             | `3008`                                               |
| `${localEnv:CHROME_PROXY_PORT}`     | Host Env | containerEnv CHROME_PROXY_PORT       | `9224`                                               |
| `${localEnv:CHROME_PORT}`           | Host Env | containerEnv CHROME_PORT             | `9225`                                               |
| `${localEnv:CHROME_HOST}`           | Host Env | containerEnv CHROME_HOST             | `host.docker.internal`                               |
| `${localEnv:BROWSER_MODE}`          | Host Env | containerEnv BROWSER_MODE            | `wsEndpoint`                                         |
| `${localEnv:LOG_LEVEL}`             | Host Env | containerEnv LOG_LEVEL               | `info`                                               |
| `${localEnv:ENABLE_STATE_FILE}`     | Host Env | containerEnv ENABLE_STATE_FILE       | `true`                                               |
| `${localEnv:REEXECUTE_POST_CREATE}` | Host Env | containerEnv REEXECUTE_POST_CREATE   | `false`                                              |
| `${localEnv:BUILD_DATE}`            | Host Env | build.args BUILD_DATE                | `2026-02-03T10:00:00Z`                               |
| `${localEnv:GIT_COMMIT}`            | Host Env | build.args VCS_REF                   | `abc1234`                                            |
| `${localEnv:DOCKER_GID}`            | Host Env | build.args DOCKER_GID                | `999`                                                |

#### ⚠️ Critical Rules for VS Code Variables

1. **Mounts `source=`**: ✅ **CAN** use VS Code variables

   ```jsonc
   "source=${localWorkspaceFolder}/.env.development" // ✅ VALID
   ```

2. **Mounts `target=`**: ❌ **CANNOT** use VS Code variables

   ```jsonc
   "target=/home/node/.env"  // ✅ VALID (literal)
   "target=${containerWorkspaceFolder}/.env"  // ❌ INVALID (Docker doesn't expand)
   ```

3. **Lifecycle Hooks**: ✅ **CAN** use `${containerWorkspaceFolder}`
   ```jsonc
   "postCreateCommand": "bash ${containerWorkspaceFolder}/.devcontainer/scripts/post-create.sh"
   ```
   **Reason**: VS Code expands BEFORE executing command in container

---

### 2. Dockerfile ARG Variables

**Source**: `.devcontainer/Dockerfile` **Expansion**: Docker Build Engine (Layer 2) **Passed From**:
`devcontainer.json` → `build.args`

| ARG            | Source                            | Default                    | Used In                          | Purpose                           |
| -------------- | --------------------------------- | -------------------------- | -------------------------------- | --------------------------------- |
| `REMOTE_USER`  | `${containerUser}`                | `node`                     | ENV USER_NAME, HOME_DIR, APP_DIR | Dynamic identity (reusable image) |
| `PROJECT_NAME` | `${localWorkspaceFolderBasename}` | `chatgpt-docker-puppeteer` | ENV APP_DIR                      | Workspace folder name             |
| `VERSION`      | Static                            | `5.2.0`                    | Image metadata                   | Semantic version                  |
| `BUILD_DATE`   | `${localEnv:BUILD_DATE}`          | -                          | Image metadata                   | Build timestamp                   |
| `VCS_REF`      | `${localEnv:GIT_COMMIT}`          | -                          | Image metadata                   | Git commit hash                   |
| `IMAGE_NAME`   | Static                            | `chatgpt-docker-puppeteer` | Image metadata                   | Image name                        |
| `IMAGE_VENDOR` | Static                            | `Yuri`                     | Image metadata                   | Maintainer                        |
| `BUILD_ENV`    | Static                            | `dev`                      | Image metadata                   | Build environment                 |
| `DOCKER_GID`   | `${localEnv:DOCKER_GID}`          | -                          | Docker group setup               | Docker socket access              |

#### ✅ ARG → ENV Flow (Critical Pattern)

```dockerfile
# Dockerfile
ARG REMOTE_USER=node
ENV USER_NAME=${REMOTE_USER} \
    HOME_DIR=/home/${REMOTE_USER} \
    APP_DIR=/workspaces/${PROJECT_NAME}

# Result in container:
# USER_NAME=node
# HOME_DIR=/home/node
# APP_DIR=/workspaces/chatgpt-docker-puppeteer
```

**Benefits**:

- ✅ Image reusable with different users (`--build-arg REMOTE_USER=testuser`)
- ✅ Single source of truth (`remoteUser: "node"` → `${containerUser}` → `ARG REMOTE_USER`)
- ✅ No hardcoded "node" strings (DRY principle)

---

### 3. Container ENV Variables

**Source**: `.devcontainer/Dockerfile` (Sections 6-8) **Expansion**: Container Runtime (Layer 3)
**Override**: `devcontainer.json` → `containerEnv` + `.env` files

#### 3.1 STRUCTURAL ENV (Identity & Paths)

| ENV                   | Source            | Default                                | Immutable | Purpose                                |
| --------------------- | ----------------- | -------------------------------------- | --------- | -------------------------------------- |
| `USER_NAME`           | ARG REMOTE_USER   | `node`                                 | ✅ Yes    | User identity (from devcontainer.json) |
| `HOME_DIR`            | `${REMOTE_USER}`  | `/home/node`                           | ✅ Yes    | User home directory                    |
| `APP_DIR`             | `${PROJECT_NAME}` | `/workspaces/chatgpt-docker-puppeteer` | ✅ Yes    | Workspace path                         |
| `XDG_CONFIG_HOME`     | `${HOME_DIR}`     | `/home/node/.config`                   | ✅ Yes    | XDG config directory                   |
| `XDG_CACHE_HOME`      | `${HOME_DIR}`     | `/home/node/.cache`                    | ✅ Yes    | XDG cache directory                    |
| `XDG_DATA_HOME`       | `${HOME_DIR}`     | `/home/node/.local/share`              | ✅ Yes    | XDG data directory                     |
| `XDG_STATE_HOME`      | `${HOME_DIR}`     | `/home/node/.local/state`              | ✅ Yes    | XDG state directory                    |
| `PUPPETEER_CACHE_DIR` | `${HOME_DIR}`     | `/home/node/.cache/puppeteer`          | ✅ Yes    | Puppeteer cache                        |

#### 3.2 INFRASTRUCTURE ENV (Ports & Connections)

| ENV                 | Default                | Override                                       | Taxonomy       | Purpose                  |
| ------------------- | ---------------------- | ---------------------------------------------- | -------------- | ------------------------ |
| `SERVER_PORT`       | `3008`                 | `${localEnv:SERVER_PORT:3008}`                 | INFRASTRUCTURE | Express API server       |
| `CHROME_PROXY_PORT` | `9224`                 | `${localEnv:CHROME_PROXY_PORT:9224}`           | INFRASTRUCTURE | Chrome proxy (container) |
| `CHROME_PORT`       | `9225`                 | `${localEnv:CHROME_PORT:9225}`                 | INFRASTRUCTURE | Chrome debugging (host)  |
| `CHROME_HOST`       | `host.docker.internal` | `${localEnv:CHROME_HOST:host.docker.internal}` | INFRASTRUCTURE | Chrome host address      |

#### 3.3 OPERATIONAL ENV (Application Behavior)

| ENV                  | Default       | Override                              | Taxonomy    | Purpose                                             |
| -------------------- | ------------- | ------------------------------------- | ----------- | --------------------------------------------------- |
| `NODE_ENV`           | `development` | `${localEnv:NODE_ENV:development}`    | OPERATIONAL | Node environment mode                               |
| `BROWSER_MODE`       | `wsEndpoint`  | `${localEnv:BROWSER_MODE:wsEndpoint}` | OPERATIONAL | Connection mode (wsEndpoint/launcher/external/auto) |
| `LOG_LEVEL`          | `info`        | `${localEnv:LOG_LEVEL:info}`          | OPERATIONAL | Logging verbosity                                   |
| `BROWSER_POOL_SIZE`  | `3`           | -                                     | TUNING      | Browser instance pool                               |
| `WS_IDLE_TIMEOUT_MS` | `300000`      | -                                     | TUNING      | WebSocket timeout (5min)                            |

#### 3.4 FEATURE FLAGS ENV

| ENV                               | Default | Override                                  | Taxonomy | Purpose                      |
| --------------------------------- | ------- | ----------------------------------------- | -------- | ---------------------------- |
| `ENABLE_STATE_FILE`               | `true`  | `${localEnv:ENABLE_STATE_FILE:true}`      | FLAGS    | Enable state tracking        |
| `REEXECUTE_POST_CREATE`           | `false` | `${localEnv:REEXECUTE_POST_CREATE:false}` | FLAGS    | Force post-create rerun      |
| `PUPPETEER_LOCAL_LAUNCH_DISABLED` | `true`  | -                                         | FLAGS    | Disable local browser launch |

---

## 🔒 Variable Synchronization Matrix

| Layer          | Variable                          | Flows To                         | Expansion Timing | Example |
| -------------- | --------------------------------- | -------------------------------- | ---------------- | ------- |
| **VS Code**    | `remoteUser: "node"`              | → `${containerUser}`             | Pre-build        | "node"  |
| **Build Args** | `REMOTE_USER: "${containerUser}"` | → `ARG REMOTE_USER`              | Build-time       | "node"  |
| **Dockerfile** | `ARG REMOTE_USER=node`            | → `ENV USER_NAME=${REMOTE_USER}` | Build-time       | "node"  |
| **Container**  | `USER_NAME=node`                  | Runtime                          | Runtime          | "node"  |

**Flow Diagram**:

```
remoteUser: "node"
    ↓ (VS Code expands ${containerUser})
REMOTE_USER: "node"
    ↓ (Docker build processes ARG)
ARG REMOTE_USER=node
    ↓ (Dockerfile uses ${REMOTE_USER})
ENV USER_NAME=node
    ↓ (Container sees final value)
USER_NAME=node
```

---

## ✅ Validation Checklist

### Synchronization Audit

- [x] `remoteUser` = `${containerUser}` = `ARG REMOTE_USER` = `ENV USER_NAME`
- [x] All mounts `target=` use literal `/home/node` paths
- [x] All lifecycle hooks use `${containerWorkspaceFolder}` (expanded by VS Code)
- [x] All `containerEnv` variables have `${localEnv:*}` fallbacks
- [x] Dockerfile ENVs derived from ARGs use `${VAR}` syntax
- [x] No hardcoded "node" strings in Dockerfile (except ARG default)

### Variable Expansion Correctness

- [x] **Mounts source=**: Uses `${localWorkspaceFolder}` (VS Code expands)
- [x] **Mounts target=**: Uses literal `/home/node` paths (no variables)
- [x] **Build args**: All values are static or `${localEnv:*}`
- [x] **Container env**: All values have defaults (`:fallback` syntax)
- [x] **Lifecycle hooks**: Use `${containerWorkspaceFolder}` (VS Code context)

### Path Consistency

- [x] `workspaceFolder: "/workspaces/${localWorkspaceFolderBasename}"` →
      `/workspaces/chatgpt-docker-puppeteer`
- [x] `APP_DIR: "/workspaces/${PROJECT_NAME}"` → `/workspaces/chatgpt-docker-puppeteer`
- [x] All mounts target= align with `remoteUser: "node"` → `/home/node/*`

---

## 🔧 Common Patterns

### ✅ DO: Dynamic Identity

```dockerfile
# Dockerfile
ARG REMOTE_USER=node
ENV USER_NAME=${REMOTE_USER} \
    HOME_DIR=/home/${REMOTE_USER}

# Build with different user
docker build --build-arg REMOTE_USER=testuser ...
```

### ✅ DO: VS Code Variables in Source

```jsonc
// devcontainer.json
"mounts": [
  "source=${localWorkspaceFolder}/.env.development,target=/workspaces/chatgpt-docker-puppeteer/.env,type=bind"
]
```

### ✅ DO: Literal Paths in Target

```jsonc
// devcontainer.json
"mounts": [
  "source=devcontainer-cache,target=/home/node/.cache,type=volume"
]
```

### ✅ DO: Container Env with Fallbacks

```jsonc
// devcontainer.json
"containerEnv": {
  "SERVER_PORT": "${localEnv:SERVER_PORT:3008}"
}
```

### ❌ DON'T: Variables in Mounts Target

```jsonc
// ❌ INVALID - Docker won't expand ${containerUserHome}
"mounts": [
  "source=cache,target=${containerUserHome}/.cache,type=volume"
]
```

### ❌ DON'T: Hardcoded Values (Use Variables)

```dockerfile
# ❌ AVOID
ENV USER_NAME=node \
    HOME_DIR=/home/node

# ✅ PREFER
ARG REMOTE_USER=node
ENV USER_NAME=${REMOTE_USER} \
    HOME_DIR=/home/${REMOTE_USER}
```

---

## 📚 References

- **Official Docker Docs**:
  [docker run --mount](https://docs.docker.com/reference/cli/docker/container/run/#mount)
- **VS Code DevContainers**:
  [Variables Reference](https://code.visualstudio.com/docs/devcontainers/create-dev-container#_variables-in-devcontainerjson)
- **DevContainers Spec**: [JSON Schema](https://containers.dev/implementors/json_reference/)
- **ENV Taxonomy**: `ENV_ANALYSIS_V6.md` (v6.0 categorization)
- **Architecture**: `ARCHITECTURE.md` (v3.0 variable flow)

---

## 🎯 Upgrade Opportunities

### Future Improvements

1. **ENV Schema Validation**: Automated validation via `.env.schema.json` (✅ Already implemented in
   v6.0)
2. **CI/CD Integration**: GitHub Actions workflow to validate variable consistency
3. **Pre-commit Hook**: Block commits with invalid variable usage
4. **Dashboard**: `/api/env/status` endpoint to inspect runtime variables

### v6.0 Status

- ✅ ENV Taxonomy implemented (STRUCTURAL → INFRASTRUCTURE → OPERATIONAL → TUNING → FLAGS)
- ✅ Schema validation (`scripts/validate-env.js`)
- ✅ Post-create trap handler (ENV snapshot on errors)
- ✅ Deprecation system (PORT → SERVER_PORT)
- ✅ Semantic validation (BROWSER*MODE → CHROME*\* dependencies)

---

**Audit Completed**: 2026-02-03 **Status**: ✅ All variables synchronized and validated
**Recommendations**: No critical issues found. Documentation updated to reflect current best
practices.
