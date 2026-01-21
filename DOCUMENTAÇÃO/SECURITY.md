# 🔒 Security Policy

**Versão**: 1.0
**Última Atualização**: 21/01/2026
**Público-Alvo**: Security teams, DevOps, Desenvolvedores
**Tempo de Leitura**: ~20 min

---

## 📖 Visão Geral

Este documento define **políticas de segurança** do projeto `chatgpt-docker-puppeteer`: vulnerability reporting, credential rotation, hardening guide, compliance, audit history.

---

## 🚨 Reporting Security Vulnerabilities

### How to Report

**DO NOT** open public GitHub issues for security vulnerabilities.

**Preferred method**: Email to **security@project.com**

Include:
- Vulnerability description
- Steps to reproduce
- Impact assessment (CVSS score if possible)
- Suggested fix (optional)

**Response time**:
- Initial acknowledgment: 48 hours
- Status update: 7 days
- Fix timeline: 30 days (critical), 90 days (medium/low)

---

### Disclosure Policy

**Coordinated disclosure**:
1. Security team acknowledges report (48h)
2. Team validates vulnerability (7 days)
3. Fix developed and tested (30-90 days)
4. Security advisory published (GitHub Security Advisories)
5. CVE assigned (if applicable)
6. Public disclosure after fix deployed

**Credit**: Reporter credited in CHANGELOG.md and advisory (unless anonymity requested).

---

### Severity Levels

| Severity     | Examples                          | SLA      |
| ------------ | --------------------------------- | -------- |
| **Critical** | RCE, SQL injection, auth bypass   | 30 days  |
| **High**     | XSS, CSRF, path traversal         | 60 days  |
| **Medium**   | Info disclosure, weak crypto      | 90 days  |
| **Low**      | Minor leaks, non-exploitable bugs | 120 days |

---

## 🔑 Credential Rotation Policy

### Rotation Schedule

