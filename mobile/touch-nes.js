 (function($) {
  var IS_IOS = /iphone|ipad/i.test(navigator.userAgent);
  $.fn.nodoubletapzoom = function() {
  if (IS_IOS)
  $(this).bind('touchstart', function preventZoom(e) {
               var t2 = e.timeStamp
               , t1 = $(this).data('lastTouch') || t2
               , dt = t2 - t1
               , fingers = e.originalEvent.touches.length;
               $(this).data('lastTouch', t2);
               if (!dt || dt > 500 || fingers > 1) return; // not double-tap
               
               e.preventDefault(); // double tap - prevent the zoom
               // also synthesize click events we just swallowed up
               $(this).trigger('click').trigger('click');
               });
  };
  })(jQuery);

function ready (){
    var jsnes = new JSNES({'fpsInterval': 1,
                          'swfPath': '/swf/',
                          'ui': $('.nes').text('').JSNESUI({
           "Working": [
                       ['Bubble Bobble', 'roms/Bubble Bobble (U).nes'],
                       
                       ['Contra', 'roms/Contra (U) [!].nes'],
                       ['Donkey Kong', 'roms/Donkey Kong (JU).nes'],
                       ['Dr. Mario', 'roms/Dr. Mario (JU).nes'],
                       ['Golf', 'roms/Golf (JU).nes'],
                       ['The Legend of Zelda', 'roms/Legend of Zelda, The (U) (PRG1).nes'],
                       ['Lemmings', 'roms/Lemmings (U).nes'],
                       ['Lifeforce', 'roms/Lifeforce (U).nes'],
                       
                       ['Mario Bros.', 'roms/Mario Bros. (JU) [!].nes'],
                       ['Mega Man', 'roms/Mega Man (U).nes'],
                       ['Pac-Man', 'roms/Pac-Man (U) [!].nes'],
                       ['Super Mario Bros.', 'roms/Super Mario Bros. (JU) (PRG0) [!].nes'],
                       ['Tennis', 'roms/Tennis (JU) [!].nes'],
                       ['Tetris', 'roms/Tetris (U) [!].nes'],
                       ['Tetris 2', 'roms/Tetris 2 (U) [!].nes'],
                       ['Zelda II - The Adventure of Link', 'roms/Zelda II - The Adventure of Link (U).nes']
                       ],
           
           "Nearly Working": [
                              ['Duck Hunt', 'roms/Duck Hunt (JUE) [!].nes'],
                              ['Super Mario Bros. 3', 'roms/Super Mario Bros. 3 (U) (PRG1) [!].nes']
                              ]
           })
      });
    $('.nes-zoom').click().remove();
    $('.nes-enablesound').click().remove();
    $('.nes-controls').attr('align','center');
    $('.nes-roms').attr('align','center');
    $('body').nodoubletapzoom();
}

$(document).ready(ready);
