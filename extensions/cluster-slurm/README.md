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
          "defaultCluster": "gautschi",
          "localRunsDir": ".openclaw/cluster-runs",
          "clusters": {
            "gautschi": {
              "sshTarget": "gautschi",
              "remoteRoot": "~/agentic-labs/runs",
              "scheduler": "slurm",
              "submitArgs": [],
              "setupCommands": ["source ~/.bashrc"],
              "slurmDefaults": {
                "partition": "gpu",
                "account": "your-account",
                "time": "02:00:00",
                "nodes": 1,
                "ntasksPerNode": 1,
                "cpusPerTask": 4,
                "mem": "16G",
                "gpus": 1,
                "output": "slurm-%j.out",
                "error": "slurm-%j.err",
                "modules": ["python/3.11"]
              }
            }
          }
        }
      }
    }
  }
}
```

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
