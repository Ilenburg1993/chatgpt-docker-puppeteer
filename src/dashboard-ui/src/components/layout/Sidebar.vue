<script setup>
import { Activity, ChevronLeft, LayoutDashboard, ListTodo, ScrollText, Target } from 'lucide-vue-next';
import { useRoute } from 'vue-router';

const props = defineProps({
  collapsed: {
    type: Boolean,
    default: false
  }
});

const emit = defineEmits(['toggle']);

const route = useRoute();

const menuItems = [
  { icon: LayoutDashboard, label: 'Visão geral', path: '/dashboard' },
  { icon: ListTodo, label: 'Tarefas', path: '/tasks' },
  { icon: Target, label: 'Missões', path: '/missions' },
  { icon: ScrollText, label: 'Eventos', path: '/events' },
  { icon: Activity, label: 'Saúde', path: '/health' },
];

const isActive = (path) => {
  return route.path === path || route.path.startsWith(path + '/');
};

const handleToggle = () => {
  emit('toggle');
};
</script>

<template>
  <aside
    :class="[
      'relative bg-gradient-to-b from-slate-900 via-slate-900 to-slate-950 border-r border-slate-700/50 flex flex-col transition-all duration-300 z-20 shadow-2xl',
      collapsed ? 'w-16' : 'w-64'
    ]"
  >
    <div class="absolute inset-0 bg-gradient-to-br from-blue-600/5 via-transparent to-violet-600/5 pointer-events-none"></div>

    <div class="flex-1 overflow-y-auto scrollbar-thin py-6 relative">
      <nav class="space-y-2 px-3">
        <router-link
          v-for="item in menuItems"
          :key="item.path"
          :to="item.path"
          :class="[
            'group flex items-center gap-3 px-4 py-3.5 rounded-xl transition-all duration-300 relative overflow-hidden',
            isActive(item.path)
              ? 'bg-gradient-to-r from-blue-600 to-blue-700 text-white shadow-lg shadow-blue-600/50'
              : 'text-gray-400 hover:text-white hover:bg-slate-800/50 backdrop-blur-sm'
          ]"
        >
          <div class="absolute inset-0 bg-gradient-to-r from-white/0 via-white/5 to-white/0 translate-x-[-100%] group-hover:translate-x-[100%] transition-transform duration-1000"></div>
          <component
            :is="item.icon"
            :size="22"
            class="flex-shrink-0 transition-all duration-300 group-hover:scale-110"
            :class="isActive(item.path) ? 'drop-shadow-lg' : ''"
          />
          <span
            v-if="!collapsed"
            class="text-sm font-semibold tracking-wide transition-all duration-300"
          >
            {{ item.label }}
          </span>
          <div
            v-if="isActive(item.path) && !collapsed"
            class="ml-auto w-1.5 h-1.5 rounded-full bg-white animate-pulse"
          ></div>
        </router-link>
      </nav>
    </div>

    <div class="p-4 border-t border-slate-700/50 bg-slate-900/50 backdrop-blur-sm relative">
      <button
        @click="handleToggle"
        class="w-full flex items-center justify-center gap-2 px-4 py-3 rounded-xl text-gray-400 hover:text-white hover:bg-slate-800/50 transition-all duration-300 group"
      >
        <ChevronLeft
          :size="20"
          :class="['transition-all duration-300 group-hover:scale-110', collapsed && 'rotate-180']"
        />
        <span v-if="!collapsed" class="text-sm font-medium">Recolher</span>
      </button>
    </div>
  </aside>
</template>
