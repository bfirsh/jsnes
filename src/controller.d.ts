export type ControllerKey = 1 | 2;

export type ButtonKey = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7;

export class Controller {
  state: number[];
  buttonDown: (key: ControllerKey) => void;
  buttonUp: (key: ControllerKey) => void;

  static readonly BUTTON_A = 0;
  static readonly BUTTON_B = 1;
  static readonly BUTTON_SELECT = 2;
  static readonly BUTTON_START = 3;
  static readonly BUTTON_UP = 4;
  static readonly BUTTON_DOWN = 5;
  static readonly BUTTON_LEFT = 6;
  static readonly BUTTON_RIGHT = 7;
}
