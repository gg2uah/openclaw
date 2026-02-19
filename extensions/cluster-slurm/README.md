# Cluster SLURM Plugin

Run reproducible SLURM jobs over SSH from OpenClaw.

Features:

- Cluster profiles (Gautschi now, Bell/others later)
- Config-driven CPU/GPU routing for natural workload requests
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
              "submitArgs": [],
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
              "submitArgs": [],
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
`/scratch/gautschi/<username>/openclaw-runs`). Keep this as an absolute path so
all uploads, scripts, logs, and outputs stay on scratch by default.

Why two profiles:

- `gautschi-cpu`: default for CPU-only jobs
- `gautschi-gpu`: GPU jobs under `lilly-ibil` on `ai`

This keeps scheduling policy in config (not hardcoded in prompts/tool logic) and
makes it easy to add more clusters later.

Note: some clusters require GPU-per-node syntax. Use `gpusPerNode` (or `gres`)
instead of `gpus` when required by the site policy.

## Environment setup best practice

Keep runtime bootstrapping in config, not prompts:

- `moduleInitScripts`: candidate scripts for initializing `module` in non-login
  shells.
- `setupCommands`: module policy + environment activation for every run.
- `loginShell`: when `true`, render jobs with `#!/bin/bash -l` for sites where
  module setup is tied to login shell initialization.
- `slurmDefaults.modules`: shared module loads for that profile.

This keeps behavior deterministic across projects and avoids ad-hoc
tool/prompt-level shell logic.

### Missing package handling

If a workload fails with `ModuleNotFoundError`, install the package using the
same profile via `run_workload` (profile `setupCommands` will load the env
first), for example:

```bash
python3 -m pip install matplotlib
python3 -c "import matplotlib; print(matplotlib.__version__)"
```

Prefer `python3 -m pip ...` as default. Use `conda install ...` only when the
package specifically needs Conda.

## Tool

Enable this optional tool via `tools.allow` or `agents.list[].tools.allow`:

- `cluster_slurm`
- or `cluster-slurm`
- or `group:plugins`

Actions:

- `run_workload` (high-level async submit)
- `check_workload`
- `fetch_workload_logs`
- `download_workload_outputs`
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

1. `run_workload` to submit (returns `runId` + `jobId` immediately)
2. `check_workload` to inspect terminal/non-terminal state
3. `fetch_workload_logs` for latest output
4. `download_workload_outputs` for artifacts

`run_workload` is strictly profile-managed for environment bootstrap.
It rejects call-level `setupCommands`, `modules`, and `headerOverrides.modules`
to prevent brittle ad-hoc runtime changes.

For one-off debugging, use low-level `render_job` with
`allowEnvOverrides=true`.

Low-level actions remain available for debugging and explicit control.

See `examples/gautschi/` for a synthetic NumPy job.
