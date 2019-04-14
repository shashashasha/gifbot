// #= require jquery-fileupload/basic
// #= require jquery-fileupload/vendor/tmpl

var $ = $ || jQuery;

$.fn.S3Uploader = function(options) {
  var $uploadForm, build_content_object, current_files, forms_for_submit, setUploadForm, settings;
  if (this.length > 1) {
    this.each(function() {
      return $(this).S3Uploader(options);
    });
    return this;
  }
  $uploadForm = this;

  settings = {
    path: '',
    additional_data: null,
    before_add: null,
    remove_completed_progress_bar: true,
    remove_failed_progress_bar: false,
    progress_bar_target: null,
    click_submit_target: null
  };

  $.extend(settings, options);
  current_files = [];
  forms_for_submit = [];

  if (settings.click_submit_target) {
    settings.click_submit_target.click(function() {
      var form, _i, _len;
      for (_i = 0, _len = forms_for_submit.length; _i < _len; _i++) {
        form = forms_for_submit[_i];
        form.submit();
      }
      return false;
    });
  }

  setUploadForm = function() {
    return $uploadForm.fileupload({
      add: function(e, data) {
        var file;
        file = data.files[0];
        file.unique_id = Math.random().toString(36).substr(2, 16);
        if (!(settings.before_add && !settings.before_add(file))) {
          current_files.push(data);
          if ($('#template-upload').length > 0) {
            data.context = $($.trim(tmpl("template-upload", file)));
          }
          $(data.context).appendTo(settings.progress_bar_target || $uploadForm);
          if (settings.click_submit_target) {
            return forms_for_submit.push(data);
          } else {
            return data.submit();
          }
        }
      },
      start: function(e) {
        return $uploadForm.trigger("s3_uploads_start", [e]);
      },
      progress: function(e, data) {
        var progress;
        if (data.context) {
          progress = parseInt(data.loaded / data.total * 100, 10);
          return data.context.find('.bar').css('width', progress + '%');
        }
      },
      done: function(e, data) {
        var content, to;
        content = build_content_object($uploadForm, data.files[0], data.result);
        to = $uploadForm.data('callback-url');
        if (to) {
          content[$uploadForm.data('callback-param')] = content.url;
          $.ajax({
            type: $uploadForm.data('callback-method'),
            url: to,
            data: content,
            beforeSend: function(xhr, settings) {
              return $uploadForm.trigger('ajax:beforeSend', [xhr, settings]);
            },
            complete: function(xhr, status) {
              return $uploadForm.trigger('ajax:complete', [xhr, status]);
            },
            success: function(data, status, xhr) {
              return $uploadForm.trigger('ajax:success', [data, status, xhr]);
            },
            error: function(xhr, status, error) {
              return $uploadForm.trigger('ajax:error', [xhr, status, error]);
            }
          });
        }
        if (data.context && settings.remove_completed_progress_bar) {
          data.context.remove();
        }
        $uploadForm.trigger("s3_upload_complete", [content]);
        current_files.splice($.inArray(data, current_files), 1);
        if (!current_files.length) {
          return $uploadForm.trigger("s3_uploads_complete", [content]);
        }
      },
      fail: function(e, data) {
        var content;
        content = build_content_object($uploadForm, data.files[0], data.result);
        content.error_thrown = data.errorThrown;
        if (data.context && settings.remove_failed_progress_bar) {
          data.context.remove();
        }
        return $uploadForm.trigger("s3_upload_failed", [content]);
      },
      formData: function(form) {
        var data, fileType, key;
        data = form.serializeArray();
        fileType = "";
        if ("type" in this.files[0]) {
          fileType = this.files[0].type;
        }
        data.push({
          name: "Content-Type",
          value: fileType
        });
        key = data[1].value.replace('{timestamp}', new Date().getTime()).replace('{unique_id}', this.files[0].unique_id);
        data[1].value = settings.path + key;
        return data;
      }
    });
  };

  build_content_object = function($uploadForm, file, result) {
    var content, domain;
    content = {};
    if (result) {
      content.url = $(result).find("Location").text();
      content.filepath = $('<a />').attr('href', content.url)[0].pathname;
    } else {
      domain = $uploadForm.attr('action');
      content.filepath = settings.path + $uploadForm.find('input[name=key]').val().replace('/${filename}', '');
      content.url = domain + content.filepath + '/' + encodeURIComponent(file.name);
    }
    content.filename = file.name;
    if ('size' in file) {
      content.filesize = file.size;
    }
    if ('type' in file) {
      content.filetype = file.type;
    }
    if ('unique_id' in file) {
      content.unique_id = file.unique_id;
    }
    if (settings.additional_data) {
      content = $.extend(content, settings.additional_data);
    }
    return content;
  };

  this.initialize = function() {
    setUploadForm();
    return this;
  };

  this.path = function(new_path) {
    return settings.path = new_path;
  };

  this.additional_data = function(new_data) {
    return settings.additional_data = new_data;
  };

  return this.initialize();
};