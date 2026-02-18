import fs from "node:fs/promises";
import path from "node:path";
import type { ClusterRunRecord, ClusterRunsLedger } from "./types.js";

const EMPTY_LEDGER: ClusterRunsLedger = { runs: {} };

export function ledgerPath(runsRoot: string): string {
  return path.join(runsRoot, "runs.json");
}

export async function loadLedger(runsRoot: string): Promise<ClusterRunsLedger> {
  const file = ledgerPath(runsRoot);
  try {
    const raw = await fs.readFile(file, "utf8");
    const parsed = JSON.parse(raw) as ClusterRunsLedger;
    if (!parsed || typeof parsed !== "object" || typeof parsed.runs !== "object") {
      return { ...EMPTY_LEDGER };
    }
    return parsed;
  } catch {
    return { ...EMPTY_LEDGER };
  }
}

export async function saveLedger(runsRoot: string, ledger: ClusterRunsLedger): Promise<void> {
  await fs.mkdir(runsRoot, { recursive: true });
  await fs.writeFile(ledgerPath(runsRoot), `${JSON.stringify(ledger, null, 2)}\n`, "utf8");
}

export async function upsertRun(
  runsRoot: string,
  run: ClusterRunRecord,
): Promise<ClusterRunsLedger> {
  const ledger = await loadLedger(runsRoot);
  ledger.runs[run.runId] = run;
  await saveLedger(runsRoot, ledger);
  return ledger;
}

export async function getRun(
  runsRoot: string,
  runId: string,
): Promise<ClusterRunRecord | undefined> {
  const ledger = await loadLedger(runsRoot);
  return ledger.runs[runId];
}
