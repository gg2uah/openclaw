#!/bin/bash
#SBATCH --job-name=numpy-demo
#SBATCH --partition=gpu
#SBATCH --time=00:10:00
#SBATCH --nodes=1
#SBATCH --ntasks-per-node=1
#SBATCH --cpus-per-task=2
#SBATCH --mem=4G
#SBATCH --output=slurm-%j.out
#SBATCH --error=slurm-%j.err

set -euo pipefail

module load python/3.11
python3 numpy_transform.py
