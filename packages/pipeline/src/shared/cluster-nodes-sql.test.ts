import assert from "node:assert/strict";
import test from "node:test";

import { buildClusterNodesSqlPlan, buildSelectClusterNodesStatement } from "./cluster-nodes.js";

test("builds cluster source select statement like Python cluster_nodes", () => {
  assert.deepEqual(buildSelectClusterNodesStatement("main"), {
    name: "select-world-nodes-cluster-source",
    sql: "SELECT id, embedding, properties_json FROM world_nodes WHERE dataset_id = $1 AND embedding IS NOT NULL AND status != 'deprecated'",
    params: ["main"],
  });
});

test("builds cluster node SQL update plan without executing database operations", () => {
  const plan = buildClusterNodesSqlPlan("main", [
    { id: "n1", properties_json: { old: true, community_id: 2, layout: { x: 1.5, y: 2.5 } } },
    { id: "n2", properties_json: { community_id: 3, layout: { x: 3, y: 4 } } },
  ]);

  assert.equal(plan.updates.length, 2);
  assert.deepEqual(plan.updates[0], {
    name: "update-world-node-cluster-layout",
    sql: "UPDATE world_nodes SET properties_json = $1::jsonb WHERE dataset_id = $2 AND id = $3",
    params: [{ old: true, community_id: 2, layout: { x: 1.5, y: 2.5 } }, "main", "n1"],
  });
  assert.deepEqual(plan.statements, plan.updates);
});
