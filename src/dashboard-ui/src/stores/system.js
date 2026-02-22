/**
 * Pinia Store: System
 *
 * Gerencia estado do sistema e alertas.
 * - Status de saúde dos componentes
 * - Alertas ativos
 * - Informações do sistema
 */

import { defineStore } from 'pinia';
import { formatHttpError, http } from '@/lib/http';

/** Constante/valor exportado: useSystemStore. */
export const useSystemStore = defineStore('system', {
    state: () => ({
        // Status geral
        overallStatus: 'unknown', // healthy, warning, critical, error, unknown

        // Componentes do sistema
        components: {
            api: { status: 'unknown', message: '' },
            queue: { status: 'unknown', message: '' },
            memory: { status: 'unknown', message: '' },
            kernel: { status: 'unknown', message: '' },
        },

        // Alertas ativos
        alerts: [],

        // Informações do sistema
        systemInfo: {
            platform: '',
            node_version: '',
            arch: '',
            pid: null,
        },

        // Uptime
        uptimeSeconds: 0,

        // Loading
        loading: false,

        // Erro
        error: null,

        // Última atualização
        lastUpdate: null,
    }),

    getters: {
        /**
         * Número de alertas ativos
         */
        alertCount: state => state.alerts.length,

        /**
         * Alertas críticos
         */
        criticalAlerts: state => state.alerts.filter(a => a.severity === 'critical'),

        /**
         * Alertas de warning
         */
        warningAlerts: state => state.alerts.filter(a => a.severity === 'warning'),

        /**
         * Todos os componentes com status
         */
        componentsList: state =>
            Object.entries(state.components).map(([name, data]) => ({
                name,
                ...data,
            })),

        /**
         * Componentes com problema
         */
        problemComponents: state =>
            Object.entries(state.components)
                .filter(([, data]) => data.status !== 'healthy')
                .map(([name, data]) => ({ name, ...data })),

        /**
         * Sistema está saudável
         */
        isHealthy: state => state.overallStatus === 'healthy',

        /**
         * Uptime formatado
         */
        uptimeFormatted: state => {
            const seconds = state.uptimeSeconds;
            const days = Math.floor(seconds / 86400);
            const hours = Math.floor((seconds % 86400) / 3600);
            const minutes = Math.floor((seconds % 3600) / 60);

            if (days > 0) {
                return `${days}d ${hours}h ${minutes}m`;
            }
            if (hours > 0) {
                return `${hours}h ${minutes}m`;
            }
            return `${minutes}m`;
        },
    },

    actions: {
        /**
         * Carrega status de saúde do sistema
         */
        async fetchHealth() {
            this.loading = true;
            this.error = null;

            try {
                const response = await http.get('/api/dashboard/system/health');
                const data = response.data;

                this.overallStatus = data.status || 'unknown';
                this.components = data.components || this.components;
                this.uptimeSeconds = data.uptime_seconds || 0;

                // Carrega alertas separadamente
                await this.fetchAlerts();

                this.lastUpdate = Date.now();
            } catch (error) {
                this.error = formatHttpError(error).message;
                this.overallStatus = 'error';
                console.error('[SystemStore] Erro ao carregar health:', error);
            } finally {
                this.loading = false;
            }
        },

        /**
         * Carrega alertas ativos
         */
        async fetchAlerts() {
            try {
                const response = await http.get('/api/dashboard/alerts');
                this.alerts = response.data.alerts || [];
            } catch (error) {
                console.error('[SystemStore] Erro ao carregar alertas:', error);
            }
        },

        /**
         * Carrega informações do sistema
         */
        async fetchSystemInfo() {
            try {
                const response = await http.get('/api/dashboard/system/info');
                this.systemInfo = {
                    ...this.systemInfo,
                    ...response.data.system,
                    ...response.data.versions,
                };
            } catch (error) {
                console.error('[SystemStore] Erro ao carregar info:', error);
            }
        },

        /**
         * Atualiza thresholds de alerta
         */
        async updateAlertThresholds(thresholds) {
            try {
                await http.put('/api/dashboard/alerts/thresholds', thresholds);
                // Recarrega alertas
                await this.fetchAlerts();
            } catch (error) {
                this.error = formatHttpError(error).message;
                throw error;
            }
        },

        /**
         * Handler para alerta via Socket.io
         */
        handleAlert(alert) {
            // Adiciona ou atualiza alerta
            const existingIndex = this.alerts.findIndex(a => a.name === alert.name);

            if (existingIndex !== -1) {
                this.alerts[existingIndex] = alert;
            } else {
                this.alerts.push(alert);
            }
        },

        /**
         * Handler para health update via Socket.io
         */
        handleHealthUpdate(component, data) {
            if (this.components[component]) {
                this.components[component] = {
                    ...this.components[component],
                    ...data,
                };
            }
        },

        /**
         * Remove alerta (quando condição resolvida)
         */
        removeAlert(alertName) {
            this.alerts = this.alerts.filter(a => a.name !== alertName);
        },

        /**
         * Limpa todos os alertas
         */
        clearAlerts() {
            this.alerts = [];
        },

        /**
         * Limpa erro
         */
        clearError() {
            this.error = null;
        },
    },
});
