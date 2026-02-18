---
summary: "Run SLURM jobs on configured clusters over SSH (upload, submit, status, logs, download)"
read_when:
  - You want cluster-first execution for heavy compute workflows
  - You need reproducible SLURM runs across projects
  - You want to configure Gautschi first and add more clusters later
title: "Cluster SLURM"
---

# Cluster SLURM

`cluster-slurm` is an OpenClaw extension for running reproducible SLURM jobs over SSH.

It provides one optional agent tool, `cluster_slurm`, with actions for:

- listing configured clusters
- creating run-scoped working directories
- uploading local files
- rendering SLURM scripts from defaults + overrides
- submitting jobs (`sbatch`)
- checking status (`squeue` with `sacct` fallback)
- tailing logs
- downloading artifacts
- cancelling jobs (`scancel`)

## Install / Enable

Bundled extension path:

```bash
openclaw plugins enable cluster-slurm
```

Then configure it under `plugins.entries.cluster-slurm.config`.

## Gautschi config example

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
              "remoteRoot": "/scratch/gautschi/<username>/openclaw-runs",
              "scheduler": "slurm",
              "setupCommands": ["source ~/.bashrc"],
              "slurmDefaults": {
                "partition": "gpu",
                "account": "my-allocation",
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

For Gautschi, set `remoteRoot` to your scratch path (for example
`/scratch/gautschi/<username>/openclaw-runs`) so compute I/O and artifacts land
on scratch by default.

## Enable the optional tool

Add `cluster_slurm` to your tool allowlist (global or per-agent).

Examples:

```json
{
  "tools": {
    "allow": ["group:fs", "group:runtime", "cluster_slurm"]
  }
}
```

Or allow all optional plugin tools:

```json
{
  "tools": {
    "allow": ["group:plugins"]
  }
}
```

## Typical flow

1. `cluster_slurm` action `init_run`
2. `cluster_slurm` action `upload`
3. `cluster_slurm` action `render_job`
4. `cluster_slurm` action `submit_job`
5. `cluster_slurm` action `job_status`
6. `cluster_slurm` action `job_logs`
7. `cluster_slurm` action `download`

## Multi-cluster design

Add more clusters by adding entries under `clusters` (for example `bell`).

The tool always resolves through configured profiles, so users cannot route execution to arbitrary SSH targets.

## Example assets

See:

- `extensions/cluster-slurm/examples/gautschi/numpy_transform.py`
- `extensions/cluster-slurm/examples/gautschi/job.slurm`
