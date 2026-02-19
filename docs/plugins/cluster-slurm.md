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
- natural async workload execution (`run_workload`)
- workload follow-ups (`check_workload`, `fetch_workload_logs`, `download_workload_outputs`)
- low-level debugging actions (`init_run`, `upload`, `render_job`, `submit_job`, `job_status`, `job_logs`, `download`, `cancel_job`)

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
          "defaultCluster": "gautschi-cpu",
          "routing": {
            "defaultProfile": "gautschi-cpu",
            "gpuProfile": "gautschi-gpu",
            "gpuIndicators": ["torch.cuda", "--device cuda", "jax[cuda]", "tensorflow-gpu"],
            "autoFallbackToGpuOnSignatures": true
          },
          "localRunsDir": ".openclaw/cluster-runs",
          "clusters": {
            "gautschi-cpu": {
              "sshTarget": "gautschi",
              "remoteRoot": "/scratch/gautschi/<username>/openclaw-runs",
              "scheduler": "slurm",
              "loginShell": true,
              "moduleInitScripts": [
                "/etc/profile",
                "/etc/profile.d/modules.sh",
                "/usr/share/lmod/lmod/init/bash"
              ],
              "setupCommands": ["module --force purge", "module load rcac"],
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
              "loginShell": true,
              "moduleInitScripts": [
                "/etc/profile",
                "/etc/profile.d/modules.sh",
                "/usr/share/lmod/lmod/init/bash"
              ],
              "setupCommands": [
                "module --force purge",
                "module load modtree/gpu",
                "module use $HOME/privatemodules",
                "module load conda-env/openclaw-py3.12"
              ],
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
`/scratch/gautschi/<username>/openclaw-runs`) so compute I/O and artifacts land
on scratch by default.

Recommended selection pattern:

- Default to `gautschi-cpu`.
- Use `gautschi-gpu` for GPU workloads.
- Let `routing.gpuIndicators` detect GPU intent for natural requests like “replicate this paper”.

This keeps account/partition policy in config and avoids brittle prompt-only
routing.

Note: if your site does not allow `--gpus=<n>`, set `gpusPerNode` (or `gres`)
in `slurmDefaults`.

## Environment strategy (recommended)

For reliable multi-project use, keep environment setup in profile config instead
of prompts:

- Put cluster-specific module initialization in `moduleInitScripts`.
- Put policy-safe module loads in `setupCommands` (for example `module purge`,
  `module load modtree/gpu`).
- Set `loginShell: true` when a site only exposes modules through login shell
  initialization.
- Activate a persistent project/runtime environment from `setupCommands` (for
  example a private module like `conda-env/openclaw-py3.12`).

This avoids brittle prompt-level shell choreography and gives the agent a
stable runtime for natural requests like “run this on GPU”.

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

For natural prompts (“run this”, “replicate this paper”), the agent should use:

1. `cluster_slurm` action `run_workload` (non-blocking submit, returns `runId` + `jobId`)
2. `cluster_slurm` action `check_workload` for status
3. `cluster_slurm` action `fetch_workload_logs` for tail logs
4. `cluster_slurm` action `download_workload_outputs` for artifacts

`run_workload` always uses profile-managed environment bootstrap.
It rejects call-level `setupCommands`, `modules`, and
`headerOverrides.modules` so natural prompts cannot inject brittle ad-hoc
runtime setup.

For one-off debugging, use low-level `render_job` with
`allowEnvOverrides=true`.

Low-level actions are still available for debugging and manual control.

## Multi-cluster design

Add more clusters by adding entries under `clusters` (for example `bell`).

The tool always resolves through configured profiles, so users cannot route execution to arbitrary SSH targets.

## Example assets

See:

- `extensions/cluster-slurm/examples/gautschi/numpy_transform.py`
- `extensions/cluster-slurm/examples/gautschi/job.slurm`
