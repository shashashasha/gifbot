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
    idling = false,
    dragging = false,
    allowautoplay = true;

  // parse the gif on the page
  self.load = function(url, gif, id) {
    self.url = url;
    self.controller = gifcontrol(gif, 460);
    self.id = id;
    $("#status").fadeIn();

    // only allow scrubbing after it's processed
    self.controller.events.processed = function() {
      self.timeline();

      $("#status").fadeOut();
      stop = self.controller.length();
      self.startIdling();

      $("#instructions").fadeIn();

      // skip to selected state if there are less than 10 frames
      if (self.controller.length() <= 10) {
        start = 0;
        stop = self.controller.length() - 1;
        centerSelection(0);
        $("#finalize-text").html("Bask in your gif, then hit")
      }
    };

    self.ui();
  };

  self.selected = function() {
    $("#instructions").fadeOut(200, function() {
      $("#finalize").fadeIn();
    });
  };

  self.ui = function() {
    // toggle idling
    $("#gif-toggle").click(function() {
      if (idling) {
        self.stopIdling();
        allowautoplay = false;
        return;
      }

      allowautoplay = true;
      self.startIdling();
    });

    // on "done" store id in form
    $("#gif-submit").click(function() {
      $("#gif-controls").slideUp();
      $("body").addClass("done");

      if (parent)
        parent.postMessage("doc_id|" + self.id, 'http://gifpop.io');
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
      var src = e.target || e.srcElement;
      var percent = e.pageX / src.clientWidth;
      self.controller.seekPercent(percent);
      self.stopIdling();

      if (dragging) {
        var current = getFrame(e);
        centerSelection(current);
      }
      else {
        // $(".jsgif").css({ opacity: .5 });
        idleID = setTimeout(self.startIdling, idleTime);
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
        idleID = setTimeout(self.startIdling, idleTime);
      }
    });

    $(window).mouseup(function(e) {
      dragging = false;

      if (allowautoplay)
        self.startIdling();

      $(".jsgif").css({ opacity: 1 });
    })
  };

  var getFrame = function(e) {
    // target.id == 'selection' ? parseFloat(e.target.style.marginLeft) + e.offsetX : e.offsetX
    var offset = e.pageX;
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
        var dif = stop - (length - 1);
        start -= dif;
        stop -= dif;

      }

      // cap them still just in case we have less than 10 frames
      stop = Math.min(length - 1, stop);
      start = Math.max(0, start);

      drawSelection();
      self.selected();

      last = current;
  };

  var drawSelection = function() {
      var sx = getPixel(start),
          ex = getPixel(stop),
          tw = $("#timeline").width();

      // draw a rectangle for now
      $("#selection").css({
        'display': 'block',
        'marginLeft': (sx - 2) + 'px',
        'marginRight': ((tw - ex) - 2) + 'px',
        'width': (ex - sx) + 'px'
      });
  };

  self.seekPercentOfSelection = function(percent) {
    var frame = (percent * (stop - start)) + start;
    self.controller.seekFrame(Math.round(frame));
  };

  /*
    loop between the *start* and *stop* frame numbers, with default *delay*
  */
  self.startIdling = function(callback) {
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

      if (callback) {
        callback();
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

    idling = true;
  };

  self.stopIdling = function() {
    clearInterval(intervalID);

    intervalID = null;
    idling = false;
  };

  return self;
}();