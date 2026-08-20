// @ts-check
/**
 * @import {
 *   ComputedRef,
 *   Ref
 * } from 'vue'
 */
import { http } from '@/lib/http';
import { computed, onMounted, ref } from 'vue';
import { useNotifications } from './useNotifications.js';

/**
 * @typedef {object} AuthUser
 * @property {string} [id]
 * @property {string} [username]
 * @property {string} [role]
 * @property {string[]} [permissions]
 */

/**
 * @typedef {object} UseAuthReturn
 * @property {Ref<AuthUser | null>} user
 * @property {Ref<boolean>} loading
 * @property {ComputedRef<boolean>} isAuthenticated
 * @property {ComputedRef<boolean>} isAdmin
 * @property {ComputedRef<boolean>} isOwner
 * @property {ComputedRef<boolean>} isOperator
 * @property {ComputedRef<string[]>} permissions
 * @property {(permission: string) => boolean} can
 * @property {(username: string, password: string) => Promise<boolean>} login
 * @property {() => Promise<void>} logout
 * @property {() => Promise<boolean>} verifyToken
 * @property {(url: string, options?: RequestInit) => Promise<Response>} authenticatedFetch
 * @property {() => string | null} getToken
 */

const authUser = /** @type {Ref<AuthUser | null>} */ (ref(null));
const authLoading = ref(false);
let verifyInFlight = /** @type {any} */ (null);
let authInitialized = false;

const getTokenFromStorage = () => localStorage.getItem('auth_token');
const setTokenInStorage = (/** @type {any} */ token) => localStorage.setItem('auth_token', /** @type {any} */ token);
const clearTokenInStorage = () => localStorage.removeItem('auth_token');

/**
 * Composable para gerenciamento de autenticação JWT Gerencia login, logout, e verificação de token automaticamente
 *
 * @returns {UseAuthReturn} Estado e funções de autenticação
 * @sideEffects - Gerencia token JWT no localStorage, faz verificações automáticas
 */
export function useAuth() {
    /**
     * Instância das notificações
     */
    const { showSuccess, showError } = useNotifications();

    /**
     * Computed para verificar se usuário está autenticado
     */
    const isAuthenticated = computed(() => !!authUser.value);

    /**
     * Computed para verificar se usuário é admin
     */
    const isAdmin = computed(() => authUser.value?.role === 'admin');
    const isOwner = computed(() => authUser.value?.role === 'owner');
    const isOperator = computed(() => authUser.value?.role === 'operator');
    const permissions = computed(() => (Array.isArray(authUser.value?.permissions) ? authUser.value.permissions : []));

    const can = (/** @type {any} */ permission) => {
        if (!permission) return false;
        const role = String(authUser.value?.role || '');
        if (role === 'owner') return true;
        if (role === 'admin' && permission !== 'rbac.manage') return true;
        return permissions.value.includes(String(permission));
    };

    /**
     * Obtém token do localStorage
     *
     * @returns {string | null} Token JWT ou null
     */
    const getToken = () => {
        return getTokenFromStorage();
    };

    /**
     * Salva token no localStorage
     *
     * @param {string} token - Token JWT
     */
    const setToken = (token) => {
        setTokenInStorage(token);
    };

    /**
     * Remove token do localStorage
     */
    const removeToken = () => {
        clearTokenInStorage();
    };

    /**
     * Verifica se token é válido fazendo request para /auth/me
     *
     * @returns {Promise<boolean>} True se token válido
     */
    const verifyToken = async () => {
        const token = getToken();
        if (!token) {
            authUser.value = null;
            return false;
        }

        if (verifyInFlight) {
            return verifyInFlight;
        }

        verifyInFlight = (async () => {
            try {
                const response = await http.get('/api/dashboard/auth/me');
                const payload = response?.data || {};
                authUser.value = payload.user || null;
                return Boolean(payload.user);
            } catch (/** @type {any} */ _error) {
                removeToken();
                authUser.value = null;
                return false;
            } finally {
                verifyInFlight = null;
            }
        })();

        return verifyInFlight;
    };

    /**
     * Faz login com credenciais
     *
     * @param {string} username - Nome do usuário
     * @param {string} password - Senha
     * @returns {Promise<boolean>} True se login bem-sucedido
     */
    const login = async (username, password) => {
        authLoading.value = true;

        try {
            const response = await http.post('/api/dashboard/auth/login', { username, password });
            const data = response?.data || {};

            if (data.success) {
                setToken(data.token);
                authUser.value = data.user;
                showSuccess(`Bem-vindo, ${data.user.username}!`);
                return true;
            }

            showError(data.error || 'Erro no login');
            return false;
        } catch (/** @type {any} */ _rawError) {
            const error = /** @type {any} */ (_rawError);
            const apiError = error?.response?.data?.error || 'Erro de conexão';
            showError(apiError);
            return false;
        } finally {
            authLoading.value = false;
        }
    };

    /**
     * Faz logout
     *
     * @returns {Promise<any>}
     */
    const logout = async () => {
        const token = getToken();

        try {
            // Tentar fazer logout no servidor (opcional)
            if (token) {
                await http.post('/api/dashboard/auth/logout');
            }
        } catch (/** @type {any} */ _rawError) {
            const error = /** @type {any} */ (_rawError);
            console.error('Logout error:', error);
        }

        // Sempre limpar estado local
        removeToken();
        authUser.value = null;
        showSuccess('Logout realizado com sucesso');
    };

    /**
     * Faz fetch autenticado com token automático
     *
     * @param {string} url - URL da API
     * @param {object} options - Opções do fetch
     * @returns {Promise<Response>} Response do fetch
     */
    const authenticatedFetch = async (url, /** @type {any} */ options = {}) => {
        const token = getToken();

        const headers = {
            'Content-Type': 'application/json',
            ...options.headers,
        };

        if (token) {
            headers['Authorization'] = `Bearer ${token}`;
        }

        const response = await fetch(url, {
            ...options,
            headers,
        });

        // Se 401, tentar verificar token
        if (response.status === 401) {
            const isValid = await verifyToken();
            if (!isValid) {
                showError('Sessão expirada. Faça login novamente.');
                return response; // Retornar response original para tratamento
            }
        }

        return response;
    };

    // Verificar token automaticamente ao inicializar
    onMounted(async () => {
        if (authInitialized) {
            return;
        }
        authInitialized = true;
        await verifyToken();
    });

    return {
        user: authUser,
        loading: authLoading,
        isAuthenticated,
        isAdmin,
        isOwner,
        isOperator,
        permissions,
        can,
        login,
        logout,
        verifyToken,
        authenticatedFetch,
        getToken,
    };
}
