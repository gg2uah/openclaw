#!/usr/bin/env python3
"""Synthetic demo job for cluster-slurm plugin testing.

Creates a random array, applies simple transforms, and writes output artifacts.
"""

from __future__ import annotations

import json
from pathlib import Path

import numpy as np


def main() -> None:
    out_dir = Path("./outputs")
    out_dir.mkdir(parents=True, exist_ok=True)

    rng = np.random.default_rng(seed=42)
    arr = rng.normal(loc=0.0, scale=1.0, size=(256, 256)).astype(np.float32)

    transformed = np.tanh(arr) + 0.1 * np.sin(arr)

    np.save(out_dir / "array_raw.npy", arr)
    np.save(out_dir / "array_transformed.npy", transformed)

    stats = {
        "raw": {
            "mean": float(arr.mean()),
            "std": float(arr.std()),
            "min": float(arr.min()),
            "max": float(arr.max()),
        },
        "transformed": {
            "mean": float(transformed.mean()),
            "std": float(transformed.std()),
            "min": float(transformed.min()),
            "max": float(transformed.max()),
        },
    }

    (out_dir / "stats.json").write_text(json.dumps(stats, indent=2), encoding="utf-8")
    print("Wrote outputs/array_raw.npy, outputs/array_transformed.npy, outputs/stats.json")


if __name__ == "__main__":
    main()
