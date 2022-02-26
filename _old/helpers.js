function throttle(func, wait, options) {
    var context, args, result;
    var timeout = null;
    var previous = 0;
    if (!options) options = {};
    var later = function() {
        previous = options.leading === false ? 0 : Date.now();
        timeout = null;
        result = func.apply(context, args);
        if (!timeout) context = args = null;
    };
    return function() {
        var now = Date.now();
        if (!previous && options.leading === false) previous = now;
        var remaining = wait - (now - previous);
        context = this;
        args = arguments;
        if (remaining <= 0 || remaining > wait) {
            if (timeout) {
                clearTimeout(timeout);
                timeout = null;
            }
            previous = now;
            result = func.apply(context, args);
            if (!timeout) context = args = null;
        } else if (!timeout && options.trailing !== false) {
            timeout = setTimeout(later, remaining);
        }
        return result;
    };
};

const find = document.querySelector.bind(document);
const findAll = document.querySelectorAll.bind(document);

function loadPage(page, data) {
	const frame = find('#pageview');
	if (!frame) {
		window.parent.postMessage({
			request: 'loadPage',
			page,
			data
		});
		return;
	}
	frame.src = page + '.html';
	frame.addEventListener('load', function loaded() {
		frame.removeEventListener('load', loaded);
		frame.contentWindow.postMessage(data);
	});
}
