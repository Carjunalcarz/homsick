import "server-only";

/*
 * Test support only, never imported by the app (src/server/queue/queue.test.ts,
 * "concurrency"): a separate process with its own better-sqlite3 connection
 * that records triage and issues Queue Numbers for the given patients, like a
 * second Triage Nurse at another workstation.
 *
 *   tsx --conditions=react-server src/test-support/queue-issue-worker.ts <db> <facilityId> <urgencyLevelId> <nowIso> <patientIdsJson>
 *
 * It prints "ready", waits for a line on stdin (so both workers start
 * together), issues one number per patient and prints the results as JSON.
 */

async function main() {
  const [dbPath, facilityId, urgencyLevelId, nowIso, patientIdsJson] = process.argv.slice(2);
  if (!dbPath || !facilityId || !urgencyLevelId || !nowIso || !patientIdsJson) {
    throw new Error("usage: issue-worker <db> <facilityId> <urgencyLevelId> <nowIso> <patientIdsJson>");
  }
  const { openDatabase } = await import("@/server/db/client");
  const { triageInputSchema } = await import("@/lib/triage");
  const { recordTriage } = await import("@/server/triage/service");

  const db = openDatabase(dbPath);
  const patientIds = JSON.parse(patientIdsJson) as string[];
  const now = new Date(nowIso);

  process.stdout.write("ready\n");
  await new Promise<void>((resolve) => process.stdin.once("data", () => resolve()));

  const results: { queueNumber: string | null; error?: string }[] = [];
  for (const patientId of patientIds) {
    try {
      const input = triageInputSchema.parse({
        patientId,
        chiefComplaint: "Cough",
        temperatureC: "37.0",
        bpSystolic: "120",
        bpDiastolic: "80",
        pulse: "80",
        respiratoryRate: "16",
        urgencyLevelId,
        facilityId,
      });
      const outcome = recordTriage(input, { type: "staff", id: `worker-${process.pid}`, name: "Worker" }, now, db);
      results.push({ queueNumber: outcome.queue?.queueNumber ?? null });
    } catch (error) {
      results.push({ queueNumber: null, error: error instanceof Error ? `${error.name}: ${error.message}` : String(error) });
    }
  }
  db.$client.close();
  process.stdout.write(`${JSON.stringify(results)}\n`);
  process.stdin.pause();
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack : error);
  process.exit(1);
});
