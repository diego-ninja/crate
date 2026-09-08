import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

const workflowNames = [
  "build-android.yml",
  "build-desktop.yml",
  "build-ios.yml",
  "test-backend.yml",
  "test-frontend.yml",
  "test-native-tools.yml",
  "test-readplane.yml",
];

const draftGuard =
  "github.event_name != 'pull_request' || github.event.pull_request.draft != true";

const prAgent = await readFile(
  join(process.cwd(), ".github", "workflows", "pr-agent.yml"),
  "utf8",
);
assert.match(prAgent, /github_action_config\.auto_review: "true"/);
assert.match(
  prAgent,
  /github_action_config\.auto_describe: .*pull_request_target.*draft == false/,
);
assert.match(
  prAgent,
  /github_action_config\.auto_improve: .*pull_request_target.*draft == false/,
);

for (const workflowName of workflowNames) {
  const workflow = await readFile(
    join(process.cwd(), ".github", "workflows", workflowName),
    "utf8",
  );
  const lines = workflow.split("\n");
  let inJobs = false;
  let currentJob = null;
  const jobs = new Map();

  for (const line of lines) {
    if (line === "jobs:") {
      inJobs = true;
      continue;
    }
    if (inJobs && /^\S/.test(line)) {
      inJobs = false;
      currentJob = null;
    }
    if (!inJobs) continue;

    const jobMatch = line.match(/^  ([A-Za-z0-9_-]+):$/);
    if (jobMatch) {
      currentJob = jobMatch[1];
      jobs.set(currentJob, "");
      continue;
    }
    const ifMatch = line.match(/^    if:\s*(.*)$/);
    if (currentJob && ifMatch) {
      jobs.set(currentJob, ifMatch[1]);
    }
  }

  assert.notEqual(jobs.size, 0, `${workflowName} must define jobs`);
  assert.match(
    workflow,
    /^  pull_request:\n    types: \[opened, reopened, synchronize, ready_for_review\]/m,
    `${workflowName} must rerun when a draft becomes ready for review`,
  );
  for (const [jobName, condition] of jobs) {
    assert.ok(
      condition.includes(draftGuard),
      `${workflowName}:${jobName} must skip draft pull requests`,
    );
  }
}

console.log(`Draft CI policy passed for ${workflowNames.length} workflows`);
