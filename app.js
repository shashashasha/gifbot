
/**
 * Module dependencies.
 */

var express = require('express')
  , engine = require('ejs-locals')
  , gm = require('gm')
  , fs = require('fs')
  , http = require('http')
  , path = require('path');

var app = express()
  , config = JSON.parse(fs.readFileSync('./settings.json'));

// use ejs-locals for all ejs templates:
app.engine('ejs', engine);

app.configure(function(){
  app.set('port', process.env.PORT || 3000);

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
  res.render('form', { 
    title: '',
    aws_signature: config.AWSSignature, 
    aws_accesskeyid: config.AWSAccessKeyId,
    aws_policy: config.AWSPolicy,
    scan_id: new Date().toLocaleDateString().split("/").join("-")
  });
});

app.get('/uploaded', function(req, res) {
  var bucket = req.query["bucket"]
    , key = req.query["key"];

  var options = {
      host: 'gifpop-uploads.s3.amazonaws.com'
    , port: 80
    , path: key
  };

  var request = http.get(options, function(response){
      var imagedata = '';
      response.setEncoding('binary');

      response.on('data', function(chunk) {
          imagedata += chunk;
      });

      response.on('end', function() {
        var savedImage = './public/images/temporary/' + key.split('/').pop();
        fs.writeFile(savedImage, imagedata, 'binary', function(err) {
          if (err) throw err;
          gm('./public/images/temporary/blank.gif')
            .append(savedImage, true)
            .stream(function streamOut (err, stdout, stderr) {
                if (err) return console.log(err);
                console.log('streaming image');
                stdout.pipe(res); //pipe to response
                stdout.on('error', console.log);
            });
        });
      });
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

  // gm('http://cdn.shopify.com/s/files/1/0172/2296/products/wolf_pixelfuck_11_large.gif[5]')
  // // gm('./public/images/0001.jpg')
  //   .append('./public/images/wolf_pixelfuck_11.gif', true)
  //   .stream(function streamOut (err, stdout, stderr) {
  //       if (err) return console.log(err);
  //       stdout.pipe(res); //pipe to response
  //       stdout.on('error', console.log);
  //   });
});

http.createServer(app).listen(app.get('port'), function(){
  console.log("Express server listening on port " + app.get('port'));
});
