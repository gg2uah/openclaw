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
- If resource intent is unclear (CPU vs GPU), ask once before submitting.

## Cluster selection

- Start with `cluster_slurm` `list_clusters` to see available profiles.
- Choose profile by resource intent:
  - CPU workflows: choose `*-cpu` (or default profile).
  - GPU workflows: choose `*-gpu` (or profile with GPU defaults like
    `gpusPerNode`/`gres`).
- Keep account/partition policy in profile config; avoid ad-hoc overrides unless
  the user explicitly asks.

## Standard sequence

1. `cluster_slurm` `init_run`
2. `cluster_slurm` `upload`
3. `cluster_slurm` `render_job`
4. `cluster_slurm` `submit_job`
5. Poll via `cluster_slurm` `job_status`
6. Inspect `cluster_slurm` `job_logs`
7. Retrieve artifacts via `cluster_slurm` `download`

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
