---
name: Bug Report
about: Create a report to help us improve
title: '[BUG] '
labels: bug
assignees: ''
---

## Describe the bug

A clear and concise description of what the bug is.

## To Reproduce

Steps to reproduce the behavior:

1. Run command '...'
2. Execute task '...'
3. See error

## Expected behavior

A clear and concise description of what you expected to happen.

## Actual behavior

What actually happened.

## Environment

- OS: [e.g. Windows 10, Ubuntu 22.04, macOS 13]
- Node.js version: [e.g. v20.10.0]
- PM2 version: [e.g. v5.3.0]
- Puppeteer version: [e.g. 21.6.1]
- Browser: [e.g. Chromium 120, Chrome 121]
- Installation method: [Docker / Local / WSL2]
- Docker version (if applicable): [e.g. 24.x]

## CI/CD Context (if applicable)

- [ ] Bug occurs in CI/CD pipeline
- CI job that failed: `___________`
- GitHub Actions run URL: `___________`
- Module-alias validation status: Pass / Fail
- ESLint exit code: `___________`
- Attach relevant CI logs or workflow output

## Module Alias Configuration (if import-related)

- [ ] Using module aliases (@core, @infra, @driver, @server, @shared)
- [ ] Using relative paths (../../..)
- [ ] Validated with: `node scripts/validate-ci.js`
- [ ] jsconfig.json aligned with package.json

## Logs

```
Paste relevant logs here
```

## Screenshots / Crash Reports

If applicable, add screenshots or forensics dumps from `logs/crash_reports/`

## Additional context

Add any other context about the problem here.
