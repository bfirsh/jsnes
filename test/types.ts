// Type-level test that exercises the public API declared in .d.ts files.
// This file is compiled (but not emitted) by `npm run typecheck` to catch
// drift between the TypeScript definitions and the actual implementation.
// If a declared method is removed or a type changes, this file will fail
// to compile and CI will catch it.

import {
  NES,
  NESOptions,
  EmulatorData,
  ControllerId,
} from "../src/nes.js";
import { Controller, ButtonKey } from "../src/controller.js";

// --- NESOptions ---

const opts: NESOptions = {
  onFrame(buffer: Uint32Array) {},
  onAudioSample(left: number, right: number) {},
  onStatusUpdate(status: string) {},
  onBatteryRamWrite(address: number, value: number) {},
  preferredFrameRate: 60,
  emulateSound: true,
  sampleRate: 44100,
};

// All options are optional
const minimal: NESOptions = {};

// --- NES class ---

const nes = new NES(opts);

nes.reset();
nes.frame();

// Controller IDs
const p1: ControllerId = 1;
const p2: ControllerId = 2;

nes.buttonDown(p1, Controller.BUTTON_A);
nes.buttonUp(p2, Controller.BUTTON_START);

nes.zapperMove(128, 120);
nes.zapperFireDown();
nes.zapperFireUp();

const fps: number = nes.getFPS();

nes.loadROM("rom-data");
nes.loadROM(new Uint8Array(16));
nes.loadROM(new ArrayBuffer(16));
nes.reloadROM();
nes.setFramerate(50);

// --- Save state round-trip ---

const state: EmulatorData = nes.toJSON();
const _cpu: object = state.cpu;
const _mmap: object = state.mmap;
const _ppu: object = state.ppu;
const _papu: object = state.papu;
nes.fromJSON(state);

// --- Controller class ---

const ctrl = new Controller();
const _state: number[] = ctrl.state;

const btn: ButtonKey = Controller.BUTTON_A;
ctrl.buttonDown(btn);
ctrl.buttonUp(Controller.BUTTON_B);
ctrl.clock();

// Verify all button constants are assignable to ButtonKey
const buttons: ButtonKey[] = [
  Controller.BUTTON_A,
  Controller.BUTTON_B,
  Controller.BUTTON_SELECT,
  Controller.BUTTON_START,
  Controller.BUTTON_UP,
  Controller.BUTTON_DOWN,
  Controller.BUTTON_LEFT,
  Controller.BUTTON_RIGHT,
  Controller.BUTTON_TURBO_A,
  Controller.BUTTON_TURBO_B,
];
