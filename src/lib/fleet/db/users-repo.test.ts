import { describe, expect, it } from "vitest";
import { openDb } from "./db";
import { createUser, deleteUser, getUserByUsername, listUsers, verifyPassword } from "./users-repo";

describe("users-repo", () => {
  it("creates users with hashed passwords and verifies login", () => {
    const db = openDb(":memory:");
    const user = createUser(db, {
      username: "alice",
      password: "correct horse battery staple",
      role: "admin",
    });
    expect(user.role).toBe("admin");
    const withHash = getUserByUsername(db, "alice");
    expect(withHash?.passwordHash).not.toContain("correct horse");
    expect(verifyPassword("correct horse battery staple", withHash?.passwordHash ?? "")).toBe(true);
    expect(verifyPassword("wrong password", withHash?.passwordHash ?? "")).toBe(false);
    db.close();
  });

  it("prevents deleting the last admin", () => {
    const db = openDb(":memory:");
    const admin = createUser(db, { username: "admin", password: "password one", role: "admin" });
    expect(() => deleteUser(db, admin.id)).toThrow(/last admin/);
    createUser(db, { username: "bob", password: "password two", role: "operator" });
    expect(listUsers(db)).toHaveLength(2);
    db.close();
  });
});