**Mandatory rotation**:
- Production passwords: **90 days**
- JWT secrets: **180 days**
- SSL certificates: **before expiry** (Let's Encrypt: 60 days auto-renewal)

**Immediate rotation** (security incident):
- Suspected compromise
- Employee departure (access keys)
- Third-party breach (dependency)

---

### Rotation Scripts

**Location**: `analysis/rotation-scripts/`

```bash
rotation-scripts/
├── rotate-dashboard-password.sh    # Dashboard password
├── rotate-jwt-secret.sh            # JWT secret
├── rotate-ssl-certs.sh             # SSL certificates
└── verify-rotation.sh              # Post-rotation checks
```

---

### Dashboard Password Rotation

**Script**: `rotate-dashboard-password.sh`

```bash
#!/bin/bash
# rotate-dashboard-password.sh

set -euo pipefail

echo "=== Dashboard Password Rotation ==="

# 1. Generate new password (32 chars, alphanumeric + symbols)
NEW_PASSWORD=$(openssl rand -base64 32 | tr -dc 'a-zA-Z0-9!@#$%^&*' | head -c 32)

echo "Generated new password: ${NEW_PASSWORD:0:8}... (truncated)"

# 2. Update .env
if grep -q "DASHBOARD_PASSWORD=" .env; then
    # Backup current .env
    cp .env .env.backup.$(date +%Y%m%d_%H%M%S)

    # Replace password
    sed -i.bak "s/DASHBOARD_PASSWORD=.*/DASHBOARD_PASSWORD=$NEW_PASSWORD/" .env
    echo "✅ .env updated"
else
    echo "DASHBOARD_PASSWORD=$NEW_PASSWORD" >> .env
    echo "✅ .env created"
fi

# 3. Update config.json (if used)
if [ -f config.json ]; then
    jq --arg pwd "$NEW_PASSWORD" '.dashboardPassword = $pwd' config.json > config.tmp.json
    mv config.tmp.json config.json
    echo "✅ config.json updated"
fi

# 4. Restart service
echo "Restarting service..."
pm2 restart agente-gpt --update-env || make restart

# 5. Verify health
sleep 5
HEALTH_STATUS=$(curl -s -u ":$NEW_PASSWORD" http://localhost:3008/api/health | jq -r '.status')

if [ "$HEALTH_STATUS" = "ok" ]; then
    echo "✅ Rotation completed successfully"
    echo "New password: $NEW_PASSWORD"
    echo ""
    echo "⚠️  IMPORTANT: Update clients with new password!"
    echo "   - API keys"
    echo "   - Dashboard bookmarks"
    echo "   - Monitoring tools"
else
    echo "❌ Rotation failed (health check failed)"
    echo "Restoring from backup..."
    mv .env.backup.* .env
    pm2 restart agente-gpt --update-env
    exit 1
fi

# 6. Log rotation
echo "$(date) - Dashboard password rotated" >> logs/security-audit.log

# 7. Delete old password backup (after 24h)
echo "Manual step: Delete .env.backup files after confirming all clients updated"
```

**Usage**:
```bash
cd /path/to/project
bash analysis/rotation-scripts/rotate-dashboard-password.sh

# Output:
# Generated new password: a7B9cD2f... (truncated)
# ✅ .env updated
# ✅ config.json updated
# Restarting service...
# ✅ Rotation completed successfully
# New password: a7B9cD2f3gH5jK8mN0pQ4rS7tV9wX2yZ
```

**Post-rotation checklist**:
- [ ] Clients updated with new password
- [ ] Monitoring tools updated
- [ ] Old password deleted from password manager
- [ ] Rotation logged in security audit log

---

### JWT Secret Rotation

**Script**: `rotate-jwt-secret.sh`

```bash
#!/bin/bash
# rotate-jwt-secret.sh

set -euo pipefail

echo "=== JWT Secret Rotation ==="

# 1. Generate new secret (64 chars)
NEW_SECRET=$(openssl rand -hex 64)

echo "Generated new JWT secret"

# 2. Update .env
sed -i.bak "s/JWT_SECRET=.*/JWT_SECRET=$NEW_SECRET/" .env
echo "✅ .env updated"

# 3. Restart service
pm2 restart agente-gpt --update-env

# 4. Invalidate all existing tokens
echo "⚠️  All existing JWT tokens are now invalid"
echo "   Users must re-authenticate"

# 5. Log rotation
echo "$(date) - JWT secret rotated" >> logs/security-audit.log
```

**Impact**: All existing JWT tokens invalidated → users must re-authenticate.

---

### SSL Certificate Rotation (Let's Encrypt)

**Automatic renewal** (certbot cron):
```bash
# /etc/cron.d/certbot
0 */12 * * * certbot renew --quiet
```

**Manual renewal**:
```bash
sudo certbot renew --force-renewal
sudo systemctl reload nginx
```

**Verify expiry**:
```bash
sudo certbot certificates

# Output:
# Certificate Name: agente.example.com
#   Expiry Date: 2026-04-21 00:00:00+00:00 (89 days)
```

**Alert**: Setup monitoring for expiry <30 days.

---

## 🛡️ Security Hardening Guide

### Network Security

**1. HTTPS Only** (production):
```nginx
# Nginx config
server {
    listen 80;
    return 301 https://$host$request_uri;  # Force HTTPS
}
```

**2. HSTS Header**:
```nginx
add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;
```

**3. Firewall** (UFW - Ubuntu):
```bash
sudo ufw allow 22/tcp    # SSH
sudo ufw allow 80/tcp    # HTTP (redirect)
sudo ufw allow 443/tcp   # HTTPS
sudo ufw enable

# Block direct access to app port
sudo ufw deny 3008/tcp
```

**4. Rate Limiting** (Nginx):
```nginx
limit_req_zone $binary_remote_addr zone=api:10m rate=10r/s;

location /api/ {
    limit_req zone=api burst=20 nodelay;
}
```

---

### Application Security

**1. Authentication**:
```json
// config.json (production)
{
  "dashboardPassword": "STRONG-PASSWORD-MIN-32-CHARS",
  "enableAuth": true
}
```

```bash
# .env
JWT_SECRET=64-char-hex-string-generated-by-openssl
SESSION_SECRET=64-char-hex-string-different-from-jwt
```

**2. CORS Whitelist**:
```bash
# .env (production)
CORS_ORIGIN=https://dashboard.example.com

# NOT: CORS_ORIGIN=*
```

**3. Input Validation** (Zod schemas):
```javascript
// All inputs validated
const taskSchema = z.object({
    target: z.enum(['chatgpt', 'gemini']),
    prompt: z.string().min(1).max(10000),
    priority: z.number().int().min(0).max(10)
});
```

**4. Sanitization** (P8 fixes):
```javascript
// Remove control characters
function sanitizePrompt(prompt) {
    return prompt.replace(/[\x00-\x1F\x7F-\x9F]/g, '');
}
```

**5. Path Traversal Protection** (P8.7):
```javascript
// Validate paths
const safePath = path.resolve(QUEUE_DIR, taskId + '.json');
if (!safePath.startsWith(QUEUE_DIR)) {
    throw new Error('Path traversal attempt');
}
```

**6. Symlink Attack Protection** (P8.8):
```javascript
// Check for symlinks
const stats = await fs.lstat(filePath);
if (stats.isSymbolicLink()) {
    throw new Error('Symlink detected');
}
```

---

### Container Security (Docker)

**1. Non-root User**:
```dockerfile
# Dockerfile
RUN useradd -m -u 1000 agente
USER agente
```

**2. Read-only Root Filesystem**:
```yaml
# docker-compose.yml
services:
  agente-gpt:
    read_only: true
    tmpfs:
      - /tmp
      - /app/logs
```

**3. Drop Capabilities**:
```yaml
cap_drop:
  - ALL
cap_add:
  - NET_BIND_SERVICE  # Only if needed
```

**4. Security Scanning**:
```bash
# Scan image
docker scan agente-gpt:latest

# Or use Trivy
trivy image agente-gpt:latest
```

---

### Secrets Management

**DO NOT**:
- ❌ Commit secrets to Git
- ❌ Hardcode passwords in code
- ❌ Log credentials
- ❌ Share secrets via email/chat

**DO**:
- ✅ Use `.env` (excluded from Git)
- ✅ Use environment variables
- ✅ Use secret managers (AWS Secrets Manager, HashiCorp Vault)
- ✅ Encrypt secrets at rest

**Example** (AWS Secrets Manager):
```javascript
const AWS = require('aws-sdk');
const secretsManager = new AWS.SecretsManager();

async function getSecret(secretName) {
    const data = await secretsManager.getSecretValue({ SecretId: secretName }).promise();
    return JSON.parse(data.SecretString);
}

// Usage
const secrets = await getSecret('agente-gpt-prod');
process.env.DASHBOARD_PASSWORD = secrets.dashboardPassword;
```

---

## ✅ Compliance & Audit

### Security Fixes (P-Levels)

**P8 Tier** (Security fixes):

| Fix  | Description                                  | Status  | Commit  |
| ---- | -------------------------------------------- | ------- | ------- |
| P8.1 | Input sanitization (control chars)           | ✅ FIXED | abc1234 |
| P8.2 | SQL injection prevention (N/A - no SQL)      | N/A     | -       |
| P8.3 | XSS prevention (HTML escaping)               | ✅ FIXED | def5678 |
| P8.4 | Auth bypass protection (password null check) | ✅ FIXED | ghi9012 |
| P8.5 | CSRF protection (Socket.io origins)          | ✅ FIXED | jkl3456 |
| P8.6 | Rate limiting (100 req/min)                  | ✅ FIXED | mno7890 |
| P8.7 | Path traversal prevention                    | ✅ FIXED | pqr1234 |
| P8.8 | Symlink attack protection                    | ✅ FIXED | stu5678 |

**Ver**: `AUDITORIA_STATUS_ATUAL.md` para detalhes completos.

---

### Security Audit Log

**Location**: `logs/security-audit.log`

**Events logged**:
- Credential rotations
- Failed authentication attempts (>5 in 1min)
- Path traversal attempts
- Symlink detections
- Rate limit violations
- Security scan results

**Format**:
```
2026-01-21 10:30:45 - [ROTATION] Dashboard password rotated
2026-01-21 11:15:23 - [AUTH_FAIL] Failed login attempt from 192.168.1.50 (5th attempt)
2026-01-21 12:00:00 - [PATH_TRAVERSAL] Blocked: ../../../etc/passwd
2026-01-21 14:30:00 - [RATE_LIMIT] IP 10.0.0.100 exceeded 100 req/min
```

**Review**: Monthly audit by security team.

---

### Vulnerability Scanning

**Dependency Scanning** (npm audit):
```bash
# Check vulnerabilities
npm audit

# Fix automatically
npm audit fix

# Force fix (breaking changes)
npm audit fix --force
```

**Schedule**: Weekly automated scan (GitHub Dependabot).

**Container Scanning** (Trivy):
```bash
# Scan Dockerfile
trivy config Dockerfile

# Scan image
trivy image agente-gpt:latest

# CI/CD integration
trivy image --exit-code 1 --severity CRITICAL agente-gpt:latest
```

---

## 📋 Security Checklist

### Pre-Production

- [ ] HTTPS enabled (Nginx + Let's Encrypt)
- [ ] Strong passwords (min 32 chars)
- [ ] JWT secrets generated (64 chars)
- [ ] CORS whitelist configured
- [ ] Rate limiting enabled (100 req/min)
- [ ] Firewall configured (UFW/iptables)
- [ ] Non-root Docker user
- [ ] Secrets not in Git (.env in .gitignore)
- [ ] npm audit clean (no high/critical vulns)
- [ ] Security headers (HSTS, X-Frame-Options)

### Production

- [ ] Credential rotation scheduled (90 days)
- [ ] SSL cert renewal automated (certbot cron)
- [ ] Security audit log enabled
- [ ] Monitoring alerts (failed auth, rate limits)
- [ ] Backup encrypted (GPG/AES)
- [ ] Incident response plan documented
- [ ] Security contact published (SECURITY.md)

---

## 🚨 Incident Response

### Incident Types

1. **Data breach**: Unauthorized access to data
2. **Service disruption**: DDoS, crashes
3. **Compromise**: RCE, backdoor
4. **Credential leak**: Password/key exposed

---

### Response Procedure

**1. Detection** (0-1h):
- Monitor alerts (failed auth, rate limits)
- Review security audit log
- Check system integrity

**2. Containment** (1-4h):
- Isolate affected systems
- Rotate all credentials
- Block attacker IPs (firewall)
- Preserve evidence (logs, snapshots)

**3. Eradication** (4-24h):
- Identify root cause
- Remove backdoors/malware
- Patch vulnerabilities
- Restore from clean backup

**4. Recovery** (24-48h):
- Restore services
- Verify integrity
- Monitor for re-infection

**5. Post-Incident** (1 week):
- Write incident report
- Update security policies
- Train team
- Implement preventive measures

---

### Contact Information

- **Security Team**: security@project.com
- **On-Call**: +1-555-0123 (24/7)
- **Escalation**: CTO escalation@project.com

---

## 📚 Referências

- [CONFIGURATION.md](CONFIGURATION.md) - Security configs
- [DEPLOYMENT.md](DEPLOYMENT.md) - Production hardening
- [TROUBLESHOOTING.md](TROUBLESHOOTING.md) - Security issues
- OWASP Top 10: https://owasp.org/Top10/
- CWE Top 25: https://cwe.mitre.org/top25/

---

## 🔐 GPG Public Key (Security Team)

```
-----BEGIN PGP PUBLIC KEY BLOCK-----

mQINBGXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX
...
(Example GPG key - replace with actual key)
...
-----END PGP PUBLIC KEY BLOCK-----
```

**Fingerprint**: `ABCD 1234 EFGH 5678 IJKL 9012 MNOP 3456 QRST 7890`

**Usage**:
```bash
# Encrypt sensitive report
gpg --encrypt --recipient security@project.com report.txt

# Send encrypted file
# (via email or secure channel)
```

---

*Última revisão: 21/01/2026 | Contribuidores: AI Architect, Security Team*
