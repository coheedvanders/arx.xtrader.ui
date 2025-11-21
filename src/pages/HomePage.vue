<!-- HomePage.vue -->
<template>
  <div class="home-wrapper">
    <!-- Ambient background -->
    <div class="ambient-bg"></div>

    <div class="home-container">
      <!-- Header -->
      <div class="header">
        <div class="logo-section">
          <img src="/src/assets/images/x-airo-logo.png" alt="Z-Bionix" class="logo" />
          <h1 class="title">x-Trader</h1>
          <p class="tagline">money printing bot</p>
        </div>
      </div>

      <!-- Main Content -->
      <div class="content">
        <!-- Welcome Card -->
        <div class="welcome-card">
          <div class="welcome-icon">
            <i class="fas fa-user"></i>
          </div>
          <h2>Welcome Back</h2>
          <p>write something here</p>
        </div>

        <!-- Navigation Grid -->
        <div class="nav-grid">
          
          <!-- Enrollment Card -->
          <router-link to="/mint" class="nav-card enrollment-card">
            <div class="card-icon">
              <i class="fas fa-check-circle"></i>
            </div>
            <h3>Mint</h3>
            <p>Like the Mint Bank</p>
            <div class="card-arrow"><i class="fas fa-arrow-right"></i></div>
          </router-link>

        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
// Static layout for homepage
</script>

<style scoped>
* {
  box-sizing: border-box;
}

.home-wrapper {
  min-height: 100vh;
  background: linear-gradient(135deg, #ffffff 0%, #f5f5f5 50%, #ffffff 100%);
  position: relative;
  overflow: hidden;
}

.ambient-bg {
  position: absolute;
  inset: 0;
  pointer-events: none;
}

.ambient-bg::before {
  content: '';
  position: absolute;
  top: 20%;
  left: 10%;
  width: 500px;
  height: 500px;
  background: radial-gradient(circle, rgba(59, 130, 246, 0.08) 0%, transparent 70%);
  border-radius: 50%;
  filter: blur-3xl;
}

.ambient-bg::after {
  content: '';
  position: absolute;
  bottom: 10%;
  right: 10%;
  width: 500px;
  height: 500px;
  background: radial-gradient(circle, rgba(34, 197, 94, 0.08) 0%, transparent 70%);
  border-radius: 50%;
  filter: blur-3xl;
}

.home-container {
  position: relative;
  z-index: 10;
  max-width: 1200px;
  margin: 0 auto;
  padding: 48px 24px;
  display: flex;
  flex-direction: column;
  min-height: 100vh;
}

/* Header */
.header {
  text-align: center;
  margin-bottom: 64px;
}

.logo-section {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 16px;
}

.logo {
  width: 120px;
  height: auto;
  opacity: 0.95;
  filter: drop-shadow(0 4px 12px rgba(59, 130, 246, 0.1));
}

.title {
  font-size: 40px;
  font-weight: 300;
  letter-spacing: 3px;
  color: #000;
  margin: 0;
}

.tagline {
  font-size: 16px;
  letter-spacing: 1px;
  color: rgba(0, 0, 0, 0.5);
  margin: 0;
  font-weight: 300;
}

/* Main Content */
.content {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 48px;
}

/* Welcome Card */
.welcome-card {
  background: rgba(255, 255, 255, 0.7);
  backdrop-filter: blur(12px);
  border: 1px solid rgba(0, 0, 0, 0.1);
  border-radius: 16px;
  padding: 40px;
  text-align: center;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.05);
}

.welcome-icon {
  font-size: 48px;
  margin-bottom: 16px;
}

.welcome-card h2 {
  font-size: 28px;
  font-weight: 300;
  letter-spacing: 1px;
  color: #000;
  margin: 0 0 12px 0;
}

.welcome-card p {
  font-size: 16px;
  color: rgba(0, 0, 0, 0.6);
  max-width: 600px;
  margin: 0 auto;
  font-weight: 300;
}

/* Navigation Grid */
.nav-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
  gap: 24px;
}

