<script setup lang="ts">
import { useSettings } from '@/composables/useSettings'

const emit = defineEmits<{ close: [] }>()

import { ref } from 'vue'

const {
  config,
  loading,
  restartRequired,
  bitratePreset,
  customBitrate,
  captureDevices,
  devicesLoading,
  addonAlreadyInstalled,
  cleanupDaysEnabled,
  cleanupDays,
  cleanupGbEnabled,
  cleanupGb,
  minimizeToTray,
  pickWowPath,
  pickStoragePath,
  setFps,
  setResolution,
  selectCaptureDevice,
  installAddon,
  relaunch,
} = useSettings()

const saveFlash = ref(false)
function handleSave(): void {
  saveFlash.value = true
  setTimeout(() => { saveFlash.value = false }, 1500)
}

const addonInstallStatus = ref<'idle' | 'installing' | 'done' | 'error'>('idle')
const addonInstallError = ref('')
const showManualInstall = ref(false)

async function handleInstallAddon(): Promise<void> {
  addonInstallStatus.value = 'installing'
  const result = await installAddon()
  if (result.success) {
    addonInstallStatus.value = 'done'
    showManualInstall.value = false
  } else {
    addonInstallStatus.value = 'error'
    addonInstallError.value = result.error ?? 'Unknown error'
    showManualInstall.value = true
  }
}

const BITRATE_PRESETS = [
  { value: 'low', label: 'Low', hint: '4 Mbps' },
  { value: 'medium', label: 'Medium', hint: '8 Mbps' },
  { value: 'high', label: 'High', hint: '16 Mbps' },
  { value: 'custom', label: 'Custom', hint: '' },
] as const
</script>

