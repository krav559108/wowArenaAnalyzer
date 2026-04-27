// FFmpeg wrapper for screen capture via AVFoundation + VideoToolbox.
//
// Recording pipeline:
//   start(outputPath) → FFmpeg spawned → resolves when capture is confirmed active
//   stop()            → sends 'q' to FFmpeg stdin → MP4 finalized → resolves with path
//
// Screen Recording permission must be granted in macOS System Settings before
// start() will succeed. Check with ScreenRecorder.checkScreenPermission() first.
//
// Default AVFoundation device: "1:none" (first screen, no audio).
// Run `ffmpeg -f avfoundation -list_devices true -i ""` to find the correct index.

import { EventEmitter } from 'events'
import { execSync, spawn } from 'child_process'
import type { ChildProcess } from 'child_process'
import { systemPreferences } from 'electron'
import { existsSync } from 'fs'
import { mkdir } from 'fs/promises'
import { dirname, join } from 'path'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ScreenPermissionStatus = 'granted' | 'denied' | 'not-determined' | 'restricted'

export interface RecorderOptions {
  // AVFoundation video device index or name ("Capture screen 0"). macOS only.
  captureDevice?: string
  // AVFoundation audio device index string ("0"). null / undefined = no audio. macOS only.
  audioDevice?: string | null
  // Video bitrate in kbps
  bitrateKbps?: number
  // Frames per second
  fps?: number
  // Output resolution, e.g. "1920x1080". undefined / "native" = no scaling.
  resolution?: string
  // Milliseconds to wait for FFmpeg to confirm capture started
  startupTimeoutMs?: number
  // Windows only: pre-detected H.264 encoder (h264_nvenc / h264_amf / h264_qsv / libx264).
  // If omitted, detectWindowsEncoder() probes automatically on first start().
  encoder?: string
}

export interface RecorderEventMap {
  // Fired when the FFmpeg process exits unexpectedly (not from a stop() call).
  // The RecorderStateMachine (Stage 4) listens here to transition to error state.
  unexpectedStop: { code: number | null; outputPath: string; stderrTail: string[] }
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

// Default AVFoundation screen device. Using the device name is more stable than
// an index — indices shift when cameras (e.g. iPhone via Continuity Camera) are
// added or removed. "Capture screen 0" is the primary display on macOS.
const DEFAULT_CAPTURE_DEVICE = 'Capture screen 0:none'
const DEFAULT_BITRATE_KBPS = 8000
const DEFAULT_FPS = 30
const DEFAULT_STARTUP_TIMEOUT_MS = 10_000

// Maximum number of FFmpeg stderr lines kept in memory for error diagnostics.
const MAX_STDERR_LINES = 200

// FFmpeg prints this line immediately before frame progress begins.
// Used to confirm that capture has started and to resolve start().
const FFMPEG_STARTED_RE = /Press \[q\] to stop|Output #0/i

// FFmpeg exits with 255 on SIGINT on some builds (in addition to the normal 0).
const GRACEFUL_EXIT_CODES = new Set([0, 255])

// ---------------------------------------------------------------------------
// ScreenRecorder
// ---------------------------------------------------------------------------

export class ScreenRecorder extends EventEmitter {
  private ffmpegProcess: ChildProcess | null = null
  private currentOutputPath: string | null = null
  private stderrLines: string[] = []

  private static cachedWindowsEncoder: string | null = null

  override emit<K extends keyof RecorderEventMap>(event: K, payload: RecorderEventMap[K]): boolean {
    return super.emit(event, payload)
  }

  override on<K extends keyof RecorderEventMap>(
    event: K,
    listener: (payload: RecorderEventMap[K]) => void
  ): this {
    return super.on(event, listener)
  }

  override once<K extends keyof RecorderEventMap>(
    event: K,
    listener: (payload: RecorderEventMap[K]) => void
  ): this {
    return super.once(event, listener)
  }

  // -------------------------------------------------------------------------
  // Static helpers
  // -------------------------------------------------------------------------

