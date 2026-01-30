<template>
    <div class="app-layout">
        <Header />
        <div class="main-container">
            <Sidebar />
            <main class="content">
                <router-view />
            </main>
        </div>
    </div>
</template>

<script>
import Header from './Header.vue';
import Sidebar from './Sidebar.vue';

export default {
    name: 'AppLayout',
    components: {
        Header,
        Sidebar
    }
};
</script>

<style scoped>
.app-layout {
    display: flex;
    flex-direction: column;
    height: 100vh;
    background-color: #f5f5f5;
}

.main-container {
    display: flex;
    flex: 1;
    overflow: hidden;
}

.content {
    flex: 1;
    overflow-y: auto;
    padding: 20px;
    background-color: #ffffff;
}
</style>
