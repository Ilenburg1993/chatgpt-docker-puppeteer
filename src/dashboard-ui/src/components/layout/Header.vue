<script setup lang="ts">
import { useUiPreferences } from '@/composables/useUiPreferences';
import { Bell, LogIn, LogOut, Menu, Search, User } from 'lucide-vue-next';
import { onMounted, ref } from 'vue';
import { useAuth } from '../../composables/useAuth.js';
import LoginModal from '../auth/LoginModal.vue';

const emit = defineEmits<{ toggleSidebar: [] }>();

const searchQuery = ref('');
const notifications = ref(3);
const showLoginModal = ref(false);
const { preset, setPreset, init: initUiPreferences } = useUiPreferences();

const { user, isAuthenticated, logout } = useAuth();

const handleMenuClick = () => {
    emit('toggleSidebar');
};

const handleLoginClick = () => {
    showLoginModal.value = true;
};

const handleLogoutClick = async () => {
    await logout();
};

const handleLoginSuccess = () => {
    showLoginModal.value = false;
};

const handlePresetChange = (event: Event) => {
    setPreset((event.target as HTMLSelectElement).value);
};

onMounted(() => {
    void initUiPreferences();
});
</script>

<template>
    <header
        class="h-16 backdrop-blur-xl bg-slate-900/80 border-b border-slate-700/50 flex items-center justify-between px-6 z-10 shadow-lg"
    >
        <div class="flex items-center gap-4">
            <button
                @click="handleMenuClick"
                class="lg:hidden p-2 rounded-lg hover:bg-slate-800/50 text-gray-400 hover:text-white transition-all duration-300"
            >
                <Menu :size="20" />
            </button>

            <div class="flex items-center gap-3">
                <div
                    class="w-10 h-10 bg-gradient-to-br from-blue-600 to-blue-700 rounded-xl flex items-center justify-center shadow-lg shadow-blue-600/50"
                >
                    <span class="text-white font-bold text-lg">M</span>
                </div>
                <div class="hidden sm:block">
                    <h1 class="text-lg font-bold text-white tracking-tight">Mission Control</h1>
                    <p class="text-xs text-blue-300">Dashboard</p>
                </div>
            </div>
        </div>

        <div class="flex-1 max-w-xl mx-8 hidden md:block">
            <div class="relative group">
                <Search
                    class="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 transition-colors group-focus-within:text-blue-400"
                    :size="18"
                />
                <input
                    v-model="searchQuery"
                    type="text"
                    placeholder="Buscar tarefas e missões..."
                    class="w-full pl-10 pr-4 py-2.5 bg-slate-800/50 border border-slate-700/50 rounded-xl text-white placeholder:text-gray-500 focus:border-blue-500/50 focus:outline-none focus:ring-2 focus:ring-blue-500/20 transition-all duration-300 backdrop-blur-sm"
                />
            </div>
        </div>

        <div class="flex items-center gap-3">
            <div class="hidden lg:flex items-center gap-2 mr-2">
                <span class="text-xs text-slate-400">Preset</span>
                <select
                    :value="preset"
                    @change="handlePresetChange"
                    class="px-2 py-1.5 text-xs rounded-lg bg-slate-800/70 border border-slate-700/60 text-slate-200"
                >
                    <option value="dense">dense</option>
                    <option value="balanced">balanced</option>
                    <option value="focus">focus</option>
                </select>
            </div>
            <button
                class="relative p-2.5 rounded-xl hover:bg-slate-800/50 text-gray-400 hover:text-white transition-all duration-300 group"
            >
                <Bell :size="20" class="group-hover:scale-110 transition-transform duration-300" />
                <span
                    v-if="notifications > 0"
                    class="absolute top-1.5 right-1.5 w-2 h-2 bg-red-500 rounded-full animate-pulse shadow-lg shadow-red-500/50"
                ></span>
            </button>

            <div class="h-8 w-px bg-slate-700/50 mx-2"></div>

            <button
                v-if="!isAuthenticated"
                @click="handleLoginClick"
                class="flex items-center gap-2 px-3 py-2 rounded-xl hover:bg-slate-800/50 transition-all duration-300 group text-gray-400 hover:text-white"
            >
                <LogIn :size="16" class="group-hover:scale-110 transition-transform duration-300" />
                <span class="hidden sm:block text-sm font-semibold">Login</span>
            </button>

            <button
                v-else
                @click="handleLogoutClick"
                class="flex items-center gap-2 px-3 py-2 rounded-xl hover:bg-slate-800/50 transition-all duration-300 group"
            >
                <div
                    class="w-8 h-8 bg-gradient-to-br from-violet-600 to-violet-700 rounded-lg flex items-center justify-center shadow-lg shadow-violet-600/30 group-hover:scale-110 transition-transform duration-300"
                >
                    <User :size="16" class="text-white" />
                </div>
                <span class="hidden sm:block text-sm font-semibold text-white">{{ user?.username }}</span>
                <LogOut :size="14" class="text-gray-400 group-hover:text-red-400 ml-1" />
            </button>
        </div>

        <!-- Modal de Login -->
        <LoginModal v-model:open="showLoginModal" @login-success="handleLoginSuccess" />
    </header>
</template>
