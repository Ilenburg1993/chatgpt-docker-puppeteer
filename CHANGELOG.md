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
