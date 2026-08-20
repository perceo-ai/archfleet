// Persistence for user-defined node types. Definitions are data, so this is a
// plain table — installing a node is an insert, not a deploy.

import type { Db } from "./db";
import type { CustomNodeType, CustomNodeTypeInput, NodeTypeField } from "../node-types";

function rowToType(row: Record<string, unknown>): CustomNodeType {
  return {
    id: row.id as string,
    name: row.name as string,
    description: (row.description as string) ?? "",
    icon: (row.icon as string) ?? undefined,
    base: row.base as CustomNodeType["base"],
    fields: JSON.parse((row.fields_json as string) || "[]") as NodeTypeField[],
    template: (row.template as string) ?? "",
    successExpr: (row.success_expr as string) ?? undefined,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
  };
}

export function saveNodeType(db: Db, input: CustomNodeTypeInput, now = new Date().toISOString()): CustomNodeType {
  const existing = getNodeType(db, input.id);
  const type: CustomNodeType = {
    ...input,
    description: input.description ?? "",
    fields: input.fields ?? [],
    template: input.template ?? "",
    createdAt: existing?.createdAt ?? input.createdAt ?? now,
    updatedAt: now,
  };
  db.prepare(
    `INSERT OR REPLACE INTO cuf_node_types
       (id, name, description, icon, base, fields_json, template, success_expr, created_at, updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,?)`,
  ).run(
    type.id,
    type.name,
    type.description,
    type.icon ?? null,
    type.base,
    JSON.stringify(type.fields),
    type.template,
    type.successExpr ?? null,
    type.createdAt,
    type.updatedAt,
  );
  return type;
}

export function getNodeType(db: Db, id: string): CustomNodeType | undefined {
  const row = db.prepare("SELECT * FROM cuf_node_types WHERE id=?").get(id) as
    | Record<string, unknown>
    | undefined;
  return row ? rowToType(row) : undefined;
}

export function listNodeTypes(db: Db): CustomNodeType[] {
  const rows = db.prepare("SELECT * FROM cuf_node_types ORDER BY name").all() as Record<string, unknown>[];
  return rows.map(rowToType);
}

/** Keyed by id — the shape the orchestrator wants. */
export function nodeTypeRegistry(db: Db): Record<string, CustomNodeType> {
  return Object.fromEntries(listNodeTypes(db).map((t) => [t.id, t]));
}

export function deleteNodeType(db: Db, id: string): boolean {
  return db.prepare("DELETE FROM cuf_node_types WHERE id=?").run(id).changes === 1;
}
