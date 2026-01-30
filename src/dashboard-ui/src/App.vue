<template>
    <AppLayout />
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
* {
    margin: 0;
    padding: 0;
    box-sizing: border-box;
}

body {
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
    -webkit-font-smoothing: antialiased;
    -moz-osx-font-smoothing: grayscale;
}

#app {
    height: 100vh;
    overflow: hidden;
}
</style>
