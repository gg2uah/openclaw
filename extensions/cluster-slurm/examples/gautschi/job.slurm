#!/bin/bash
#SBATCH --job-name=numpy-demo
#SBATCH --partition=ai
#SBATCH --qos=normal
#SBATCH --account=lilly-ibil
#SBATCH --time=00:30:00
#SBATCH --nodes=1
#SBATCH --ntasks=1
#SBATCH --cpus-per-task=14
#SBATCH --gpus-per-node=1
#SBATCH --mem=8G
#SBATCH --output=slurm-%j.out
#SBATCH --error=slurm-%j.err

set -euo pipefail

module --force purge
module load modtree/gpu
module use "$HOME/privatemodules"
module load conda-env/mypackages-py3.12.5
python3 numpy_transform.py
