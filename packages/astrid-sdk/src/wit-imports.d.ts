// Ambient type declarations for the Astrid host imports that ComponentizeJS
// resolves at componentize time. The JS-side import shape is
// `"astrid:capsule/<interface>@<version>"` with kebab-case function names
// converted to camelCase, per Phase 0 findings.
//
// One ambient module per WIT interface. Version is always `@0.1.0` because
// our `astrid-capsule.wit` declares `package astrid:capsule@0.1.0`. Per
// Phase 0, omitting the version causes a Wizer-time "module not found"
// error.

// ----------------------------------------------------------------------
// astrid:capsule/types — shared records used across interfaces
// ----------------------------------------------------------------------
declare module "astrid:capsule/types@0.1.0" {
  // No re-exported types are needed by the SDK — interfaces below re-import
  // the records they use directly. Kept as an alias module so the WIT
  // resolution path doesn't fail when a guest references `use types.{...}`.
}

// ----------------------------------------------------------------------
// astrid:capsule/sys
// ----------------------------------------------------------------------
declare module "astrid:capsule/sys@0.1.0" {
  export type LogLevel =
    | { tag: "trace" }
    | { tag: "debug" }
    | { tag: "info" }
    | { tag: "warn" }
    | { tag: "error" };

  export interface CallerContext {
    principal: string | undefined;
    sourceId: string;
    timestamp: string;
  }

  export interface CapabilityCheckRequest {
    sourceUuid: string;
    capability: string;
  }

  export interface CapabilityCheckResponse {
    allowed: boolean;
  }

  export function log(level: LogLevel, message: string): void;
  export function signalReady(): void;
  export function clockMs(): bigint;
  export function getCaller(): CallerContext;
  export function getConfig(key: string): string;
  export function triggerHook(requestJson: string): string;
  export function checkCapsuleCapability(
    request: CapabilityCheckRequest,
  ): CapabilityCheckResponse;
}

// ----------------------------------------------------------------------
// astrid:capsule/kv
// ----------------------------------------------------------------------
declare module "astrid:capsule/kv@0.1.0" {
  export function kvGet(key: string): Uint8Array | undefined;
  export function kvSet(key: string, value: Uint8Array): void;
  export function kvDelete(key: string): void;
  export function kvListKeys(prefix: string): string[];
  export function kvClearPrefix(prefix: string): bigint;
}

// ----------------------------------------------------------------------
// astrid:capsule/ipc
// ----------------------------------------------------------------------
declare module "astrid:capsule/ipc@0.1.0" {
  export interface IpcMessage {
    topic: string;
    payload: string;
    sourceId: string;
  }

  export interface IpcEnvelope {
    messages: IpcMessage[];
    dropped: bigint;
    lagged: bigint;
  }

  export interface InterceptorHandle {
    handleId: bigint;
    action: string;
    topic: string;
  }

  export function ipcPublish(topic: string, payload: string): void;
  // `ipc-publish-as` lives on sdk-rust's feat/ipc-publish-as branch but
  // hasn't landed in the kernel WIT yet. Re-enable when the kernel side
  // is wired up — see TODO in src/ipc.ts.
  // export function ipcPublishAs(topic: string, payload: string, principal: string): void;
  export function ipcSubscribe(topicPattern: string): bigint;
  export function ipcUnsubscribe(handleId: bigint): void;
  export function ipcPoll(handleId: bigint): IpcEnvelope;
  export function ipcRecv(handleId: bigint, timeoutMs: bigint): IpcEnvelope;
  export function getInterceptorHandles(): InterceptorHandle[];
}

// ----------------------------------------------------------------------
// astrid:capsule/fs
// ----------------------------------------------------------------------
declare module "astrid:capsule/fs@0.1.0" {
  export interface FileStat {
    size: bigint;
    isDir: boolean;
    mtime: bigint | undefined;
  }

  export function fsExists(path: string): boolean;
  export function fsMkdir(path: string): void;
  export function fsReaddir(path: string): string[];
  export function fsStat(path: string): FileStat;
  export function fsUnlink(path: string): void;
  export function readFile(path: string): Uint8Array;
  export function writeFile(path: string, content: Uint8Array): void;
}

// ----------------------------------------------------------------------
// astrid:capsule/net
// ----------------------------------------------------------------------
declare module "astrid:capsule/net@0.1.0" {
  export type NetReadStatus =
    | { tag: "data"; value: Uint8Array }
    | { tag: "closed" }
    | { tag: "pending" };

