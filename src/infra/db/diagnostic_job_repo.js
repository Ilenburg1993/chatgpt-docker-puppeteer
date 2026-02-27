// @ts-check

/**
 * Diagnostic Agent Job Repository
 *
 * Repositório para persistência de jobs do Diagnostic Agent.
 * Fornece operações CRUD para diagnostic_jobs e diagnostic_reports.
 *
 * Tabelas:
 * - diagnostic_jobs: Jobs de diagnóstico
 * - diagnostic_reports: Relatórios gerados
 */

import { getDb } from '#infra/db/sqlite.js';

/**
 * Gera timestamp atual em ms
 * @returns {number}
 */
function _now() {
    return Date.now();
}

/**
 * Converte row para DiagnosticJob
 * @param {Object} row
 * @returns {Object|null}
 */
function _rowToJob(row) {
    if (!row) return null;
    return {
        id: String(row.id || ''),
        status: String(row.status || ''),
        kind: String(row.kind || ''),
        priority: Number(row.priority) || 50,
        triggerType: String(row.trigger_type || ''),
        triggerRef: row.trigger_ref ? String(row.trigger_ref) : null,
        scopeJson: row.scope_json ? JSON.parse(row.scope_json) : {},
        targetPath: row.target_path ? String(row.target_path) : null,
        analysisType: row.analysis_type ? String(row.analysis_type) : null,
        configJson: row.config_json ? JSON.parse(row.config_json) : {},
        createdBy: row.created_by ? String(row.created_by) : null,
        assignedTo: row.assigned_to ? String(row.assigned_to) : null,
        attemptSeq: Number(row.attempt_seq) || 0,
        resultJson: row.result_json ? JSON.parse(row.result_json) : null,
        errorJson: row.error_json ? JSON.parse(row.error_json) : null,
        createdAtMs: Number(row.created_at_ms) || 0,
        updatedAtMs: Number(row.updated_at_ms) || 0,
        startedAtMs: row.started_at_ms ? Number(row.started_at_ms) : null,
        completedAtMs: row.completed_at_ms ? Number(row.completed_at_ms) : null,
    };
}

/**
 * Converte row para DiagnosticReport
 * @param {Object} row
 * @returns {Object|null}
 */
function _rowToReport(row) {
    if (!row) return null;
    return {
        id: String(row.id || ''),
        jobId: String(row.job_id || ''),
        reportType: String(row.report_type || ''),
        format: String(row.format || 'json'),
        title: String(row.title || ''),
        summary: row.summary ? String(row.summary) : null,
        contentJson: row.content_json ? JSON.parse(row.content_json) : {},
        findingsCount: Number(row.findings_count) || 0,
        severityCountsJson: row.severity_counts_json ? JSON.parse(row.severity_counts_json) : {},
        llmModelUsed: row.llm_model_used ? String(row.llm_model_used) : null,
        llmPromptTokens: row.llm_prompt_tokens ? Number(row.llm_prompt_tokens) : null,
        llmCompletionTokens: row.llm_completion_tokens ? Number(row.llm_completion_tokens) : null,
        durationMs: row.duration_ms ? Number(row.duration_ms) : null,
        createdAtMs: Number(row.created_at_ms) || 0,
    };
}

/**
 * Cria um novo job de diagnóstico
 * @param {Object} input
 * @returns {Object}
 */
