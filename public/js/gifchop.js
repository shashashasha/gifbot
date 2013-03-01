/*
  take a gif url, chop it up and display it on the page
  also provide ui for selecting frames
*/
var gifchopper = function() {
  var self = {},
    stream = null,
    delay = 200,
    interval = 1,
    start = 0,
    stop = -1,
    intervalID = null,
    pingponging = false;

  self.parse = function() {
    try {
      // in jsgif gif.js
      parseGIF(stream, handler);
      console.log(handler, stream);
    } catch(err) {
      console.log(err);
    }
  };

  // parse the gif on the page
  self.load = function(url, gif) {
    self.url = url;
    self.controller = gifcontrol(gif);
    self.timeline(document.getElementById('timeline'));
  };

  self.timeline = function(div) {
    div.addEventListener('mousemove', function(e) {
      var percent = e.x / e.srcElement.clientWidth;
      self.controller.seekPercent(percent);
      self.stopPingPoinging();
    }, false);

    div.addEventListener('click', function(e) {
      if (pingponging) {
        self.stopPingPoinging();
        return;
      }

      var length = self.controller.length() - 1;
      var percent = e.x / e.srcElement.clientWidth;
      start = Math.round(percent * length);
      stop = start + 10;

      console.log(start,stop);
      self.startPingPoinging();
    }, false);
  };

  self.startPingPoinging = function() {
    self.controller.seekFrame(start);
    intervalID = setInterval(function() {
      var current = self.controller.currentFrame(), 
          length = self.controller.length();
      console.log(current, start, stop, length);
      if (current >= stop || current >= length - 1) {
        self.controller.seekFrame(start);
      } else {
        self.controller.nextFrame();  
      }
    }, delay);

    pingponging = true;
  };

  self.stopPingPoinging = function() {
    clearInterval(intervalID);

    intervalID = null;
    pingponging = false;
  };

  return self;
}();