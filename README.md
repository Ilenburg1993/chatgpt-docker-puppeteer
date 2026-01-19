# chatgpt-docker-puppeteer

[![CI](https://github.com/Ilenburg1993/chatgpt-docker-puppeteer/workflows/CI/badge.svg)](https://github.com/Ilenburg1993/chatgpt-docker-puppeteer/actions)
[![Node.js Version](https://img.shields.io/badge/node-%3E%3D20.0.0-brightgreen)](https://nodejs.org/)
[![License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](CONTRIBUTING.md)

🤖 **Autonomous AI agent for browser automation with Puppeteer** - Domain-driven task processing with adaptive validation and real-time monitoring.

Note: this project is developed from an LLM-agnostic perspective — tools and
integrations are intended to work with any large language model (LLM) or
provider. References to specific models in code or examples are illustrative
only and should be considered implementation details rather than core
assumptions.

See `DOCUMENTAÇÃO/` for more details.

## Branch protection & Merge policy

- **Main is protected:** `main` requires passing `CI` checks and at least
  one approving review before merging. Administrators are also enforced by
  this policy.
- **No automatic merges into `main`:** Do not merge dependency updates or
  other changes into `main` without explicit authorization from the
  repository owner. Use feature or chore branches and open PRs for review.
- **Low-priority records:** Small, non-impacting records (e.g. lockfile-only
  PRs for CI fixes) may be opened for auditable history, but they must not
  be merged without approval.

This policy keeps `main` as the high-trust core of the project; use topic
branches for active work and coordinate any change that affects runtime
behavior or dependencies.
