// @ts-check
import { ref, computed, onMounted } from 'vue';
import { useNotifications } from './useNotifications.js';

/**
 * Composable para gerenciamento de autenticação JWT
 * Gerencia login, logout, e verificação de token automaticamente
 *
 * @returns {object} Estado e funções de autenticação
 * @sideEffects - Gerencia token JWT no localStorage, faz verificações automáticas
 */
export function useAuth() {
    /**
     * Estado do usuário autenticado
     */
    const user = ref(null);

    /**
     * Estado de loading
     */
    const loading = ref(false);

    /**
     * Instância das notificações
     */
    const { showSuccess, showError } = useNotifications();

    /**
     * Computed para verificar se usuário está autenticado
     */
    const isAuthenticated = computed(() => !!user.value);

    /**
     * Computed para verificar se usuário é admin
     */
    const isAdmin = computed(() => user.value?.role === 'admin');

    /**
     * Obtém token do localStorage
     * @returns {string|null} Token JWT ou null
     */
    const getToken = () => {
        return localStorage.getItem('auth_token');
    };

    /**
     * Salva token no localStorage
     * @param {string} token - Token JWT
     */
    const setToken = token => {
        localStorage.setItem('auth_token', token);
    };

    /**
     * Remove token do localStorage
     */
    const removeToken = () => {
        localStorage.removeItem('auth_token');
    };

    /**
     * Verifica se token é válido fazendo request para /auth/me
     * @returns {Promise<boolean>} True se token válido
     */
    const verifyToken = async () => {
        const token = getToken();
        if (!token) return false;

        try {
            const response = await fetch('/api/dashboard/auth/me', {
                headers: {
                    Authorization: `Bearer ${token}`,
                },
            });

            if (response.ok) {
                const data = await response.json();
                user.value = data.user;
                return true;
            } else {
                // Token inválido, remover
                removeToken();
                user.value = null;
                return false;
            }
        } catch (error) {
            console.error('Token verification error:', error);
            removeToken();
            user.value = null;
            return false;
        }
    };

    /**
     * Faz login com credenciais
     * @param {string} username - Nome do usuário
     * @param {string} password - Senha
     * @returns {Promise<boolean>} True se login bem-sucedido
     */
    const login = async (username, password) => {
        loading.value = true;

        try {
            const response = await fetch('/api/dashboard/auth/login', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ username, password }),
            });

            const data = await response.json();

            if (data.success) {
                setToken(data.token);
                user.value = data.user;
                showSuccess(`Bem-vindo, ${data.user.username}!`);
                return true;
            } else {
                showError(data.error || 'Erro no login');
                return false;
            }
        } catch (error) {
            showError('Erro de conexão');
            console.error('Login error:', error);
            return false;
        } finally {
            loading.value = false;
        }
    };

    /**
     * Faz logout
     * @returns {Promise<void>}
     */
    const logout = async () => {
        const token = getToken();

        try {
            // Tentar fazer logout no servidor (opcional)
            if (token) {
                await fetch('/api/dashboard/auth/logout', {
                    method: 'POST',
                    headers: {
                        Authorization: `Bearer ${token}`,
                    },
                });
            }
        } catch (error) {
            console.error('Logout error:', error);
        }

        // Sempre limpar estado local
        removeToken();
        user.value = null;
        showSuccess('Logout realizado com sucesso');
    };

    /**
     * Faz fetch autenticado com token automático
     * @param {string} url - URL da API
     * @param {object} options - Opções do fetch
     * @returns {Promise<Response>} Response do fetch
     */
    const authenticatedFetch = async (url, options = {}) => {
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
        await verifyToken();
    });

    return {
        user,
        loading,
        isAuthenticated,
        isAdmin,
        login,
        logout,
        verifyToken,
        authenticatedFetch,
        getToken,
    };
}
