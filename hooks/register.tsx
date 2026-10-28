import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Gpu, GpuProcess, GpuSnapshot } from '../types'

const PANE = 'gpu-monitor'
const TITLE = 'GPU'
const POLL_MS = 2000
const GPU_FIELDS = 'index,uuid,name,memory.used,memory.total,utilization.gpu,temperature.gpu'
const APP_FIELDS = 'gpu_uuid,pid,process_name,used_memory'

const EMPTY: GpuSnapshot = { gpus: [], processes: [], updatedAt: 0, error: null }
// Change the tag when the snapshot's fields change: it declines what an earlier
// version stored, which outlives a reload.
const snapshot = atom({ plugin: 'gpu-monitor', key: 'snapshot' } as const, EMPTY, {
  shape: 'snapshot-1',
})

function parseRows(stdout: string, width: number, what: string): string[][] {
  return stdout
    .split('\n')
    .map(line => line.trim())
    .filter(line => line !== '')
    .map(line => {
      const cells = line.split(',').map(cell => cell.trim())
      if (cells.length !== width) {
        throw new Error(`${what}: expected ${width} fields, got ${cells.length}: "${line}"`)
      }
      return cells
    })
}

function toNumber(cell: string | undefined, what: string): number {
  const value = Number(cell)
  if (cell === undefined || cell === '' || !Number.isFinite(value)) {
    throw new Error(`${what}: not a number: "${cell}"`)
  }
  return value
}

async function runChecked($: EngineInterface, argv: string[]): Promise<string> {
  const ran = await $.process.run(argv, { timeoutMs: 10_000 })
  if (ran.exitCode !== 0) {
    throw new Error(`${argv[0]} exited ${ran.exitCode}: ${(ran.stderr || ran.stdout).trim()}`)
  }
  return ran.stdout
}

// "/home/x/envs/vllm/bin/python -m vllm ..." reads better as "python -m vllm ...".
function shortenCommand(args: string): string {
  const [head = '', ...rest] = args.split(' ')
  return [head.split('/').pop() ?? head, ...rest].join(' ')
}

async function commandLines($: EngineInterface, pids: number[]): Promise<Map<number, string>> {
  const lines = new Map<number, string>()
  if (pids.length === 0) return lines
  // ps exits 1 when a pid has already gone; whatever it printed still counts.
  const ran = await $.process.run(['ps', '-o', 'pid=,args=', '-p', pids.join(',')], {
    timeoutMs: 5_000,
  })
  for (const line of ran.stdout.split('\n')) {
    const match = /^\s*(\d+)\s+(.+)$/.exec(line)
    if (match?.[1] && match[2]) lines.set(Number(match[1]), shortenCommand(match[2]))
  }
  return lines
}

async function sample($: EngineInterface): Promise<GpuSnapshot> {
  const gpuOut = await runChecked($, [
    'nvidia-smi',
    `--query-gpu=${GPU_FIELDS}`,
    '--format=csv,noheader,nounits',
  ])
  const gpus: Gpu[] = parseRows(gpuOut, 7, 'nvidia-smi --query-gpu').map(cells => ({
    index: toNumber(cells[0], 'gpu index'),
    uuid: cells[1] ?? '',
    name: (cells[2] ?? '').replace(/^NVIDIA (GeForce )?/, ''),
    memoryUsedMiB: toNumber(cells[3], 'memory.used'),
    memoryTotalMiB: toNumber(cells[4], 'memory.total'),
    utilizationPercent: toNumber(cells[5], 'utilization.gpu'),
    temperatureC: toNumber(cells[6], 'temperature.gpu'),
  }))
  if (gpus.length === 0) throw new Error('nvidia-smi listed no GPU')

  const appOut = await runChecked($, [
    'nvidia-smi',
    `--query-compute-apps=${APP_FIELDS}`,
    '--format=csv,noheader,nounits',
  ])
  const apps = parseRows(appOut, 4, 'nvidia-smi --query-compute-apps')
  const pids = apps.map(cells => toNumber(cells[1], 'pid'))
  const commands = await commandLines($, pids)
  const processes: GpuProcess[] = apps.map((cells, at) => {
    const pid = pids[at] ?? 0
    return {
      gpuUuid: cells[0] ?? '',
      pid,
      command: commands.get(pid) ?? (cells[2] ?? '').split('/').pop() ?? '',
      memoryMiB: toNumber(cells[3], 'used_memory'),
    }
  })

  return { gpus, processes, updatedAt: await $.clock.now(), error: null }
}

