
/**
 * Module dependencies.
 */

var express = require('express')
  , engine = require('ejs-locals')
  , gm = require('gm')
  , fs = require('fs')
  , http = require('http')
  , path = require('path')
  , util = require('util')
  , crypto = require('crypto')
  , exec = require('child_process').exec
  , couchdb = require('felix-couchdb')
  , client = couchdb.createClient(13893, 'localhost') // may need to change this for webfaction
  // , client = couchdb.createClient(null, 'db.gifpop.io') // may need to change this for webfaction
  , db = client.db('gifpop');

var app = express()
  , config = JSON.parse(fs.readFileSync('./settings.json'));

// use ejs-locals for all ejs templates:
app.engine('ejs', engine);

app.configure(function() {
  app.set('port', config.PORT || 3000); // 28171 on webfaction

  // view templates
  app.set('views', __dirname + '/views');
  app.set('view engine', 'ejs');

  // app.use(express.favicon());
  app.use(express.logger('dev'));
  app.use(express.bodyParser());
  app.use(express.methodOverride());
  app.use(app.router);

  // static assets
  app.use(express.static(path.join(__dirname, 'public')));
});

app.configure('development', function(){
  app.use(express.errorHandler());
});

// index page
app.get('/', function(req, res) {
  res.render('index', { what: 'best', title: 'me' });
});

var uploadForm = function(res, form) {
  var cur = new Date()
    , folder = [cur.getFullYear(), cur.getMonth() + 1, cur.getDate()].join('-');

  /* sign the form */
  // var policy = '{"expiration": "2015-01-01T00:00:00Z", "conditions": [ {"bucket": "gifpop-uploads"}, {"x-amz-acl": "public-read"}, ["starts-with", "$key", "uploads/"], ["starts-with", "$Content-Type", "image"], {"success_action_redirect": "http://gifbot.gifpop.io/uploaded/"}, ["content-length-range", 0, 20971520] ] }';
  // var policy = JSON.stringify({
  //   "expiration": "2015-01-01T00:00:00Z",
  //   "conditions": [
  //     { "bucket": "gifpop-uploads" }, 
  //     { "x-amz-acl": "public-read" }, 
  //     ["starts-with", "$key", "uploads/"], 
  //     { "success_action_redirect": config.HOST + "/uploaded" }, 
  //     ["starts-with", "$Content-Type", "image"],
  //     ["content-length-range", 0, 2147483648]
  //   ]
  // });

  // encode it to put it in the form
  // var AWSPolicyBase64 = new Buffer(policy).toString('base64');
  // var AWSSignature = crypto.createHmac('sha1', config.AWSSecretKey).update(new Buffer(policy, 'utf-8')).digest('base64');

  res.render(form, {
    title: '',
    base_url: config.HOST,
    aws_signature: config.AWSSignature, 
    aws_accesskeyid: config.AWSAccessKeyId,
    aws_policy: config.AWSPolicy,
    scan_id: folder,
    file_prefix: cur.getTime()
  });
};

app.get('/upload', function(req, res) {
  uploadForm(res, 'form');
});

app.get('/dropform', function(req, res) {
  uploadForm(res, 'dropform');
});

app.get('/directform', function(req, res) {
  uploadForm(res, 'directform');
});

app.get('/uploaded', function(req, res) {
  var bucket = req.query["bucket"]
    , etag = req.query["etag"]
    , key = decodeURIComponent(req.query["key"])
    , filename = key.split('/').pop()
    , base = 'http://{bucket}.s3.amazonaws.com/{key}'
    , url = base.replace('{bucket}', bucket).replace('{key}', key);

  // save the uploaded gif information
  // doc id is timestamp in milliseconds plus etag
  var docId = filename.split('-').shift() + '-' + etag.substr(1, etag.length - 2);
  db.saveDoc(docId, {
    url: url,
    date: JSON.stringify(new Date()),
    type: 'gif',
    status: 'uploaded'
  }, function(er, ok) {
    if (er) {
      util.puts(er); 
    }
    
    util.p(ok);

    // render the uploaded page if we've saved the gif info to the db
    res.render('uploaded', { 
      title: 'GifPOP',
      image_url: url,
      doc_id: docId
    });
  });

});

