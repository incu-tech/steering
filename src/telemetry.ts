/**
 * Telemetry stub. The upstream skills CLI posts anonymous usage to a Vercel
 * endpoint; for an enterprise tool that's a data-leak footgun, so steering
 * ships a no-op. The API surface (track/flush/setVersion) is preserved so the
 * rest of the CLI doesn't need to know, and the opt-out env vars are still
 * honored — if telemetry is ever wired to an internal endpoint, gate it here.
 *
 * Opt-out: DISABLE_TELEMETRY=1 or DO_NOT_TRACK=1.
 */

let _version: string | null = null;

export function setVersion(version: string): void {
  _version = version;
}

export function getVersion(): string | null {
  return _version;
}

export function isTelemetryEnabled(): boolean {
  return !process.env.DISABLE_TELEMETRY && !process.env.DO_NOT_TRACK;
}

export type TelemetryEvent = Record<string, string | number | boolean | undefined>;

export function track(_event: TelemetryEvent): void {
  // No-op by design. See file header.
}

export async function flushTelemetry(): Promise<void> {
  // Nothing buffered; resolves immediately.
}
