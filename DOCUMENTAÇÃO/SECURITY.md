# Security Guidelines

## Overview

This document outlines security best practices for chatgpt-docker-puppeteer development and deployment.

---

## Data Protection

### 1. Sensitive Data in Task Queue

**Risk**: Tasks in `fila/` may contain sensitive prompts or context.

**Mitigation**:

- ✅ `fila/` excluded in `.gitignore`
- ✅ Backup scripts should encrypt queue data
- ✅ Use environment-specific queues for production

### 2. AI Responses

**Risk**: Responses in `respostas/` may contain sensitive information.

**Mitigation**:

- ✅ `respostas/` excluded in `.gitignore`
- ✅ Implement data retention policies
- ✅ Sanitize responses before logging

### 3. Browser Profiles

**Risk**: `profile/` directory contains browser sessions and cookies.

**Mitigation**:

- ✅ `profile/` excluded in `.gitignore`
- ✅ Use isolated profiles per environment
- ✅ Clear profile data after testing
- ⚠️ Never commit profile directories

### 4. Logs

**Risk**: Logs may contain personal information or API keys.

**Mitigation**:

- ✅ `logs/` excluded in `.gitignore`
- ✅ Implement log rotation (PM2 handles this)
- ✅ Sanitize sensitive data before logging
- ✅ Review logs before sharing for debugging

---

## Configuration Security

### 1. Environment Variables

**Never commit:**

- `.env` files
- Hardcoded API keys
- Credentials or tokens

**Best Practice**:

```bash
# Use .env.example as template
cp .env.example .env
# Edit .env with real values
# NEVER: git add .env
```

### 2. Config File Validation

**Implemented**:

- ✅ Zod schema validation for `config.json`
- ✅ Type checking at runtime
- ✅ Default values for missing fields

**Test**:

```bash
npm run test:config
```

### 3. Domain Whitelist

**Enforcement**: Only domains in `allowedDomains` are permitted.

```json
{
    "allowedDomains": ["chatgpt.com", "gemini.google.com"]
}
```

**Adding new domains**:

1. Update `config.json`
2. Test with validation script
3. Reload config: `CONFIG.reload('domain-update')`

---

## Network Security

### 1. Chrome Remote Debugging

**Risk**: Port 9222 exposes Chrome DevTools Protocol.

**Mitigation**:

- ⚠️ Bind to `localhost` only (not `0.0.0.0`)
- ⚠️ Use firewall to block external access
- ✅ Docker: Use `host.docker.internal` (not exposed publicly)

**Windows**:

```powershell
chrome.exe --remote-debugging-port=9222 --remote-debugging-address=127.0.0.1
```

**Linux**:

```bash
google-chrome --remote-debugging-port=9222 --remote-debugging-address=127.0.0.1
```

### 2. Dashboard Access

**Risk**: Dashboard on port 3008 accessible to network.

**Production Mitigation**:

- ✅ Use Nginx reverse proxy with authentication
- ✅ Enable HTTPS with valid certificate
- ✅ Implement rate limiting
- ✅ Set `CORS_ORIGIN` to specific domain

**Example Nginx config**:

```nginx
location / {
    proxy_pass http://localhost:3008;
    auth_basic "Agent Dashboard";
    auth_basic_user_file /etc/nginx/.htpasswd;
}
```

### 3. API Authentication

**Current Status**: ⚠️ No authentication (development)

**Production TODO**:

- [ ] Implement API key authentication
- [ ] Add JWT token support
- [ ] Rate limiting per API key
- [ ] Audit logging of API calls

**Enable**:

```bash
# .env
API_KEY=your-secret-key-here
ENABLE_AUTH=true
```

---

## Code Security

### 1. Dependency Scanning

**Automated**:

- ✅ Dependabot enabled (npm, Docker, Actions)
- ✅ Weekly scans for vulnerabilities
- ✅ Automated PRs for security updates

**Manual**:

```bash
# Audit dependencies
npm audit

# Fix vulnerabilities
npm audit fix

# Check outdated packages
npm outdated
```

### 2. Secret Scanning

**Automated**:

- ✅ `.secrets.baseline` for detect-secrets
- ✅ GitHub Actions secret scan workflow
- ✅ Pre-commit hooks (optional)

**Manual**:

```bash
# Scan for secrets
detect-secrets scan > .secrets.baseline

# Audit findings
detect-secrets audit .secrets.baseline
```

