export type ButtonKey = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9;

export class Controller {
  state: number[];
  baseA: number;
  baseB: number;
  turboA: boolean;
  turboB: boolean;
  turboToggle: boolean;

  buttonDown: (key: ButtonKey) => void;
  buttonUp: (key: ButtonKey) => void;
  clock: () => void;
  toJSON(): {
    state: number[];
    baseA: number;
    baseB: number;
    turboA: boolean;
    turboB: boolean;
    turboToggle: boolean;
  };
  fromJSON(state: {
    state: number[];
    baseA: number;
    baseB: number;
    turboA: boolean;
    turboB: boolean;
    turboToggle: boolean;
  }): void;

  static readonly BUTTON_A = 0;
  static readonly BUTTON_B = 1;
  static readonly BUTTON_SELECT = 2;
  static readonly BUTTON_START = 3;
  static readonly BUTTON_UP = 4;
  static readonly BUTTON_DOWN = 5;
  static readonly BUTTON_LEFT = 6;
  static readonly BUTTON_RIGHT = 7;
  static readonly BUTTON_TURBO_A = 8;
  static readonly BUTTON_TURBO_B = 9;
  static readonly JSON_PROPERTIES: readonly [
    "state",
    "baseA",
    "baseB",
    "turboA",
    "turboB",
    "turboToggle",
  ];
}
