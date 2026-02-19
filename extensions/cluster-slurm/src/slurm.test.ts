import { describe, expect, it } from "vitest";
import { mergeSlurmHeader, parseSubmittedJobId, renderSlurmScript } from "./slurm.js";

describe("slurm rendering", () => {
  it("merges defaults and overrides", () => {
    const merged = mergeSlurmHeader(
      { partition: "gpu", cpusPerTask: 4, modules: ["python/3.11"] },
      { cpusPerTask: 8, modules: ["cuda/12"] },
    );
    expect(merged.partition).toBe("gpu");
    expect(merged.cpusPerTask).toBe(8);
    expect(merged.modules).toEqual(["cuda/12"]);
  });

  it("renders directives, env, modules, and commands", () => {
    const script = renderSlurmScript({
      header: {
        jobName: "demo",
        partition: "gpu",
        ntasks: 1,
        cpusPerTask: 2,
        gpusPerNode: 1,
        modules: ["python/3.11"],
      },
      env: { OMP_NUM_THREADS: "2" },
      modules: ["cuda/12"],
      setupCommands: ["echo setup"],
      commands: ["python3 run.py"],
    });

    expect(script).toContain("#SBATCH --job-name=demo");
    expect(script).toContain("#SBATCH --partition=gpu");
    expect(script).toContain("#SBATCH --ntasks=1");
    expect(script).toContain("#SBATCH --cpus-per-task=2");
    expect(script).toContain("#SBATCH --gpus-per-node=1");
    expect(script).toContain("export OMP_NUM_THREADS='2'");
    expect(script).toContain("module load python/3.11");
    expect(script).toContain("module load cuda/12");
    expect(script).toContain("if ! type module >/dev/null 2>&1; then");
    expect(script).toContain("openclaw: module command unavailable");
    expect(script).toContain("echo setup");
    expect(script).toContain("python3 run.py");
  });

  it("bootstraps module command when setup commands use module without slurmDefaults.modules", () => {
    const script = renderSlurmScript({
      header: {},
      setupCommands: ["module use $HOME/privatemodules", "module load conda-env/openclaw"],
      commands: ["python3 run.py"],
    });

    expect(script).toContain("if ! type module >/dev/null 2>&1; then");
    expect(script).toContain("module use $HOME/privatemodules");
    expect(script).toContain("module load conda-env/openclaw");
  });

  it("supports profile-specific module init scripts", () => {
    const script = renderSlurmScript({
      header: { modules: ["modtree/gpu"] },
      moduleInitScripts: ["/custom/modules.sh"],
      commands: ["python3 run.py"],
    });

    expect(script).toContain("for __openclaw_mod_init in '/custom/modules.sh'; do");
    expect(script).toContain("module load modtree/gpu");
  });

  it("supports login-shell shebang for clusters that need profile initialization", () => {
    const script = renderSlurmScript({
      header: {},
      loginShell: true,
      commands: ["python3 run.py"],
    });
    expect(script.startsWith("#!/bin/bash -l\n")).toBe(true);
  });
});

describe("job id parsing", () => {
  it("parses standard sbatch output", () => {
    expect(parseSubmittedJobId("Submitted batch job 123456\n")).toBe("123456");
  });

  it("parses fallback numeric output", () => {
    expect(parseSubmittedJobId("job 777777 accepted")).toBe("777777");
  });

  it("rejects ambiguous GPU directives", () => {
    expect(() =>
      renderSlurmScript({
        header: {
          gpus: 1,
          gpusPerNode: 1,
        },
        commands: ["echo hello"],
      }),
    ).toThrow(/either gpus or gpusPerNode/);
  });
});
