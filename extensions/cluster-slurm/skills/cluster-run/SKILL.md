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
