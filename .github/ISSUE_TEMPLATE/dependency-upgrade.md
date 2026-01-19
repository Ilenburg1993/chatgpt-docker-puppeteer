---
name: Dependency Upgrade PR Checklist
about: Use this template when preparing PRs that upgrade dependencies
title: 'chore(deps): upgrade <package> — compatibility validation'
labels: ['dependency','security']
assignees: []
---

Use this checklist for any PR that upgrades runtime or infra dependencies (especially `puppeteer`, `puppeteer-extra`, `pm2`, `express`). Upgrades that touch browser automation or process managers require careful validation.

Checklist
- [ ] Branch name: `chore/deps-upgrade/<package>-<version>`
- [ ] Document motivation and changelog links in PR description
- [ ] Run `npm audit --json` and attach output to PR (`analysis/verification_commands/npm_audit_current.json`)
- [ ] Run `npm ci` and `npm test` (or `npm run test:linux`) and include results
- [ ] Run `test-puppeteer.js` smoke flows locally (describe environment and Chromium version)
- [ ] Run CI (make sure secret-scan and pre-commit checks pass)
- [ ] Provide rollback plan and expected impact (downtime, config changes)
- [ ] Add at least one reviewer from runtime/security team
- [ ] If upgrade is major for `puppeteer` or other browser tooling, include a dedicated QA run and confirm Puppeteer binary compatibility
- [ ] When merged: update `CHANGELOG.md` and tag release if applicable

Notes
- Avoid mass automatic upgrades: prefer small, isolated PRs per package.
- For packages that include native/binary components (Chromium), test across CI images and local environments.
