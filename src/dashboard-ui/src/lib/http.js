import axios from 'axios';

const DEFAULT_TIMEOUT_MS = 15000;

export const http = axios.create({
    timeout: Number(import.meta.env.VITE_API_TIMEOUT_MS || DEFAULT_TIMEOUT_MS) || DEFAULT_TIMEOUT_MS,
    withCredentials: true
});

http.interceptors.request.use(
    config => {
        const token = localStorage.getItem('auth_token');
        if (token) {
            config.headers = config.headers || {};
            config.headers.Authorization = `Bearer ${token}`;
        }
        return config;
    },
    error => Promise.reject(error)
);

http.interceptors.response.use(
    (response) => response,
    (error) => {
        // Attach request_id (when present) for better UX/logging.
        try {
            const requestId = error?.response?.data?.request_id || error?.response?.data?.requestId || null;
            if (requestId) {
                error.request_id = requestId;
            }
        } catch (e) {
            // ignore
        }
        return Promise.reject(error);
    }
);

export function formatHttpError(error) {
    const requestId = error?.request_id || error?.response?.data?.request_id || null;
    const apiMessage =
        error?.response?.data?.error ||
        error?.response?.data?.message ||
        null;

    const message = apiMessage || error?.message || 'Request failed';

    return {
        message: requestId ? `${message} (request_id: ${requestId})` : message,
        request_id: requestId
    };
}
