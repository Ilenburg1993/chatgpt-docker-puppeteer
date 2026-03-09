/// <reference types="vite/client" />

interface ImportMetaEnv {
    readonly VITE_API_BASE_URL?: string;
    readonly VITE_WS_BASE_URL?: string;
    readonly VITE_DASHBOARD_SOCKET_URL?: string;
    readonly VITE_ENABLE_DEBUG?: string;
    readonly [key: string]: string | undefined;
}

interface ImportMeta {
    readonly env: ImportMetaEnv;
}

declare module '@/composables/useNotifications.js' {
    import type { Ref } from 'vue';

    export interface NotificationItem {
        id: string;
        message: string;
        type: 'success' | 'error' | 'warning' | 'info';
        duration: number;
        createdAt: number;
    }

    export interface UseNotificationsReturn {
        notifications: Ref<NotificationItem[]>;
        addNotification: (message: string, type?: NotificationItem['type'], duration?: number) => string;
        removeNotification: (id: string) => void;
        showSuccess: (message: string, duration?: number) => string;
        showError: (message: string, duration?: number) => string;
        showWarning: (message: string, duration?: number) => string;
        showInfo: (message: string, duration?: number) => string;
        clearAll: () => void;
    }

    export function useNotifications(): UseNotificationsReturn;
}

declare module '@/composables/useAuth.js' {
    import type { ComputedRef, Ref } from 'vue';

    export interface AuthUser {
        id?: string;
        username?: string;
        role?: string;
        permissions?: string[];
    }

    export interface UseAuthReturn {
        user: Ref<AuthUser | null>;
        loading: Ref<boolean>;
        isAuthenticated: ComputedRef<boolean>;
        isAdmin: ComputedRef<boolean>;
        isOwner: ComputedRef<boolean>;
        isOperator: ComputedRef<boolean>;
        permissions: ComputedRef<string[]>;
        can: (permission: string) => boolean;
        login: (username: string, password: string) => Promise<boolean>;
        logout: () => Promise<void>;
        verifyToken: () => Promise<boolean>;
        authenticatedFetch: (url: string, options?: RequestInit) => Promise<Response>;
        getToken: () => string | null;
    }

    export function useAuth(): UseAuthReturn;
}
