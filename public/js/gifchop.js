/*
  take a gif url, chop it up and display it on the page
  also provide ui for selecting frames
*/
var gifchopper = function() {
  var self = {},
    delay = 200,
    interval = 1,
    initialStart = 0,
    start = 0,
    stop = -1,
    intervalID = null,
    last = null,
    pingponging = false,
    dragging = false;

  // parse the gif on the page
  self.load = function(url, gif) {
    self.url = url;
    self.controller = gifcontrol(gif);
    self.timeline(document.getElementById('timeline'));

    self.ui();
  };

  self.ui = function() {
    $("#gif-submit").click(function() {
      var frames = [], 
          j = 0;
      for (var i = start; i < stop; i++) {
        frames[j] = i;
        j++;
      }

      console.log('posting', frames.toString());
      if (parent)
        parent.postMessage(frames.toString(), 'http://gifpop.io');
    });

    // Create IE + others compatible event handler
    var eventMethod = window.addEventListener ? "addEventListener" : "attachEvent";
    var eventer = window[eventMethod];
    var messageEvent = eventMethod == "attachEvent" ? "onmessage" : "message";

    // Listen to message from child window
    eventer(messageEvent,function(e) {
      console.log('parent received message!:  ',e.data);
    },false);
  };

  self.timeline = function(div) {
    // scrub the timeline
    div.addEventListener('mousemove', function(e) {
      var percent = e.offsetX / e.srcElement.clientWidth;
      self.controller.seekPercent(percent);
      self.stopPingPoinging();

      if (dragging) {
        var current = getFrame(e);
        updateSelection(current);
      }
    }, false);

    div.addEventListener('mousedown', function(e) {
      var length = self.controller.length() - 1,
        width = e.srcElement.clientWidth;

      initialStart = start = getFrame(e);
      stop = start + 1;
      dragging = true;

      $("#selection").css({
        'marginLeft': e.offsetX + 'px',
        'marginRight': '0px',
        'width': ((1/length) * width) + 'px'
      });
    }, false);

    div.addEventListener('mouseup', function(e) {
      var current = getFrame(e);

      // haven't dragged, set default length
      if (current == initialStart) {
        var length = self.controller.length() - 1;
        current = Math.min(length, initialStart + 5);

        // reset last
        last = -1;
      }

      updateSelection(current);
      self.startPingPoinging();
      dragging = false;
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
    return $("#timeline").width() * (Math.round(f) / length);
  };

  var updateSelection = function(current) {
      // prevent redraws
      if (last == current) return;

      stop = current;

      // flip
      if (current < initialStart) {
        var end = initialStart;
        stop = end;
        start = current;
      }

      var sx = getPixel(start),
          ex = getPixel(stop),
          tw = $("#timeline").width();

      // draw a rectangle for now
      $("#selection").css({
        'marginLeft': sx + 'px',
        'marginRight': (tw - ex) + 'px',
        'width': (ex - sx) + 'px'
      });

      last = current;

      interval = Math.max(Math.floor((stop - start) / 10), 1);
  };

  /*
    loop between the *start* and *stop* frame numbers, with default *delay*
  */
  self.startPingPoinging = function() {
    if (intervalID) {
      clearInterval(intervalID);
    }

    self.controller.seekFrame(start);
    intervalID = setInterval(function() {
      var current = self.controller.currentFrame(), 
          length = self.controller.length();

      if (current >= stop || current >= length - 1) {
        self.controller.seekFrame(start);
      } else {

        if (start != 0 && stop != -1) {
          self.controller.stepFrame(interval);  
        } 
        else {
          self.controller.nextFrame();
        }
          
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