.nav-card {
  position: relative;
  background: rgba(255, 255, 255, 0.7);
  backdrop-filter: blur(12px);
  border: 1px solid rgba(0, 0, 0, 0.1);
  border-radius: 16px;
  padding: 32px 24px;
  text-decoration: none;
  color: inherit;
  transition: all 0.3s ease;
  cursor: pointer;
  display: flex;
  flex-direction: column;
  gap: 12px;
  overflow: hidden;
}

.nav-card::before {
  content: '';
  position: absolute;
  inset: 0;
  background: linear-gradient(135deg, transparent 0%, rgba(59, 130, 246, 0.05) 100%);
  opacity: 0;
  transition: opacity 0.3s ease;
}

.nav-card:hover {
  transform: translateY(-8px);
  box-shadow: 0 12px 32px rgba(0, 0, 0, 0.1);
  border-color: rgba(0, 0, 0, 0.15);
}

.nav-card:hover::before {
  opacity: 1;
}

.nav-card.scanner-card:hover {
  border-color: #3b82f6;
}

.nav-card.enrollment-card:hover {
  border-color: #22c55e;
}

.nav-card.management-card:hover {
  border-color: #f59e0b;
}

.card-icon {
  font-size: 40px;
  line-height: 1;
}

.nav-card h3 {
  font-size: 20px;
  font-weight: 300;
  letter-spacing: 1px;
  color: #000;
  margin: 0;
}

.nav-card p {
  font-size: 14px;
  color: rgba(0, 0, 0, 0.6);
  margin: 0;
  font-weight: 300;
  flex: 1;
}

.card-arrow {
  font-size: 24px;
  color: rgba(0, 0, 0, 0.3);
  transition: all 0.3s ease;
}

.nav-card:hover .card-arrow {
  transform: translateX(4px);
  color: #3b82f6;
}

/* Stats Section */
.stats-section {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
  gap: 16px;
}

.stat-box {
  background: rgba(255, 255, 255, 0.7);
  backdrop-filter: blur(12px);
  border: 1px solid rgba(0, 0, 0, 0.1);
  border-radius: 12px;
  padding: 20px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  text-align: center;
}

.stat-icon {
  font-size: 32px;
}

.stat-label {
  font-size: 12px;
  letter-spacing: 1px;
  color: rgba(0, 0, 0, 0.5);
  font-weight: 300;
  text-transform: uppercase;
}

.stat-value {
  font-size: 24px;
  font-weight: 300;
  color: #3b82f6;
}

/* Info Section */
.info-section {
  display: flex;
  flex-direction: column;
  gap: 20px;
}

.info-item {
  display: flex;
  gap: 20px;
  align-items: flex-start;
  background: rgba(255, 255, 255, 0.5);
  backdrop-filter: blur(12px);
  border: 1px solid rgba(0, 0, 0, 0.08);
  border-radius: 12px;
  padding: 24px;
}

.info-number {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 48px;
  height: 48px;
  border-radius: 50%;
  background: linear-gradient(135deg, #3b82f6 0%, #2563eb 100%);
  color: white;
  font-size: 20px;
  font-weight: 300;
  flex-shrink: 0;
}

.info-item h4 {
  font-size: 16px;
  font-weight: 400;
  letter-spacing: 0.5px;
  color: #000;
  margin: 0 0 4px 0;
}

.info-item p {
  font-size: 14px;
  color: rgba(0, 0, 0, 0.6);
  margin: 0;
  font-weight: 300;
}

/* Footer */
.footer {
  text-align: center;
  padding-top: 32px;
  margin-top: 32px;
  border-top: 1px solid rgba(0, 0, 0, 0.1);
  font-size: 12px;
  letter-spacing: 0.5px;
  color: rgba(0, 0, 0, 0.4);
  font-weight: 300;
}

/* Responsive */
@media (max-width: 768px) {
  .home-container {
    padding: 32px 16px;
  }

  .header {
    margin-bottom: 40px;
  }

  .title {
    font-size: 32px;
  }

  .welcome-card {
    padding: 24px;
  }

  .welcome-card h2 {
    font-size: 24px;
  }

  .nav-grid {
    grid-template-columns: 1fr;
  }

  .info-item {
    flex-direction: column;
    text-align: center;
  }

  .info-number {
    margin: 0 auto;
  }
}
</style>