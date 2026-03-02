# Security Policy

## Supported Versions

| Version      | Supported |
| ------------ | --------- |
| 1.x (latest) | ✅ Yes    |
| < 1.0        | ❌ No     |

## Reporting a Vulnerability

**Please do NOT open a public GitHub issue for security vulnerabilities.**

To report a security vulnerability, use one of the following channels:

1. **GitHub Private Vulnerability Reporting** (preferred): Use the
   ["Report a vulnerability"](../../security/advisories/new) button in the Security tab of this
   repository. This is a private channel visible only to maintainers.

2. **Email**: If the above option is unavailable, contact the maintainers directly via the email
   listed in the repository profile.

### What to include in your report

- Description of the vulnerability and its potential impact
- Steps to reproduce (proof-of-concept or exploit code if available)
- Affected version(s) and configuration
- Any suggested fix or mitigation

### Response Timeline

| Step                           | Target SLA                           |
| ------------------------------ | ------------------------------------ |
| Initial acknowledgement        | 3 business days                      |
| Triage and severity assessment | 7 business days                      |
| Fix or workaround              | 30 days (critical), 90 days (others) |
| Public disclosure              | After fix is released                |

## Scope

### In Scope

- Remote code execution (RCE) vulnerabilities in the Node.js runtime
- Authentication/authorization bypass in the API or dashboard
- Secret/credential exposure via logs, API responses, or storage
- Injection attacks (SQL, command, prompt injection) in the backend
- Denial of service (DoS) attacks affecting service availability
- Dependency vulnerabilities with proven exploitability

### Out of Scope

- Vulnerabilities in the external Chrome/Chromium instance (report to Google)
- Issues requiring physical access to the host machine
- Social engineering attacks
- Theoretical vulnerabilities without proof-of-concept
- Issues already reported and publicly tracked

## Security Architecture

This project implements the following security controls:

- **HTTP hardening**: Helmet.js with explicit CSP, frameguard, referrer policy, and HSTS
  (production)
- **Rate limiting**: Express rate-limit (100 req/min in production, configurable)
- **CORS**: Configurable allowed origins, restricted headers
- **Input validation**: Zod schema validation on all API inputs
- **Authentication**: Token-based auth middleware on protected routes
- **Process isolation**: Non-root container user, dumb-init for signal handling
- **Dependency scanning**: Automated npm audit, Dependabot, and Trivy on every PR

For full technical security documentation, see
[`DOCUMENTAÇÃO/OPERACOES/SECURITY.md`](DOCUMENTAÇÃO/OPERACOES/SECURITY.md).

## Security Scanning

This repository uses automated security scanning on every pull request and weekly:

- **CodeQL**: Static analysis for JavaScript/TypeScript (SAST)
- **Trivy**: Container image and filesystem vulnerability scanning
- **OSSF Scorecard**: Security best practices evaluation
- **npm audit**: Production dependency vulnerability check
- **Dependabot**: Automated dependency updates

Results are visible in the [Security tab](../../security) of this repository.