// save frame selection to couch, need to get the latest rev number to update it though
app.post('/selected', function(req, res) {
  // frames are grabbed via gifchop.js
  var docId = req.body.id
    , frames = req.body.frames;

  console.log('selecting', docId);
  console.log('frames:', frames);
  db.getDoc(docId, function(err, doc) {
    if (err) console.log(err);

    // update the doc with the current revision id
    db.saveDoc(docId, {
      _rev: doc._rev,
      url: doc.url,
      date: JSON.stringify(new Date()),
      type: 'gif',
      status: 'selected',
      frames: frames,
      zip: doc.url.replace('.gif', '.zip')
    }, function(er, ok) {

    });
  });
});

app.post('/ordered', function(req, res) {
  console.log(req.body);
  db.saveDoc('order-' + new Date().getTime(), req.body, function(er, ok) {
    console.log(er, ok);
  });
});

/*
  given a doc id, grab the document, 
  load the url of the image/gif,
  and send it to the processor
*/
var imageHandler = {};

// write temp gif and run command
imageHandler.gifsicle = function(id, cmd) {
  var output = id + '-' + mode + '.gif',
    tempFolder = './public/images/temporary/',
    temp = tempFolder + id + '.gif';

  // write the gif to a temp file, then resize it to a smaller gif
  fs.writeFile(temp, imagedata, 'binary', function(err) {
    if (err) throw err;

    exec("gifsicle " + temp + " " + cmd + " -o " + output, function(err) {
      if (err) throw err;

      imageHandler.returnImage(res, output);
    });
  });
};

imageHandler.returnImage = function(res, path) {
  var img = fs.readFileSync(path);
  res.writeHead(200, {'Content-Type': 'image/gif' });
  res.end(img, 'binary');
};

imageHandler.processImage = function(id, processor) {
  console.log('processing image', id);
  db.getDoc(id, function(err, doc) {
    console.log(err)
    if (err) return;

    http.get(doc.url, function(response) {
      var imagedata = '';

      response.setEncoding('binary');

      response.on('data', function(chunk) {
        imagedata += chunk;
        console.log(imagedata.length);
      });

      response.on('end', function() {
        if (processor)
          processor(doc, imagedata);
        else 
          console.log('no image processor defined');
      });
    })
  })
};

app.get('/preview/:doc', function(req, res) {
  console.log(req.params.doc);
  var docId = req.params.doc.split('.gif')[0],
    filename = req.params.doc,
    tempFolder = './public/images/temporary/';

  imageHandler.processImage(docId, function(doc, imagedata) {
    var temp = tempFolder + filename;
    console.log('writing to temp file ', temp);

    // write the gif to a temp file, then resize it to a smaller gif
    fs.writeFile(temp, imagedata, 'binary', function(err) {
      if (err) throw err;

      var output = tempFolder + docId + "-preview.gif";
      console.log('resizing to ', output);

      exec("gifsicle " + temp + " --resize-width 120 -o " + output, function(err, stdout, stderr) {
        if (err) throw err;

        var selection = doc.frames.split(','),
            start = +selection[0],
            end = +selection[selection.length-1],
            frames = "'#" + start + "-" + end + "'";

        var finalOutput = tempFolder + [id, "frames", start, end].join('-') + ".gif";
        console.log('chopping frames', finalOutput);

        exec("gifsicle -U " + output + " " + frames + " -o " + finalOutput, function(err, stdout, stderr) {
          if (err) throw err;

          var img = fs.readFileSync(finalOutput);
          res.writeHead(200, {'Content-Type': 'image/gif' });
          res.end(img, 'binary');
        });

        imageHandler.returnImage(res, output);
      });
    });
  });
});

app.get('/chop/:doc/:start/:end', function(req, res) {
  console.log(req.params.doc);
  var start = req.params.start,
    end = req.params.end,
    id = req.params.doc,
    tempFolder = './public/images/temporary/';

  imageHandler.processImage(id, function(doc, imagedata) {
    var temp = tempFolder + id + '.gif';
    console.log('writing to temp file ', temp);

    // write the gif to a temp file, then resize it to a smaller gif
    fs.writeFile(temp, imagedata, 'binary', function(err) {
      if (err) throw err;

      var output = tempFolder + [id, "frames", start, end].join('-') + ".gif";
      var frames = "'#" + start + "-" + end + "'";
      console.log('writing frames ', frames);

      exec("gifsicle -U " + temp + " " + frames + " -o " + output, function(err, stdout, stderr) {
        if (err) throw err;

        var img = fs.readFileSync(output);
        res.writeHead(200, {'Content-Type': 'image/gif' });
        res.end(img, 'binary');
      });
    });
  });
});

http.createServer(app).listen(app.get('port'), function(){
  console.log("Express server listening on port " + app.get('port'));
});