  // Returns the absolute path to the system FFmpeg binary.
  // Throws if FFmpeg is not installed.
  //
  // Finder-launched apps have a minimal PATH (/usr/bin:/bin:/usr/sbin:/sbin) that
  // excludes Homebrew. We therefore fall back to the two known Homebrew prefixes
  // after `which` fails: /opt/homebrew (Apple Silicon) and /usr/local (Intel).
  static resolveFfmpegPath(): string {
    if (process.platform === 'win32') {
      try {
        const p = execSync('where ffmpeg', { stdio: ['pipe', 'pipe', 'pipe'] })
          .toString()
          .trim()
          .split('\n')[0]
          ?.trim()
        if (p && p.length > 0) return p
      } catch {
        // where failed — try known install locations below.
      }
      const winCandidates = [
        join(process.env.ProgramFiles ?? 'C:\\Program Files', 'ffmpeg', 'bin', 'ffmpeg.exe'),
        join(process.env['ProgramFiles(x86)'] ?? 'C:\\Program Files (x86)', 'ffmpeg', 'bin', 'ffmpeg.exe'),
        join(process.env.LOCALAPPDATA ?? '', 'ffmpeg', 'bin', 'ffmpeg.exe'),
        'C:\\ffmpeg\\bin\\ffmpeg.exe',
      ]
      for (const candidate of winCandidates) {
        if (existsSync(candidate)) return candidate
      }
      throw new Error('FFmpeg not found. Download from https://ffmpeg.org/download.html and add to PATH.')
    }

    try {
      const p = execSync('which ffmpeg', { stdio: ['pipe', 'pipe', 'pipe'] })
        .toString()
        .trim()
      if (p.length > 0) return p
    } catch {
      // Terminal-launched path lookup failed — try known Homebrew locations below.
    }

    const candidates = ['/opt/homebrew/bin/ffmpeg', '/usr/local/bin/ffmpeg']
    for (const candidate of candidates) {
      if (existsSync(candidate)) return candidate
    }

    throw new Error('FFmpeg not found. Install via: brew install ffmpeg')
  }

  // Returns the current Screen Recording permission status.
  // 'granted' is required before start() will succeed.
  static checkScreenPermission(): ScreenPermissionStatus {
    if (process.platform === 'win32') return 'granted'
    return systemPreferences.getMediaAccessStatus('screen') as ScreenPermissionStatus
  }

  // Probes available H.264 encoders on Windows and returns the best one.
  // Result is cached — probing runs only once per process lifetime.
  // Order: h264_nvenc (Nvidia) → h264_amf (AMD) → h264_qsv (Intel) → libx264 (CPU fallback).
  static async detectWindowsEncoder(ffmpegPath: string): Promise<string> {
    if (ScreenRecorder.cachedWindowsEncoder !== null) {
      return ScreenRecorder.cachedWindowsEncoder
    }

    const candidates = ['h264_nvenc', 'h264_amf', 'h264_qsv', 'libx264']

    for (const enc of candidates) {
      const available = await new Promise<boolean>((resolve) => {
        const proc = spawn(
          ffmpegPath,
          ['-f', 'lavfi', '-i', 'color=black:s=2x2:d=0.1', '-vcodec', enc, '-frames:v', '1', '-f', 'null', '-'],
          { stdio: 'ignore' }
        )
        const timer = setTimeout(() => { proc.kill(); resolve(false) }, 5000)
        proc.on('close', (code) => { clearTimeout(timer); resolve(code === 0) })
        proc.on('error', () => { clearTimeout(timer); resolve(false) })
      })
      if (available) {
        console.warn(`[ScreenRecorder] Windows encoder detected: ${enc}`)
        ScreenRecorder.cachedWindowsEncoder = enc
        return enc
      }
    }

    ScreenRecorder.cachedWindowsEncoder = 'libx264'
    return 'libx264'
  }

  // Runs `ffmpeg -f avfoundation -list_devices true -i ""` and returns the output.
  // Useful for finding the correct screen device index.
  static listAvfoundationDevices(): Promise<string> {
    const ffmpegPath = ScreenRecorder.resolveFfmpegPath()

    return new Promise((resolve) => {
      const lines: string[] = []
      const proc = spawn(ffmpegPath, ['-f', 'avfoundation', '-list_devices', 'true', '-i', ''])

      proc.stderr?.on('data', (chunk: Buffer) => {
        lines.push(chunk.toString())
      })

      // FFmpeg exits with code 1 when listing devices (no input specified).
      proc.on('close', () => resolve(lines.join('')))
    })
  }

  // -------------------------------------------------------------------------
  // State
  // -------------------------------------------------------------------------

  isRecording(): boolean {
    return this.ffmpegProcess !== null
  }

  // Returns the last N stderr lines from FFmpeg — useful for error messages.
  getStderrTail(lines = 20): string[] {
    return this.stderrLines.slice(-lines)
  }

  // -------------------------------------------------------------------------
  // start
  // -------------------------------------------------------------------------

