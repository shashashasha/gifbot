var helper = {};

helper.getUploadFolder = function() {
	var d = new Date(),
		date = ("0" + d.getDate()).slice(-2),
		month = ("0" + (d.getMonth() + 1)).slice(-2);

	return '/uploads/' + [d.getFullYear(), month, date].join('-') + '/';
};

helper.getURLParameter = function(name) {
	return decodeURIComponent((new RegExp('[?|&]' + name + '=' + '([^&;]+?)(&|#|;|$)').exec(location.search)||[,""])[1].replace(/\+/g, '%20'))||null
}

helper.send = function(endpoint, data, success, error) {
	$.ajax({
		type: "POST",
		url: "https://gifbot.gifpop.io/" + endpoint,
		data: data,
		dataType: "json",
		success: success || function(args) {
			console.log('success', endpoint, arguments);
		},
		error: error || function() {
			console.log('error', endpoint, arguments);
		}
	});
};