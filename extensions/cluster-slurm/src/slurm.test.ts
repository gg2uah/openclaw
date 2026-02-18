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
        cpusPerTask: 2,
        modules: ["python/3.11"],
      },
      env: { OMP_NUM_THREADS: "2" },
      modules: ["cuda/12"],
      setupCommands: ["echo setup"],
      commands: ["python3 run.py"],
    });

    expect(script).toContain("#SBATCH --job-name=demo");
    expect(script).toContain("#SBATCH --partition=gpu");
    expect(script).toContain("#SBATCH --cpus-per-task=2");
    expect(script).toContain("export OMP_NUM_THREADS='2'");
    expect(script).toContain("module load python/3.11");
    expect(script).toContain("module load cuda/12");
    expect(script).toContain("echo setup");
    expect(script).toContain("python3 run.py");
  });
});

describe("job id parsing", () => {
  it("parses standard sbatch output", () => {
    expect(parseSubmittedJobId("Submitted batch job 123456\n")).toBe("123456");
  });

  it("parses fallback numeric output", () => {
    expect(parseSubmittedJobId("job 777777 accepted")).toBe("777777");
  });
});
