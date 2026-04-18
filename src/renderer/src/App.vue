<script setup lang="ts">
import { ref, onMounted } from 'vue'
import OnboardingView from './pages/OnboardingView.vue'
import MainView from './pages/MainView.vue'
import { useLogAnalysisStore } from '@/stores/logAnalysisStore'

// Whether the full app is ready to show (config loaded)
const loading = ref(true)
const onboardingComplete = ref(false)

const logAnalysisStore = useLogAnalysisStore()

onMounted(async () => {
  const result = await window.electron.invoke('config:get', { key: 'onboardingComplete' })
  onboardingComplete.value = result === true

  // Restore last log analysis session so history survives restarts
  const cache = await window.electron.invoke('logAnalysis:getCache')
  if (cache !== null && cache.matches.length > 0) {
    logAnalysisStore.setMatches(cache.filePath, cache.matches)
  }

  loading.value = false
})

function handleOnboardingComplete(): void {
  onboardingComplete.value = true
}
</script>

<template>
  <div v-if="!loading">
    <OnboardingView
      v-if="!onboardingComplete"
      @complete="handleOnboardingComplete"
    />
    <MainView v-else />
  </div>
</template>
