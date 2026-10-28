import { expect, test } from 'claude-code/testing'

const PANE = {
  plugin: 'gpu-monitor',
  component: 'Pane',
  requestId: 'gpu-monitor',
  props: {
    title: 'GPU',
    isFocused: false,
    bodyColumns: 60,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 20 },
    view: {},
  },
} as const

const RUN_GPU = {
  command: 'gpu',
  args: '',
  origin: { kind: 'composer' },
  presentation: { isFullscreen: true, columns: 160 },
} as const

const GPUS = [
  '0, GPU-aaa, NVIDIA GeForce RTX 4090, 12288, 49140, 95, 81',
  '1, GPU-bbb, NVIDIA GeForce RTX 4090, 12, 49140, 0, 33',
].join('\n')
const APPS = 'GPU-aaa, 4242, /envs/vllm/bin/python, 12000'
const PS = ' 4242 /envs/vllm/bin/python -m vllm.entrypoints.openai.api_server'

test('/gpu opens the pane and draws each GPU and its processes', async ($, on) => {
  let isOpen = false
  on('command.register', () => ({ value: { command: 'gpu' } }))
  on('ui.open', () => {
    isOpen = true
    return { value: { isPlaced: true } }
  })
  on('ui.panes', () => ({
    value: isOpen
      ? [{ id: 'gpu-monitor', title: 'GPU', isShown: true, isFocused: false, isPlaced: true }]
      : [],
  }))
  on('clock.now', () => ({ value: 0 }))
  on('process.run', (_, e) => {
    const flag = e.argv[1] ?? ''
    const stdout = e.argv[0] === 'ps' ? PS : flag.startsWith('--query-gpu') ? GPUS : APPS
    return {
      value: { exitCode: 0, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false },
    }
  })
  on('session.start', (_, e) => ({ cwd: e.cwd }))

  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.command.run(RUN_GPU)

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })
    expect((await ui.find({ type: 'Text', text: /GPU0 RTX 4090/ }))?.text).toBe('GPU0 RTX 4090')
    expect((await ui.find({ type: 'Text', text: /4242/ }))?.text).toContain(
      'python -m vllm.entrypoints',
    )
    expect((await ui.find({ type: 'Text', text: /no compute process/ }))?.text).toBeTruthy()
    await ui.unmount()
  }
})

test('a failing nvidia-smi shows its error in the pane', async ($, on) => {
  let isOpen = false
  on('command.register', () => ({ value: { command: 'gpu' } }))
  on('ui.open', () => {
    isOpen = true
    return { value: { isPlaced: true } }
  })
  on('ui.panes', () => ({
    value: isOpen
      ? [{ id: 'gpu-monitor', title: 'GPU', isShown: true, isFocused: false, isPlaced: true }]
      : [],
  }))
  on('clock.now', () => ({ value: 0 }))
  on('process.run', () => ({
    value: {
      exitCode: 9,
      stdout: '',
      stderr: 'NVIDIA-SMI has failed',
      isStdoutTruncated: false,
      isStderrTruncated: false,
    },
  }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))

  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.command.run(RUN_GPU)

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect((await ui.find({ type: 'Text', text: /exited 9/ }))?.text).toContain(
    'NVIDIA-SMI has failed',
  )
  await ui.unmount()
})