  // Spawns FFmpeg and resolves when capture is confirmed active.
  // Rejects if FFmpeg is not found, permission is missing, or startup times out.
  async start(outputPath: string, options: RecorderOptions = {}): Promise<void> {
    if (this.ffmpegProcess !== null) {
      throw new Error('ScreenRecorder is already recording')
    }

    const ffmpegPath = ScreenRecorder.resolveFfmpegPath()
    const permission = ScreenRecorder.checkScreenPermission()

    if (permission !== 'granted') {
      throw new Error(
        `Screen Recording permission is "${permission}". ` +
          'Grant access in System Settings > Privacy & Security > Screen Recording, ' +
          'then restart the app.'
      )
    }

    const device = options.captureDevice ?? DEFAULT_CAPTURE_DEVICE
    const audioDevice = options.audioDevice ?? null
    const bitrate = options.bitrateKbps ?? DEFAULT_BITRATE_KBPS
    const fps = options.fps ?? DEFAULT_FPS
    const resolution = options.resolution && options.resolution !== 'native' ? options.resolution : undefined
    const startupTimeout = options.startupTimeoutMs ?? DEFAULT_STARTUP_TIMEOUT_MS

    await mkdir(dirname(outputPath), { recursive: true })

    const encoder = process.platform === 'win32'
      ? (options.encoder ?? await ScreenRecorder.detectWindowsEncoder(ffmpegPath))
      : 'h264_videotoolbox'

    const args = buildFfmpegArgs({ device, audioDevice, bitrate, fps, resolution, outputPath, encoder })

    return new Promise<void>((resolve, reject) => {
      this.stderrLines = []
      let startupResolved = false

      const proc = spawn(ffmpegPath, args, { stdio: ['pipe', 'pipe', 'pipe'] })
      this.ffmpegProcess = proc
      this.currentOutputPath = outputPath

      const startupTimer = setTimeout(() => {
        if (!startupResolved) {
          startupResolved = true
          proc.kill('SIGKILL')
          this.ffmpegProcess = null
          this.currentOutputPath = null
          reject(
            new Error(
              `FFmpeg did not start recording within ${startupTimeout}ms. ` +
                `Last output:\n${this.stderrLines.slice(-10).join('\n')}`
            )
          )
        }
      }, startupTimeout)

      proc.stderr?.on('data', (chunk: Buffer) => {
        const text = chunk.toString()
        for (const line of text.split('\n')) {
          const trimmed = line.trimEnd()
          if (trimmed.length === 0) continue
          this.appendStderr(trimmed)

          if (!startupResolved && FFMPEG_STARTED_RE.test(trimmed)) {
            startupResolved = true
            clearTimeout(startupTimer)
            resolve()
          }
        }
      })

      proc.on('error', (err: Error) => {
        if (!startupResolved) {
          startupResolved = true
          clearTimeout(startupTimer)
          this.ffmpegProcess = null
          this.currentOutputPath = null
          reject(new Error(`Failed to spawn FFmpeg: ${err.message}`))
        }
      })

      proc.on('close', (code: number | null) => {
        clearTimeout(startupTimer)

        const wasTracked = this.ffmpegProcess === proc
        if (wasTracked) {
          this.ffmpegProcess = null
        }

        if (!startupResolved) {
          // Exited before we could confirm recording started
          startupResolved = true
          if (wasTracked) this.currentOutputPath = null
          reject(
            new Error(
              `FFmpeg exited (code ${code}) before recording started. ` +
                `Output:\n${this.stderrLines.slice(-20).join('\n')}`
            )
          )
        } else if (wasTracked) {
          // Process exited after start() resolved but without stop() being called.
          // Notify the state machine so it can transition to the error state.
          const savedPath = this.currentOutputPath ?? outputPath
          this.currentOutputPath = null
          this.emit('unexpectedStop', {
            code,
            outputPath: savedPath,
            stderrTail: this.stderrLines.slice(-20)
          })
        }
      })
    })
  }

  // -------------------------------------------------------------------------
  // stop
  // -------------------------------------------------------------------------

