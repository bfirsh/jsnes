class Controller {
  static BUTTON_A = 0;
  static BUTTON_B = 1;
  static BUTTON_SELECT = 2;
  static BUTTON_START = 3;
  static BUTTON_UP = 4;
  static BUTTON_DOWN = 5;
  static BUTTON_LEFT = 6;
  static BUTTON_RIGHT = 7;
  // Turbo buttons rapidly toggle A/B each frame while held, simulating the
  // extra buttons on the NES Advantage and dogbone controllers.
  static BUTTON_TURBO_A = 8;
  static BUTTON_TURBO_B = 9;

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

  buttonDown(key) {
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

  buttonUp(key) {
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
  clock() {
    if (!this.turboA && !this.turboB) return;
    this.turboToggle = !this.turboToggle;
    if (this.turboA) {
      this.state[Controller.BUTTON_A] = this.turboToggle ? 0x41 : 0x40;
    }
    if (this.turboB) {
      this.state[Controller.BUTTON_B] = this.turboToggle ? 0x41 : 0x40;
    }
  }
}

export default Controller;
