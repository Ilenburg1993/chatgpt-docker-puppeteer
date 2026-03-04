// @ts-check

/**
 * SQLite schema migrations (SSOT).
 *
 * IMPORTANT:
 * - Migrations must be append-only.
 * - Each migration must be idempotent (safe to re-run) via IF NOT EXISTS.
 */

/** @typedef {{ version: number, name: string, up?: string, upFn?: (db: import('better-sqlite3').Database) => void }} Migration */

/** @type {Migration[]} */
const MIGRATIONS = [
    {
        version: 1,
        name: 'init_ssot_schema',
        up: `
            CREATE TABLE IF NOT EXISTS schema_migrations (
                version INTEGER PRIMARY KEY,
                name TEXT NOT NULL,
                applied_at_ms INTEGER NOT NULL
            );

            CREATE TABLE IF NOT EXISTS missions (
                id TEXT PRIMARY KEY,
                title TEXT NOT NULL,
                description TEXT NOT NULL DEFAULT '',
                status TEXT NOT NULL,
                autonomy_mode TEXT NOT NULL,
                policy_json TEXT NOT NULL,
                context_json TEXT NOT NULL DEFAULT '{}',
                created_at_ms INTEGER NOT NULL,
                updated_at_ms INTEGER NOT NULL,
                started_at_ms INTEGER NULL,
                completed_at_ms INTEGER NULL
            );

            CREATE INDEX IF NOT EXISTS idx_missions_status ON missions(status);
            CREATE INDEX IF NOT EXISTS idx_missions_updated ON missions(updated_at_ms);

            CREATE TABLE IF NOT EXISTS tasks (
                id TEXT PRIMARY KEY,
                mission_id TEXT NULL,

                stage TEXT NOT NULL,
                status TEXT NOT NULL,

                priority INTEGER NOT NULL,
                target TEXT NOT NULL,
                model TEXT NULL,

                execute_after_ms INTEGER NULL,
                attempts INTEGER NOT NULL DEFAULT 0,
                last_error TEXT NULL,
                last_correlation_id TEXT NULL,

                locked_by TEXT NULL,
                locked_at_ms INTEGER NULL,
                lock_expires_at_ms INTEGER NULL,

                spec_user_message TEXT NOT NULL,
                spec_system_message TEXT NOT NULL DEFAULT '',

                task_json TEXT NOT NULL,
                result_json TEXT NULL,

                created_at_ms INTEGER NOT NULL,
                updated_at_ms INTEGER NOT NULL,
                started_at_ms INTEGER NULL,
                completed_at_ms INTEGER NULL,
                paused_at_ms INTEGER NULL,
                cancelled_at_ms INTEGER NULL,
                failed_at_ms INTEGER NULL,

                FOREIGN KEY (mission_id) REFERENCES missions(id) ON DELETE SET NULL
            );

            CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
            CREATE INDEX IF NOT EXISTS idx_tasks_stage_status ON tasks(stage, status);
            CREATE INDEX IF NOT EXISTS idx_tasks_mission_status ON tasks(mission_id, status);
            CREATE INDEX IF NOT EXISTS idx_tasks_execute_after ON tasks(execute_after_ms);
            CREATE INDEX IF NOT EXISTS idx_tasks_lock_expires ON tasks(lock_expires_at_ms);
            CREATE INDEX IF NOT EXISTS idx_tasks_created ON tasks(created_at_ms);

            CREATE TABLE IF NOT EXISTS task_dependencies (
                task_id TEXT NOT NULL,
                depends_on_task_id TEXT NOT NULL,
                PRIMARY KEY (task_id, depends_on_task_id),
                FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE,
                FOREIGN KEY (depends_on_task_id) REFERENCES tasks(id) ON DELETE RESTRICT
            );

            CREATE INDEX IF NOT EXISTS idx_task_deps_parent ON task_dependencies(depends_on_task_id);

            CREATE TABLE IF NOT EXISTS events (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                entity_type TEXT NOT NULL,
                entity_id TEXT NOT NULL,
                ts_ms INTEGER NOT NULL,
                actor_type TEXT NOT NULL,
                actor_id TEXT NULL,
                event_type TEXT NOT NULL,
                payload_json TEXT NOT NULL,
                dedup_key TEXT NULL
            );

            CREATE UNIQUE INDEX IF NOT EXISTS idx_events_dedup_key ON events(dedup_key);
            CREATE INDEX IF NOT EXISTS idx_events_entity ON events(entity_type, entity_id, ts_ms);
        `,
    },
    {
        version: 2,
        name: 'artifacts_and_attempts',
        upFn: db => {
            // Artifacts: metadata + ponteiro para storage (FS, por enquanto).
            db.exec(`
                CREATE TABLE IF NOT EXISTS artifacts (
                    id TEXT PRIMARY KEY,
                    kind TEXT NOT NULL,
                    mime TEXT NOT NULL,
                    size_bytes INTEGER NOT NULL,
                    sha256 TEXT NULL,
                    storage_uri TEXT NOT NULL,
                    created_at_ms INTEGER NOT NULL,
                    created_by TEXT NULL
                );

                CREATE INDEX IF NOT EXISTS idx_artifacts_kind_created ON artifacts(kind, created_at_ms);
                CREATE INDEX IF NOT EXISTS idx_artifacts_sha256 ON artifacts(sha256);
            `);

            // Attempts: 1 dispatch (correlationId) = 1 attempt.
            db.exec(`
                CREATE TABLE IF NOT EXISTS task_attempts (
                    id TEXT PRIMARY KEY, -- attempt_id == correlation_id
                    task_id TEXT NOT NULL,
                    mission_id TEXT NULL,
                    status TEXT NOT NULL,
                    worker_id TEXT NULL,
                    created_at_ms INTEGER NOT NULL,
                    started_at_ms INTEGER NULL,
                    ended_at_ms INTEGER NULL,

                    rendered_prompt_artifact_id TEXT NULL,
                    response_text_artifact_id TEXT NULL,
                    response_v2_json_artifact_id TEXT NULL,
                    response_md_artifact_id TEXT NULL,
                    response_html_artifact_id TEXT NULL,

                    error TEXT NULL,
                    driver_target TEXT NULL,
                    model TEXT NULL,

                    FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE,
                    FOREIGN KEY (mission_id) REFERENCES missions(id) ON DELETE SET NULL
                );

                CREATE INDEX IF NOT EXISTS idx_task_attempts_task ON task_attempts(task_id, created_at_ms);
                CREATE INDEX IF NOT EXISTS idx_task_attempts_status ON task_attempts(status);
            `);

            // tasks: add optional linkage columns (best-effort idempotent).
            const cols = new Set(
                db
                    .prepare("PRAGMA table_info('tasks')")
                    .all()
                    .map(/** @param {any} r */ r => String(r.name))
            );

            if (!cols.has('prompt_template_artifact_id')) {
                db.exec('ALTER TABLE tasks ADD COLUMN prompt_template_artifact_id TEXT NULL;');
            }
            if (!cols.has('latest_attempt_id')) {
                db.exec('ALTER TABLE tasks ADD COLUMN latest_attempt_id TEXT NULL;');
            }
            if (!cols.has('latest_rendered_prompt_artifact_id')) {
                db.exec('ALTER TABLE tasks ADD COLUMN latest_rendered_prompt_artifact_id TEXT NULL;');
            }
            if (!cols.has('latest_response_v2_json_artifact_id')) {
                db.exec('ALTER TABLE tasks ADD COLUMN latest_response_v2_json_artifact_id TEXT NULL;');
            }

            db.exec(`
                CREATE INDEX IF NOT EXISTS idx_tasks_latest_attempt ON tasks(latest_attempt_id);
            `);
        },
    },
    {
        version: 3,
        name: 'blocked_and_attempt_heartbeats',
        upFn: db => {
            // tasks: add BLOCKED metadata columns (idempotent).
            const taskCols = new Set(
                db
                    .prepare("PRAGMA table_info('tasks')")
                    .all()
                    .map(/** @param {any} r */ r => String(r.name))
            );
            if (!taskCols.has('blocked_reason')) {
                db.exec('ALTER TABLE tasks ADD COLUMN blocked_reason TEXT NULL;');
            }
            if (!taskCols.has('blocked_at_ms')) {
                db.exec('ALTER TABLE tasks ADD COLUMN blocked_at_ms INTEGER NULL;');
            }
            if (!taskCols.has('blocked_details_json')) {
                db.exec('ALTER TABLE tasks ADD COLUMN blocked_details_json TEXT NULL;');
            }

            // task_attempts: add failure taxonomy + heartbeat fields (idempotent).
            const attemptCols = new Set(
                db
                    .prepare("PRAGMA table_info('task_attempts')")
                    .all()
                    .map(/** @param {any} r */ r => String(r.name))
            );
            if (!attemptCols.has('reason_class')) {
                db.exec('ALTER TABLE task_attempts ADD COLUMN reason_class TEXT NULL;');
            }
            if (!attemptCols.has('count_attempt')) {
                db.exec('ALTER TABLE task_attempts ADD COLUMN count_attempt INTEGER NOT NULL DEFAULT 0;');
            }
            if (!attemptCols.has('last_heartbeat_at_ms')) {
                db.exec('ALTER TABLE task_attempts ADD COLUMN last_heartbeat_at_ms INTEGER NULL;');
            }

            db.exec(`
                CREATE INDEX IF NOT EXISTS idx_tasks_blocked_reason ON tasks(blocked_reason);
                CREATE INDEX IF NOT EXISTS idx_attempts_reason_class ON task_attempts(reason_class);
                CREATE INDEX IF NOT EXISTS idx_attempts_last_heartbeat ON task_attempts(last_heartbeat_at_ms);
            `);
        },
    },
    {
        version: 4,
        name: 'attempt_diagnostics_and_failure_codes',
        upFn: db => {
            const attemptCols = new Set(
                db
                    .prepare("PRAGMA table_info('task_attempts')")
                    .all()
                    .map(/** @param {any} r */ r => String(r.name))
            );
            if (!attemptCols.has('reason_code')) {
                db.exec('ALTER TABLE task_attempts ADD COLUMN reason_code TEXT NULL;');
            }
            if (!attemptCols.has('cause_layer')) {
                db.exec('ALTER TABLE task_attempts ADD COLUMN cause_layer TEXT NULL;');
            }
            if (!attemptCols.has('diagnostic_artifacts_json')) {
                db.exec('ALTER TABLE task_attempts ADD COLUMN diagnostic_artifacts_json TEXT NULL;');
            }
            if (!attemptCols.has('diagnosis_json')) {
                db.exec('ALTER TABLE task_attempts ADD COLUMN diagnosis_json TEXT NULL;');
            }

            db.exec(`
                CREATE INDEX IF NOT EXISTS idx_attempts_reason_code ON task_attempts(reason_code);
                CREATE INDEX IF NOT EXISTS idx_attempts_cause_layer ON task_attempts(cause_layer);
            `);
        },
    },
    {
        version: 5,
        name: 'tasks_workflow_fields',
        upFn: db => {
            const taskCols = new Set(
                db
                    .prepare("PRAGMA table_info('tasks')")
                    .all()
                    .map(/** @param {any} r */ r => String(r.name))
            );

            if (!taskCols.has('parent_id')) {
                db.exec('ALTER TABLE tasks ADD COLUMN parent_id TEXT NULL;');
            }
            if (!taskCols.has('workflow_id')) {
                db.exec('ALTER TABLE tasks ADD COLUMN workflow_id TEXT NULL;');
            }

            db.exec(`
                CREATE INDEX IF NOT EXISTS idx_tasks_parent ON tasks(parent_id, updated_at_ms);
                CREATE INDEX IF NOT EXISTS idx_tasks_workflow ON tasks(workflow_id, updated_at_ms);
            `);

            // Best-effort backfill from task_json (requires SQLite JSON1).
            try {
                const probe = /** @type {any} */ (db.prepare("SELECT json_extract('{\"a\":1}', '$.a') AS a").get());
                const jsonOk = probe && Number(probe.a) === 1;
                if (jsonOk) {
                    db.exec(`
                        UPDATE tasks
                        SET parent_id = json_extract(task_json, '$.meta.parent_id')
                        WHERE parent_id IS NULL
                          AND json_extract(task_json, '$.meta.parent_id') IS NOT NULL;
                    `);
                    db.exec(`
                        UPDATE tasks
                        SET workflow_id = json_extract(task_json, '$.meta.workflow_id')
                        WHERE workflow_id IS NULL
                          AND json_extract(task_json, '$.meta.workflow_id') IS NOT NULL;
                    `);
                }
            } catch (_) {
                // Skip backfill if JSON1 is unavailable.
            }
        },
    },
    {
        version: 6,
        name: 'control_plane_and_rbac',
        up: `
            CREATE TABLE IF NOT EXISTS mission_steps (
                id TEXT PRIMARY KEY,
                mission_id TEXT NOT NULL,
                step_id TEXT NOT NULL,
                step_index INTEGER NOT NULL,
                title TEXT NOT NULL DEFAULT '',
                status TEXT NOT NULL DEFAULT 'PENDING',
                current_task_id TEXT NULL,
                last_task_id TEXT NULL,
                attempt_seq INTEGER NOT NULL DEFAULT 0,
                version INTEGER NOT NULL DEFAULT 1,
                updated_at_ms INTEGER NOT NULL,
                UNIQUE (mission_id, step_id, attempt_seq),
                FOREIGN KEY (mission_id) REFERENCES missions(id) ON DELETE CASCADE,
                FOREIGN KEY (current_task_id) REFERENCES tasks(id) ON DELETE SET NULL,
                FOREIGN KEY (last_task_id) REFERENCES tasks(id) ON DELETE SET NULL
            );

            CREATE INDEX IF NOT EXISTS idx_mission_steps_mission ON mission_steps(mission_id, step_index);
            CREATE INDEX IF NOT EXISTS idx_mission_steps_status ON mission_steps(status, updated_at_ms);

            CREATE TABLE IF NOT EXISTS control_operations (
                id TEXT PRIMARY KEY,
                command TEXT NOT NULL,
                entity_type TEXT NOT NULL,
                entity_id TEXT NOT NULL,
                actor_id TEXT NULL,
                actor_role TEXT NULL,
                reason TEXT NOT NULL,
                idempotency_key TEXT NOT NULL UNIQUE,
                status TEXT NOT NULL,
                payload_json TEXT NOT NULL,
                result_json TEXT NULL,
                error_code TEXT NULL,
                error_message TEXT NULL,
                created_at_ms INTEGER NOT NULL,
                updated_at_ms INTEGER NOT NULL
            );

            CREATE INDEX IF NOT EXISTS idx_control_ops_entity ON control_operations(entity_type, entity_id, updated_at_ms);
            CREATE INDEX IF NOT EXISTS idx_control_ops_status ON control_operations(status, updated_at_ms);

            CREATE TABLE IF NOT EXISTS audit_diffs (
                id TEXT PRIMARY KEY,
                operation_id TEXT NOT NULL,
                entity_type TEXT NOT NULL,
                entity_id TEXT NOT NULL,
                before_json TEXT NOT NULL,
                after_json TEXT NOT NULL,
                created_at_ms INTEGER NOT NULL,
                FOREIGN KEY (operation_id) REFERENCES control_operations(id) ON DELETE CASCADE
            );

            CREATE INDEX IF NOT EXISTS idx_audit_diffs_operation ON audit_diffs(operation_id);
            CREATE INDEX IF NOT EXISTS idx_audit_diffs_entity ON audit_diffs(entity_type, entity_id, created_at_ms);

            CREATE TABLE IF NOT EXISTS user_preferences (
                user_id TEXT PRIMARY KEY,
                layout_json TEXT NOT NULL DEFAULT '{}',
                columns_json TEXT NOT NULL DEFAULT '{}',
                filters_json TEXT NOT NULL DEFAULT '{}',
                density TEXT NOT NULL DEFAULT 'comfortable',
                shortcuts_json TEXT NOT NULL DEFAULT '{}',
                alerts_json TEXT NOT NULL DEFAULT '{}',
                updated_at_ms INTEGER NOT NULL
            );

            CREATE TABLE IF NOT EXISTS rbac_users (
                id TEXT PRIMARY KEY,
                username TEXT NOT NULL UNIQUE,
                password_hash TEXT NOT NULL,
                active INTEGER NOT NULL DEFAULT 1,
                created_at_ms INTEGER NOT NULL,
                updated_at_ms INTEGER NOT NULL
            );

            CREATE TABLE IF NOT EXISTS rbac_roles (
                id TEXT PRIMARY KEY,
                role_name TEXT NOT NULL UNIQUE,
                description TEXT NOT NULL DEFAULT ''
            );

            CREATE TABLE IF NOT EXISTS rbac_permissions (
                id TEXT PRIMARY KEY,
                permission TEXT NOT NULL UNIQUE,
                description TEXT NOT NULL DEFAULT ''
            );

            CREATE TABLE IF NOT EXISTS rbac_user_role (
                user_id TEXT NOT NULL,
                role_id TEXT NOT NULL,
                PRIMARY KEY (user_id, role_id),
                FOREIGN KEY (user_id) REFERENCES rbac_users(id) ON DELETE CASCADE,
                FOREIGN KEY (role_id) REFERENCES rbac_roles(id) ON DELETE CASCADE
            );

            CREATE TABLE IF NOT EXISTS rbac_role_permission (
                role_id TEXT NOT NULL,
                permission_id TEXT NOT NULL,
                PRIMARY KEY (role_id, permission_id),
                FOREIGN KEY (role_id) REFERENCES rbac_roles(id) ON DELETE CASCADE,
                FOREIGN KEY (permission_id) REFERENCES rbac_permissions(id) ON DELETE CASCADE
            );
        `,
    },
    {
        version: 7,
        name: 'audit_agent_and_inference_config',
        up: `
            CREATE TABLE IF NOT EXISTS audit_jobs (
                id TEXT PRIMARY KEY,
                status TEXT NOT NULL,
                kind TEXT NOT NULL,
                priority INTEGER NOT NULL DEFAULT 50,
                trigger_type TEXT NOT NULL,
                trigger_ref TEXT NULL,
                scope_json TEXT NOT NULL DEFAULT '{}',
                policy_json TEXT NOT NULL DEFAULT '{}',
                mission_id TEXT NULL,
                current_step TEXT NULL,
                created_by TEXT NULL,
                assigned_to TEXT NULL,
                attempt_seq INTEGER NOT NULL DEFAULT 0,
                result_json TEXT NULL,
                error_json TEXT NULL,
                created_at_ms INTEGER NOT NULL,
                updated_at_ms INTEGER NOT NULL,
                started_at_ms INTEGER NULL,
                completed_at_ms INTEGER NULL
            );

            CREATE INDEX IF NOT EXISTS idx_audit_jobs_status_updated ON audit_jobs(status, updated_at_ms);
            CREATE INDEX IF NOT EXISTS idx_audit_jobs_kind_updated ON audit_jobs(kind, updated_at_ms);
            CREATE INDEX IF NOT EXISTS idx_audit_jobs_trigger_updated ON audit_jobs(trigger_type, updated_at_ms);

            CREATE TABLE IF NOT EXISTS audit_job_runs (
                id TEXT PRIMARY KEY,
                job_id TEXT NOT NULL,
                attempt_seq INTEGER NOT NULL,
                status TEXT NOT NULL,
                executor TEXT NOT NULL DEFAULT 'audit-agent',
                llm_model TEXT NULL,
                llm_provider TEXT NULL,
                token_usage_json TEXT NULL,
                metrics_json TEXT NULL,
                error_json TEXT NULL,
                started_at_ms INTEGER NOT NULL,
                completed_at_ms INTEGER NULL,
                FOREIGN KEY (job_id) REFERENCES audit_jobs(id) ON DELETE CASCADE
            );

            CREATE INDEX IF NOT EXISTS idx_audit_job_runs_job_attempt ON audit_job_runs(job_id, attempt_seq);
            CREATE INDEX IF NOT EXISTS idx_audit_job_runs_status_started ON audit_job_runs(status, started_at_ms);

            CREATE TABLE IF NOT EXISTS inference_backends (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL UNIQUE,
                kind TEXT NOT NULL,
                enabled INTEGER NOT NULL DEFAULT 1,
                base_url TEXT NULL,
                auth_ref TEXT NULL,
                health_policy_json TEXT NOT NULL DEFAULT '{}',
                transport_policy_json TEXT NOT NULL DEFAULT '{}',
                created_at_ms INTEGER NOT NULL,
                updated_at_ms INTEGER NOT NULL
            );

            CREATE TABLE IF NOT EXISTS inference_models (
                id TEXT PRIMARY KEY,
                backend_id TEXT NOT NULL,
                model_name TEXT NOT NULL,
                alias TEXT NOT NULL UNIQUE,
                enabled INTEGER NOT NULL DEFAULT 1,
                capabilities_json TEXT NOT NULL DEFAULT '{}',
                resource_profile_json TEXT NOT NULL DEFAULT '{}',
                safety_profile_json TEXT NOT NULL DEFAULT '{}',
                default_params_json TEXT NOT NULL DEFAULT '{}',
                created_at_ms INTEGER NOT NULL,
                updated_at_ms INTEGER NOT NULL,
                FOREIGN KEY (backend_id) REFERENCES inference_backends(id) ON DELETE CASCADE
            );

            CREATE INDEX IF NOT EXISTS idx_inference_models_backend_enabled ON inference_models(backend_id, enabled);

            CREATE TABLE IF NOT EXISTS inference_profiles (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL UNIQUE,
                purpose TEXT NOT NULL DEFAULT '',
                enabled INTEGER NOT NULL DEFAULT 1,
                preferred_backend_id TEXT NULL,
                preferred_model_id TEXT NULL,
                fallback_chain_json TEXT NOT NULL DEFAULT '[]',
                generation_params_json TEXT NOT NULL DEFAULT '{}',
                budget_policy_json TEXT NOT NULL DEFAULT '{}',
                validation_policy_json TEXT NOT NULL DEFAULT '{}',
                created_at_ms INTEGER NOT NULL,
                updated_at_ms INTEGER NOT NULL,
                FOREIGN KEY (preferred_backend_id) REFERENCES inference_backends(id) ON DELETE SET NULL,
                FOREIGN KEY (preferred_model_id) REFERENCES inference_models(id) ON DELETE SET NULL
            );

            CREATE TABLE IF NOT EXISTS inference_client_policies (
                id TEXT PRIMARY KEY,
                client_tag TEXT NOT NULL UNIQUE,
                enabled INTEGER NOT NULL DEFAULT 1,
                profile_id TEXT NULL,
                allowed_backends_json TEXT NOT NULL DEFAULT '[]',
                allowed_models_json TEXT NOT NULL DEFAULT '[]',
                max_parallel INTEGER NOT NULL DEFAULT 1,
                rate_limit_json TEXT NOT NULL DEFAULT '{}',
                timeout_ms INTEGER NULL,
                token_budget_json TEXT NOT NULL DEFAULT '{}',
                priority INTEGER NOT NULL DEFAULT 50,
                degraded_behavior_json TEXT NOT NULL DEFAULT '{}',
                approval_policy_json TEXT NOT NULL DEFAULT '{}',
                created_at_ms INTEGER NOT NULL,
                updated_at_ms INTEGER NOT NULL,
                FOREIGN KEY (profile_id) REFERENCES inference_profiles(id) ON DELETE SET NULL
            );

            CREATE INDEX IF NOT EXISTS idx_inference_client_policies_enabled ON inference_client_policies(enabled, priority);
        `,
    },
    {
        version: 8,
        name: 'audit_agent_findings_patches_watch_rules',
        up: `
            CREATE TABLE IF NOT EXISTS audit_job_findings (
                id TEXT PRIMARY KEY,
                job_id TEXT NOT NULL,
                severity TEXT NOT NULL,
                category TEXT NOT NULL,
                title TEXT NOT NULL,
                source TEXT NOT NULL,
                contract_id TEXT NULL,
                dedup_key TEXT NULL,
                status TEXT NOT NULL DEFAULT 'open',
                evidence_json TEXT NOT NULL DEFAULT '{}',
                created_at_ms INTEGER NOT NULL,
                updated_at_ms INTEGER NOT NULL,
                FOREIGN KEY (job_id) REFERENCES audit_jobs(id) ON DELETE CASCADE
            );

            CREATE INDEX IF NOT EXISTS idx_audit_findings_job ON audit_job_findings(job_id, created_at_ms DESC);
            CREATE INDEX IF NOT EXISTS idx_audit_findings_status ON audit_job_findings(status, updated_at_ms DESC);
            CREATE UNIQUE INDEX IF NOT EXISTS idx_audit_findings_dedup ON audit_job_findings(job_id, dedup_key);

            CREATE TABLE IF NOT EXISTS audit_patch_proposals (
                id TEXT PRIMARY KEY,
                job_id TEXT NOT NULL,
                status TEXT NOT NULL,
                patch_unified_diff TEXT NOT NULL DEFAULT '',
                patch_summary_json TEXT NOT NULL DEFAULT '{}',
                risk_score REAL NULL,
                dry_run_result_json TEXT NULL,
                approval_required INTEGER NOT NULL DEFAULT 1,
                approved_by TEXT NULL,
                approved_at_ms INTEGER NULL,
                applied_by TEXT NULL,
                applied_at_ms INTEGER NULL,
                rollback_patch TEXT NULL,
                created_at_ms INTEGER NOT NULL,
                updated_at_ms INTEGER NOT NULL,
                FOREIGN KEY (job_id) REFERENCES audit_jobs(id) ON DELETE CASCADE
            );

            CREATE INDEX IF NOT EXISTS idx_audit_patches_job ON audit_patch_proposals(job_id, created_at_ms DESC);
            CREATE INDEX IF NOT EXISTS idx_audit_patches_status ON audit_patch_proposals(status, updated_at_ms DESC);

            CREATE TABLE IF NOT EXISTS audit_watch_rules (
                id TEXT PRIMARY KEY,
                enabled INTEGER NOT NULL DEFAULT 1,
                name TEXT NOT NULL,
                trigger_type TEXT NOT NULL,
                scope_json TEXT NOT NULL DEFAULT '{}',
                schedule_cron TEXT NULL,
                debounce_ms INTEGER NOT NULL DEFAULT 5000,
                cooldown_ms INTEGER NOT NULL DEFAULT 30000,
                action_policy_json TEXT NOT NULL DEFAULT '{}',
                created_at_ms INTEGER NOT NULL,
                updated_at_ms INTEGER NOT NULL
            );

            CREATE INDEX IF NOT EXISTS idx_audit_watch_rules_enabled ON audit_watch_rules(enabled, updated_at_ms DESC);
        `,
    },
    {
        version: 9,
        name: 'diagnostic_agent_jobs_and_reports',
        up: `
            CREATE TABLE IF NOT EXISTS diagnostic_jobs (
                id TEXT PRIMARY KEY,
                status TEXT NOT NULL,
                kind TEXT NOT NULL,
                priority INTEGER NOT NULL DEFAULT 50,
                trigger_type TEXT NOT NULL,
                trigger_ref TEXT NULL,
                scope_json TEXT NOT NULL DEFAULT '{}',
                target_path TEXT NULL,
                analysis_type TEXT NULL,
                config_json TEXT NOT NULL DEFAULT '{}',
                created_by TEXT NULL,
                assigned_to TEXT NULL,
                attempt_seq INTEGER NOT NULL DEFAULT 0,
                result_json TEXT NULL,
                error_json TEXT NULL,
                created_at_ms INTEGER NOT NULL,
                updated_at_ms INTEGER NOT NULL,
                started_at_ms INTEGER NULL,
                completed_at_ms INTEGER NULL
            );

            CREATE INDEX IF NOT EXISTS idx_diagnostic_jobs_status_updated ON diagnostic_jobs(status, updated_at_ms);
            CREATE INDEX IF NOT EXISTS idx_diagnostic_jobs_kind_updated ON diagnostic_jobs(kind, updated_at_ms);
            CREATE INDEX IF NOT EXISTS idx_diagnostic_jobs_trigger_updated ON diagnostic_jobs(trigger_type, updated_at_ms);

            CREATE TABLE IF NOT EXISTS diagnostic_reports (
                id TEXT PRIMARY KEY,
                job_id TEXT NOT NULL,
                report_type TEXT NOT NULL,
                format TEXT NOT NULL DEFAULT 'json',
                title TEXT NOT NULL,
                summary TEXT NULL,
                content_json TEXT NOT NULL DEFAULT '{}',
                findings_count INTEGER NOT NULL DEFAULT 0,
                severity_counts_json TEXT NOT NULL DEFAULT '{}',
                llm_model_used TEXT NULL,
                llm_prompt_tokens INTEGER NULL,
                llm_completion_tokens INTEGER NULL,
                duration_ms INTEGER NULL,
                created_at_ms INTEGER NOT NULL,
                FOREIGN KEY (job_id) REFERENCES diagnostic_jobs(id) ON DELETE CASCADE
            );

            CREATE INDEX IF NOT EXISTS idx_diagnostic_reports_job ON diagnostic_reports(job_id, created_at_ms DESC);
            CREATE INDEX IF NOT EXISTS idx_diagnostic_reports_type ON diagnostic_reports(report_type, created_at_ms DESC);
        `,
    },
];

export { MIGRATIONS };
