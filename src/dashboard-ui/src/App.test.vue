<template>
    <div style="background: #0a0e1a; color: #fff; padding: 50px; font-size: 24px">
        <h1>✅ VUE APP IS WORKING!</h1>
        <p>If you see this, Vue is rendering correctly.</p>
        <p>Counter: {{ counter }}</p>
        <button @click="counter++" style="padding: 10px 20px; font-size: 18px">Click me</button>
    </div>
</template>

<script setup>
import { ref } from 'vue';

const counter = ref(0);
</script>