export function createDiagnosticJob(input) {
    const db = getDb();
    const now = _now();
    const id = input.id || `diag-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;

    db.prepare(
        `
        INSERT INTO diagnostic_jobs (
            id, status, kind, priority, trigger_type, trigger_ref,
            scope_json, target_path, analysis_type, config_json,
            created_by, assigned_to, attempt_seq,
            result_json, error_json,
            created_at_ms, updated_at_ms, started_at_ms, completed_at_ms
        ) VALUES (
            @id, @status, @kind, @priority, @trigger_type, @trigger_ref,
            @scope_json, @target_path, @analysis_type, @config_json,
            @created_by, @assigned_to, @attempt_seq,
            @result_json, @error_json,
            @created_at_ms, @updated_at_ms, @started_at_ms, @completed_at_ms
        )
    `
    ).run({
        id,
        status: String(input.status || 'PENDING')
            .trim()
            .toUpperCase(),
        kind: String(input.kind || 'code_analysis').trim(),
        priority: Number(input.priority) || 50,
        triggerType: String(input.trigger_type || 'manual').trim(),
        triggerRef: input.trigger_ref || null,
        scopeJson: JSON.stringify(input.scope_json || {}),
        targetPath: input.target_path || null,
        analysisType: input.analysis_type || null,
        configJson: JSON.stringify(input.config_json || {}),
        createdBy: input.created_by || null,
        assignedTo: input.assigned_to || null,
        attemptSeq: Number(input.attempt_seq) || 0,
        resultJson: input.result_json ? JSON.stringify(input.result_json) : null,
        errorJson: input.error_json ? JSON.stringify(input.error_json) : null,
        created_at_ms: now,
        updated_at_ms: now,
        started_at_ms: input.startedAtMs || null,
        completed_at_ms: input.completedAtMs || null,
    });

    return getDiagnosticJobById(id);
}

/**
 * Obtém um job de diagnóstico pelo ID
 * @param {string} id
 * @returns {Object|null}
 */
export function getDiagnosticJobById(id) {
    const db = getDb();
    const row = db.prepare('SELECT * FROM diagnostic_jobs WHERE id = ?').get(String(id || '').trim());
    return _rowToJob(row);
}

/**
 * Lista jobs de diagnóstico com filtros opcionais
 * @param {Object} [filters]
 * @param {string} [filters.status]
 * @param {string} [filters.kind]
 * @param {string} [filters.triggerType]
 * @param {number} [filters.limit]
 * @param {number} [filters.offset]
 * @returns {Object[]}
 */
export function listDiagnosticJobs(filters = {}) {
    const db = getDb();
    const { status, kind, triggerType, limit = 100, offset = 0 } = filters;

    let whereClause = '';
    const params = {};

    if (status) {
        whereClause = 'WHERE status = @status';
        params.status = status;
    }

    if (kind) {
        whereClause = whereClause ? `${whereClause} AND kind = @kind` : 'WHERE kind = @kind';
        params.kind = kind;
    }

    if (triggerType) {
        whereClause = whereClause
            ? `${whereClause} AND trigger_type = @trigger_type`
            : 'WHERE trigger_type = @trigger_type';
        params.trigger_type = triggerType;
    }

    params.limit = limit;
    params.offset = offset;

    const rows = db
        .prepare(
            `
        SELECT *
        FROM diagnostic_jobs
        ${whereClause}
        ORDER BY updated_at_ms DESC
        LIMIT @limit OFFSET @offset
    `
        )
        .all(params);

    return rows.map(_rowToJob);
}

/**
 * Atualiza um job de diagnóstico
 * @param {string} id
 * @param {Object} updates
 * @returns {Object|null}
 */
export function updateDiagnosticJob(id, updates = {}) {
    const db = getDb();
    const now = _now();

    // Primeiro verifica se o job existe
    const existing = getDiagnosticJobById(id);
    if (!existing) return null;

    // Constrói a query dinamicamente
    const fields = [];
    const params = { id: String(id), updated_at_ms: now };

    if (updates.status !== undefined) {
        fields.push('status = @status');
        params.status = String(updates.status).trim().toUpperCase();
    }
    if (updates.priority !== undefined) {
        fields.push('priority = @priority');
        params.priority = Number(updates.priority);
    }
    if (updates.scopeJson !== undefined) {
        fields.push('scope_json = @scope_json');
        params.scope_json = JSON.stringify(updates.scopeJson);
    }
    if (updates.targetPath !== undefined) {
        fields.push('target_path = @target_path');
        params.target_path = updates.targetPath;
    }
    if (updates.analysisType !== undefined) {
        fields.push('analysis_type = @analysis_type');
        params.analysis_type = updates.analysisType;
    }
    if (updates.configJson !== undefined) {
        fields.push('config_json = @config_json');
        params.config_json = JSON.stringify(updates.configJson);
    }
    if (updates.resultJson !== undefined) {
        fields.push('result_json = @result_json');
        params.result_json = JSON.stringify(updates.resultJson);
    }
    if (updates.errorJson !== undefined) {
        fields.push('error_json = @error_json');
        params.error_json = JSON.stringify(updates.errorJson);
    }
    if (updates.startedAtMs !== undefined) {
        fields.push('started_at_ms = @started_at_ms');
        params.started_at_ms = updates.startedAtMs;
    }
    if (updates.completedAtMs !== undefined) {
        fields.push('completed_at_ms = @completed_at_ms');
        params.completed_at_ms = updates.completedAtMs;
    }

    if (fields.length === 0) {
        return existing;
    }

    fields.push('updated_at_ms = @updated_at_ms');

    db.prepare(
        `
        UPDATE diagnostic_jobs SET
            ${fields.join(', ')}
        WHERE id = @id
    `
    ).run(params);

    return getDiagnosticJobById(id);
}

/**
 * Cria um novo relatório de diagnóstico
 * @param {Object} input
 * @returns {Object}
 */
export function createDiagnosticReport(input) {
    const db = getDb();
    const now = _now();
    const id = input.id || `diagr-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;

    db.prepare(
        `
        INSERT INTO diagnostic_reports (
            id, job_id, report_type, format, title, summary,
            content_json, findings_count, severity_counts_json,
            llm_model_used, llm_prompt_tokens, llm_completion_tokens, duration_ms,
            created_at_ms
        ) VALUES (
            @id, @job_id, @report_type, @format, @title, @summary,
            @content_json, @findings_count, @severity_counts_json,
            @llm_model_used, @llm_prompt_tokens, @llm_completion_tokens, @duration_ms,
            @created_at_ms
        )
    `
    ).run({
        id,
        job_id: String(input.jobId || ''),
        report_type: String(input.reportType || 'code_analysis'),
        format: String(input.format || 'json'),
        title: String(input.title || ''),
        summary: input.summary || null,
        content_json: JSON.stringify(input.contentJson || {}),
        findings_count: Number(input.findingsCount) || 0,
        severity_counts_json: JSON.stringify(input.severityCountsJson || {}),
        llm_model_used: input.llmModelUsed || null,
        llm_prompt_tokens: input.llmPromptTokens || null,
        llm_completion_tokens: input.llmCompletionTokens || null,
        duration_ms: input.durationMs || null,
        created_at_ms: now,
    });

    return getDiagnosticReportById(id);
}

/**
 * Obtém um relatório pelo ID
 * @param {string} id
 * @returns {Object|null}
 */
export function getDiagnosticReportById(id) {
    const db = getDb();
    const row = db.prepare('SELECT * FROM diagnostic_reports WHERE id = ?').get(String(id || '').trim());
    return _rowToReport(row);
}

/**
 * Lista relatórios por job
 * @param {string} jobId
 * @returns {Object[]}
 */
export function listDiagnosticReportsByJob(jobId) {
    const db = getDb();
    const rows = db
        .prepare(
            `
        SELECT *
        FROM diagnostic_reports
        WHERE job_id = ?
        ORDER BY created_at_ms DESC
    `
        )
        .all(String(jobId || '').trim());

    return rows.map(_rowToReport);
}

/**
 * Exporte padrão com todas as funções
 */
export default {
    createDiagnosticJob,
    getDiagnosticJobById,
    listDiagnosticJobs,
    updateDiagnosticJob,
    createDiagnosticReport,
    getDiagnosticReportById,
    listDiagnosticReportsByJob,
};
