var gamepads = navigator.webkitGamepads || navigator.MozGamepads;

window.frames = (function(){
    return  window.requestAnimationFrame || 
    window.webkitRequestAnimationFrame   || 
    window.mozRequestAnimationFrame      || 
    window.oRequestAnimationFrame        || 
    window.msRequestAnimationFrame       || 
    function( callback ){
        window.setTimeout(callback, 1000 / 60);
    };
})();



function runAnimation()
{
    window.frames(runAnimation);
    
    if(gamepads) {
        var axes = gamepads[0].axes;
        var buttons = gamepads[0].buttons;
        for(var i=0;i<nes.keyboard.state1.length;i++){
            nes.keyboard.state1[i]=0x40;
        }
        if(axes[5]==1){
            nes.keyboard.state1[5]=0x41;
        }
        if(axes[5]==-1){
            nes.keyboard.state1[4]=0x41;
        }
        if(axes[4]==1){
            nes.keyboard.state1[7]=0x41;
        }
        if(axes[4]==-1){
            nes.keyboard.state1[6]=0x41;
        }
        if(buttons[8]==1){
            nes.keyboard.state1[2]=0x41;
        }
        if(buttons[9]==1){
            nes.keyboard.state1[3]=0x41;
        }
        if(buttons[0]==1){
            nes.keyboard.state1[0]=0x41;
        }
        if(buttons[1]==1){
            nes.keyboard.state1[1]=0x41;
        }
    }

}
window.frames(runAnimation);