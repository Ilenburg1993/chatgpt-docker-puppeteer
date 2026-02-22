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
