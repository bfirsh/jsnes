const SCREEN_WIDTH = 256;
const SCREEN_HEIGHT = 240;

export default class Screen {
  constructor(container, options = {}) {
    this.onMouseDown = options.onMouseDown;
    this.onMouseUp = options.onMouseUp;

    // Create canvas element
    this.canvas = document.createElement("canvas");
    this.canvas.width = SCREEN_WIDTH;
    this.canvas.height = SCREEN_HEIGHT;
    this.canvas.style.imageRendering = "pixelated";
    this.canvas.style.imageRendering = "crisp-edges";
    container.appendChild(this.canvas);

    // Mouse events for Zapper support
    this._handleMouseDown = (e) => {
      if (!this.onMouseDown) return;
      // Make coordinates unscaled
      let scale = SCREEN_WIDTH / parseFloat(this.canvas.style.width);
      let rect = this.canvas.getBoundingClientRect();
      let x = Math.round((e.clientX - rect.left) * scale);
      let y = Math.round((e.clientY - rect.top) * scale);
      this.onMouseDown(x, y);
    };
    this._handleMouseUp = () => {
      if (this.onMouseUp) this.onMouseUp();
    };
    this.canvas.addEventListener("mousedown", this._handleMouseDown);
    this.canvas.addEventListener("mouseup", this._handleMouseUp);

    this._initCanvas();
  }

  _initCanvas() {
    this.context = this.canvas.getContext("2d");
    this.imageData = this.context.getImageData(
      0,
      0,
      SCREEN_WIDTH,
      SCREEN_HEIGHT,
    );

    this.context.fillStyle = "black";
    // set alpha to opaque
    this.context.fillRect(0, 0, SCREEN_WIDTH, SCREEN_HEIGHT);

    // buffer to write on next animation frame
    this.buf = new ArrayBuffer(this.imageData.data.length);
    // Get the canvas buffer in 8bit and 32bit
    this.buf8 = new Uint8ClampedArray(this.buf);
    this.buf32 = new Uint32Array(this.buf);

    // Set alpha
    for (var i = 0; i < this.buf32.length; ++i) {
      this.buf32[i] = 0xff000000;
    }
  }

  setBuffer = (buffer) => {
    for (var y = 0; y < SCREEN_HEIGHT; ++y) {
      for (var x = 0; x < SCREEN_WIDTH; ++x) {
        var i = y * 256 + x;
        // Convert pixel from NES BGR to canvas ABGR
        this.buf32[i] = 0xff000000 | buffer[i]; // Full alpha
      }
    }
  };

  writeBuffer = () => {
    this.imageData.data.set(this.buf8);
    this.context.putImageData(this.imageData, 0, 0);
  };

  fitInParent = () => {
    let parent = this.canvas.parentNode;
    let parentWidth = parent.clientWidth;
    let parentHeight = parent.clientHeight;
    let parentRatio = parentWidth / parentHeight;
    let desiredRatio = SCREEN_WIDTH / SCREEN_HEIGHT;
    if (desiredRatio < parentRatio) {
      this.canvas.style.width = `${Math.round(parentHeight * desiredRatio)}px`;
      this.canvas.style.height = `${parentHeight}px`;
    } else {
      this.canvas.style.width = `${parentWidth}px`;
      this.canvas.style.height = `${Math.round(parentWidth / desiredRatio)}px`;
    }
  };

  screenshot() {
    var img = new Image();
    img.src = this.canvas.toDataURL("image/png");
    return img;
  }

  destroy() {
    this.canvas.removeEventListener("mousedown", this._handleMouseDown);
    this.canvas.removeEventListener("mouseup", this._handleMouseUp);
    this.canvas.parentNode.removeChild(this.canvas);
  }
}
