import type { FleetVm } from "./types";

export type RdpLaunchResult =
  | { mode: "guacamole"; launchUrl: string }
  | { mode: "rdp_file"; downloadUrl: string; reason: string };

type GuacamoleToken = {
  authToken: string;
};

type QuickConnectResponse =
  | string
  | {
      identifier?: string;
      connectionIdentifier?: string;
      id?: string;
    };

export function resolveCredential(source: string, env: Record<string, string | undefined> = process.env): string | undefined {
  const match = /^env:(.+)$/.exec(source);
  if (!match) return undefined;
  return env[match[1]];
}

export function buildRdpUri(vm: FleetVm, password?: string): string {
  const user = encodeURIComponent(vm.xrdp.username);
  const auth = password ? `${user}:${encodeURIComponent(password)}@` : `${user}@`;
  const params = new URLSearchParams({
    "ignore-cert": "true",
    "disable-audio": "true",
    security: "any",
  });
  return `rdp://${auth}${vm.xrdp.host}:${vm.xrdp.port}/?${params.toString()}`;
}

export function isGuacamoleConfigured(env: Record<string, string | undefined> = process.env): boolean {
  return Boolean(env.CUF_GUACAMOLE_URL && env.CUF_GUACAMOLE_USERNAME && env.CUF_GUACAMOLE_PASSWORD);
}

export async function createRdpLaunch(
  vm: FleetVm,
  opts: {
    fetchImpl?: typeof fetch;
    env?: Record<string, string | undefined>;
    downloadUrl: string;
  },
): Promise<RdpLaunchResult> {
  const env = opts.env ?? process.env;
  if (!isGuacamoleConfigured(env)) {
    return { mode: "rdp_file", downloadUrl: opts.downloadUrl, reason: "CUF_GUACAMOLE_URL is not configured" };
  }

  const baseUrl = normalizeBaseUrl(env.CUF_GUACAMOLE_URL as string);
  const publicBaseUrl = normalizeBaseUrl(env.CUF_GUACAMOLE_PUBLIC_URL ?? env.CUF_GUACAMOLE_URL as string);
  const fetchImpl = opts.fetchImpl ?? fetch;
  const token = await getGuacamoleToken(fetchImpl, baseUrl, env);
  const uri = buildRdpUri(vm, resolveCredential(vm.xrdp.credentialSource, env));
  const identifier = await createQuickConnect(fetchImpl, baseUrl, token.authToken, uri);
  return { mode: "guacamole", launchUrl: `${publicBaseUrl}/#/client/${encodeURIComponent(identifier)}?token=${encodeURIComponent(token.authToken)}` };
}

async function getGuacamoleToken(fetchImpl: typeof fetch, baseUrl: string, env: Record<string, string | undefined>): Promise<GuacamoleToken> {
  const body = new URLSearchParams({
    username: env.CUF_GUACAMOLE_USERNAME as string,
    password: env.CUF_GUACAMOLE_PASSWORD as string,
  });
  const res = await fetchImpl(`${baseUrl}/api/tokens`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!res.ok) throw new Error(`Guacamole auth failed (${res.status})`);
  const json = (await res.json()) as Partial<GuacamoleToken>;
  if (!json.authToken) throw new Error("Guacamole auth response did not include authToken");
  return { authToken: json.authToken };
}

async function createQuickConnect(fetchImpl: typeof fetch, baseUrl: string, token: string, uri: string): Promise<string> {
  const res = await fetchImpl(`${baseUrl}/api/session/ext/quickconnect/create?token=${encodeURIComponent(token)}`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ uri }),
  });
  if (!res.ok) throw new Error(`Guacamole quickconnect failed (${res.status})`);
  const json = (await res.json()) as QuickConnectResponse;
  const identifier =
    typeof json === "string"
      ? json
      : json.identifier ?? json.connectionIdentifier ?? json.id;
  if (!identifier) throw new Error("Guacamole quickconnect response did not include a connection identifier");
  return identifier;
}

function normalizeBaseUrl(url: string): string {
  return url.replace(/\/+$/, "");
}
