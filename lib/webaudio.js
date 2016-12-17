class WebAudio {
  constructor () {
    let ref;
    if ((window.AudioContext != null) || (window.webKitAudioContext != null)) {
      this.context = new ((ref = window.AudioContext) != null ? ref : window.webKitAudioContext);
      this.supported = true;
    } else {
      this.supported = false;
    }
  }

  writeStereo (samplesL, samplesR) {
    samplesL = new Float32Array(samplesL);
    samplesR = new Float32Array(samplesR);
    let bufferSize = samplesL.length;
    let buffer = this.context.createBuffer(2, bufferSize, 88200); // 44100
    if (buffer.copyToChannel != null) {
      buffer.copyToChannel(samplesL, 0);
      buffer.copyToChannel(samplesR, 1);
    } else {
      let left = buffer.getChannelData(0);
      let right = buffer.getChannelData(1);
      for (let i = 0, j = 0, ref = bufferSize; ref >= 0 ? j <= ref : j >= ref; i = ref >= 0 ? ++j : --j) {
        left[i] = samplesL[i] // 32768;
        right[i] = samplesR[i] // 32768;
      }
    }
    let source = this.context.createBufferSource();
    source.buffer = buffer;
    source.connect(this.context.destination);
    if (source.start != null) {
      return source.start(0);
    } else {
      return source.noteOn(0);
    }
  }
}

window.WebAudio = WebAudio;
