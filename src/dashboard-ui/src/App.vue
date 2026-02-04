<template>
    <div class="dark">
        <AppLayout />
    </div>
</template>

<script>
import AppLayout from './components/layout/AppLayout.vue';

export default {
    name: 'App',
    components: {
        AppLayout
    }
};
</script>

<style>
#app {
    height: 100vh;
    overflow: hidden;
}
</style>
