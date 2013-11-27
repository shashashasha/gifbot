/*
  Adapting much of JSGIF's html.js for our needs, rolling up into a gifcontroller module
*/
var gifcontrol = function(gif, maxheight) {
  var self = {};

  self.events = {};

  var stream;
  var hdr;

  var loadError = null;

  var transparency = null;
  var delay = null;
  var disposalMethod = null;
  var lastDisposalMethod = null;
  var frame = null;

  var playing = true;
  var forward = true;

  var frames = [];

  var clear = function() {
    transparency = null;
    delay = null;
    lastDisposalMethod = disposalMethod;
    disposalMethod = null;
    frame = null;
    //frame = tmpCanvas.getContext('2d');
  };

  // XXX: There's probably a better way to handle catching exceptions when
  // callbacks are involved.
  var doParse = function() {
    try {
      parseGIF(stream, handler);
    } catch(err) {
      doLoadError('parse');
    }
  };

  var doGet = function() {
    var h = new XMLHttpRequest();
    h.overrideMimeType('text/plain; charset=x-user-defined');
    h.onload = function(e) {
      // TODO: In IE, might be able to use h.responseBody instead of overrideMimeType.
      stream = new Stream(h.responseText);
      setTimeout(doParse, 0);
    };
    h.onprogress = doLoadProgress;
    h.onerror = function() { doLoadError('xhr'); };
    h.open('GET', gif.src, true);
    h.send();
  };

  var doText = function(text) {
    toolbar.innerHTML = text; // innerText? Escaping? Whatever.
    //ctx.fillStyle = 'black';
    //ctx.font = '32px sans-serif';
    //ctx.fillText(text, 8, 32);
  };

  var doShowProgress = function(prefix, pos, length, draw) {
    //toolbar.style.display = pos === length ? 'none' : 'block';
    //toolbar.style.display = pos === length ? '' : 'block'; // FIXME Move this to doPlay() or something.
    toolbar.style.visibility = pos === length ? '' : 'visible'; // FIXME Move this to doPlay() or something.

    if (draw) {
      var height = Math.min(canvas.height >> 3, canvas.height);
      var top = (canvas.height - height) >> 1;
      var bottom = (canvas.height + height) >> 1;
      var mid = (pos / length) * canvas.width;

      // XXX Figure out alpha fillRect.
      ctx.fillStyle = 'rgba(210,210,210,0.5)';
      ctx.fillRect(mid, 0, canvas.width - mid, canvas.height);

      ctx.fillStyle = 'rgba(15,15,15,0.5)';
      ctx.fillRect(0, 0, (pos / length) * canvas.width, canvas.height);


      var text = prefix + ' ' + Math.floor(pos / length * 100) + '%';

      ctx.font = 'italic 24pt Futura';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = 'rgb(255, 255, 255)';
      ctx.fillText(text.toUpperCase(), canvas.width / 2, canvas.height / 2 + 10);
    }

    doText(prefix + ' ' + Math.floor(pos / length * 100) + '%');
  };

  var doLoadProgress = function(e) {
    // TODO: Find out what lengthComputable actually means.
    if (e.lengthComputable) doShowProgress('Loading...', e.loaded, e.total, true);
  };

  var doLoadError = function(originOfError) {
    var drawError = function() {
      ctx.fillStyle = 'rgb(127,127,127)';
      ctx.fillRect(0, 0, hdr.width, hdr.height);
      ctx.strokeStyle = 'rgb(247, 152, 31)';
      ctx.lineWidth = 3;
      ctx.moveTo(0, 0);
      ctx.lineTo(hdr.width, hdr.height);
      ctx.moveTo(0, hdr.height);
      ctx.lineTo(hdr.width, 0);
      ctx.stroke();
    };

    loadError = originOfError;
    hdr = {width: gif.width, height: 300 }; // Fake header, fake height for now
    frames = [];
    drawError();
    setTimeout(doPlay, 0);
  };

  var doHdr = function(_hdr) {
    hdr = _hdr;
    //console.assert(gif.width === hdr.width && gif.height === hdr.height); // See other TODO.

    var scale = maxheight / hdr.height;

    canvas.width = hdr.width * scale;
    canvas.height = hdr.height * scale;

    // commenting this line out, scaling full width
    // div.style.width = (hdr.width * scale) + 'px';

    // adding this line, cropping max height
    div.style.height = '450px';

    // adding this line, vertically centering the full bleed gif
    var horzStretch = $(div).width() / hdr.width;
    var vertStretch = horzStretch * hdr.height;
    canvas.style.marginTop = -(vertStretch - 450)/2 + 'px';

    // div.style.height = hdr.height + 'px';
    // toolbar.style.minWidth = (hdr.width * scale) + 'px';

    tmpCanvas.width = hdr.width;
    tmpCanvas.height = hdr.height;
    //if (hdr.gctFlag) { // Fill background.
    //  rgb = hdr.gct[hdr.bgColor];
    //  tmpCanvas.fillStyle = 'rgba(' + rgb[0] + ',' + rgb[1] + ',' + rgb[2] + ',');
    //}
    //tmpCanvas.getContext('2d').fillRect(0, 0, hdr.width, hdr.height);
    // TODO: Figure out the disposal method business.
  };

  var doGCE = function(gce) {
    pushFrame();
    clear();
    transparency = gce.transparencyGiven ? gce.transparencyIndex : null;
    delay = gce.delayTime;
    disposalMethod = gce.disposalMethod;
    // We don't have much to do with the rest of GCE.
  };

  var pushFrame = function() {
    if (!frame) return;
    frames.push({data: frame.getImageData(0, 0, hdr.width, hdr.height),
                 delay: delay});
  };

  var doImg = function(img) {
    if (!frame) frame = tmpCanvas.getContext('2d');
    var ct = img.lctFlag ? img.lct : hdr.gct; // TODO: What if neither exists?

    var cData = frame.getImageData(img.leftPos, img.topPos, img.width, img.height);

    img.pixels.forEach(function(pixel, i) {
      // cData.data === [R,G,B,A,...]
      if (transparency !== pixel) { // This includes null, if no transparency was defined.
        cData.data[i * 4 + 0] = ct[pixel][0];
        cData.data[i * 4 + 1] = ct[pixel][1];
        cData.data[i * 4 + 2] = ct[pixel][2];
        cData.data[i * 4 + 3] = 255; // Opaque.
      } else {
        // TODO: Handle disposal method properly.
        // XXX: When I get to an Internet connection, check which disposal method is which.
        if (lastDisposalMethod === 2 || lastDisposalMethod === 3) {
          cData.data[i * 4 + 3] = 0; // Transparent.
          // XXX: This is very very wrong.
        } else {
          // lastDisposalMethod should be null (no GCE), 0, or 1; leave the pixel as it is.
          // assert(lastDispsalMethod === null || lastDispsalMethod === 0 || lastDispsalMethod === 1);
          // XXX: If this is the first frame (and we *do* have a GCE),
          // lastDispsalMethod will be null, but we want to set undefined
          // pixels to the background color.
        }
      }
    });

    // use tmpCanvas as a buffer for saving frame data (have to draw progress bar over the real one)
    frame.putImageData(cData, img.leftPos, img.topPos);

    // drawing from the tmpCanvas to do the scaling to the proper canvas size.
    ctx.drawImage(tmpCanvas, 0, 0, tmpCanvas.width, tmpCanvas.height, 0, 0, canvas.width, canvas.height);
  };

  var doPlay = (function() {
      var i = -1;
      var curFrame;  // XXX These two are <input> tags. They're declared up here
                     // instead of in initToolbar's scope so that stepFrame has
                     // access to them. This is hacky and should be eliminated.
                     // (Maybe this should actually be a class instead of a
                     // cheap plastic imitation? At the very least it should be
                     // abstracted more.)
      var delayInfo;


      var showingInfo = false;
      var pinned = false;

      //
      self.currentFrame = function() {
        return i;
      };

      // gifcontrol hook
      self.stepFrame = function(delta) { // XXX: Name is confusing.
        var updated = (i + delta + frames.length) % frames.length;
        updateFrame(updated);
      };

      // gifcontrol hook
      self.seekFrame = function(i) {
        updateFrame(i);
      };

      // gifcontrol hook
      self.seekPercent = function(percent) {
        var p = Math.round(percent * (frames.length-1));
        updateFrame(p);
      };

      var updateFrame = function(num) {
        i = Math.max(0, Math.min(frames.length-1, num));
        if (curFrame && delayInfo) {
          curFrame.value = i + 1;
          delayInfo.value = frames[i].delay;
        }

        putFrame();

        // callbacks
        if (self.events.frameChanged)
          self.events.frameChanged(i/(frames.length-1));
      };

      var step = (function() {
        var stepping = false;

        var doStep = function() {
          stepping = playing;
          if (!stepping) return;

          self.stepFrame(forward ? 1 : -1);
          var delay = frames[i].delay * 10;
          if (!delay) delay = 100; // FIXME: Should this even default at all? What should it be?
          setTimeout(doStep, delay);
        };

        return function() { if (!stepping) setTimeout(doStep, 0); };
      }());

      var putFrame = function() {
        if (frames[i].data) {

          // draw it to the temp canvas so we can scale it properly
          if (!frame) frame = tmpCanvas.getContext('2d');
          frame.putImageData(frames[i].data, 0, 0);

          ctx.drawImage(tmpCanvas, 0, 0, tmpCanvas.width, tmpCanvas.height, 0, 0, canvas.width, canvas.height);

          // ctx.putImageData(frames[i].data, 0, 0);
        }
      };

      var initToolbar = function() {
        // Characters.
        var right = '&#9654;';
        var left = '&#9664;';
        var bar = '&#10073;';
        var rarr = '&rarr;';
        var larr = '&larr;';
        var xsign = '&#10006;';
        //var infosource = '&#8505;';
        var circle = '&#9675;';
        var circledot = '&#8857;';
        //var blackSquare = '&#9632;'; // XXX
        //var doubleVerticalLine = '&#8214;'; // XXX
        var nearr = '&nearr;';
        // Buttons.
        var playIcon = right;
        var pauseIcon = bar + bar;
        var revplayIcon = left;
        var prevIcon = left + bar;
        var nextIcon = bar + right;
        //var showInfoIcon = infosource;
        var showInfoIcon = 'i'; // Fonts.
        var revIcon = larr;
        var revrevIcon = rarr;
        var closeIcon = xsign;
        var pinIcon = circledot;
        var unpinIcon = circle;
        var popupIcon = nearr;

        /**
         * @param{Object=} attrs Attributes (optional).
         */ // Make compiler happy.
        var elt = function(tag, cls, attrs) {
          var e = document.createElement(tag);
          if (cls) e.className = 'jsgif_' + cls;
          for (var k in attrs) {
            e[k] = attrs[k];
          }
          return e;
        };

        var simpleTools = elt('div', 'simple_tools');
        var rev = elt('button', 'rev');
        var showInfo = elt('button', 'show_info');
        var prev = elt('button', 'prev');
        var playPause = elt('button', 'play_pause');
        var next = elt('button', 'next');
        var pin = elt('button', 'pin');
        var close = elt('button', 'close');

        var infoTools = elt('div', 'info_tools');
        curFrame = elt('input', 'cur_frame', {type: 'text'}); // See above.
        delayInfo = elt('input', 'delay_info', {type: 'text'}); // See above.

        var updateTools = function() {
          if (playing) {
            playPause.innerHTML = pauseIcon;
              playPause.title = 'Pause'
            prev.style.visibility = 'hidden'; // See TODO.
            next.style.visibility = 'hidden';
          } else {
            playPause.innerHTML = forward ? playIcon : revplayIcon;
              playPause.title = 'Play';
            prev.style.visibility = '';
            next.style.visibility = '';
          }

          toolbar.style.visibility = pinned ? 'visible' : ''; // See TODO.

          infoTools.style.display = showingInfo ? '' : 'none'; // See TODO.

          showInfo.innerHTML = showInfoIcon;
            showInfo.title = 'Show info/more tools'
          rev.innerHTML = forward ? revIcon : revrevIcon;
            rev.title = forward ? 'Reverse' : 'Un-reverse';
          prev.innerHTML = prevIcon;
            prev.title = 'Previous frame';
          next.innerHTML = nextIcon;
            next.title = 'Next frame'
          pin.innerHTML = pinned ? unpinIcon : pinIcon;
            pin.title = pinned ? 'Unpin' : 'Pin';
          close.innerHTML = closeIcon;
            close.title = 'Close jsgif and go back to original image';

          curFrame.disabled = playing;
          delayInfo.disabled = playing;

          toolbar.innerHTML = '';
          simpleTools.innerHTML = '';
          infoTools.innerHTML = '';

          var t = function(text) { return document.createTextNode(text); };

          if (frames.length < 2) { // XXX
            // Also, this shouldn't actually be playing in this case.
            // TODO: Are we going to want an info tool that'll be displayed on static GIFs later?

            if (loadError == 'xhr') {
              toolbar.appendChild(t("Load failed; cross-domain? "));

              var popup = elt('button', 'popup');
              popup.addEventListener('click', function() { window.open(gif.src); } );
              popup.innerHTML = popupIcon;
                popup.title = 'Click to open GIF in new window; try running jsgif there instead';
              toolbar.appendChild(popup);
            } else if (loadError == 'parse') {
              toolbar.appendChild(t("Parse failed "));
            }

            toolbar.appendChild(close);

            return;
          }

          // We don't actually need to repack all of these -- that's left over
          // from before -- but it doesn't especially hurt either.
          var populate = function(elt, children) {
            elt.innerHTML = '';
            children.forEach(function(c) { elt.appendChild(c); });
            //children.forEach(elt.appendChild); // Is this a "pseudo-function"?
          };

          // XXX Blach.
          var simpleToolList = forward ? [showInfo, rev, prev, playPause, next, pin, close]
                                       : [showInfo, rev, next, playPause, prev, pin, close];
          populate(toolbar, [simpleTools, infoTools]);
          populate(simpleTools, simpleToolList);
          populate(infoTools, [t(' frame: '), curFrame, t(' / '), t(frames.length), t(' (delay: '), delayInfo, t(')')]);
        };

        var doRev = function() {
          forward = !forward;
          updateTools();
          rev.focus(); // (because repack)
        };

        self.nextFrame = function() { self.stepFrame(1); };
        self.prevFrame = function() { self.stepFrame(-1); };

        self.pause = function() {
          playing = false;
          updateTools();
          step();
        };

        self.play = function() {
          playing = true;
          updateTools();
          step();
        };

        self.playPause = function() {
          playing = !playing;
          updateTools();
          playPause.focus(); // In case this was called by clicking on the
                             // canvas (we have to do this here because we
                             // repack the buttons).
          step();
        };

        var doCurFrameChanged = function() {
          var newFrame = +curFrame.value;
          if (isNaN(newFrame) || newFrame < 1 || newFrame > frames.length) {
            // Invalid frame; put it back to what it was.
            curFrame.value = i + 1;
          } else {
            i = newFrame - 1;
            putFrame();
          }
        };

        var doCurDelayChanged = function() {
          var newDelay = +delayInfo.value;
          if (!isNaN(newDelay)) {
            frames[i].delay = newDelay;
          }
        };

        var doToggleShowingInfo = function() {
          showingInfo = !showingInfo;
          updateTools();
          showInfo.focus(); // (because repack)
        };

        var doTogglePinned = function() {
          pinned = !pinned;
          updateTools();
          pin.focus(); // (because repack)
        };

        // TODO: If the <img> was in an <a>, every one of these will go to the
        // URL. We don't want that for the buttons (and probably not for
        // anything?).
        showInfo.addEventListener('click', doToggleShowingInfo, false);
        rev.addEventListener('click', doRev, false);
        curFrame.addEventListener('change', doCurFrameChanged, false);
        prev.addEventListener('click', self.prevFrame, false);
        playPause.addEventListener('click', self.playPause, false);
        next.addEventListener('click', self.nextFrame, false);
        pin.addEventListener('click', doTogglePinned, false);
        close.addEventListener('click', doClose, false);

        delayInfo.addEventListener('change', doCurDelayChanged, false);

        // stop autoplaying and pausing
        // canvas.addEventListener('click', self.playPause, false);

        // For now, to handle GIFs in <a> tags and so on. This needs to be handled better, though.
        div.addEventListener('click', function(e) { e.preventDefault(); }, false);

        updateTools();
      };

      return function() {
        setTimeout(initToolbar, 0);
        if (loadError) return;
        canvas.width = hdr.width;
        canvas.height = hdr.height;
        // step();
      };
  }());

  var doClose = function() {
    playing = false;
    parent.insertBefore(gif, div);
    parent.removeChild(div);
  };

  var doDecodeProgress = function(draw) {
    //  (frame ' + (frames.length + 1) + ')
    doShowProgress('Decoding ', stream.pos, stream.data.length, draw);
  };

  var doNothing = function(){};
  /**
   * @param{boolean=} draw Whether to draw progress bar or not; this is not idempotent because of translucency.
   *                       Note that this means that the text will be unsynchronized with the progress bar on non-frames;
   *                       but those are typically so small (GCE etc.) that it doesn't really matter. TODO: Do this properly.
   */
  var withProgress = function(fn, draw) {
    return function(block) {
      fn(block);
      doDecodeProgress(draw);
    };
  };


  var handler = {
    hdr: withProgress(doHdr),
    gce: withProgress(doGCE),
    com: withProgress(doNothing), // I guess that's all for now.
    app: {
     // TODO: Is there much point in actually supporting iterations?
      NETSCAPE: withProgress(doNothing)
    },
    img: withProgress(doImg, true),
    // when finished!
    eof: function(block) {
      pushFrame();
      doDecodeProgress(false);
      doText('Playing...');
      doPlay();
      self.seekPercent(0);

      if (self.events.processed)
        self.events.processed();
    }
  };

  var parent = gif.parentNode;

  var wrapper = document.createElement('div');
  wrapper.className = 'gif-wrapper';
  var div = document.createElement('div');
  var canvas = document.createElement('canvas');
  canvas.id = 'gif-canvas';
  var ctx = canvas.getContext('2d');
  var toolbar = document.createElement('div');

  var tmpCanvas = document.createElement('canvas');

  // Copy the computed style of the <img> to the <div>. The CSS specifies
  // !important for all its properties; this still has a few issues, but it's
  // probably preferable to not doing it. XXX: Maybe this should only copy a
  // few specific properties (or specify properties more thoroughly in the
  // CSS)?
  // (If we don't hav getComputedStyle we'll have to get along without it, of
  // course. It's not as if this supports IE, anyway, though, so I don't know
  // if that really matters.)
  //
  // XXX: Commented out for now. If uncommenting, make sure to add !important
  // to all the CSS properties in jsgif.css
  //
  //if (window.getComputedStyle) {
  //  for (var s in window.getComputedStyle(gif)) {
  //    div.style[s] = gif.style[s];
  //  }
  //}

  // This is our first estimate for the size of the picture. It might have been
  // changed so we'll correct it when we parse the header. TODO: Handle zoom etc.
  canvas.width = gif.width;
  canvas.height = gif.height;
  toolbar.style.minWidth = gif.width + 'px';

  div.className = 'jsgif scrubbable';
  toolbar.className = 'jsgif_toolbar';
  div.appendChild(canvas);
  div.appendChild(toolbar);

  parent.insertBefore(wrapper, gif);
  wrapper.appendChild(div);
  parent.removeChild(gif);

  // doText('Loading...');
  doGet();

  /*

    Handler functions for GIFController

  */
  self.length = function() {
    return frames.length;
  };

  self.canvas = function() {
    return canvas;
  };

  return self;
};