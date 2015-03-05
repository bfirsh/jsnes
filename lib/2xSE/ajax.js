//-- Easy ajax load --------------------------------------------------------
// url: the path the the resource to GET
// success: callback function for async load ( params: response content )
// fail: callback function for async load ( params: error status code )
// cache: boolean flag to enable caching
//  notes: success and fail callbacks are optional. If ommited function will
//         perform a syncronous get on the main thread and return the response
//---------------------------------------------------------------------------
(function () {
    var ajaxcache = [];
    window.ajax = function (url, success, fail, cache) {
        if (cache) {
            for (var i = 0; i < ajaxcache.length; i++) {
                if (ajaxcache[i].url == url) {
                    if (typeof success !== 'undefined') success(ajaxcache[i].responseText);
                    else return ajaxcache[i].responseText;
                    return;
                }
            }
        }
        var xmlhttp = new XMLHttpRequest();
        xmlhttp.onreadystatechange = function () {
            if (xmlhttp.readyState == 4) {
                if (xmlhttp.status == 200)
                    if (success) {
                        if (cache) ajaxcache.push({ url: url, responseText: xmlhttp.responseText });
                        success(xmlhttp.responseText);
                        return;
                    } else {
                        if (fail) {
                            fail(xmlhttp.status);
                            return;
                        }
                    }
            }
        };
        xmlhttp.open("GET", url, (success || fail));
        xmlhttp.send();
        if (cache) ajaxcache.push({ url: url, responseText: xmlhttp.responseText });
        return xmlhttp.responseText || xmlhttp.status;
    }

})()
