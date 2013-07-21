/*
  take a gif url, chop it up and display it on the page
  also provide ui for selecting frames
*/
var gifchopper = function() {
  var self = {},
    delay = 200,
    idleTime = 800,
    interval = 1,
    start = 0,
    stop = -1,
    intervalID = null,
    idleID = null,
    last = null,
    pingponging = false,
    dragging = false,
    allowautoplay = true;

  // parse the gif on the page
  self.load = function(url, gif, id) {
    self.url = url;
    self.controller = gifcontrol(gif, 450);
    self.id = id;

    // only allow scrubbing after it's processed
    self.controller.events.processed = function() {
      self.timeline();

      stop = self.controller.length();
      self.startPingPoinging();
    };

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

    // on "done" store id in form
    $("#gif-submit").click(function() {
      $("#gif-controls").slideUp();
      $("body").addClass("done");

      if (parent)
        parent.postMessage(self.id, 'http://gifpop.io');
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

    self.controller.events.frameChanged = function(percent) {
      var px = $("#timeline").width() * percent;
      $("#playhead").css({
        marginLeft: px + 'px'
      });
    };

    // right now this is .jsgif and #timeline
    $(".scrubbable").mousemove(function(e) {
      clearTimeout(idleID);
      // when we're on our selection, or outside of the frame, autoplay
      // if (e.target.id == 'selection') {
      //   return;
      // }
      var percent = e.offsetX / e.srcElement.clientWidth;
      self.controller.seekPercent(percent);
      self.stopPingPoinging();

      if (dragging) {
        var current = getFrame(e);
        centerSelection(current);
      }
      else {
        // $(".jsgif").css({ opacity: .5 });
        idleID = setTimeout(self.startPingPoinging, idleTime);
      }
    })
    .mousedown(function(e) {
      clearTimeout(idleID);
      dragging = true;

      var current = getFrame(e);
      centerSelection(current);
    })
    .mouseout(function() {
      if (allowautoplay && stop > 0) {
        clearTimeout(idleID);
        idleID = setTimeout(self.startPingPoinging, idleTime);
      }
    });

    $(window).mouseup(function(e) {
      dragging = false;

      if (allowautoplay)
        self.startPingPoinging();

      $(".jsgif").css({ opacity: 1 });
    })
  };

  var getFrame = function(e) {
    var offset = e.target.id == 'selection' ? parseFloat(e.target.style.marginLeft) + e.offsetX : e.offsetX;
    var length = self.controller.length() - 1;
    var percent = offset / e.currentTarget.clientWidth;
    return Math.round(percent * length);
  };

  var getPixel = function(f) {
    var length = self.controller.length() - 1;
    return $("#timeline").width() * (f / length);
  };

  var centerSelection = function(current) {
      // prevent redraws
      if (last == current) return;
      var length = self.controller.length();

      // center on current, 10 frames
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
      intervalID = null;
    }

    // ignore if autoplay is turned off
    if (!allowautoplay) {
      return;
    }

    // just start playing from the current frame unless we have a selection
    var currentStart = self.controller.currentFrame();
    if (currentStart < start || currentStart > stop)
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