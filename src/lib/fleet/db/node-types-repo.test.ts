import { describe, expect, it } from "vitest";
import { openDb } from "./db";
import {
  deleteNodeType,
  getNodeType,
  listNodeTypes,
  nodeTypeRegistry,
  saveNodeType,
} from "./node-types-repo";
import { validateNodeType } from "../node-types";
import type { CustomNodeType } from "../node-types";

const slack: CustomNodeType = {
  id: "slack",
  name: "Post to Slack",
  description: "Send a message",
  icon: "Send",
  base: "http",
  fields: [{ name: "webhook", label: "Webhook", type: "secret", required: true }],
  template: '{"url":"{{field.webhook}}","method":"POST"}',
  createdAt: "2026-08-12T00:00:00Z",
  updatedAt: "2026-08-12T00:00:00Z",
};

describe("node types repo", () => {
  it("round-trips a definition, fields and all", () => {
    const db = openDb(":memory:");
    saveNodeType(db, slack, "2026-08-12T00:00:00Z");
    expect(getNodeType(db, "slack")).toEqual(slack);
    expect(listNodeTypes(db)).toHaveLength(1);
    expect(nodeTypeRegistry(db).slack.name).toBe("Post to Slack");
    db.close();
  });

  it("keeps the original createdAt when a definition is edited", () => {
    const db = openDb(":memory:");
    saveNodeType(db, slack, "2026-08-12T00:00:00Z");
    const updated = saveNodeType(db, { ...slack, name: "Slack" }, "2026-08-13T00:00:00Z");
    expect(updated.createdAt).toBe("2026-08-12T00:00:00Z");
    expect(updated.updatedAt).toBe("2026-08-13T00:00:00Z");
    db.close();
  });

  it("deletes", () => {
    const db = openDb(":memory:");
    saveNodeType(db, slack);
    expect(deleteNodeType(db, "slack")).toBe(true);
    expect(deleteNodeType(db, "slack")).toBe(false);
    db.close();
  });
});

describe("validateNodeType", () => {
  it("accepts a well-formed definition", () => {
    expect(validateNodeType(slack)).toEqual([]);
  });

  it("catches the mistakes an author actually makes", () => {
    expect(validateNodeType({})).toContain("An id is required.");
    expect(validateNodeType({ ...slack, id: "has spaces" })[0]).toMatch(/id may only contain/);
    expect(validateNodeType({ ...slack, template: "" })).toContain(
      "The template is empty — there is nothing to run.",
    );
    expect(validateNodeType({ ...slack, template: "not json" })).toContain(
      "An HTTP node's template must be JSON with at least a url.",
    );
    expect(validateNodeType({ ...slack, template: '{"method":"POST"}' })).toContain(
      "The HTTP template has no url.",
    );
    expect(
      validateNodeType({ ...slack, fields: [{ name: "mode", label: "Mode", type: "select" }] }),
    ).toContain('Field "mode" is a picker with no options.');
  });
});
