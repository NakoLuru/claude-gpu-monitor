# gpu-monitor

A Claude Code mod that keeps a GPU monitor pane beside the chat. It runs `nvidia-smi` every 2 seconds and shows, for each GPU:

- name and temperature
- utilization and memory bars (green, yellow from 60%, red from 90%)
- the compute processes on it: PID, memory, and the full command line from `ps`, so `python` reads as `python -m vllm.entrypoints...`

`/gpu` opens the pane, and `/gpu` again closes it. Nothing is polled while the pane is not shown. When `nvidia-smi` fails, the pane shows its error.

Needs a Linux machine with an NVIDIA driver (`nvidia-smi` on the `PATH`).

## Install

At the prompt of a terminal session:

```
/plugin install gpu-monitor --marketplace NakoLuru/claude-gpu-monitor
```

Answer `y` to add the marketplace, then pick a scope (user scope first, chosen with Enter).

From a shell:

```
claude plugin install gpu-monitor --marketplace NakoLuru/claude-gpu-monitor
```

In the desktop app, where `/plugin` does not run: click + next to the prompt box, then Plugins, Add marketplace with `NakoLuru/claude-gpu-monitor`, then Add plugin.
