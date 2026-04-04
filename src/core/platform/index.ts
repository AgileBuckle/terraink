import type { IPlatformAdapter } from "./ports";
import { webPlatformAdapter } from "./webPlatformAdapter";

let _adapter: IPlatformAdapter = webPlatformAdapter;
let _onAdapterChange: (() => void) | null = null;

export function onPlatformAdapterChange(cb: () => void): void {
  _onAdapterChange = cb;
}

export function setPlatformAdapter(adapter: IPlatformAdapter): void {
  _adapter = adapter;
  _onAdapterChange?.();
}

export function getPlatformAdapter(): IPlatformAdapter {
  return _adapter;
}

export function isNativePlatform(): boolean {
  return _adapter.isNative;
}
