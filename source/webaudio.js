(function() {
    var audioContext;

    try {
        audioContext = new (window.AudioContext || window.webkitAudioContext)();
    } catch (_) {}

    var writeIntSamples = function(samples) {
        // takes the Array of integers from papu.js
        if (audioContext) {
            var source = audioContext.createBufferSource();
            source.loop = false;
            source.buffer = audioContext.createBuffer(1, samples.length, samples.length * 4);
            var aux = source.buffer.getChannelData(0);
            for (i = 0; i < samples.length; i++) {
                aux[i] = samples[i] / 32768;
            }
            source.connect(audioContext.destination);
            source.noteOn(0);
        }
    }

    if (!window.WebAudio) {
        WebAudio = {};
    }

    WebAudio.writeInt = writeIntSamples;
    WebAudio.audioContext = audioContext;
})();