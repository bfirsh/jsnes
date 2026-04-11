import { toJSON, fromJSON } from "./utils.ts";

export type ButtonKey = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9;

export interface ControllerState {
  state: number[];
  baseA: number;
  baseB: number;
  turboA: boolean;
  turboB: boolean;
  turboToggle: boolean;
}

class Controller {
  static readonly BUTTON_A = 0;
  static readonly BUTTON_B = 1;
  static readonly BUTTON_SELECT = 2;
  static readonly BUTTON_START = 3;
  static readonly BUTTON_UP = 4;
  static readonly BUTTON_DOWN = 5;
  static readonly BUTTON_LEFT = 6;
  static readonly BUTTON_RIGHT = 7;
  // Turbo buttons rapidly toggle A/B each frame while held, simulating the
  // extra buttons on the NES Advantage and dogbone controllers.
  static readonly BUTTON_TURBO_A = 8;
  static readonly BUTTON_TURBO_B = 9;

  static readonly JSON_PROPERTIES = [
    "state",
    "baseA",
    "baseB",
    "turboA",
    "turboB",
    "turboToggle",
  ] as const;

  state: number[];
  baseA: number;
  baseB: number;
  turboA: boolean;
  turboB: boolean;
  turboToggle: boolean;

  constructor() {
    this.state = new Array(8);
    for (let i = 0; i < this.state.length; i++) {
      this.state[i] = 0x40;
    }
    // Track the non-turbo ("base") state of A and B so we can restore them
    // when turbo is released while the regular button is still held.
    this.baseA = 0x40;
    this.baseB = 0x40;
    this.turboA = false;
    this.turboB = false;
    this.turboToggle = false;
  }

  buttonDown(key: ButtonKey): void {
    if (key === Controller.BUTTON_TURBO_A) {
      this.turboA = true;
    } else if (key === Controller.BUTTON_TURBO_B) {
      this.turboB = true;
    } else {
      this.state[key] = 0x41;
      if (key === Controller.BUTTON_A) this.baseA = 0x41;
      if (key === Controller.BUTTON_B) this.baseB = 0x41;
    }
  }

  buttonUp(key: ButtonKey): void {
    if (key === Controller.BUTTON_TURBO_A) {
      this.turboA = false;
      this.state[Controller.BUTTON_A] = this.baseA;
    } else if (key === Controller.BUTTON_TURBO_B) {
      this.turboB = false;
      this.state[Controller.BUTTON_B] = this.baseB;
    } else {
      this.state[key] = 0x40;
      if (key === Controller.BUTTON_A) this.baseA = 0x40;
      if (key === Controller.BUTTON_B) this.baseB = 0x40;
    }
  }

  // Called once per frame to toggle turbo button states. Produces a ~30 Hz
  // press rate at 60 FPS, matching the fast end of the NES Advantage's
  // adjustable turbo range.
  clock(): void {
    if (!this.turboA && !this.turboB) return;
    this.turboToggle = !this.turboToggle;
    if (this.turboA) {
      this.state[Controller.BUTTON_A] = this.turboToggle ? 0x41 : 0x40;
    }
    if (this.turboB) {
      this.state[Controller.BUTTON_B] = this.turboToggle ? 0x41 : 0x40;
    }
  }

  toJSON(): ControllerState {
    return toJSON(this) as ControllerState;
  }

  fromJSON(s: ControllerState): void {
    fromJSON(this, s);
  }
}

export default Controller;
