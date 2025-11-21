<template>
    <div class="error-container">
        <h1 class="error-code">404</h1>
        <p class="error-title">Page Not Found</p>
        <p class="error-message">The page you’re looking for doesn’t exist or has been moved.</p>
        <ButtonComponent class="pt-md" :href="'/'">Back to Home</ButtonComponent>
    </div>
</template>

<script setup lang="ts">
import ButtonComponent from '@/components/shared/form/ButtonComponent.vue';


</script>

<style scoped>
.error-container {
    text-align: center;
    max-width: 600px;
    margin: auto;
    padding: 40px 20px;
}

.error-code {
    font-size: 72px;
    font-weight: bold;
    margin-bottom: 20px;
    color: #d9534f;
}

.error-title {
    font-size: 24px;
    font-weight: 600;
    margin-bottom: 10px;
}

.error-message {
    font-size: 16px;
    color: #666;
    margin-bottom: 30px;
}

.home-link {
    display: inline-block;
    padding: 10px 20px;
    background-color: #007bff;
    color: white;
    text-decoration: none;
    border-radius: 4px;
}

.home-link:hover {
    background-color: #0056b3;
}
</style>