### 3. Input Validation

**Implemented**:

- ✅ Zod schemas for task validation
- ✅ Config validation with defaults
- ✅ Sanitization of prompts (control characters removed)

**Test**:

```bash
npm run test:schema
```

---

## Deployment Security

### 1. Container Security

**Best Practices**:

- ✅ Use non-root user in Dockerfile (`USER node`)
- ✅ Minimal base image (Node 20 slim)
- ✅ No secrets in image layers
- ✅ Multi-stage builds to reduce attack surface

**Scan image**:

```bash
docker scan chatgpt-docker-puppeteer
```

### 2. PM2 Configuration

**Security settings**:

```javascript
// ecosystem.config.js
{
  max_memory_restart: '2G',  // Prevent memory exhaustion
  kill_timeout: 5000,        // Graceful shutdown
  listen_timeout: 10000,     // Startup timeout
  autorestart: true          // Restart on crash
}
```

### 3. File Permissions

**Recommended**:

```bash
# Configuration files (read-only for application)
chmod 640 config.json dynamic_rules.json .env

# Scripts (executable)
chmod 750 scripts/*.sh

# Logs directory (writable)
chmod 750 logs/

# Queue directory (writable)
chmod 750 fila/
```

---

## Incident Response

### 1. Compromised Credentials

**Actions**:

1. Rotate all API keys immediately
2. Review audit logs for suspicious activity
3. Change `.env` variables
4. Restart all services
5. Review git history for leaked secrets

### 2. Unauthorized Access

**Actions**:

1. Check access logs: `tail -f logs/audit.log`
2. Review PM2 logs: `pm2 logs`
3. Check for suspicious tasks in `fila/`
4. Reset Chrome profile: `rm -rf profile/`
5. Enable authentication: `ENABLE_AUTH=true`

### 3. Malicious Task Injection

**Detection**:

- Monitor for abnormal task patterns
- Check `fila/corrupted/` for invalid tasks
- Review audit logs for task creation

**Prevention**:

- Validate task sources
- Implement task approval workflow
- Use API authentication

---

## Security Checklist

### Development

- [ ] Never commit `.env` files
- [ ] Use `.env.example` for templates
- [ ] Clear browser profiles after testing
- [ ] Review code for hardcoded secrets
- [ ] Run security tests before commit

### Deployment

- [ ] Use strong API keys (if enabled)
- [ ] Enable HTTPS for dashboard
- [ ] Set up firewall rules
- [ ] Configure log rotation
- [ ] Enable Dependabot
- [ ] Scan Docker images
- [ ] Use non-root user in containers
- [ ] Bind Chrome to localhost only
- [ ] Set up monitoring and alerts
- [ ] Implement backup strategy

### Maintenance

- [ ] Review audit logs weekly
- [ ] Update dependencies monthly
- [ ] Rotate secrets quarterly
- [ ] Review access controls
- [ ] Test disaster recovery
- [ ] Document incidents

---

## Reporting Security Issues

**Do NOT open public GitHub issues for security vulnerabilities.**

**Instead**:

1. Email: [security contact - TBD]
2. Provide detailed description
3. Include reproduction steps
4. Allow 90 days for fix before disclosure

**We will**:

- Acknowledge within 48 hours
- Provide fixes in next release
- Credit you in CHANGELOG (if desired)

---

## Compliance

### GDPR Considerations

If processing personal data:

- ✅ Implement data retention policies
- ✅ Provide data export functionality
- ✅ Enable data deletion (clear `fila/` and `respostas/`)
- ✅ Log data processing activities
- ⚠️ Obtain user consent for AI processing

### Audit Trail

Enabled:

- ✅ Task creation logged with timestamp
- ✅ Task execution logged with result
- ✅ IPC commands audited in `logs/audit.log`
- ✅ Configuration changes logged

---

## Resources

- [OWASP Top 10](https://owasp.org/www-project-top-ten/)
- [Node.js Security Best Practices](https://nodejs.org/en/docs/guides/security/)
- [Docker Security](https://docs.docker.com/engine/security/)
- [Chrome DevTools Protocol Security](https://chromedevtools.github.io/devtools-protocol/)

---

## Updates

This document should be reviewed and updated:

- After security incidents
- When adding new features
- During security audits
- At least quarterly
