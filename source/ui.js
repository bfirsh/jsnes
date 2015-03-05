/*
JSNES, based on Jamie Sanders' vNES
Copyright (C) 2010 Ben Firshman

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU General Public License as published by
the Free Software Foundation, either version 3 of the License, or
(at your option) any later version.

This program is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
GNU General Public License for more details.

You should have received a copy of the GNU General Public License
along with this program.  If not, see <http://www.gnu.org/licenses/>.
*/

JSNES.DummyUI = function(nes) {
    this.nes = nes;
    this.enable = function() {};
    this.updateStatus = function() {};
    this.writeAudio = function() {};
    this.writeFrame = function() {};
};

if (typeof jQuery !== 'undefined') {
    (function ($) {
        $.fn.JSNESUI = function (roms) {
            var parent = this;
            var UI = function (nes) {
                var self = this;
                self.nes = nes;

                /*
                * Create UI
                */
                self.root = $('<div></div>');
                self.screen = $('<canvas class="nes-screen" width="256" height="240"></canvas>').appendTo(self.root);
                self.webgl = $('#WebGLCanvas');

                if (!self.screen[0].getContext) {
                    parent.html("Your browser doesn't support the <code>&lt;canvas&gt;</code> tag. Try Google Chrome, Safari, Opera or Firefox!");
                    return;
                }

                self.romContainer = $('<div class="nes-roms"></div>').appendTo(self.root);
                self.romSelect = $('<select></select>').appendTo(self.romContainer);

                self.controls = $('<div class="nes-controls"></div>').appendTo(self.root);
                self.buttons = {
                    pause: $('<input type="button" value="pause" class="nes-pause" disabled="disabled">').appendTo(self.controls),
                    restart: $('<input type="button" value="restart" class="nes-restart" disabled="disabled">').appendTo(self.controls),
                    sound: $('<input type="button" value="enable sound" class="nes-enablesound">').appendTo(self.controls),
                    zoom: $('<input type="button" value="zoom" class="nes-zoom">').appendTo(self.controls),
                    fullscreen: $('<input type="button" value="Fullscreen (2xSE)" >').appendTo(self.controls)
                };
                self.status = $('<p class="nes-status">Booting up...</p>').appendTo(self.root);
                self.root.appendTo(parent);

                /*
                * ROM loading
                */
                self.romSelect.change(function () {
                    self.loadROM();
                });

                /*
                * Buttons
                */
                self.buttons.pause.click(function () {
                    if (self.nes.isRunning) {
                        self.nes.stop();
                        self.updateStatus("Paused");
                        self.buttons.pause.attr("value", "resume");
                    }
                    else {
                        self.nes.start();
                        self.buttons.pause.attr("value", "pause");
                    }
                });

                self.buttons.restart.click(function () {
                    self.nes.reloadRom();
                    self.nes.start();
                });

                self.buttons.sound.click(function () {
                    if (self.nes.opts.emulateSound) {
                        self.nes.opts.emulateSound = false;
                        self.buttons.sound.attr("value", "enable sound");
                    }
                    else {
                        self.nes.opts.emulateSound = true;
                        self.buttons.sound.attr("value", "disable sound");
                    }
                });




                //--- setup 2xSE -----------------------------------------------------------------------------------------------------------------------------------
                gpu.init(256, 240);
                $(document).
                    bind('keyup', function (evt) {
                        if (evt.keyCode == 110) {   // Numpad .
                            /*
                            if (gpu.renderMode == 4) gpu.renderMode = 0;
                            else if (gpu.renderMode == 2) gpu.renderMode = 4;
                            else if (gpu.renderMode == 0) gpu.renderMode = 2;
                            */
                            if (gpu.renderMode == 2) gpu.renderMode = 0;
                            else if (gpu.renderMode == 0) gpu.renderMode = 2;
                        }
                    });

                    /* Fullscreen toggle 2xSE */
                self.buttons.fullscreen.get(0).addEventListener("click", function () {
                    var size = (screen.height < screen.width) ? screen.height : screen.width;
                    gpu.resize(size, size);

                    var element = document.getElementById("WebGLCanvas");
                    element = element || document.body;
                    if (element.webkitRequestFullScreen) element.webkitRequestFullScreen();
                    if (element.mozRequestFullScreen) element.mozRequestFullScreen();

                }, false);
                if (document.addEventListener) {
                    document.addEventListener('webkitfullscreenchange', exitHandler, false);
                    document.addEventListener('mozfullscreenchange', exitHandler, false);
                    document.addEventListener('fullscreenchange', exitHandler, false);
                    document.addEventListener('MSFullscreenChange', exitHandler, false);
                }
                self.fullscreen = false;
                function exitHandler() {
                    self.fullscreen = !self.fullscreen;
                    if (self.fullscreen) {
                        self.screen.addClass('hidden');
                        self.webgl.removeClass('hidden');                    
                    }
                    else {                        
                        self.webgl.addClass('hidden');
                        self.screen.removeClass('hidden');
                    }
                }
                //----------------------------------------------------------------------------------------------------------------------------------------------------



                self.zoomed = false;

                self.buttons.zoom.click(function () {

                    if (self.zoomed) {
                        self.screen.animate({
                            width: '256px',
                            height: '240px'
                        });
                        self.buttons.zoom.attr("value", "zoom in");
                        self.zoomed = false;
                    } else {
                        self.screen.animate({
                            width: '512px',
                            height: '480px'
                        });
                        self.buttons.zoom.attr("value", "zoom out");
                        self.zoomed = true;
                    }

                });


                /*
                * Lightgun experiments with mouse
                * (Requires jquery.dimensions.js)
                */
                if ($.offset) {
                    self.screen.mousedown(function (e) {
                        if (self.nes.mmap) {
                            self.nes.mmap.mousePressed = true;
                            // FIXME: does not take into account zoom
                            self.nes.mmap.mouseX = e.pageX - self.screen.offset().left;
                            self.nes.mmap.mouseY = e.pageY - self.screen.offset().top;
                        }
                    }).mouseup(function () {
                        setTimeout(function () {
                            if (self.nes.mmap) {
                                self.nes.mmap.mousePressed = false;
                                self.nes.mmap.mouseX = 0;
                                self.nes.mmap.mouseY = 0;
                            }
                        }, 500);
                    });
                }

                if (typeof roms != 'undefined') {
                    self.setRoms(roms);
                }

                /*
                * Canvas
                */
                self.canvasContext = self.screen[0].getContext('2d');

                if (!self.canvasContext.getImageData) {
                    parent.html("Your browser doesn't support writing pixels directly to the <code>&lt;canvas&gt;</code> tag. Try the latest versions of Google Chrome, Safari, Opera or Firefox!");
                    return;
                }

                self.canvasImageData = self.canvasContext.getImageData(0, 0, 256, 240);
                self.resetCanvas();

                /*
                * Keyboard
                */
                $(document).
                    bind('keydown', function (evt) {
                        self.nes.keyboard.keyDown(evt);
                    }).
                    bind('keyup', function (evt) {
                        self.nes.keyboard.keyUp(evt);
                    }).
                    bind('keypress', function (evt) {
                        self.nes.keyboard.keyPress(evt);
                    });

                /*
                * Sound
                */
                self.dynamicaudio = new DynamicAudio({
                    swf: nes.opts.swfPath + 'dynamicaudio.swf'
                });
            };

            UI.prototype = {
                loadROM: function () {
                    var self = this;
                    self.updateStatus("Downloading...");
                    $.ajax({
                        url: escape(self.romSelect.val()),
                        xhr: function () {
                            var xhr = $.ajaxSettings.xhr();
                            if (typeof xhr.overrideMimeType !== 'undefined') {
                                // Download as binary
                                xhr.overrideMimeType('text/plain; charset=x-user-defined');
                            }
                            self.xhr = xhr;
                            return xhr;
                        },
                        complete: function (xhr, status) {
                            var i, data;
                            if (JSNES.Utils.isIE()) {
                                var charCodes = JSNESBinaryToArray(
                                    xhr.responseBody
                                ).toArray();
                                data = String.fromCharCode.apply(
                                    undefined,
                                    charCodes
                                );
                            }
                            else {
                                data = xhr.responseText;
                            }
                            self.nes.loadRom(data);
                            self.nes.start();
                            self.enable();
                        }
                    });
                },

                resetCanvas: function () {
                    this.canvasContext.fillStyle = 'black';
                    // set alpha to opaque
                    this.canvasContext.fillRect(0, 0, 256, 240);

                    // Set alpha
                    for (var i = 3; i < this.canvasImageData.data.length - 3; i += 4) {
                        this.canvasImageData.data[i] = 0xFF;
                    }
                },

                /*
                *
                * nes.ui.screenshot() --> return <img> element :)
                */
                screenshot: function () {
                    var data = this.screen[0].toDataURL("image/png"),
                        img = new Image();
                    img.src = data;
                    return img;
                },

                /*
                * Enable and reset UI elements
                */
                enable: function () {
                    this.buttons.pause.attr("disabled", null);
                    if (this.nes.isRunning) {
                        this.buttons.pause.attr("value", "pause");
                    }
                    else {
                        this.buttons.pause.attr("value", "resume");
                    }
                    this.buttons.restart.attr("disabled", null);
                    if (this.nes.opts.emulateSound) {
                        this.buttons.sound.attr("value", "disable sound");
                    }
                    else {
                        this.buttons.sound.attr("value", "enable sound");
                    }
                },

                updateStatus: function (s) {
                    this.status.text(s);
                },

                setRoms: function (roms) {
                    this.romSelect.children().remove();
                    $("<option>Select a ROM...</option>").appendTo(this.romSelect);
                    for (var groupName in roms) {
                        if (roms.hasOwnProperty(groupName)) {
                            var optgroup = $('<optgroup></optgroup>').
                                attr("label", groupName);
                            for (var i = 0; i < roms[groupName].length; i++) {
                                $('<option>' + roms[groupName][i][0] + '</option>')
                                    .attr("value", roms[groupName][i][1])
                                    .appendTo(optgroup);
                            }
                            this.romSelect.append(optgroup);
                        }
                    }
                },

                writeAudio: function (samples) {
                    return this.dynamicaudio.writeInt(samples);
                },

                writeFrame: function (buffer, prevBuffer) {

                    var imageData = this.canvasImageData.data;
                    var pixel, i, j;

                    for (i = 0; i < 256 * 240; i++) {
                        pixel = buffer[i];

                        if (pixel != prevBuffer[i]) {
                            j = i * 4;
                            imageData[j] = pixel & 0xFF;
                            imageData[j + 1] = (pixel >> 8) & 0xFF;
                            imageData[j + 2] = (pixel >> 16) & 0xFF;
                            prevBuffer[i] = pixel;
                        }
                    }
                    this.canvasContext.putImageData(this.canvasImageData, 0, 0);

                    // --- 2xSE -------------------------------------------------------------------
                    if (this.fullscreen) {
                        //WebGL doesn't like Uint8ClampedArray... gotta do this:                    
                        var data = new Uint8Array(imageData);
                        var texture1 = new THREE.DataTexture(data, 256, 240, THREE.RGBAFormat);
                        texture1.needsUpdate = true;
                        gpu.render(texture1);
                    }

                }
            };

            return UI;
        };
    })(jQuery);
}
