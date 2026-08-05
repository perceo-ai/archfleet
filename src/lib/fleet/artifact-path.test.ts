import { describe, expect, it } from "vitest";
import { safeArtifactPath, contentTypeFor } from "./artifact-path";

describe("safeArtifactPath", () => {
  it("resolves a normal artifact under the run dir", () => {
    const p = safeArtifactPath("/data/artifacts", "run_1", "shot.png");
    expect(p).toBe("/data/artifacts/run_1/shot.png");
  });
  it("blocks path traversal via name", () => {
    // basename strips the traversal, so it stays inside the run dir
    const p = safeArtifactPath("/data/artifacts", "run_1", "../../etc/passwd");
    expect(p).toBe("/data/artifacts/run_1/passwd");
  });
  it("blocks traversal via runId", () => {
    const p = safeArtifactPath("/data/artifacts", "../secrets", "x.png");
    expect(p).toBe("/data/artifacts/secrets/x.png");
  });
});

describe("contentTypeFor", () => {
  it("maps extensions", () => {
    expect(contentTypeFor("a.png")).toBe("image/png");
    expect(contentTypeFor("a.json")).toBe("application/json");
    expect(contentTypeFor("a.bin")).toBe("application/octet-stream");
  });
});
