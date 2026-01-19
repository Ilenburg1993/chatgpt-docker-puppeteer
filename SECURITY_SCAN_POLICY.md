# Security Scan & Remediation Policy

This repository includes automated secret scanning and remediation guidelines.

 - Scheduled scans: `.github/workflows/secret-scan-schedule.yml` dispatches periodic scans.
 - Pre-commit: ensure `pre-commit` is configured locally to run the included secret checks.
 - Post-rotation verification: use `analysis/rotation-scripts/post_rotation_verify.sh` to collect verification reports.

Owner responsibilities:
 - Run rotation scripts in `analysis/rotation-scripts/` and confirm completion in issue #15.
 - Request host-side GC from platform support and attach evidence to issue #16.

For emergencies, archive `analysis/outputs/final_package.zip` and contact repository support.
# Security Scan Policy

Objetivo
-------
Definir regras, thresholds e procedimentos operacionais para varredura de segredos e artefatos sensíveis no repositório.

Escopo
------
- Filesystem (arquivos presentes no workspace)
- Git history (commits/objetos históricos)

Ferramentas recomendadas
------------------------
- TruffleHog (deep entropy / regex)
- git-secrets (hooks locais / CI)
- git-sizer (detecção de blobs grandes)
- git-filter-repo / BFG (remoção histórica)

Exclusões e whitelist padrão
---------------------------
- Ignorar diretórios gerados: `node_modules/`, `vendor/`, `build/`, `dist/`.
 - Ignorar diretórios gerados: `node_modules/`, `vendor/`, `build/`, `dist/`, `local-login/`.
- Arquivos binários grandes devem ser tratados separadamente (ex.: armazenar em LFS ou repositório de assets).
- Lockfiles (`package-lock.json`, `yarn.lock`) são escaneados, mas marcados com suspeita reduzida (muitos hashes/integrity são falsos-positives).

Assinaturas e regex (catálogo)
------------------------------
- AWS access keys: `AKIA[0-9A-Z]{16}`
- Azure keys, GCP service-account JSON patterns
- JWT-like tokens (header.payload.signature)
- Webhooks (Slack, etc.)
- Private keys: `-----BEGIN .* PRIVATE KEY-----`
- DB URIs, basic auth patterns, URLs com tokens

Entropia e thresholds
----------------------
- Heurística combinada: entropia (Shannon) + comprimento mínimo.
- Recomendação inicial: entropia >= 4.5 e comprimento >= 20 bytes para marcar como suspeito.
- Para base64/hex permitir thresholds diferenciados e sinalizar com menor severidade se o contexto for lockfile.

Fluxo de triagem (Triage)
-------------------------
1. Detectado → coletar evidências (path, commit, snippet).
2. Triage manual por owner: confirmar falso-positivo ou credencial ativa.
3. Classificação de severidade:
   - P0: credencial ativa com exposição pública/produção (ação imediata)
   - P1: credencial válida em ambiente de desenvolvimento/local
   - P2: possível token / baixa probabilidade
   - P3: provável falso-positivo (ex.: integrity hashes)
4. Criar issue/ticket com owner e prazo.

Remediação
----------
Se confirmado, seguir ordem:
1. Rotacionar a credencial/Token imediatamente (não esperar remoção do git).
2. Fazer backup do repositório: `git bundle --all -o /tmp/repo-backup.bundle`.
3. Remover histórico com `git-filter-repo` (ou BFG) para os paths/strings afetados.
4. `git reflog expire --expire=now --all` && `git gc --prune=now --aggressive`.
5. Testar localmente e `git push --force` para remotos afetados.
6. Registrar a ação na issue (quem rotacionou, quando, comando usado).

Prevenção
---------
- Hooks locais `pre-commit` para bloquear commits com segredos.
- Pre-push checks e CI scans (PR) que executem TruffleHog/git-secrets.
- Educação dos contribuidores: não commitar `profile/`, chaves privadas, ou arquivos sensíveis.

Logging e retenção
------------------
- Salvar saídas JSON de scanners com timestamp em storage seguro (retenção sugerida: 90 dias).
- Registrar auditoria para whitelists/exceções.

Exceções
--------
- Qualquer pedido de whitelist deve ter: motivo, owner, duração e aprovação de 2 reviewers.
- Exceções expiradas são removidas automaticamente.

Anexos e utilitários
--------------------
- Workflows GitHub Actions e templates de `pre-commit` acompanham este repositório.

Contato
-------
Equipe de segurança (owner): listar contatos internos e processo de escalonamento.
