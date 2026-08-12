import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import type { FleetVm } from "./types";

export type ProfileOperationAction = "prepare" | "update" | "recover";
export type ProfileOperationStatus = "running" | "waiting_for_capture" | "succeeded" | "failed";

export type ProfileOperationInput = {
  action: ProfileOperationAction;
  profile: string;
  clones?: number;
  task?: string;
  agentPassword?: string;
  repair?: boolean;
  sourceDomain?: string;
  sourceRdpPort?: number;
  sourceSshPort?: number;
};

export type ProfileOperation = {
  id: string;
  action: ProfileOperationAction;
  profile: string;
  task?: string;
  clones: number;
  status: ProfileOperationStatus;
  command: string[];
  startedAt: string;
  updatedAt: string;
  finishedAt?: string;
  exitCode?: number | null;
  logs: string[];
  sourceVm?: FleetVm;
};

type StoredOperation = ProfileOperation & {
  child?: ChildProcessWithoutNullStreams;
};

type Registry = {
  nextId: number;
  operations: Map<string, StoredOperation>;
};

const registryKey = Symbol.for("archfleet.profileOperations");
const globalWithRegistry = globalThis as typeof globalThis & { [registryKey]?: Registry };

function registry(): Registry {
  if (!globalWithRegistry[registryKey]) {
    globalWithRegistry[registryKey] = { nextId: 0, operations: new Map() };
  }
  return globalWithRegistry[registryKey];
}

function profileSlug(profile: string): string {
  return profile.replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "").toLowerCase();
}

export function buildProfileCommand(input: ProfileOperationInput): string[] {
  const profile = profileSlug(input.profile);
  const clones = Math.max(0, Math.floor(input.clones ?? 2));
  const base =
    input.action === "update"
      ? ["virt/update-profile.sh", "--profile", profile, "--clones", String(clones)]
      : input.action === "recover"
        ? ["virt/recover-profile.sh", "--profile", profile]
        : ["virt/prepare-profile.sh", "--profile", profile, "--clones", String(clones)];

  if (input.action !== "recover" && input.sourceDomain) base.push("--source", input.sourceDomain);
  if (input.action !== "recover" && input.sourceRdpPort) base.push("--source-rdp-port", String(input.sourceRdpPort));
  if (input.action !== "recover" && input.sourceSshPort) base.push("--source-ssh-port", String(input.sourceSshPort));
  if (input.action === "recover" && input.repair) base.push("--repair");
  return base;
}

export function sourceVmForOperation(input: ProfileOperationInput, id: string): FleetVm | undefined {
  if (input.action === "recover") return undefined;
  const host = process.env.CUF_PROFILE_SOURCE_HOST ?? process.env.CUF_GUEST_HOST ?? "127.0.0.1";
  const port = input.sourceRdpPort ?? Number(process.env.SOURCE_RDP_PORT ?? process.env.CUF_GUEST_RDP_PORT ?? "13389");
  const username = process.env.AGENT_USER ?? "agent";
  return {
    id: `profile_source_${id}`,
    name: `${profileSlug(input.profile)} source`,
    status: "running",
    labels: ["source", `profile:${profileSlug(input.profile)}`],
    cpu: 0,
    memoryGb: 4,
    diskGb: 25,
    xrdp: { host, port, username, credentialSource: "env:AGENT_PASSWORD" },
    ssh: {
      host: process.env.CUF_PROFILE_SOURCE_HOST ?? "127.0.0.1",
      port: input.sourceSshPort ?? Number(process.env.SOURCE_SSH_PORT ?? process.env.CUF_GUEST_SSH_PORT ?? "10022"),
      username,
    },
    lastHealthAt: new Date().toISOString(),
    domain: input.sourceDomain ?? process.env.CUF_GOLDEN_DOMAIN ?? "cuf-golden",
  };
}

export function listProfileOperations(): ProfileOperation[] {
  return [...registry().operations.values()].map(publicOperation);
}

export function getProfileOperation(id: string): ProfileOperation | undefined {
  const op = registry().operations.get(id);
  return op ? publicOperation(op) : undefined;
}

export function continueProfileOperation(id: string): ProfileOperation | undefined {
  const op = registry().operations.get(id);
  if (!op) return undefined;
  if (op.status === "waiting_for_capture" && op.child && !op.child.killed) {
    op.child.stdin.write("\n");
    op.status = "running";
    appendLog(op, "Capture confirmed from web UI.");
  }
  return publicOperation(op);
}

export function startProfileOperation(input: ProfileOperationInput): ProfileOperation {
  const profile = profileSlug(input.profile);
  if (!profile) throw new Error("profile is required");
  if (!["prepare", "update", "recover"].includes(input.action)) throw new Error("invalid profile action");

  const reg = registry();
  const id = `profile_op_${Date.now()}_${reg.nextId++}`;
  const command = buildProfileCommand({ ...input, profile });
  const now = new Date().toISOString();
  const op: StoredOperation = {
    id,
    action: input.action,
    profile,
    task: input.task,
    clones: Math.max(0, Math.floor(input.clones ?? 2)),
    status: "running",
    command,
    startedAt: now,
    updatedAt: now,
    logs: [],
    sourceVm: sourceVmForOperation({ ...input, profile }, id),
  };
  reg.operations.set(id, op);

  appendLog(op, `$ ${command.join(" ")}`);
  if (input.task) appendLog(op, `Task: ${input.task}`);

  const child = spawn("bash", command, {
    cwd: process.cwd(),
    env: {
      ...process.env,
      AGENT_PASSWORD: input.agentPassword || process.env.AGENT_PASSWORD || "",
      LIBVIRT_URI: process.env.CUF_LIBVIRT_URI || process.env.LIBVIRT_URI || "qemu:///session",
    },
    stdio: "pipe",
  });
  op.child = child;

  child.stdout.on("data", (chunk) => appendLog(op, chunk.toString()));
  child.stderr.on("data", (chunk) => appendLog(op, chunk.toString()));
  child.on("error", (err) => {
    op.status = "failed";
    op.finishedAt = new Date().toISOString();
    appendLog(op, `Process error: ${err.message}`);
  });
  child.on("exit", (code) => {
    op.exitCode = code;
    op.status = code === 0 ? "succeeded" : "failed";
    op.finishedAt = new Date().toISOString();
    appendLog(op, `Exited with code ${code ?? "unknown"}.`);
  });

  return publicOperation(op);
}

function appendLog(op: StoredOperation, text: string) {
  const parts = text.split(/\r?\n/);
  for (const line of parts) {
    if (!line) continue;
    op.logs.push(line);
  }
  if (text.includes("Press Enter when the VM is ready to capture")) {
    op.status = "waiting_for_capture";
  }
  if (op.logs.length > 400) op.logs.splice(0, op.logs.length - 400);
  op.updatedAt = new Date().toISOString();
}

function publicOperation(op: StoredOperation): ProfileOperation {
  const { child: _child, ...publicOp } = op;
  void _child;
  return { ...publicOp, logs: [...publicOp.logs] };
}
