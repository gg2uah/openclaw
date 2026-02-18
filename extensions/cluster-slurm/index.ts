import type { AnyAgentTool, OpenClawPluginApi } from "openclaw/plugin-sdk";
import { buildClusterSlurmTool, parseClusterSlurmConfig } from "./src/tool.js";

const clusterSlurmPlugin = {
  id: "cluster-slurm",
  name: "Cluster SLURM",
  description: "Run reproducible SLURM jobs over SSH (upload, submit, status, logs, download).",
  configSchema: {
    parse: parseClusterSlurmConfig,
  },
  register(api: OpenClawPluginApi) {
    const config = parseClusterSlurmConfig(api.pluginConfig ?? {});

    api.registerTool(
      (ctx) =>
        buildClusterSlurmTool({
          config,
          workspaceDir:
            ctx.workspaceDir ?? api.config?.agents?.defaults?.workspace ?? process.cwd(),
        }) as AnyAgentTool,
      { optional: true },
    );

    api.logger.info(
      `[cluster-slurm] registered (${Object.keys(config.clusters).length} cluster profile${
        Object.keys(config.clusters).length === 1 ? "" : "s"
      })`,
    );
  },
};

export default clusterSlurmPlugin;
