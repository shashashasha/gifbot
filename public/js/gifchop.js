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
    last = null,
    pingponging = false,
    dragging = false,
    allowautoplay = true;

  // parse the gif on the page
  self.load = function(url, gif) {
    self.url = url;
    self.controller = gifcontrol(gif, 300);

    self.timeline();
    self.ui();
  };

  self.ui = function() {
    // toggle pingponging
    $("#gif-toggle").click(function() {
      if (pingponging) {
        self.stopPingPoinging();
        allowautoplay = false;
        return;
      }

      allowautoplay = true;
      self.startPingPoinging();
    });

    $("#gif-submit").click(function() {
      var frames = self.getFrames();

      $("#gif-controls").slideUp();
      $("body").addClass("done");

      console.log('posting', frames.toString());
      if (parent) 
        parent.postMessage(frames.toString(), 'http://gifpop.io');
    });
  };

  self.getFrames = function() {
      var frames = [], 
          j = 0;
      for (var i = start; i < stop; i++) {
        frames[j] = i;
        j++;
      }

      return frames;
  };

  self.timeline = function() {
    $("#timeline").mousemove(function(e) {
      // when we're on our selection, or outside of the frame, autoplay
      if (e.target.id == 'selection') {
        return;
      }
      var percent = e.offsetX / e.srcElement.clientWidth;
      self.controller.seekPercent(percent);
      self.stopPingPoinging();

      if (dragging) {
        var current = getFrame(e);
        centerSelection(current);
      }
      else {
        $(".jsgif").css({
          opacity: .5
        }); 
      }
    })
    .mousedown(function(e) {
      dragging = true;
      var current = getFrame(e);
      centerSelection(current);
      $("#instructions").hide();
    })
    .mouseup(function(e) {
      dragging = false;

      if (allowautoplay)
        self.startPingPoinging();

      $(".jsgif").css({
        opacity: 1
      });
    })
    .mouseout(function() {
      if (allowautoplay && stop > 0) {
        self.startPingPoinging();
        $(".jsgif").css({
          opacity: 1
        });
      }
    });
  };

  var getFrame = function(e) {
    var offset = e.target.id == 'selection' ? parseFloat(e.target.style.marginLeft) + e.offsetX : e.offsetX;
    var length = self.controller.length() - 1;
    var percent = offset / e.currentTarget.clientWidth;
    return Math.round(percent * length);  
  };

  var getPixel = function(f) {
    var length = self.controller.length() - 1;
    return $("#timeline").width() * (Math.round(f) / length);
  };

  var centerSelection = function(current) {
      // prevent redraws
      if (last == current) return;
      var length = self.controller.length();

      // center on current
      start = current - 5;
      stop = current + 5;

      // don't go over beginning or end of the animation
      if (start < 0) {
        var dif = -start;
        start += dif;
        stop += dif;
      } else if (stop >= length) {
        var dif = stop - length;
        start -= dif;
        stop -= dif;
      }

      drawSelection();
      last = current;
  };

  var drawSelection = function() {
      var sx = getPixel(start),
          ex = getPixel(stop),
          tw = $("#timeline").width();

      // draw a rectangle for now
      $("#selection").css({
        'marginLeft': sx + 'px',
        'marginRight': (tw - ex) + 'px',
        'width': (ex - sx) + 'px'
      });
  };

  /*
    loop between the *start* and *stop* frame numbers, with default *delay*
  */
  self.startPingPoinging = function() {
    if (intervalID) {
      clearInterval(intervalID);
    }

    // ignore if autoplay is turned off
    if (!allowautoplay) {
      return;
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

    /*
  
    // code for pingponging
    var forwards = true;
    self.controller.seekFrame(start);
    intervalID = setInterval(function() {
      var current = self.controller.currentFrame(), 
          length = self.controller.length();

      if (forwards == true && current == stop) {
        forwards = false;
        // self.controller.seekFrame(start);
      } if (forwards == false && current == start) {
        forwards = true;
      }

      self.controller.stepFrame(forwards ? interval : -interval);  
    }, delay);

    */

    pingponging = true;
  };

  self.stopPingPoinging = function() {
    clearInterval(intervalID);

    intervalID = null;
    pingponging = false;
  };

  return self;
}();