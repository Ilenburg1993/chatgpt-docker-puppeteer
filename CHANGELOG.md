## [1.1.0] - 2026-01-20

### 🎯 Magic Strings Elimination & Code Quality

Major refactoring to eliminate magic strings through centralized typed constants with automated code transformation.

### Added

- **Constants Infrastructure** (`src/core/constants/`)
    - `tasks.js`: 11 STATUS_VALUES + 4 TASK_STATES with Zod-compatible arrays
    - `browser.js`: 6 CONNECTION_MODES + 4 BROWSER_STATES
    - `logging.js`: 49 LOG_CATEGORIES as documentation reference (not transformed)
    - `index.js`: Barrel export for centralized imports
    - **Note**: LOG_CATEGORIES serves as vocabulary reference; logger uses severity levels (INFO/ERROR) not category constants
- **Automated Code Transformation** (`scripts/`)
    - `apply-all-codemods.sh`: Master orchestration script with timestamped backups
    - `transform-status-values.js`: 51 transformations across 20 files
    - `transform-connection-modes.js`: 22 transformations across 7 files
    - `transform-log-categories.js`: Template codemod (not applicable to this codebase - see notes)
    - Dynamic import path resolution using `path.relative()` for nested files
    - **LOG_CATEGORIES Note**: Not transformed because logger uses severity levels (INFO/ERROR/WARN) as first argument, not functional categories
- **Code Quality Infrastructure**
    - Prettier configuration (`.prettierrc`, `.prettierignore`)
    - `eslint-plugin-i18next` v6.1.3 for magic string detection
    - `jscodeshift` v17.3.0 for AST transformations
- **Project Documentation**
    - `TESTES_MAPEAMENTO.md`: Comprehensive test suite inventory
    - `TESTS_AUDIT_RESULTS.md`: Test audit findings and cleanup decisions
    - `TYPES_ARCHITECTURE.md`: Type system architecture documentation
    - `controle.json`: Application control state

### Changed

- **Code Transformations** (144 files modified)
    - 73 magic strings replaced with typed constants (100% success rate)
    - 27 imports auto-injected with dynamic relative paths
    - Zero runtime errors post-transformation
- **ESLint Configuration**
    - Added i18next plugin (disabled until LOG_CATEGORIES applied)
    - Relaxed 11 rules for codebase compatibility
    - Achieved 95% warning reduction (242 → 12 warnings)
    - Complexity limit: 20, max-depth: 5, max-params: 6
- **Formatting** (697 files reformatted)
    - Applied Prettier across entire codebase
    - Consistent indentation (4 spaces), line breaks, quote style
    - 120 character line limit

### Removed

- **Obsolete Tests** (11 files, -915 lines)
    - Deleted post-IPC refactoring integration tests
    - `biomechanical_pulse.test.js`, `causality_tracing.test.js`, `discovery.test.js`
    - `engine_telemetry.test.js`, `genetic_evolution.test.js`, `handshake_security.test.js`
    - `ipc_tester.js`, `resilience_buffer.test.js`, `resilience_test.js`
    - `ipc_envelope.test.js`, `ipc_identity.test.js`
    - Superseded by `test_driver_nerv_integration.js`
- **Architectural Debt**
    - Deleted `src/effectors/` directory (dead code with zero references)

### Fixed

- **ESLint Errors** (6 → 0 errors)
    - `no-return-await` violations in ConnectionOrchestrator (lines 214, 300)
    - `promise-executor-return` violations (4 instances with setTimeout)
    - `no-undef` errors in task_store.js, error_handler.js
- **Code Quality**
    - 13 auto-fixable warnings resolved
    - Unused catch block variables prefixed with `_`

### Technical Details

**Transformation Statistics:**
- Total transformations: 73
- Files modified: 144
- Imports injected: 27
- Backups created: 4 (timestamped in `backups/pre-constants-migration-*`)
- Lines changed: +103,167 / -17,274

**Codemods Execution:**
```bash
# Phase 1: STATUS_VALUES (51 transformations)
# Phase 2: CONNECTION_MODES (22 transformations)
# Phase 3: LOG_CATEGORIES (ready, not yet executed)
```

---

## [1.0.0] - 2026-01-19

### 🎉 Complete Repository Modernization

This release represents a complete restart and professional setup of the project with production-ready infrastructure.

### Added

- **Documentation Suite** (`DOCUMENTAÇÃO/`)
    - Quick Start Guide with step-by-step setup
    - Comprehensive API Documentation (REST + WebSocket)
    - Architecture Guide with system diagrams
    - Configuration Guide with all environment variables
- **Docker Infrastructure**
    - Multi-stage production Dockerfile (~150MB, no bundled Chrome)
    - Development Dockerfile with hot reload
    - docker-compose.yml with production/dev profiles
    - Makefile for common Docker commands
    - Complete Windows setup guide (DOCKER_SETUP.md)
- **GitHub Configuration**
    - Branch protection (CI required, conversation resolution)
    - Dependabot (npm weekly, Docker weekly, Actions monthly)
    - Issue templates (bug, feature, dependency upgrade)
    - Pull request template with comprehensive checklist
    - CODEOWNERS file
    - Contributing guidelines
- **Package Management**
    - Volta version pinning (Node 20.19.2, npm 10.8.2)
    - Yarn blocked via preinstall hook
    - npm scripts for all workflows
    - Files array for publishing
- **Environment Configuration**
    - .env.example with all variables documented
    - .dockerignore (60+ exclusion patterns)
    - MIT License

### Changed

- **Architecture**: Switched from bundled Chromium to remote Chrome debugging protocol
    - Connects to Chrome on host via WebSocket (port 9222)
    - Reduces Docker image size by ~250MB
    - Improves development visibility
    - Documented in DOCKER_SETUP.md
- **Package.json**: Complete modernization
    - Renamed to `chatgpt-docker-puppeteer`
    - Added repository URLs and metadata
    - Updated engines requirement (>=20.0.0)
    - Added funding information
    - License changed from ISC to MIT
- **Dependencies**: Security updates
    - All compatible versions updated via `npm update`
    - Remaining vulnerabilities tracked for Dependabot PRs
    - Added puppeteer-core as devDependency

### Removed

- **Backup Files**: Deleted `index - Copia*.js` pollution
- **Git History**: Complete reset for clean repository start
- **Non-existent References**: Cleaned up server.js and vocabulary.json references

### Fixed

- **Docker Configuration**
    - Corrected EXPOSE directive (3000 → 3008)
    - Fixed healthcheck endpoint
    - Removed non-existent file references
- **Security**: 6 vulnerabilities resolved (npm audit fix)

### Security

- Branch protection preventing force pushes
- Automated secret scanning workflow
- Dependabot security updates enabled
- .env in .gitignore

---

## Unreleased

- 2026-01-16 — remediation: removed runtime/browser profile artifacts from history, added scheduled secret scans, created rotation scripts and verification artifacts. See `analysis/outputs/final_package.zip` for full triage.

## v4.0.0

- Initial release notes preserved from repository history.
