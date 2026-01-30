<template>
    <aside class="sidebar">
        <nav class="nav-menu">
            <router-link to="/dashboard" class="nav-item">
                <span class="icon">📊</span>
                <span>Dashboard</span>
            </router-link>
            <router-link to="/missions" class="nav-item">
                <span class="icon">🎯</span>
                <span>Missions</span>
            </router-link>
            <router-link to="/tasks" class="nav-item">
                <span class="icon">📋</span>
                <span>Tasks</span>
            </router-link>
            <router-link to="/workflow" class="nav-item">
                <span class="icon">🔄</span>
                <span>Workflow</span>
            </router-link>
            <router-link to="/metrics" class="nav-item">
                <span class="icon">📈</span>
                <span>Metrics</span>
            </router-link>
            <router-link to="/events" class="nav-item">
                <span class="icon">⚡</span>
                <span>Events</span>
            </router-link>
            <router-link to="/health" class="nav-item">
                <span class="icon">💚</span>
                <span>Health</span>
            </router-link>
            <router-link to="/templates" class="nav-item">
                <span class="icon">📝</span>
                <span>Templates</span>
            </router-link>
        </nav>
    </aside>
</template>

<script>
export default {
    name: 'Sidebar'
};
</script>

<style scoped>
.sidebar {
    width: 240px;
    background-color: #34495e;
    color: white;
    overflow-y: auto;
}

.nav-menu {
    display: flex;
    flex-direction: column;
    padding: 10px 0;
}

.nav-item {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 12px 20px;
    color: #ecf0f1;
    text-decoration: none;
    transition: all 0.2s ease;
}

.nav-item:hover {
    background-color: rgba(255, 255, 255, 0.1);
}

.nav-item.router-link-active {
    background-color: #3498db;
    border-left: 4px solid #2980b9;
}

.nav-item .icon {
    font-size: 1.2rem;
}

.nav-item span:last-child {
    font-size: 0.95rem;
    font-weight: 500;
}
</style>
