// @ts-check
import { ref, computed } from 'vue';

/** @typedef {{ baseUrl?: string }} UseAuditOptions */

/**
 * Composable para interação com APIs do Audit Agent
 * @param {UseAuditOptions} options
  * @returns {any}
 */
export function useAudit(options = {}) {
    const baseUrl = options.baseUrl || '/api/dashboard';

    /** @type {import('vue').Ref<any[]>} */
    const jobs = ref([]);
    /** @type {import('vue').Ref<any|null>} */
    const currentJob = ref(null);
    /** @type {import('vue').Ref<any[]>} */
    const patches = ref([]);
    /** @type {import('vue').Ref<any[]>} */
    const findings = ref([]);
    /** @type {import('vue').Ref<any[]>} */
    const watchRules = ref([]);
    /** @type {import('vue').Ref<boolean>} */
    const loading = ref(false);
    /** @type {import('vue').Ref<string|null>} */
    const error = ref(null);

    /**
     * Fetch wrapper com error handling
     * @param {string} url
     * @param {RequestInit} opts
     * @returns {Promise<any>}
     */
    async function fetchApi(url, opts = {}) {
        const res = await fetch(`${baseUrl}${url}`, {
            ...opts,
            headers: {
                'Content-Type': 'application/json',
                ...opts.headers,
            },
        });
        if (!res.ok) {
            const err = await res.json().catch(() => ({ message: res.statusText }));
            throw new Error(err.message || `HTTP ${res.status}`);
        }
        return res.json();
    }

    // ============ JOBS ============

    /**
     * Lista todos os jobs de auditoria
     * @returns {Promise<any[]>}
     */
    async function listJobs() {
        loading.value = true;
        error.value = null;
        try {
            const data = await fetchApi('/audit/jobs');
            jobs.value = data.jobs || [];
            return jobs.value;
        } catch (e) {
            error.value = e.message;
            throw e;
        } finally {
            loading.value = false;
        }
    }

    /**
     * Detalhes de um job específico
     * @param {string} jobId
     * @param {object} [query]
     * @returns {Promise<any>}
     */
    async function getJob(jobId, query = {}) {
        loading.value = true;
        error.value = null;
        try {
            const params = new URLSearchParams(query).toString();
            const url = `/audit/jobs/${jobId}${params ? `?${params}` : ''}`;
            const data = await fetchApi(url);
            currentJob.value = data;
            return data;
        } catch (e) {
            error.value = e.message;
            throw e;
        } finally {
            loading.value = false;
        }
    }

    /**
     * Cria um novo job de auditoria
     * @param {object} payload
     * @returns {Promise<any>}
     */
    async function createJob(payload) {
        loading.value = true;
        error.value = null;
        try {
            const data = await fetchApi('/audit/jobs', {
                method: 'POST',
                body: JSON.stringify(payload),
            });
            return data;
        } catch (e) {
            error.value = e.message;
            throw e;
        } finally {
            loading.value = false;
        }
    }

    /**
     * Executa um job existente
     * @param {string} jobId
     * @returns {Promise<any>}
     */
    async function runJob(jobId) {
        loading.value = true;
        error.value = null;
        try {
            const data = await fetchApi(`/audit/jobs/${jobId}/run`, {
                method: 'POST',
            });
            return data;
        } catch (e) {
            error.value = e.message;
            throw e;
        } finally {
            loading.value = false;
        }
    }

    /**
     * Cancela um job em execução
     * @param {string} jobId
     * @returns {Promise<any>}
     */
    async function cancelJob(jobId) {
        loading.value = true;
        error.value = null;
        try {
            const data = await fetchApi(`/audit/jobs/${jobId}/cancel`, {
                method: 'POST',
            });
            return data;
        } catch (e) {
            error.value = e.message;
            throw e;
        } finally {
            loading.value = false;
        }
    }

    // ============ PATCHES ============

    /**
     * Lista patches de um job
     * @param {string} jobId
     * @param {object} [query]
     * @returns {Promise<any[]>}
     */
    async function listPatches(jobId, query = {}) {
        loading.value = true;
        error.value = null;
        try {
            const params = new URLSearchParams(query).toString();
            const url = `/audit/jobs/${jobId}/patches${params ? `?${params}` : ''}`;
            const data = await fetchApi(url);
            patches.value = data.patches || [];
            return patches.value;
        } catch (e) {
            error.value = e.message;
            throw e;
        } finally {
            loading.value = false;
        }
    }

    /**
     * Detalhes de um patch específico
     * @param {string} patchId
     * @param {object} [query]
     * @returns {Promise<any>}
     */
    async function getPatch(patchId, query = {}) {
        loading.value = true;
        error.value = null;
        try {
            const params = new URLSearchParams(query).toString();
            const url = `/audit/patches/${patchId}${params ? `?${params}` : ''}`;
            const data = await fetchApi(url);
            return data;
        } catch (e) {
            error.value = e.message;
            throw e;
        } finally {
            loading.value = false;
        }
    }

    /**
     * Aprova um patch
     * @param {string} patchId
     * @returns {Promise<any>}
     */
    async function approvePatch(patchId) {
        loading.value = true;
        error.value = null;
        try {
            const data = await fetchApi(`/audit/patches/${patchId}/approve`, {
                method: 'POST',
            });
            return data;
        } catch (e) {
            error.value = e.message;
            throw e;
        } finally {
            loading.value = false;
        }
    }

    /**
     * Rejeita um patch
     * @param {string} patchId
     * @returns {Promise<any>}
     */
    async function rejectPatch(patchId) {
        loading.value = true;
        error.value = null;
        try {
            const data = await fetchApi(`/audit/patches/${patchId}/reject`, {
                method: 'POST',
            });
            return data;
        } catch (e) {
            error.value = e.message;
            throw e;
        } finally {
            loading.value = false;
        }
    }

    /**
     * Aplica um patch aprovado
     * @param {string} patchId
     * @returns {Promise<any>}
     */
    async function applyPatch(patchId) {
        loading.value = true;
        error.value = null;
        try {
            const data = await fetchApi(`/audit/patches/${patchId}/apply`, {
                method: 'POST',
            });
            return data;
        } catch (e) {
            error.value = e.message;
            throw e;
        } finally {
            loading.value = false;
        }
    }

    /**
     * Valida readiness de apply
     * @param {string} patchId
     * @returns {Promise<any>}
     */
    async function getPatchApplyReadiness(patchId) {
        loading.value = true;
        error.value = null;
        try {
            const data = await fetchApi(`/audit/patches/${patchId}/apply-readiness`);
            return data;
        } catch (e) {
            error.value = e.message;
            throw e;
        } finally {
            loading.value = false;
        }
    }

    // ============ FINDINGS ============

    /**
     * Lista findings de um job
     * @param {string} jobId
     * @returns {Promise<any[]>}
     */
    async function listFindings(jobId) {
        loading.value = true;
        error.value = null;
        try {
            const data = await fetchApi(`/audit/jobs/${jobId}/findings`);
            findings.value = data.findings || [];
            return findings.value;
        } catch (e) {
            error.value = e.message;
            throw e;
        } finally {
            loading.value = false;
        }
    }

    // ============ WATCH RULES ============

    /**
     * Lista watch rules
     * @returns {Promise<any[]>}
     */
    async function listWatchRules() {
        loading.value = true;
        error.value = null;
        try {
            const data = await fetchApi('/audit/watch-rules');
            watchRules.value = data.rules || [];
            return watchRules.value;
        } catch (e) {
            error.value = e.message;
            throw e;
        } finally {
            loading.value = false;
        }
    }

    /**
     * Cria ou atualiza watch rule
     * @param {object} payload
     * @returns {Promise<any>}
     */
    async function upsertWatchRule(payload) {
        loading.value = true;
        error.value = null;
        try {
            const data = await fetchApi('/audit/watch-rules', {
                method: 'POST',
                body: JSON.stringify(payload),
            });
            return data;
        } catch (e) {
            error.value = e.message;
            throw e;
        } finally {
            loading.value = false;
        }
    }

    /**
     * Toggle watch rule
     * @param {string} ruleId
     * @returns {Promise<any>}
     */
    async function toggleWatchRule(ruleId) {
        loading.value = true;
        error.value = null;
        try {
            const data = await fetchApi(`/audit/watch-rules/${ruleId}/toggle`, {
                method: 'POST',
            });
            return data;
        } catch (e) {
            error.value = e.message;
            throw e;
        } finally {
            loading.value = false;
        }
    }

    // ============ INFERENCE ============

    /**
     * Lista profiles de inferência
     * @returns {Promise<any[]>}
     */
    async function listInferenceProfiles() {
        loading.value = true;
        error.value = null;
        try {
            const data = await fetchApi('/inference/profiles');
            return data.profiles || [];
        } catch (e) {
            error.value = e.message;
            throw e;
        } finally {
            loading.value = false;
        }
    }

    /**
     * Lista client policies
     * @returns {Promise<any[]>}
     */
    async function listInferenceClientPolicies() {
        loading.value = true;
        error.value = null;
        try {
            const data = await fetchApi('/inference/client-policies');
            return data.policies || [];
        } catch (e) {
            error.value = e.message;
            throw e;
        } finally {
            loading.value = false;
        }
    }

    /**
     * Lista backends de inferência
     * @returns {Promise<any[]>}
     */
    async function listInferenceBackends() {
        loading.value = true;
        error.value = null;
        try {
            const data = await fetchApi('/inference/backends');
            return data.backends || [];
        } catch (e) {
            error.value = e.message;
            throw e;
        } finally {
            loading.value = false;
        }
    }

    /**
     * Lista models de inferência
     * @returns {Promise<any[]>}
     */
    async function listInferenceModels() {
        loading.value = true;
        error.value = null;
        try {
            const data = await fetchApi('/inference/models-db');
            return data.models || [];
        } catch (e) {
            error.value = e.message;
            throw e;
        } finally {
            loading.value = false;
        }
    }

    /**
     * Resumo de inferência
     * @returns {Promise<any>}
     */
    async function getInferenceSummary() {
        loading.value = true;
        error.value = null;
        try {
            const data = await fetchApi('/inference/summary');
            return data;
        } catch (e) {
            error.value = e.message;
            throw e;
        } finally {
            loading.value = false;
        }
    }

    return {
        // State
        jobs,
        currentJob,
        patches,
        findings,
        watchRules,
        loading,
        error,
        // Jobs
        listJobs,
        getJob,
        createJob,
        runJob,
        cancelJob,
        // Patches
        listPatches,
        getPatch,
        approvePatch,
        rejectPatch,
        applyPatch,
        getPatchApplyReadiness,
        // Findings
        listFindings,
        // Watch Rules
        listWatchRules,
        upsertWatchRule,
        toggleWatchRule,
        // Inference
        listInferenceProfiles,
        listInferenceClientPolicies,
        listInferenceBackends,
        listInferenceModels,
        getInferenceSummary,
    };
}
