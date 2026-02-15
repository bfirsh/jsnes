import { NES } from "./nes";

export interface BrowserOptions {
  /** The container element to render into. */
  container: HTMLElement;
  /** ROM data to load immediately. If omitted, call loadROM() then start(). */
  romData?: string | null;
  /** Called when the emulator encounters an error during frame execution. */
  onError?: (error: Error) => void;
  /** Called when battery-backed SRAM is written. */
  onBatteryRamWrite?: (address: number, value: number) => void;
}

export class Browser {
  /** The underlying NES instance. */
  readonly nes: NES;
  /** The keyboard controller for configuring key mappings. */
  readonly keyboard: {
    keys: Record<number, [number, number, string]>;
    loadKeys: () => void;
    setKeys: (keys: Record<number, [number, number, string]>) => void;
  };
  /** The gamepad controller for configuring gamepad mappings. */
  readonly gamepad: {
    gamepadConfig: unknown;
    loadGamepadConfig: () => void;
    setGamepadConfig: (config: unknown) => void;
    promptButton: (callback: ((buttonInfo: unknown) => void) | null) => void;
  };

  constructor(options: BrowserOptions);

  /** Start emulation. Called automatically if romData is provided to constructor. */
  start(): void;
  /** Pause emulation. */
  stop(): void;
  /** Load a new ROM and start emulation. */
  loadROM(data: string): void;
  /** Re-layout the canvas to fill its container. */
  fitInParent(): void;
  /** Get a screenshot as an HTMLImageElement. */
  screenshot(): HTMLImageElement;
  /** Clean up all resources: stop emulation, remove listeners, remove canvas. */
  destroy(): void;

  /** Load ROM data from a URL via XHR. */
  static loadROMFromURL(
    url: string,
    callback: (error: Error | null, data?: string) => void,
  ): XMLHttpRequest;
}
