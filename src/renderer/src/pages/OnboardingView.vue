<script setup lang="ts">
import { onMounted } from 'vue'
import { useOnboarding } from '@/composables/useOnboarding'

const emit = defineEmits<{ complete: [] }>()

const {
  step,
  platform,
  wowPath,
  wowPathState,
  permissionStatus,
  permissionChecking,
  addonState,
  brewState,
  ffmpegState,
  ffmpegPath,
  showFfmpegSection,
  canAdvance,
  init,
  detectWowPath,
  pickWowFolder,
  checkScreenPermission,
  openSystemPreferences,
  checkAddon,
  checkBrew,
  checkFfmpeg,
  next,
  back,
  complete
} = useOnboarding()

const TOTAL_STEPS = 5

onMounted(async () => {
  await init()
  await detectWowPath()
})

async function handleComplete(): Promise<void> {
  await complete()
  emit('complete')
}
</script>

<template>
  <div class="min-h-screen bg-[#0f0f0f] flex items-center justify-center p-6">
    <div class="w-full max-w-xl">
      <!-- Header -->
      <div class="mb-8 text-center">
        <h1 class="text-2xl font-semibold text-white mb-1">
          WoW Arena Recorder
        </h1>
        <p class="text-sm text-zinc-400">
          Setup — step {{ step + 1 }} of {{ TOTAL_STEPS }}
        </p>
      </div>

      <!-- Step indicator -->
      <div class="flex gap-1.5 mb-8">
        <div
          v-for="i in TOTAL_STEPS"
          :key="i"
          class="h-1 flex-1 rounded-full transition-colors duration-200"
          :class="i - 1 <= step ? 'bg-blue-500' : 'bg-zinc-700'"
        />
      </div>

      <!-- Step content -->
      <div class="bg-[#1a1a1a] border border-zinc-800 rounded-xl p-6 min-h-[280px] flex flex-col">
        <!-- Step 0: WoW Folder -->
        <template v-if="step === 0">
          <h2 class="text-lg font-medium text-white mb-1">
            World of Warcraft folder
          </h2>
          <p class="text-sm text-zinc-400 mb-6">
            The app needs your WoW installation path to watch the combat log.
          </p>

          <div
            class="flex items-center gap-3 p-3 rounded-lg border mb-4"
            :class="{
              'border-zinc-700 bg-zinc-900': wowPathState === 'idle',
              'border-zinc-600 bg-zinc-900': wowPathState === 'checking',
              'border-green-700 bg-green-950/30': wowPathState === 'ok',
              'border-red-700 bg-red-950/30': wowPathState === 'fail'
            }"
          >
            <span class="text-lg">
              <template v-if="wowPathState === 'ok'">✓</template>
              <template v-else-if="wowPathState === 'fail'">✗</template>
              <template v-else>⋯</template>
            </span>
            <span class="text-sm text-zinc-300 flex-1 truncate font-mono">
              {{ wowPath || '/Applications/World of Warcraft' }}
            </span>
          </div>

          <template v-if="wowPathState === 'fail'">
            <p class="text-sm text-red-400 mb-4">
              The selected folder does not appear to be a valid WoW installation (<code
                class="text-xs"
              >_retail_/Logs/</code>
              not found).
            </p>
          </template>

          <template v-if="wowPathState === 'idle'">
            <p class="text-sm text-zinc-400 mb-4">
              WoW was not found at the default location. Please select your WoW folder.
            </p>
          </template>

          <div class="mt-auto flex gap-3">
            <button
              class="btn-secondary flex-1"
              @click="pickWowFolder"
            >
              Choose folder…
            </button>
          </div>
        </template>

        <!-- Step 1: Screen Recording -->
        <template v-else-if="step === 1">
          <h2 class="text-lg font-medium text-white mb-1">
            Screen Recording
          </h2>
          <p class="text-sm text-zinc-400 mb-6">
            The app requires Screen Recording access to capture your gameplay.
          </p>

          <div
            class="flex items-center gap-3 p-3 rounded-lg border mb-4"
            :class="{
              'border-green-700 bg-green-950/30': permissionStatus === 'granted',
              'border-yellow-700 bg-yellow-950/30': permissionStatus === 'not-determined',
              'border-red-700 bg-red-950/30': permissionStatus === 'denied'
            }"
          >
            <span class="text-lg">
              <template v-if="permissionStatus === 'granted'">✓</template>
              <template v-else>✗</template>
            </span>
            <span
              class="text-sm flex-1"
              :class="{
                'text-green-400': permissionStatus === 'granted',
                'text-yellow-400': permissionStatus === 'not-determined',
                'text-red-400': permissionStatus === 'denied'
              }"
            >
              <template v-if="permissionStatus === 'granted'">Permission granted</template>
              <template v-else-if="permissionStatus === 'not-determined'">Permission not yet granted</template>
              <template v-else>Permission denied</template>
            </span>
          </div>

          <template v-if="permissionStatus !== 'granted'">
            <p class="text-sm text-zinc-400 mb-4">
              Open
              <strong class="text-zinc-200">System Settings → Privacy &amp; Security → Screen Recording</strong>
              and enable this app. Then click "Check again".
            </p>
            <p class="text-xs text-zinc-500 mb-4">
              After granting access, you may need to restart the app for the change to take effect.
            </p>
          </template>

          <div class="mt-auto flex gap-3">
            <button
              v-if="permissionStatus !== 'granted'"
              class="btn-secondary flex-1"
              @click="openSystemPreferences"
            >
              Open System Settings
            </button>
            <button
              class="btn-secondary flex-1"
              :disabled="permissionChecking"
              @click="checkScreenPermission"
            >
              {{ permissionChecking ? 'Checking…' : 'Check again' }}
            </button>
          </div>
        </template>

        <!-- Step 2: Addon -->
        <template v-else-if="step === 2">
          <h2 class="text-lg font-medium text-white mb-1">
            Combat logging addon
          </h2>
          <p class="text-sm text-zinc-400 mb-6">
            <strong class="text-zinc-200">SimpleCombatLogger</strong> automatically enables combat
            logging when you enter an arena — without it you would need to type
            <code class="text-xs bg-zinc-800 px-1 rounded">/combatlog</code> manually every session.
          </p>

          <div class="text-sm text-zinc-300 space-y-2 mb-6">
            <p>
              Install via <strong class="text-blue-400">CurseForge</strong> or the
              <strong class="text-blue-400">Overwolf app</strong>:
            </p>
            <p class="font-mono text-xs text-zinc-400 bg-zinc-900 p-2 rounded">
              curseforge.com/wow/addons/simplecombatlogger
            </p>
            <p class="text-xs text-zinc-500">
              After installing, launch WoW and log in before clicking Verify.
            </p>
          </div>

          <template v-if="addonState === 'ok'">
            <div
              class="flex items-center gap-2 p-3 rounded-lg border border-green-700 bg-green-950/30 mb-4"
            >
              <span class="text-green-400">✓</span>
              <span class="text-sm text-green-400">SimpleCombatLogger found</span>
            </div>
          </template>
          <template v-else-if="addonState === 'fail'">
            <div
              class="flex items-center gap-2 p-3 rounded-lg border border-yellow-700 bg-yellow-950/30 mb-4"
            >
              <span class="text-yellow-400">!</span>
              <span class="text-sm text-yellow-400">
                Addon not found — you can continue, but install it before recording arenas.
              </span>
            </div>
          </template>

          <div class="mt-auto flex gap-3">
            <button
              class="btn-secondary flex-1"
              :disabled="addonState === 'checking'"
              @click="checkAddon"
            >
              {{ addonState === 'checking' ? 'Checking…' : 'Verify addon' }}
            </button>
          </div>
        </template>

        <!-- Step 3: Homebrew + FFmpeg -->
        <template v-else-if="step === 3">
          <h2 class="text-lg font-medium text-white mb-1">
            Homebrew &amp; FFmpeg
          </h2>
          <p class="text-sm text-zinc-400 mb-5">
            FFmpeg captures your screen using Apple's VideoToolbox hardware encoder. It must be
            installed via Homebrew.
          </p>

          <!-- Sub-step A: Homebrew -->
          <div class="mb-5">
            <p class="text-sm font-medium text-zinc-300 mb-2">
              Step A — Homebrew
            </p>
            <template v-if="brewState === 'ok'">
              <div
                class="flex items-center gap-2 p-2.5 rounded-lg border border-green-700 bg-green-950/30"
              >
                <span class="text-green-400">✓</span>
                <span class="text-sm text-green-400">Homebrew is installed</span>
              </div>
            </template>
            <template v-else-if="brewState === 'fail'">
              <p class="text-sm text-zinc-400 mb-2">
                Homebrew is not installed. Run this command in Terminal:
              </p>
              <div class="relative">
                <code
                  class="block text-xs font-mono bg-zinc-900 border border-zinc-700 p-2.5 rounded-lg text-zinc-300 break-all"
                >
                  /bin/bash -c "$(curl -fsSL
                  https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
                </code>
              </div>
              <p class="text-xs text-zinc-500 mt-2">
                Or visit <span class="text-blue-400">brew.sh</span> for instructions.
              </p>
              <button
                class="btn-secondary mt-3"
                @click="checkBrew"
              >
                Check again
              </button>
            </template>
            <template v-else>
              <button
                class="btn-secondary"
                :disabled="brewState === 'checking'"
                @click="checkBrew"
              >
                {{ brewState === 'checking' ? 'Checking…' : 'Check Homebrew' }}
              </button>
            </template>
          </div>

          <!-- Sub-step B: FFmpeg (only shown after Homebrew confirmed) -->
          <template v-if="showFfmpegSection">
            <div class="border-t border-zinc-800 pt-5">
              <p class="text-sm font-medium text-zinc-300 mb-2">
                Step B — FFmpeg
              </p>
              <template v-if="ffmpegState === 'ok'">
                <div
                  class="flex items-center gap-2 p-2.5 rounded-lg border border-green-700 bg-green-950/30"
                >
                  <span class="text-green-400">✓</span>
                  <span class="text-sm text-green-400 font-mono truncate">{{ ffmpegPath }}</span>
                </div>
              </template>
              <template v-else-if="ffmpegState === 'fail'">
                <p class="text-sm text-zinc-400 mb-2">
                  FFmpeg is not installed. Run in Terminal:
                </p>
                <code
                  class="block text-xs font-mono bg-zinc-900 border border-zinc-700 p-2.5 rounded-lg text-zinc-300 mb-3"
                >
                  brew install ffmpeg
                </code>
                <button
                  class="btn-secondary"
                  @click="checkFfmpeg"
                >
                  Check again
                </button>
              </template>
              <template v-else>
                <button
                  class="btn-secondary"
                  :disabled="ffmpegState === 'checking'"
                  @click="checkFfmpeg"
                >
                  {{ ffmpegState === 'checking' ? 'Checking…' : 'Check FFmpeg' }}
                </button>
              </template>
            </div>
          </template>
        </template>

        <!-- Step 4: Ready -->
        <template v-else-if="step === 4">
          <h2 class="text-lg font-medium text-white mb-1">
            You are ready
          </h2>
          <p class="text-sm text-zinc-400 mb-6">
            All checks passed. The app will automatically record your arena matches.
          </p>

          <div class="space-y-2 mb-6">
            <div
              class="flex items-center gap-3 p-2.5 rounded-lg bg-zinc-900 border border-zinc-800"
            >
              <span class="text-green-400 text-base">✓</span>
              <span class="text-sm text-zinc-300">WoW folder</span>
              <span class="text-xs text-zinc-500 font-mono ml-auto truncate max-w-[200px]">{{
                wowPath
              }}</span>
            </div>
            <div
              class="flex items-center gap-3 p-2.5 rounded-lg bg-zinc-900 border border-zinc-800"
            >
              <span class="text-green-400 text-base">✓</span>
              <span class="text-sm text-zinc-300">Screen Recording</span>
            </div>
            <div
              class="flex items-center gap-3 p-2.5 rounded-lg bg-zinc-900 border border-zinc-800"
            >
              <span
                class="text-base"
                :class="addonState === 'ok' ? 'text-green-400' : 'text-yellow-400'"
              >
                {{ addonState === 'ok' ? '✓' : '!' }}
              </span>
              <span class="text-sm text-zinc-300">SimpleCombatLogger</span>
              <span
                v-if="addonState !== 'ok'"
                class="text-xs text-yellow-500 ml-auto"
              >
                not found — install before recording
              </span>
            </div>
            <div
              class="flex items-center gap-3 p-2.5 rounded-lg bg-zinc-900 border border-zinc-800"
            >
              <span class="text-green-400 text-base">✓</span>
              <span class="text-sm text-zinc-300">FFmpeg</span>
              <span class="text-xs text-zinc-500 font-mono ml-auto truncate max-w-[200px]">{{
                ffmpegPath
              }}</span>
            </div>
          </div>
        </template>
      </div>

      <!-- Navigation -->
      <div class="flex gap-3 mt-4">
        <button
          v-if="step > 0"
          class="btn-secondary w-24"
          @click="back"
        >
          Back
        </button>
        <div class="flex-1" />

        <template v-if="step < TOTAL_STEPS - 1">
          <button
            class="btn-primary w-28"
            :disabled="!canAdvance"
            @click="next"
          >
            Continue
          </button>
        </template>
        <template v-else>
          <button
            class="btn-primary w-28"
            @click="handleComplete"
          >
            Start
          </button>
        </template>
      </div>
    </div>
  </div>
</template>

<style scoped>
.btn-primary {
  @apply px-4 py-2 bg-blue-600 hover:bg-blue-500 disabled:bg-zinc-700 disabled:text-zinc-500
         text-white text-sm font-medium rounded-lg transition-colors duration-150 cursor-pointer
         disabled:cursor-not-allowed;
}

.btn-secondary {
  @apply px-4 py-2 bg-zinc-800 hover:bg-zinc-700 disabled:bg-zinc-800 disabled:text-zinc-600
         text-zinc-200 text-sm font-medium rounded-lg border border-zinc-700
         transition-colors duration-150 cursor-pointer disabled:cursor-not-allowed;
}
</style>
