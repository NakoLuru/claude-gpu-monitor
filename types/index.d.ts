export type Gpu = {
  index: number
  uuid: string
  name: string
  memoryUsedMiB: number
  memoryTotalMiB: number
  utilizationPercent: number
  temperatureC: number
}

export type GpuProcess = {
  gpuUuid: string
  pid: number
  command: string
  memoryMiB: number
}

export type GpuSnapshot = {
  gpus: Gpu[]
  processes: GpuProcess[]
  updatedAt: number
  error: string | null
}

declare module 'claude-code' {
  interface PluginState {
    'gpu-monitor': { snapshot: Shaped<GpuSnapshot> }
  }
}
