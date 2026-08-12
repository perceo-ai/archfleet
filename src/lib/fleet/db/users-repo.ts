import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import type { Db } from "./db";

export type UserRole = "admin" | "operator" | "viewer";

export type User = {
  id: string;
  username: string;
  displayName: string;
  role: UserRole;
  createdAt: string;
  updatedAt: string;
};

const ROLES = new Set<UserRole>(["admin", "operator", "viewer"]);

function idFor(username: string): string {
  return `usr_${username.toLowerCase().replace(/[^a-z0-9_-]+/g, "_")}`;
}

function rowToUser(row: Record<string, unknown>): User {
  return {
    id: row.id as string,
    username: row.username as string,
    displayName: (row.display_name as string) || (row.username as string),
    role: row.role as UserRole,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
  };
}

export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString("base64url");
  const hash = scryptSync(password, salt, 32).toString("base64url");
  return `scrypt$${salt}$${hash}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [scheme, salt, hash] = stored.split("$");
  if (scheme !== "scrypt" || !salt || !hash) return false;
  const expected = Buffer.from(hash, "base64url");
  const actual = scryptSync(password, salt, expected.length);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

export function listUsers(db: Db): User[] {
  const rows = db.prepare("SELECT * FROM cuf_users ORDER BY username").all() as Record<
    string,
    unknown
  >[];
  return rows.map(rowToUser);
}

export function countUsers(db: Db): number {
  const row = db.prepare("SELECT COUNT(*) AS c FROM cuf_users").get() as { c: number };
  return row.c;
}

export function getUserByUsername(db: Db, username: string): (User & { passwordHash: string }) | undefined {
  const row = db.prepare("SELECT * FROM cuf_users WHERE username=?").get(username.trim().toLowerCase()) as
    | Record<string, unknown>
    | undefined;
  if (!row) return undefined;
  return { ...rowToUser(row), passwordHash: row.password_hash as string };
}

export function createUser(
  db: Db,
  input: { username: string; password: string; displayName?: string; role?: string },
  now = new Date().toISOString(),
): User {
  const username = input.username.trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9_-]{1,62}$/.test(username)) {
    throw new Error("username must be 2-63 lowercase letters, numbers, dashes or underscores");
  }
  if (input.password.length < 10) throw new Error("password must be at least 10 characters");
  const role = ROLES.has(input.role as UserRole) ? (input.role as UserRole) : "operator";
  db.prepare(
    `INSERT INTO cuf_users (id, username, display_name, role, password_hash, created_at, updated_at)
     VALUES (?,?,?,?,?,?,?)`,
  ).run(
    idFor(username),
    username,
    input.displayName?.trim() || username,
    role,
    hashPassword(input.password),
    now,
    now,
  );
  return getUserByUsername(db, username) as User;
}

export function deleteUser(db: Db, id: string): boolean {
  const row = db.prepare("SELECT role FROM cuf_users WHERE id=?").get(id) as
    | { role: UserRole }
    | undefined;
  if (!row) return false;
  if (row.role === "admin") {
    const admins = db.prepare("SELECT COUNT(*) AS c FROM cuf_users WHERE role='admin'").get() as {
      c: number;
    };
    if (admins.c <= 1) throw new Error("cannot delete the last admin");
  }
  return db.prepare("DELETE FROM cuf_users WHERE id=?").run(id).changes === 1;
}

export function ensureAdminFromEnv(db: Db): void {
  const username = process.env.CUF_ADMIN_USERNAME?.trim().toLowerCase();
  const password = process.env.CUF_ADMIN_PASSWORD;
  if (!username || !password || countUsers(db) > 0) return;
  createUser(db, { username, password, role: "admin", displayName: username });
}
