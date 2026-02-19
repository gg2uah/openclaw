---
name: cluster_run
description: Cluster-first SLURM execution workflow (init/upload/render/submit/status/download) using the cluster_slurm tool.
metadata: { "openclaw": { "emoji": "🧪", "requires": { "tools": ["cluster_slurm"] } } }
---

# Cluster-first SLURM workflow

Use this skill when a task requires heavy compute (paper replication, model training, parameter sweeps, large preprocessing).

## Rules

- Run heavy compute on configured clusters via `cluster_slurm`.
- Keep local machine for orchestration, code edits, and result inspection.
- Use run-scoped directories and keep artifacts reproducible.
- Prefer explicit status updates with job IDs and paths.
- Use routing defaults for CPU vs GPU; only ask when signals are ambiguous and high-risk.
- `run_workload` is profile-managed for environment bootstrap and rejects
  call-level `setupCommands`/`modules`; use low-level `render_job` with
  `allowEnvOverrides=true` only for explicit debugging.
- If a job fails with `ModuleNotFoundError`, install packages inside the same
  profile environment (do not add inline `module`/`conda activate` commands).

## Cluster selection

- Start with `cluster_slurm` `list_clusters` to see available profiles.
- Choose profile by resource intent:
  - CPU workflows: choose `*-cpu` (or default profile).
  - GPU workflows: choose `*-gpu` (or profile with GPU defaults like
    `gpusPerNode`/`gres`).
- Keep account/partition policy in profile config; avoid ad-hoc overrides unless
  the user explicitly asks.

## Standard sequence

1. `cluster_slurm` `run_workload` (non-blocking submit)
2. `cluster_slurm` `check_workload`
3. `cluster_slurm` `fetch_workload_logs`
4. `cluster_slurm` `download_workload_outputs`

Low-level sequence (`init_run/upload/render_job/submit_job/...`) is still valid for debugging.

## Missing package recovery

When logs show `ModuleNotFoundError: No module named '<pkg>'`:

1. Keep the same profile (`*-cpu` or `*-gpu`) so profile `setupCommands` load
   the same environment.
2. Submit an install workload using `run_workload` with commands such as:
   - `python3 -m pip install <pkg>`
   - `python3 -c "import <pkg>; print(<pkg>.__version__)"`
3. Re-run the original workload.

Use `python3 -m pip ...` as default. Use `conda install ...` only when a package
specifically requires Conda and you accept slower solver/runtime behavior.

## Prompting template (for user messages)

Use this structure when asking for cluster work:

- Objective: what to run/replicate
- Cluster: profile id (`gautschi`, later `bell`, etc.)
- Inputs: files/data paths
- Resource intent: CPU/GPU/memory/time
- Outputs: expected files/metrics

## Deliverables to report back

- run ID
- cluster ID
- job ID(s)
- remote run path
- local artifact paths
- current status (running/completed/failed)
- next action
