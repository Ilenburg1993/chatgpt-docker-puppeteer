<template>
    <Modal :open="open" @update:open="handleClose" size="sm" title="Login">
        <form @submit.prevent="handleLogin" class="space-y-4">
            <div>
                <label for="username" class="block text-sm font-medium text-foreground mb-1"> Usuário </label>
                <Input
                    id="username"
                    v-model="form.username"
                    placeholder="Digite seu usuário"
                    :error="errors.username"
                    required
                />
            </div>

            <div>
                <label for="password" class="block text-sm font-medium text-foreground mb-1"> Senha </label>
                <Input
                    id="password"
                    v-model="form.password"
                    type="password"
                    placeholder="Digite sua senha"
                    :error="errors.password"
                    required
                />
            </div>

            <div v-if="error" class="text-sm text-error bg-error-muted/20 p-3 rounded-lg">
                {{ error }}
            </div>

            <div class="flex justify-end gap-2 pt-4">
                <Button variant="ghost" type="button" @click="handleClose" :disabled="loading"> Cancelar </Button>
                <Button variant="primary" type="submit" :loading="loading"> Entrar </Button>
            </div>
        </form>
    </Modal>
</template>

<script setup>
// @ts-check
import { ref, reactive } from 'vue';
import Modal from '../ui/Modal.vue';
import Button from '../ui/Button.vue';
import Input from '../ui/Input.vue';
import { useNotifications } from '@/composables/useNotifications.js';
import { useAuth } from '@/composables/useAuth.js';

/**
 * Props do componente LoginModal
 */
const props = defineProps({
    open: {
        type: Boolean,
        default: false,
    },
});

/**
 * Emits do componente LoginModal
 */
const emit = defineEmits(['update:open', 'login-success']);

/**
 * Estado reativo do formulário
 */
const form = reactive({
    username: '',
    password: '',
});

/**
 * Estado de erros de validação
 */
const errors = reactive({
    username: '',
    password: '',
});

/**
 * Estado de loading
 */
const loading = ref(false);

/**
 * Estado de erro geral
 */
const error = ref('');

/**
 * Instância das notificações
 */
const { showError } = useNotifications();
const { login } = useAuth();

/**
 * Fecha o modal
 */
const handleClose = () => {
    resetForm();
    emit('update:open', false);
};

/**
 * Reseta o formulário
 */
const resetForm = () => {
    form.username = '';
    form.password = '';
    errors.username = '';
    errors.password = '';
    error.value = '';
};

/**
 * Valida o formulário
 * @returns {boolean} True se válido
 */
const validateForm = () => {
    errors.username = '';
    errors.password = '';
    error.value = '';

    if (!form.username.trim()) {
        errors.username = 'Usuário é obrigatório';
        return false;
    }

    if (!form.password.trim()) {
        errors.password = 'Senha é obrigatória';
        return false;
    }

    return true;
};

/**
 * Processa o login
 */
const handleLogin = async () => {
    if (!validateForm()) return;

    loading.value = true;
    error.value = '';

    try {
        const success = await login(form.username.trim(), form.password.trim());
        if (success) {
            emit('login-success');
            handleClose();
        } else {
            error.value = 'Credenciais inválidas';
            showError(error.value);
        }
    } catch (err) {
        error.value = 'Erro de conexão. Tente novamente.';
        showError(error.value);
        console.error('Login error:', err);
    } finally {
        loading.value = false;
    }
};
</script>
