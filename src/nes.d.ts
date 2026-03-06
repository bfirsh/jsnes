import { ButtonKey } from "./controller";
import { GameGenie } from "./gamegenie";

export type ControllerId = 1 | 2;

export interface EmulatorData {
  cpu: object;
  mmap: object;
  ppu: object;
  papu: object;
}

export interface NESOptions {
  onFrame?: (buffer: Uint32Array) => void;
  onAudioSample?: (left: number, right: number) => void;
  onStatusUpdate?: (status: string) => void;
  onBatteryRamWrite?: (address: number, value: number) => void;
  emulateSound?: boolean;
  sampleRate?: number;
}

export class NES {
  constructor(opts: NESOptions);
  gameGenie: GameGenie;
  reset: () => void;
  frame: () => void;
  buttonDown: (controller: ControllerId, button: ButtonKey) => void;
  buttonUp: (controller: ControllerId, button: ButtonKey) => void;
  zapperMove: (x: number, y: number) => void;
  zapperFireDown: () => void;
  zapperFireUp: () => void;
  getFPS: () => number;
  reloadROM: () => void;
  loadROM: (data: string | Buffer | Uint8Array | ArrayBuffer) => void;
  setFramerate: (rate: number) => void;
  toJSON: () => EmulatorData;
  fromJSON: (data: EmulatorData) => void;
}
