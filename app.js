
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
  , couchdb = require('felix-couchdb')
  , client = couchdb.createClient(13893, 'localhost') // may need to change this for webfaction
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

app.get('/upload', function(req, res) {
  var cur = new Date()
    , folder = [cur.getFullYear(), cur.getMonth() + 1, cur.getDate()].join('-');

  res.render('form', { 
    title: '',
    base_url: config.HOST,
    aws_signature: config.AWSSignature, 
    aws_accesskeyid: config.AWSAccessKeyId,
    aws_policy: config.AWSPolicy,
    scan_id: folder
  });
});

app.get('/uploaded', function(req, res) {
  var bucket = req.query["bucket"]
    , key = decodeURIComponent(req.query["key"])
    , base = 'http://{bucket}.s3.amazonaws.com/{key}'
    , url = base.replace('{bucket}', bucket).replace('{key}', key);

  // save the uploaded gif information
  db.saveDoc(key, {
    url: url,
    date: JSON.stringify(new Date()),
    type: 'gif',
    status: 'processed'
  }, function(er, ok) {
    console.log(ok);
  });

  res.render('uploaded', { 
    title: '',
    image_url: url
  });
});

app.get('/dropform', function(req, res) {
  var cur = new Date()
    , folder = [cur.getFullYear(), cur.getMonth() + 1, cur.getDate()].join('-');

  res.render('dropform', { 
    title: '',
    base_url: config.HOST,
    aws_signature: config.AWSSignature, 
    aws_accesskeyid: config.AWSAccessKeyId,
    aws_policy: config.AWSPolicy,
    scan_id: folder
  });
});


app.get('/split/:image', function(req, res) {
  var filename = '/' + req.params.image + '.gif';
  var options = {
      host: 'i.imgur.com'
    , port: 80
    , path: filename
  };

  var request = http.get(options, function(response){
      var imagedata = '';
      response.setEncoding('binary');

      response.on('data', function(chunk) {
          imagedata += chunk;
      });

      response.on('end', function() {
        var savedImage = './public/images/temporary' + filename;
        fs.writeFile(savedImage, imagedata, 'binary', function(err) {
          if (err) throw err;
          console.log(filename + ' saved.');

          gm('./public/images/temporary/blank.gif')
            .append(savedImage, true)
            .stream(function streamOut (err, stdout, stderr) {
                if (err) return console.log(err);
                console.log('streaming image');
                stdout.pipe(res); //pipe to response
                stdout.on('error', console.log);
            });
            // .write('./public/images/wolf_static_0.jpg', function(err, stdout, stderr) {
            //   console.log(err);
            // });
        });
      });
  });

});

http.createServer(app).listen(app.get('port'), function(){
  console.log("Express server listening on port " + app.get('port'));
});
