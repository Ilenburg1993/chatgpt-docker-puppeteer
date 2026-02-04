<template>
  <div class="flex flex-col h-screen overflow-hidden relative">
    <!-- Background gradiente animado -->
    <div class="fixed inset-0 bg-gradient-to-br from-slate-950 via-blue-950 to-slate-950 z-0">
      <div class="absolute inset-0 bg-[radial-gradient(circle_at_50%_50%,rgba(56,189,248,0.1),transparent_50%)] animate-pulse-slow"></div>
      <div class="absolute inset-0 bg-[url('data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNjAiIGhlaWdodD0iNjAiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyI+PGRlZnM+PHBhdHRlcm4gaWQ9ImdyaWQiIHdpZHRoPSI2MCIgaGVpZ2h0PSI2MCIgcGF0dGVyblVuaXRzPSJ1c2VyU3BhY2VPblVzZSI+PHBhdGggZD0iTSAxMCAwIEwgMCAwIDAgMTAiIGZpbGw9Im5vbmUiIHN0cm9rZT0id2hpdGUiIHN0cm9rZS1vcGFjaXR5PSIwLjAyIiBzdHJva2Utd2lkdGg9IjEiLz48L3BhdHRlcm4+PC9kZWZzPjxyZWN0IHdpZHRoPSIxMDAlIiBoZWlnaHQ9IjEwMCUiIGZpbGw9InVybCgjZ3JpZCkiLz48L3N2Zz4')] opacity-50"></div>
    </div>

    <div class="relative z-10 flex flex-col h-screen">
      <Header />
      <div class="flex flex-1 overflow-hidden">
        <Sidebar :collapsed="sidebarCollapsed" @toggle="toggleSidebar" />
        <main class="flex-1 overflow-y-auto p-6 md:p-8 custom-scrollbar">
          <router-view />
        </main>
      </div>
      <Footer />
    </div>
  </div>
</template>

<script setup>
import { ref } from 'vue';
import Footer from './Footer.vue';
import Header from './Header.vue';
import Sidebar from './Sidebar.vue';

const sidebarCollapsed = ref(false);

const toggleSidebar = () => {
  sidebarCollapsed.value = !sidebarCollapsed.value;
};
</script>

<style scoped>
@keyframes pulse-slow {
  0%, 100% { opacity: 0.3; }
  50% { opacity: 0.6; }
}

.animate-pulse-slow {
  animation: pulse-slow 8s ease-in-out infinite;
}

.custom-scrollbar::-webkit-scrollbar {
  width: 8px;
}

.custom-scrollbar::-webkit-scrollbar-track {
  background: transparent;
}

.custom-scrollbar::-webkit-scrollbar-thumb {
  background: rgba(71, 85, 105, 0.5);
  border-radius: 4px;
}

.custom-scrollbar::-webkit-scrollbar-thumb:hover {
  background: rgba(71, 85, 105, 0.8);
}
</style>