// Polls only while the pane is the one shown, so a closed pane costs nothing.
async function refresh($: EngineInterface): Promise<void> {
  const panes = await $.ui.panes()
  if (!panes.some(pane => pane.id === PANE && pane.isShown)) return
  let fresh: GpuSnapshot
  try {
    fresh = await sample($)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    fresh = { ...EMPTY, updatedAt: await $.clock.now(), error: message }
  }
  await update($, snapshot, () => fresh)
}

function bar(percent: number, width: number): string {
  const filled = Math.round((Math.min(100, Math.max(0, percent)) / 100) * width)
  return '[' + '#'.repeat(filled) + '.'.repeat(width - filled) + ']'
}

function level(percent: number): 'success' | 'warning' | 'error' {
  if (percent >= 90) return 'error'
  if (percent >= 60) return 'warning'
  return 'success'
}

function heat(celsius: number): 'success' | 'warning' | 'error' {
  if (celsius >= 80) return 'error'
  if (celsius >= 70) return 'warning'
  return 'success'
}

const gb = (mib: number) => (mib / 1024).toFixed(1)

function clockTime(ms: number): string {
  const at = new Date(ms)
  return [at.getHours(), at.getMinutes(), at.getSeconds()]
    .map(part => String(part).padStart(2, '0'))
    .join(':')
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'gpu',
      description: 'Toggle the GPU monitor pane (nvidia-smi, every 2 s)',
    })
    let isBusy = false
    $.clock.every(POLL_MS, () => {
      if (isBusy) return
      isBusy = true
      void refresh($).finally(() => {
        isBusy = false
      })
    })

    return next(e)
  })

  on('command.run', { command: 'gpu' }, async $ => {
    const isOpen = (await $.ui.panes()).some(pane => pane.id === PANE)
    if (isOpen) {
      await $.ui.close({ id: PANE })
      return { text: 'GPU pane closed.' }
    }
    await $.ui.open({ id: PANE, title: TITLE })
    await refresh($)

    return { text: 'GPU pane opened.' }
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text } = $.ui.resolve(e)
    const snap = await read($, snapshot)
    const columns = e.viewport?.columns ?? 60
    const width = Math.max(10, Math.min(30, columns - 26))

    if (snap.error !== null) {
      return (
        <Box flexDirection="column">
          <Text color="error">nvidia-smi failed</Text>
          <Text dimColor>{snap.error}</Text>
        </Box>
      )
    }
    if (snap.gpus.length === 0) return <Text dimColor>Reading nvidia-smi...</Text>

    return (
      <Box flexDirection="column">
        {snap.gpus.map(gpu => {
          const memPercent = (gpu.memoryUsedMiB / gpu.memoryTotalMiB) * 100
          const procs = snap.processes.filter(proc => proc.gpuUuid === gpu.uuid)
          return (
            <Box flexDirection="column" marginBottom={1}>
              <Box justifyContent="space-between">
                <Text bold>
                  GPU{gpu.index} {gpu.name}
                </Text>
                <Text color={heat(gpu.temperatureC)}>{gpu.temperatureC}C</Text>
              </Box>
              <Text>
                util <Text color={level(gpu.utilizationPercent)}>{bar(gpu.utilizationPercent, width)}</Text>{' '}
                {String(gpu.utilizationPercent).padStart(3)}%
              </Text>
              <Text>
                mem  <Text color={level(memPercent)}>{bar(memPercent, width)}</Text>{' '}
                {gb(gpu.memoryUsedMiB)}/{gb(gpu.memoryTotalMiB)} GB
              </Text>
              {procs.length === 0 && <Text dimColor>  no compute process</Text>}
              {procs.map(proc => (
                <Text wrap="truncate-end">
                  <Text dimColor>  {String(proc.pid).padEnd(8)}</Text>
                  {gb(proc.memoryMiB).padStart(5)} GB  {proc.command}
                </Text>
              ))}
            </Box>
          )
        })}
        <Text dimColor>
          updated {clockTime(snap.updatedAt)}, every {POLL_MS / 1000}s. /gpu closes
        </Text>
      </Box>
    )
  })
}