  // Sends 'q' to FFmpeg stdin for a graceful shutdown that finalises the MP4
  // container (writes the moov atom). Falls back to SIGINT if stdin is closed.
  // Resolves with the output path when FFmpeg exits cleanly.
  stop(): Promise<string> {
    if (this.ffmpegProcess === null || this.currentOutputPath === null) {
      return Promise.reject(new Error('ScreenRecorder is not recording'))
    }

    const proc = this.ffmpegProcess
    const outputPath = this.currentOutputPath

    // Clear references immediately so isRecording() returns false and a second
    // stop() call is rejected before the process actually exits.
    this.ffmpegProcess = null
    this.currentOutputPath = null

    return new Promise<string>((resolve, reject) => {
      proc.once('close', (code: number | null) => {
        if (code === null || GRACEFUL_EXIT_CODES.has(code)) {
          resolve(outputPath)
        } else {
          reject(
            new Error(
              `FFmpeg exited with unexpected code ${code}. ` +
                `Output:\n${this.stderrLines.slice(-20).join('\n')}`
            )
          )
        }
      })

      // Graceful stop via stdin 'q' — FFmpeg will finalize the container.
      if (proc.stdin?.writable) {
        proc.stdin.write('q')
        proc.stdin.end()
      } else {
        proc.kill('SIGINT')
      }
    })
  }

  // -------------------------------------------------------------------------
  // Private
  // -------------------------------------------------------------------------

  private appendStderr(line: string): void {
    this.stderrLines.push(line)
    if (this.stderrLines.length > MAX_STDERR_LINES) {
      this.stderrLines.shift()
    }
  }
}

// ---------------------------------------------------------------------------
// FFmpeg argument builder
// ---------------------------------------------------------------------------

interface FfmpegArgConfig {
  device: string
  audioDevice: string | null
  bitrate: number
  fps: number
  resolution?: string  // e.g. "1920x1080" — undefined means no scaling
  outputPath: string
  encoder: string  // h264_videotoolbox on macOS; h264_nvenc/amf/qsv/libx264 on Windows
}

function buildFfmpegArgs(cfg: FfmpegArgConfig): string[] {
  if (process.platform === 'win32') {
    return buildWindowsArgs(cfg)
  }
  return buildMacArgs(cfg)
}

function buildMacArgs(cfg: FfmpegArgConfig): string[] {
  // Build the AVFoundation device string: "videoIdx:audioIdx" or "videoIdx:none"
  const videoIdx = cfg.device.includes(':') ? cfg.device.split(':')[0]! : cfg.device
  const audioIdx = cfg.audioDevice !== null ? cfg.audioDevice : 'none'
  const deviceArg = `${videoIdx}:${audioIdx}`

  const args = [
    '-f',
    'avfoundation',
    '-framerate',
    String(cfg.fps),
    // uyvy422 is AVFoundation's native YUV format for screen capture (~2 bytes/px vs 4 for bgr0),
    // cutting memory bandwidth in half and removing the BGR→YUV conversion step.
    '-pixel_format',
    'uyvy422',
    '-i',
    deviceArg,

    // Encoder: VideoToolbox hardware H.264
    '-vcodec',
    'h264_videotoolbox',
    // Drop frames when encoder falls behind rather than queuing them.
    // Without this flag, VideoToolbox accumulates a backlog during high-load transitions
    // (e.g. solo shuffle round changes) and the output FPS collapses to 10-12.
    '-realtime',
    'true',
    '-pix_fmt',
    'yuv420p',
    '-b:v',
    `${cfg.bitrate}k`,
    '-r',
    String(cfg.fps),
    // Keyframe every 5 seconds. Forcing one every 1s (= fps) was 5× more expensive
    // on the encoder and contributed to thermal/CPU debt in long sessions.
    '-g',
    String(cfg.fps * 5),
  ]

  if (cfg.resolution) {
    const [w, h] = cfg.resolution.split('x')
    args.push('-vf', `scale=${w}:${h}`)
  }

  if (cfg.audioDevice !== null) {
    args.push('-acodec', 'aac', '-b:a', '128k')
  }

  args.push('-y', cfg.outputPath)
  return args
}

function buildWindowsArgs(cfg: FfmpegArgConfig): string[] {
  const args = [
    '-f',
    'gdigrab',
    '-framerate',
    String(cfg.fps),
    '-i',
    'desktop',
    '-vcodec',
    cfg.encoder,
    '-pix_fmt',
    'yuv420p',
    '-b:v',
    `${cfg.bitrate}k`,
    '-r',
    String(cfg.fps),
    '-g',
    String(cfg.fps * 5),
  ]

  // libx264 (CPU fallback) needs explicit realtime presets; HW encoders are fast by default.
  if (cfg.encoder === 'libx264') {
    args.push('-preset', 'ultrafast', '-tune', 'zerolatency')
  }

  if (cfg.resolution) {
    const [w, h] = cfg.resolution.split('x')
    args.push('-vf', `scale=${w}:${h}`)
  }

  // Audio capture on Windows requires DirectShow device configuration — not supported yet.

  args.push('-y', cfg.outputPath)
  return args
}