<template>
  <div class="flex flex-col h-full bg-[#141414] text-zinc-200 overflow-hidden">
    <!-- Panel header -->
    <div
      class="flex-shrink-0 flex items-center justify-between px-4 py-3 border-b border-zinc-800"
    >
      <h2 class="text-sm font-semibold text-zinc-100">
        Settings
      </h2>
      <div class="flex items-center gap-2">
        <button
          class="px-2.5 py-1 text-xs rounded border transition-colors"
          :class="saveFlash
            ? 'bg-green-900/40 border-green-700 text-green-400'
            : 'bg-zinc-800 border-zinc-700 text-zinc-300 hover:bg-zinc-700'"
          @click="handleSave"
        >
          {{ saveFlash ? 'Saved ✓' : 'Save' }}
        </button>
        <button
          class="p-1.5 rounded hover:bg-zinc-700 text-zinc-400 hover:text-zinc-200 transition-colors"
          title="Close settings"
          @click="emit('close')"
        >
          <svg
            class="w-4 h-4"
            viewBox="0 0 16 16"
            fill="currentColor"
          >
            <path
              d="M3.72 3.72a.75.75 0 011.06 0L8 6.94l3.22-3.22a.75.75 0 111.06 1.06L9.06 8l3.22 3.22a.75.75 0 11-1.06 1.06L8 9.06l-3.22 3.22a.75.75 0 01-1.06-1.06L6.94 8 3.72 4.78a.75.75 0 010-1.06z"
            />
          </svg>
        </button>
      </div>
    </div>

    <!-- Restart required banner -->
    <div
      v-if="restartRequired"
      class="flex-shrink-0 flex items-center gap-3 px-4 py-2.5 bg-amber-950/60 border-b border-amber-800/60"
    >
      <span class="text-amber-400 text-xs flex-1">
        Restart required for path changes to take effect.
      </span>
      <button
        class="text-xs px-3 py-1 rounded bg-amber-700 hover:bg-amber-600 text-white font-medium transition-colors"
        @click="relaunch"
      >
        Restart now
      </button>
    </div>

    <!-- Loading -->
    <div
      v-if="loading"
      class="flex-1 flex items-center justify-center"
    >
      <p class="text-zinc-500 text-sm">
        Loading…
      </p>
    </div>

    <!-- Content -->
    <div
      v-else-if="config !== null"
      class="flex-1 overflow-y-auto"
    >
      <!-- ---------------------------------------------------------------- -->
      <!-- WoW Installation                                                  -->
      <!-- ---------------------------------------------------------------- -->
      <section class="px-4 py-4 border-b border-zinc-800/60">
        <h3 class="text-xs font-semibold text-zinc-500 uppercase tracking-wider mb-3">
          WoW Installation
        </h3>

        <div class="space-y-1 mb-3">
          <p class="text-xs text-zinc-400">
            Installation folder
          </p>
          <div
            class="flex items-center gap-2 px-3 py-2 rounded-lg bg-zinc-900 border border-zinc-700"
          >
            <span class="flex-1 text-xs font-mono text-zinc-300 truncate">
              {{ config.wowPath }}
            </span>
          </div>
        </div>

        <button
          class="btn-secondary text-xs"
          @click="pickWowPath"
        >
          Change folder…
        </button>
      </section>

      <!-- ---------------------------------------------------------------- -->
      <!-- Recording Storage                                                 -->
      <!-- ---------------------------------------------------------------- -->
      <section class="px-4 py-4 border-b border-zinc-800/60">
        <h3 class="text-xs font-semibold text-zinc-500 uppercase tracking-wider mb-3">
          Recording Storage
        </h3>

        <div class="space-y-1 mb-3">
          <p class="text-xs text-zinc-400">
            Save recordings to
          </p>
          <div
            class="flex items-center gap-2 px-3 py-2 rounded-lg bg-zinc-900 border border-zinc-700"
          >
            <span class="flex-1 text-xs font-mono text-zinc-300 truncate">
              {{ config.storagePath }}
            </span>
          </div>
        </div>

        <button
          class="btn-secondary text-xs"
          @click="pickStoragePath"
        >
          Change folder…
        </button>
      </section>

      <!-- ---------------------------------------------------------------- -->
      <!-- Video Quality                                                     -->
      <!-- ---------------------------------------------------------------- -->
      <section class="px-4 py-4 border-b border-zinc-800/60">
        <h3 class="text-xs font-semibold text-zinc-500 uppercase tracking-wider mb-3">
          Video Quality
        </h3>

        <!-- Bitrate presets -->
        <div class="mb-4">
          <p class="text-xs text-zinc-400 mb-2">
            Bitrate
          </p>
          <div class="flex gap-2 flex-wrap">
            <button
              v-for="preset in BITRATE_PRESETS"
              :key="preset.value"
              class="px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors"
              :class="
                bitratePreset === preset.value
                  ? 'bg-blue-600 border-blue-500 text-white'
                  : 'bg-zinc-900 border-zinc-700 text-zinc-300 hover:border-zinc-500'
              "
              @click="bitratePreset = preset.value"
            >
              {{ preset.label }}
              <span
                v-if="preset.hint"
                class="text-xs opacity-60 ml-1"
              >{{ preset.hint }}</span>
            </button>
          </div>

          <!-- Custom bitrate input -->
          <div
            v-if="bitratePreset === 'custom'"
            class="mt-3 flex items-center gap-2"
          >
            <input
              :value="customBitrate"
              type="number"
              min="1000"
              max="50000"
              step="1000"
              class="w-28 px-3 py-1.5 rounded-lg bg-zinc-900 border border-zinc-700 text-zinc-200 text-xs focus:outline-none focus:border-zinc-500"
              @change="customBitrate = Number(($event.target as HTMLInputElement).value)"
            >
            <span class="text-xs text-zinc-500">kbps</span>
          </div>
        </div>

        <!-- Frame rate -->
        <div class="mb-4">
          <p class="text-xs text-zinc-400 mb-2">
            Frame rate
            <span class="text-zinc-600 ml-1">(macOS AVFoundation caps screen capture at 30 fps)</span>
          </p>
          <div class="flex gap-2">
            <button
              class="px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors"
              :class="
                config.videoFps === 30
                  ? 'bg-blue-600 border-blue-500 text-white'
                  : 'bg-zinc-900 border-zinc-700 text-zinc-300 hover:border-zinc-500'
              "
              @click="setFps(30)"
            >
              30 fps
            </button>
            <button
              class="px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors"
              :class="
                config.videoFps === 60
                  ? 'bg-blue-600 border-blue-500 text-white'
                  : 'bg-zinc-900 border-zinc-700 text-zinc-300 hover:border-zinc-500'
              "
              @click="setFps(60)"
            >
              60 fps
            </button>
          </div>
        </div>

        <!-- Resolution -->
        <div class="mb-4">
          <p class="text-xs text-zinc-400 mb-2">
            Output resolution
          </p>
          <div class="flex gap-2 flex-wrap">
            <button
              v-for="res in ['native', '2560x1440', '1920x1080', '1280x720']"
              :key="res"
              class="px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors"
              :class="
                config.videoResolution === res
                  ? 'bg-blue-600 border-blue-500 text-white'
                  : 'bg-zinc-900 border-zinc-700 text-zinc-300 hover:border-zinc-500'
              "
              @click="setResolution(res)"
            >
              {{ res === 'native' ? 'Native' : res }}
            </button>
          </div>
          <p class="text-xs text-zinc-600 mt-1.5">
            Native = record at full screen resolution (e.g. 2560×1440). Downscale to save space.
          </p>
        </div>

        <!-- Capture device -->
        <div>
          <p class="text-xs text-zinc-400 mb-2">
            Screen capture device
          </p>
          <p
            v-if="devicesLoading"
            class="text-xs text-zinc-600"
          >
            Detecting devices…
          </p>
          <div
            v-else-if="captureDevices.length === 0"
            class="text-xs text-zinc-600"
          >
            No devices found — ensure FFmpeg is installed.
          </div>
          <div
            v-else
            class="space-y-1.5"
          >
            <button
              v-for="dev in captureDevices"
              :key="dev.index"
              class="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-xs border transition-colors text-left"
              :class="
                config.captureDevice === String(dev.index)
                  ? 'bg-blue-600 border-blue-500 text-white'
                  : dev.isScreen
                    ? 'bg-zinc-900 border-zinc-700 text-zinc-300 hover:border-zinc-500'
                    : 'bg-zinc-900/50 border-zinc-800 text-zinc-500'
              "
              @click="selectCaptureDevice(dev)"
            >
              <span class="w-5 text-center flex-shrink-0 font-mono">{{ dev.index }}</span>
              <span class="flex-1 truncate">{{ dev.name }}</span>
              <span
                v-if="dev.isScreen && dev.resolution"
                class="flex-shrink-0 text-xs opacity-60"
              >{{ dev.resolution }}</span>
              <span
                v-if="dev.isScreen && dev.isPrimary !== undefined"
                class="flex-shrink-0 text-xs px-1.5 py-0.5 rounded"
                :class="config.captureDevice === String(dev.index) ? 'bg-white/20' : 'bg-zinc-700 text-zinc-400'"
              >{{ dev.isPrimary ? 'primary' : 'external' }}</span>
              <span
                v-else-if="!dev.isScreen"
                class="flex-shrink-0 text-xs opacity-50"
              >camera</span>
            </button>
          </div>
          <p class="text-xs text-zinc-600 mt-1.5">
            Select the "Capture screen" device — not your webcam or Continuity Camera.
          </p>
        </div>

      </section>

      <!-- ---------------------------------------------------------------- -->
      <!-- WoW Addon                                                         -->
      <!-- ---------------------------------------------------------------- -->
      <section class="px-4 py-4 border-b border-zinc-800/60">
        <h3 class="text-xs font-semibold text-zinc-500 uppercase tracking-wider mb-3">
          WoW Addon
        </h3>
        <p class="text-xs text-zinc-400 mb-3">
          The companion addon saves your character's GUID so the app can correctly
          identify your team in arena logs. After installing, enable it in-game and reload UI.
        </p>
        <!-- Already installed badge -->
        <div
          v-if="addonAlreadyInstalled && addonInstallStatus === 'idle'"
          class="flex items-center gap-2 mb-3"
        >
          <span class="text-xs text-green-400 font-medium">Addon installed ✓</span>
          <button
            class="text-xs text-zinc-500 hover:text-zinc-300 underline"
            @click="handleInstallAddon"
          >
            Reinstall
          </button>
        </div>

        <button
          v-else
          class="btn-secondary text-xs"
          :disabled="addonInstallStatus === 'installing'"
          @click="handleInstallAddon"
        >
          {{
            addonInstallStatus === 'installing' ? 'Installing…'
              : addonInstallStatus === 'done' ? 'Installed ✓'
              : 'Install Addon'
          }}
        </button>
        <p
          v-if="addonInstallStatus === 'error'"
          class="text-xs text-red-400 mt-2"
        >
          {{ addonInstallError }}
        </p>
        <p
          v-if="addonInstallStatus === 'done'"
          class="text-xs text-green-400 mt-2"
        >
          ArenaRecorderCompanion installed. Enable it in WoW → AddOns and /reload.
        </p>

        <!-- Manual install toggle -->
        <button
          v-if="addonInstallStatus !== 'done'"
          class="text-xs text-zinc-500 hover:text-zinc-300 underline mt-3 block"
          @click="showManualInstall = !showManualInstall"
        >
          {{ showManualInstall ? 'Hide manual install' : 'Install manually' }}
        </button>

        <!-- Manual install instructions -->
        <div
          v-if="showManualInstall && addonInstallStatus !== 'done'"
          class="mt-3 p-3 rounded-lg bg-zinc-900 border border-zinc-700 text-xs text-zinc-400 space-y-2"
        >
          <p>Copy the <code class="bg-zinc-800 px-1 rounded">ArenaRecorderCompanion</code> folder into your WoW AddOns directory:</p>
          <ol class="list-decimal list-inside space-y-2 text-zinc-500">
            <li>
              Open the addon source folder and copy <code class="bg-zinc-800 px-1 rounded">ArenaRecorderCompanion</code>
              <button
                class="ml-2 px-2 py-0.5 rounded bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 text-zinc-300 transition-colors"
                @click="() => window.electron.invoke('system:openAddonSource')"
              >
                Open source
              </button>
            </li>
            <li>
              Paste it into your WoW AddOns folder
              <button
                v-if="config"
                class="ml-2 px-2 py-0.5 rounded bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 text-zinc-300 transition-colors"
                @click="() => window.electron.invoke('system:openAddonsDir', { wowPath: config!.wowPath })"
              >
                Open AddOns
              </button>
            </li>
            <li>Enable it in WoW → AddOns and <code class="bg-zinc-800 px-1 rounded">/reload</code></li>
          </ol>
        </div>
      </section>

      <!-- ---------------------------------------------------------------- -->
      <!-- Auto-Cleanup                                                      -->
      <!-- ---------------------------------------------------------------- -->
      <section class="px-4 py-4">
        <h3 class="text-xs font-semibold text-zinc-500 uppercase tracking-wider mb-3">
          Auto-Cleanup
        </h3>

        <!-- Delete after N days -->
        <label class="flex items-center gap-3 mb-4 cursor-pointer">
          <input
            :checked="cleanupDaysEnabled"
            type="checkbox"
            class="w-4 h-4 rounded accent-blue-500 cursor-pointer"
            @change="cleanupDaysEnabled = ($event.target as HTMLInputElement).checked"
          >
          <span class="text-xs text-zinc-300">Delete recordings older than</span>
          <input
            :value="cleanupDays"
            type="number"
            min="1"
            max="365"
            :disabled="!cleanupDaysEnabled"
            class="w-16 px-2 py-1 rounded bg-zinc-900 border border-zinc-700 text-zinc-200 text-xs text-center focus:outline-none focus:border-zinc-500 disabled:opacity-40 disabled:cursor-not-allowed"
            @change="cleanupDays = Number(($event.target as HTMLInputElement).value)"
          >
          <span class="text-xs text-zinc-500">days</span>
        </label>

        <!-- Limit storage to X GB -->
        <label class="flex items-center gap-3 cursor-pointer">
          <input
            :checked="cleanupGbEnabled"
            type="checkbox"
            class="w-4 h-4 rounded accent-blue-500 cursor-pointer"
            @change="cleanupGbEnabled = ($event.target as HTMLInputElement).checked"
          >
          <span class="text-xs text-zinc-300">Limit storage to</span>
          <input
            :value="cleanupGb"
            type="number"
            min="1"
            max="2000"
            :disabled="!cleanupGbEnabled"
            class="w-16 px-2 py-1 rounded bg-zinc-900 border border-zinc-700 text-zinc-200 text-xs text-center focus:outline-none focus:border-zinc-500 disabled:opacity-40 disabled:cursor-not-allowed"
            @change="cleanupGb = Number(($event.target as HTMLInputElement).value)"
          >
          <span class="text-xs text-zinc-500">GB</span>
        </label>

        <p class="text-xs text-zinc-600 mt-3">
          Auto-cleanup runs when the app starts and after each recording is processed.
        </p>
      </section>

      <!-- ---------------------------------------------------------------- -->
      <!-- App Behaviour                                                      -->
      <!-- ---------------------------------------------------------------- -->
      <section class="px-4 py-4">
        <h3 class="text-xs font-semibold text-zinc-500 uppercase tracking-wider mb-3">
          App Behaviour
        </h3>
        <label class="flex items-center gap-3 cursor-pointer">
          <input
            :checked="minimizeToTray"
            type="checkbox"
            class="w-4 h-4 rounded accent-blue-500 cursor-pointer"
            @change="minimizeToTray = ($event.target as HTMLInputElement).checked"
          >
          <span class="text-xs text-zinc-300">Minimize to tray on close</span>
        </label>
        <p class="text-xs text-zinc-600 mt-2">
          Clicking × hides the app to the system tray instead of quitting. Right-click the tray icon to quit.
        </p>
      </section>
    </div>
  </div>
</template>

<style scoped>
.btn-secondary {
  @apply px-3 py-1.5 bg-zinc-800 hover:bg-zinc-700 text-zinc-200 font-medium rounded-lg
         border border-zinc-700 transition-colors duration-150 cursor-pointer;
}
</style>
