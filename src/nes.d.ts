import { ControllerKey, ButtonKey } from "./controller";

export interface EmulatorData {
  cpu: string;
  mmap: string;
  ppu: string;
  papu: string;
}

export interface NESOptions {
  onFrame?: (buffer: Buffer) => void;
  onAudioSample?: (left: number, right: number) => void;
  onStatusUpdate?: (status: string) => void;
  onBatteryRamWrite?: (address: number, value: number) => void;
  preferredFrameRate?: number;
  emulateSound?: boolean;
  sampleRate?: number;
}

export class NES {
  constructor(opts: NESOptions);
  stop: () => void;
  reset: () => void;
  frame: () => void;
  buttonDown: (controller: ControllerKey, button: ButtonKey) => void;
  buttonUp: (controller: ControllerKey, button: ButtonKey) => void;
  zapperMove: (x: number, y: number) => void;
  zapperFireDown: () => void;
  zapperFireUp: () => void;
  getFPS: () => number;
  reloadROM: () => void;
  loadROM: (data: string | Buffer) => void;
  setFramerate: (rate: number) => void;
  toJSON: () => EmulatorData;
  fromJSON: (data: EmulatorData) => void;
}
