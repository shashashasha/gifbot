
$(function () {
    $('#fileupload').fileupload({
        // autoUpload: true,
        singleFileUploads: true,
        // forceIframeTransport: true,
        // redirect: 'http://127.0.0.1:3000/uploaded',
        redirectParamName: 'success_action_redirect',

        limitConcurrentUploads: 1,

        // not sure if this needs to be xml for amazon's response
        dataType: 'json',
        add: function(e, data) {
            // don't autosubmit
            console.log(data);
            data.context = $('<button/>').text('Upload')
                .appendTo(document.body)
                .click(function () {
                    data.context = $('<p/>').text('Uploading...').replaceAll($(this));
                    data.submit();
                });
        },
        progress: function(e, data) {
            console.log('progress', parseInt(data.loaded / data.total * 100, 10));
        },
        always: function(e, data) {
            console.log('always', arguments);
        },
        send: function(e, data) {
            console.log('sending');
        },
        fail: function(e, data) {
            // fails with errorThrown = ""
            console.log('failed:', data.errorThrown, e);
            globalEvent = e;
            globalData = data;
        },
        done: function (e, data) {
            console.log('done', data);
            $.each(data.result.files, function (index, file) {
                $('<p/>').text(file.name).appendTo(document.body);
            });
        }
    });
});