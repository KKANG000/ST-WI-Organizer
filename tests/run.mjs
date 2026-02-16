import assert from "node:assert/strict";
import { parseGroupPrefix, composeComment, validateGroupName } from "../src/parsing.js";
import { normalizeGroupOrderArray } from "../src/order.js";
import { computeRenderPlan, sortGroupEntries } from "../src/render.js";

function testParseGroupPrefix() {
  assert.deepEqual(parseGroupPrefix("::Group:: Title"), { group: "Group", title: "Title" });
  assert.deepEqual(parseGroupPrefix("::한글 그룹:: 제목"), { group: "한글 그룹", title: "제목" });
  assert.deepEqual(parseGroupPrefix("No prefix"), { group: null, title: "No prefix" });
  assert.deepEqual(parseGroupPrefix("::Broken: Title"), { group: null, title: "::Broken: Title" });
}

function testComposeComment() {
  assert.equal(composeComment("Group A", "Title"), "::Group A:: Title");
  assert.equal(composeComment(" Group   A ", "  Title  "), "::Group A:: Title");
}

function testValidateGroupName() {
  assert.equal(validateGroupName("Group").ok, true);
  assert.equal(validateGroupName(" ").ok, false);
  assert.equal(validateGroupName("Bad::Name").ok, false);
}

function testNormalizeGroupOrderArray() {
  assert.deepEqual(
    normalizeGroupOrderArray(["B", "A"], ["A", "C"]),
    ["A", "C"],
  );
  assert.deepEqual(
    normalizeGroupOrderArray([], ["A", "B"]),
    ["A", "B"],
  );
}

function makeMeta(uid, group, title) {
  return {
    uid: String(uid),
    group,
    title,
    rawComment: title,
    commentEl: null,
    entryEl: {
      querySelector: () => null,
    },
  };
}

function testSortTieBreaker() {
  const metas = [
    makeMeta(1, "G", "Zulu"),
    makeMeta(2, "G", "Alpha"),
  ];
  const sorted = sortGroupEntries(metas, {
    mode: "field",
    field: "comment",
    order: "asc",
  });
  assert.equal(sorted[0].title, "Alpha");
  assert.equal(sorted[1].title, "Zulu");
}

function testComputeRenderPlan() {
  const metas = [
    makeMeta(1, "B", "z"),
    makeMeta(2, null, "ungrouped"),
    makeMeta(3, "A", "a"),
    makeMeta(4, "B", "a"),
  ];

  const plan = computeRenderPlan(
    metas,
    ["A", "B"],
    { mode: "field", field: "comment", order: "asc" },
    (name) => name !== "B",
    (name) => name === "A",
  );

  assert.equal(plan.orderedGroups.length, 2);
  assert.equal(plan.orderedGroups[0].name, "A");
  assert.equal(plan.orderedGroups[0].collapsed, true);
  assert.equal(plan.orderedGroups[1].name, "B");
  assert.equal(plan.orderedGroups[1].enabled, false);
  assert.deepEqual(plan.orderedGroups[1].entries.map((x) => x.uid), ["4", "1"]);
}

function run() {
  testParseGroupPrefix();
  testComposeComment();
  testValidateGroupName();
  testNormalizeGroupOrderArray();
  testSortTieBreaker();
  testComputeRenderPlan();
  console.log("All tests passed.");
}

run();

