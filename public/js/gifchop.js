/*
  take a gif url, chop it up and display it on the page
  also provide ui for selecting frames
*/
var gifchopper = function() {
  var self = {},
    stream = null,
    handler = null;

  self.parse = function() {
    try {
      // in jsgif gif.js
      parseGIF(stream, handler);
    } catch(err) {
      console.log(err);
    }
  };

  self.load = function(url) {
    var req = new XMLHttpRequest();
    req.overrideMimeType('text/plain; charset=x-user-defined');
    
    req.onload = function(e) {
      stream = new Stream(req.responseText);
      setTimeout(doParse, 0);
    };

    req.onprogress = console.log;
    req.onerror = function() { console.log('xhr error'); };

    req.open('GET', url, true);
    req.send();

    console.log(req, 'loading');
  };

  return self;
}();