<template>
  <div class="splash flex flex-col items-center justify-center gap-4">
    <img src="/src/assets/images/x-airo-logo.png" class="logo" />
    <div class="font-semibold">y-cortex</div>
    
    <div class="content-container flex flex-col items-center gap-2">
        <h3 class="signed-out-title">Signed Out</h3>
        <p class="signed-out-message">
            You have securely ended your session.
        </p>
    </div>


    <div class="flex justify-center mt-lg">
        <ButtonComponent @click="redirectHome">
            Sign In Again
        </ButtonComponent>
    </div>
  </div>
</template>

<script setup lang="ts">
import CardComponent from '@/components/shared/card/CardComponent.vue';
import ButtonComponent from '@/components/shared/form/ButtonComponent.vue';
import { onMounted } from 'vue';
import { useRouter } from 'vue-router';

const router = useRouter();

onMounted(() => {
  localStorage.clear();
});

function redirectHome() {
  window.location.href = "/";
}
</script>

<style scoped>
.splash {
  height: 80vh; /* Vertical centering area */
}

.logo {
  width: 88px;
  height: auto;
}

.redirect-btn {
  background-color: #2563eb; /* blue */
  color: white;
  padding: 0.5rem 1rem;
  border-radius: 0.5rem;
  font-weight: 600;
  cursor: pointer;
  border: none;
  transition: background 0.2s ease;
}

.redirect-btn:hover {
  background-color: #1d4ed8;
}


.signed-out-title {
  font-size: 1.5rem;
  font-weight: 500;
  letter-spacing: 0.05em;
  color: #1f2937; /* soft dark gray */
}

.signed-out-message {
  font-size: 0.95rem;
  color: #6b7280; /* muted gray */
  margin-top: 0.5rem;
  line-height: 1.6;
  text-align: center;
}

/* Optional: add a subtle divider (inspired by washi paper / brush strokes) */
.content-container {
  padding: 1rem;
  border-top: 1px solid #e5e7eb;
  border-bottom: 1px solid #e5e7eb;
}

</style>
