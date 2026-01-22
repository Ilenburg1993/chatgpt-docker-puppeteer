---
name: Dependency Upgrade PR Checklist
about: Use this template when preparing PRs that upgrade dependencies
title: 'chore(deps): upgrade <package> — compatibility validation'
labels: ['dependency', 'security']
assignees: []
---

Use this checklist for any PR that upgrades runtime or infra dependencies (especially `puppeteer`, `puppeteer-extra`, `pm2`, `express`). Upgrades that touch browser automation or process managers require careful validation.

## Pre-Upgrade Validation

- [ ] Branch name: `chore/deps-upgrade/<package>-<version>`
- [ ] Document motivation and changelog links in PR description
- [ ] Run `npm audit --json` and attach output to PR (`analysis/verification_commands/npm_audit_current.json`)
- [ ] Review breaking changes from package changelog

## CI/CD Validation (CRITICAL)

- [ ] Module-alias validation: `node scripts/validate-ci.js`
- [ ] ESLint strict mode: `npx eslint . --max-warnings 0 --quiet`
- [ ] Local tests: `make test-fast` (pre-commit suite)
- [ ] Integration tests: `make test-integration`
- [ ] CI pipeline passes all 8 jobs (Dependencies, Lint, Tests×3, Integration, Build, Security, Docs)
- [ ] No new ESLint warnings introduced

## Runtime Validation

- [ ] Run `npm ci` and `npm test` (or `npm run test:linux`) and include results
- [ ] Run `test-puppeteer.js` smoke flows locally (describe environment and Chromium version)
- [ ] PM2 health checks pass: `make health`
- [ ] Browser pool connectivity verified (launcher + external modes)

## Cross-Platform Checks

- [ ] Tested on Linux (Ubuntu 22.04 or similar)
- [ ] Tested on Windows (10/11 with PowerShell)
- [ ] Tested on macOS (if available)
- [ ] Docker build succeeds: `docker-compose build`

## Security & Documentation

- [ ] Run CI (make sure secret-scan and pre-commit checks pass)
- [ ] Update `CHANGELOG.md` with upgrade details
- [ ] Provide rollback plan and expected impact (downtime, config changes)
- [ ] Add at least one reviewer from runtime/security team

## Special Cases

- [ ] If upgrade is major for `puppeteer` or other browser tooling, include a dedicated QA run and confirm Puppeteer binary compatibility
- [ ] For `module-alias` upgrades: verify all 9 aliases resolve correctly
- [ ] For PM2 upgrades: test ecosystem.config.js compatibility
- [ ] When merged: update `CHANGELOG.md` and tag release if applicable

## Notes

- Avoid mass automatic upgrades: prefer small, isolated PRs per package.
- For packages that include native/binary components (Chromium), test across CI images and local environments.
- All dependency PRs MUST pass CI/CD v2.0 pipeline (8 jobs) before merge.
