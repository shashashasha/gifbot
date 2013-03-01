/*
  take a gif url, chop it up and display it on the page
  also provide ui for selecting frames
*/
var gifchopper = function() {
  var self = {},
    delay = 200,
    interval = 1,
    start = 0,
    stop = -1,
    intervalID = null,
    pingponging = false;

  // parse the gif on the page
  self.load = function(url, gif) {
    self.url = url;
    self.controller = gifcontrol(gif);
    self.timeline(document.getElementById('timeline'));
  };

  self.timeline = function(div) {
    // scrub the timeline
    div.addEventListener('mousemove', function(e) {
      var percent = e.offsetX / e.srcElement.clientWidth;
      self.controller.seekPercent(percent);
      self.stopPingPoinging();
    }, false);

    div.addEventListener('mousedown', function(e) {
      start = getFrame(e);
      dragging = true;
      $("#selection").css({
        'marginLeft': e.offsetX + 'px',
        'marginRight': '0px'
      });
    }, false);

    div.addEventListener('mouseup', function(e) {
      var current = getFrame(e);
      if (current != start) {
        if (start < current) {
          stop = current;
        } else {
          stop = start;
          start = current;
        }
      }
      $("#selection").css({
        'marginLeft': getPixel(start) + 'px',
        'marginRight': ($("#timeline").width - getPixel(stop)) + 'px',
        'width': (getPixel(stop) - getPixel(start)) + 'px'
      });

      console.log('new range:', start, stop);

      self.startPingPoinging();
    }, false);

    // toggle pingponging
    // div.addEventListener('click', function(e) {
    //   if (pingponging) {
    //     self.stopPingPoinging();
    //     return;
    //   }

    //   start = getFrame(e);
    //   stop = start + 10;

    //   console.log(start,stop);
    //   self.startPingPoinging();
    // }, false);
  };

  var getFrame = function(e) {
    var length = self.controller.length() - 1;
    var percent = e.offsetX / e.srcElement.clientWidth;
    return Math.round(percent * length);  
  };

  var getPixel = function(f) {
    var length = self.controller.length() - 1;
    return $("#timeline").width() * (f / length);
  };

  /*
    loop between the *start* and *stop* frame numbers, with default *delay*
  */
  self.startPingPoinging = function() {
    self.controller.seekFrame(start);
    intervalID = setInterval(function() {
      var current = self.controller.currentFrame(), 
          length = self.controller.length();

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