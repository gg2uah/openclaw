# Cluster SLURM Plugin

Run reproducible SLURM jobs over SSH from OpenClaw.

Features:

- Cluster profiles (Gautschi now, Bell/others later)
- Run-scoped ledger (local + remote paths, job IDs)
- File upload/download via SCP
- SLURM script rendering with defaults + overrides
- `sbatch` submit + job status (`squeue` with `sacct` fallback)
- Log tail and `scancel`

## Config Example (Gautschi)

```json
{
  "plugins": {
    "entries": {
      "cluster-slurm": {
        "enabled": true,
        "config": {
          "defaultCluster": "gautschi-cpu",
          "localRunsDir": ".openclaw/cluster-runs",
          "clusters": {
            "gautschi-cpu": {
              "sshTarget": "gautschi",
              "remoteRoot": "/scratch/gautschi/<username>/openclaw-runs",
              "scheduler": "slurm",
              "submitArgs": [],
              "setupCommands": ["source ~/.bashrc"],
              "slurmDefaults": {
                "partition": "cpu",
                "account": "lilly-agentic-cpu",
                "time": "02:00:00",
                "nodes": 1,
                "ntasksPerNode": 1,
                "cpusPerTask": 4,
                "mem": "8G",
                "output": "slurm-%j.out",
                "error": "slurm-%j.err",
                "modules": ["python/3.11"]
              }
            },
            "gautschi-gpu": {
              "sshTarget": "gautschi",
              "remoteRoot": "/scratch/gautschi/<username>/openclaw-runs",
              "scheduler": "slurm",
              "submitArgs": [],
              "setupCommands": ["source ~/.bashrc"],
              "slurmDefaults": {
                "partition": "ai",
                "account": "lilly-ibil",
                "qos": "normal",
                "time": "04:00:00",
                "nodes": 1,
                "ntasks": 1,
                "cpusPerTask": 14,
                "gpusPerNode": 1,
                "mem": "16G",
                "output": "slurm-%j.out",
                "error": "slurm-%j.err",
                "modules": ["modtree/gpu"]
              }
            }
          }
        }
      }
    }
  }
}
```

For Gautschi, set `remoteRoot` to your scratch path (for example
`/scratch/gautschi/<username>/openclaw-runs`). Keep this as an absolute path so
all uploads, scripts, logs, and outputs stay on scratch by default.

Why two profiles:

- `gautschi-cpu`: default for CPU-only jobs
- `gautschi-gpu`: GPU jobs under `lilly-ibil` on `ai`

This keeps scheduling policy in config (not hardcoded in prompts/tool logic) and
makes it easy to add more clusters later.

Note: some clusters require GPU-per-node syntax. Use `gpusPerNode` (or `gres`)
instead of `gpus` when required by the site policy.

## Tool

Enable this optional tool via `tools.allow` or `agents.list[].tools.allow`:

- `cluster_slurm`
- or `cluster-slurm`
- or `group:plugins`

Actions:

- `list_clusters`
- `init_run`
- `upload`
- `render_job`
- `submit_job`
- `job_status`
- `job_logs`
- `download`
- `cancel_job`

## Example Workflow

1. `init_run` for `gautschi`
2. `upload` local scripts/data
3. `render_job` using defaults + per-run overrides
4. `submit_job` and capture job ID
5. `job_status` until completion
6. `job_logs` to inspect output
7. `download` artifacts to workspace

See `examples/gautschi/` for a synthetic NumPy job.
