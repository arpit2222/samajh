import "dotenv/config";
import { initDatabase } from "../src/db/firestore.js";
import { runCohortClusteringBatch } from "../src/jobs/cohortClusteringJob.js";

async function main() {
  await initDatabase();
  const partnerId = process.argv[2] || null;
  const result = await runCohortClusteringBatch({ partnerId });
  console.log(
    `[CohortClusteringJob] Processed ${result.cohorts_processed} cohort(s), clustered ${result.total_sessions_clustered} session(s).`
  );
  process.exit(0);
}

main().catch((err) => {
  console.error("[CohortClusteringJob] Fatal error:", err);
  process.exit(1);
});
