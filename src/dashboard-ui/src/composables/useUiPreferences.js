import { computed, ref } from 'vue';
import { http } from '@/lib/http';
import { useAuth } from '@/composables/useAuth';

const STORAGE_KEY = 'ui_preset_v1';
const ALLOWED_PRESETS = new Set(['dense', 'balanced', 'focus']);

const currentPreset = ref('dense');
const loading = ref(false);
let initialized = false;

function _normalizePreset(value) {
    const preset = String(value || '')
        .trim()
        .toLowerCase();
    return ALLOWED_PRESETS.has(preset) ? preset : 'dense';
}

function _applyPresetToDom(preset) {
    if (typeof document === 'undefined') return;
    document.documentElement.setAttribute('data-ui-preset', preset);
}

function _persistLocalPreset(preset) {
    try {
        localStorage.setItem(STORAGE_KEY, preset);
    } catch (_) {
        // noop
    }
}

async function _loadFromServer() {
    const response = await http.get('/api/control/preferences/me');
    const prefs = response?.data?.preferences || {};
    const preset = _normalizePreset(prefs?.layout?.preset || prefs?.layout?.dashboard_preset || null);
    return { preset, prefs };
}

async function _saveToServer(preset) {
    await http.patch('/api/control/preferences/me', {
        layout: {
            preset,
            dashboard_preset: preset,
        },
    });
}

/**
 * Função exportada: useUiPreferences.
 * @returns {any}
 */
export function useUiPreferences() {
    const { isAuthenticated } = useAuth();

    const init = async () => {
        if (initialized) return;
        initialized = true;
        loading.value = true;
        try {
            let localPreset = 'dense';
            try {
                localPreset = _normalizePreset(localStorage.getItem(STORAGE_KEY));
            } catch (_) {
                localPreset = 'dense';
            }
            currentPreset.value = localPreset;
            _applyPresetToDom(localPreset);

            if (isAuthenticated.value) {
                const { preset } = await _loadFromServer();
                currentPreset.value = preset;
                _applyPresetToDom(preset);
                _persistLocalPreset(preset);
            }
        } catch (_) {
            _applyPresetToDom(currentPreset.value);
        } finally {
            loading.value = false;
        }
    };

    const setPreset = async presetInput => {
        const preset = _normalizePreset(presetInput);
        currentPreset.value = preset;
        _applyPresetToDom(preset);
        _persistLocalPreset(preset);

        if (isAuthenticated.value) {
            try {
                await _saveToServer(preset);
            } catch (_) {
                // best effort: mantém persistência local.
            }
        }
    };

    return {
        preset: computed(() => currentPreset.value),
        loading: computed(() => loading.value),
        init,
        setPreset,
    };
}