  export function netBindUnix(listenerHandle: bigint): bigint;
  export function netAccept(listenerHandle: bigint): bigint;
  export function netPollAccept(listenerHandle: bigint): bigint | undefined;
  export function netRead(streamHandle: bigint): NetReadStatus;
  export function netWrite(streamHandle: bigint, data: Uint8Array): void;
  export function netCloseStream(streamHandle: bigint): void;
}

// ----------------------------------------------------------------------
// astrid:capsule/http
// ----------------------------------------------------------------------
declare module "astrid:capsule/http@0.1.0" {
  export interface KeyValuePair {
    key: string;
    value: string;
  }

  export interface HttpRequestData {
    url: string;
    method: string;
    headers: KeyValuePair[];
    body: string | undefined;
  }

  export interface HttpResponseData {
    status: number;
    headers: KeyValuePair[];
    body: Uint8Array;
  }

  export interface HttpStreamStartResponse {
    handle: bigint;
    status: number;
    headers: KeyValuePair[];
  }

  export function httpRequest(request: HttpRequestData): HttpResponseData;
  export function httpStreamStart(request: HttpRequestData): HttpStreamStartResponse;
  export function httpStreamRead(streamHandle: bigint): Uint8Array;
  export function httpStreamClose(streamHandle: bigint): void;
}

// ----------------------------------------------------------------------
// astrid:capsule/process
// ----------------------------------------------------------------------
declare module "astrid:capsule/process@0.1.0" {
  export interface SpawnRequest {
    cmd: string;
    args: string[];
  }

  export interface ProcessResult {
    stdout: string;
    stderr: string;
    exitCode: number;
  }

  export interface SpawnBackgroundResult {
    id: bigint;
  }

  export interface ReadLogsResult {
    stdout: string;
    stderr: string;
    running: boolean;
    exitCode: number | undefined;
  }

  export interface KillProcessResult {
    killed: boolean;
    exitCode: number | undefined;
    stdout: string;
    stderr: string;
  }

  export function spawn(request: SpawnRequest): ProcessResult;
  export function spawnBackground(request: SpawnRequest): SpawnBackgroundResult;
  export function readLogs(processId: bigint): ReadLogsResult;
  export function kill(processId: bigint): KillProcessResult;
}

// ----------------------------------------------------------------------
// astrid:capsule/elicit
// ----------------------------------------------------------------------
declare module "astrid:capsule/elicit@0.1.0" {
  export interface ElicitRequest {
    elicitType: string;
    key: string;
    description: string;
    options: string[] | undefined;
    defaultValue: string | undefined;
  }

  export function elicit(request: ElicitRequest): string;
  export function hasSecret(key: string): boolean;
}

// ----------------------------------------------------------------------
// astrid:capsule/approval
// ----------------------------------------------------------------------
declare module "astrid:capsule/approval@0.1.0" {
  export interface ApprovalRequest {
    action: string;
    targetResource: string;
  }

  export interface ApprovalResponse {
    approved: boolean;
  }

  export function requestApproval(request: ApprovalRequest): ApprovalResponse;
}

// ----------------------------------------------------------------------
// astrid:capsule/identity
// ----------------------------------------------------------------------
declare module "astrid:capsule/identity@0.1.0" {
  export interface IdentityResolveRequest {
    platform: string;
    platformUserId: string;
  }

  export interface IdentityResolveResponse {
    found: boolean;
    userId: string | undefined;
    displayName: string | undefined;
    error: string | undefined;
  }

  export interface IdentityLinkRequest {
    platform: string;
    platformUserId: string;
    astridUserId: string;
    method: string;
  }

  export interface IdentityUnlinkRequest {
    platform: string;
    platformUserId: string;
  }

  export interface IdentityCreateUserRequest {
    displayName: string | undefined;
  }

  export interface IdentityListLinksRequest {
    astridUserId: string;
  }

  export interface IdentityOkResponse {
    ok: boolean;
    error: string | undefined;
    userId: string | undefined;
    removed: boolean | undefined;
    linksJson: string | undefined;
  }

  export function identityResolve(request: IdentityResolveRequest): IdentityResolveResponse;
  export function identityLink(request: IdentityLinkRequest): IdentityOkResponse;
  export function identityUnlink(request: IdentityUnlinkRequest): IdentityOkResponse;
  export function identityCreateUser(request: IdentityCreateUserRequest): IdentityOkResponse;
  export function identityListLinks(request: IdentityListLinksRequest): IdentityOkResponse;
}

// ----------------------------------------------------------------------
// astrid:capsule/uplink
// ----------------------------------------------------------------------
declare module "astrid:capsule/uplink@0.1.0" {
  export function uplinkRegister(name: string, platform: string, profile: string): string;
  export function uplinkSend(
    uplinkId: string,
    platformUserId: string,
    content: string,
  ): boolean;
}
