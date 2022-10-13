var querystring = require('querystring');

var got = require('got');

var languages = require('./languages');

function extract(key, res) {
    var re = new RegExp(`"${key}":".*?"`);
    var result = re.exec(res.body);
    if (result !== null) {
        return result[0].replace(`"${key}":"`, '').slice(0, -1);
    }
    return '';
}

function translate(text, opts, gotopts) {
    opts = opts || {};
    gotopts = gotopts || {};
    var e;
    [opts.from, opts.to].forEach(function (lang) {
        if (lang && !languages.isSupported(lang)) {
            e = new Error();
            e.code = 400;
            e.message = 'The language \'' + lang + '\' is not supported';
        }
    });
    if (e) {
        return new Promise(function (resolve, reject) {
            reject(e);
        });
    }

    opts.from = opts.from || 'auto';
    opts.to = opts.to || 'en';

    if (opts.useGoogleAPIs) {
        let key = opts.googleAPIsKey || "";
        opts.url = "https://translation.googleapis.com/language/translate/v2?key=" + key;
    }
    else {
        opts.url = opts.url || 'https://translate.google.cn';
    }

    opts.from = languages.getCode(opts.from);
    opts.to = languages.getCode(opts.to);

    var url = opts.url;
    if (opts.useGoogleAPIs) {
        let payload = {
            "q": text,
            "target": opts.to,
            "format": "text"
        }

        gotopts.body = JSON.stringify(payload);
        gotopts.headers = gotopts.headers || {};
        gotopts.headers['content-type'] = 'application/json;charset=UTF-8';

        return got.post(url, gotopts).then(function (res) {
            var result = {
                text: '',
                pronunciation: '',
                candidates: [],
                from: {
                    language: {
                        didYouMean: false,
                        iso: ''
                    },
                    text: {
                        autoCorrected: false,
                        value: '',
                        didYouMean: false
                    }
                },
                raw: ''
            };

            let resJson = {};
            try {
                resJson = JSON.parse(res.body);
            } catch (e) {
                return result;
            }

            if (!resJson || !resJson.data || !resJson.data.translations || 0 == resJson.data.translations.length) {
                return result;
            }

            result.text = resJson.data.translations[0].translatedText || '';
            result.from.language.iso = opts.from;
            result.from.text.value = text;
            result.raw = resJson;

            return result;
        }).catch(function (err) {
            err.message += `\nUrl: ${url}\nPayload: ${JSON.stringify(payload)}`;
            if (err.statusCode !== undefined && err.statusCode !== 200) {
                err.code = 'BAD_REQUEST';
            } else {
                err.code = 'BAD_NETWORK';
            }
            throw err;
        });
    } else {
        return got(url, gotopts).then(function (res) {
            var data = {
                'rpcids': 'MkEWBc',
                'f.sid': extract('FdrFJe', res),
                'bl': extract('cfb2h', res),
                'hl': 'en-US',
                'soc-app': 1,
                'soc-platform': 1,
                'soc-device': 1,
                '_reqid': Math.floor(1000 + (Math.random() * 9000)),
                'rt': 'c'
            };

        return data;
    }).then(function (data) {
        url = url + '/_/TranslateWebserverUi/data/batchexecute?' + querystring.stringify(data);
        gotopts.body = 'f.req=' + encodeURIComponent(JSON.stringify([[['MkEWBc', JSON.stringify([[text, opts.from, opts.to, true], [null]]), null, 'generic']]])) + '&';
        gotopts.headers['content-type'] = 'application/x-www-form-urlencoded;charset=UTF-8';

        return got.post(url, gotopts).then(function (res) {
            var json = res.body.slice(6);
            var length = '';

            var result = {
                text: '',
                pronunciation: '',
                candidates: [],
                from: {
                    language: {
                        didYouMean: false,
                        iso: ''
                    },
                    text: {
                        autoCorrected: false,
                        value: '',
                        didYouMean: false
                    }
                },
                raw: ''
            };

            try {
                length = /^\d+/.exec(json)[0];
                json = JSON.parse(json.slice(length.length, parseInt(length, 10) + length.length));
                json = JSON.parse(json[0][2]);
                result.raw = json;
            } catch (e) {
                return result;
            }

            if (json[1][0][0][5] === undefined || json[1][0][0][5] === null) {
                // translation not found, could be a hyperlink or gender-specific translation?
                result.text = json[1][0][0][0];
            } else {
                result.text = json[1][0][0][5]
                    .map(function (obj) {
                        return obj[0];
                    })
                    .filter(Boolean)
                    // Google api seems to split text per sentences by <dot><space>
                    // So we join text back with spaces.
                    // See: https://github.com/vitalets/google-translate-api/issues/73
                    .join(' ');
            }
            result.pronunciation = json[1][0][0][1];
            try { result.candidates = json[1][0][0][5][0][4].map(a => a[0]) } catch(e) {}

            // From language
            if (json[0] && json[0][1] && json[0][1][1]) {
                result.from.language.didYouMean = true;
                result.from.language.iso = json[0][1][1][0];
            } else if (json[1][3] === 'auto') {
                result.from.language.iso = json[2];
            } else {
                result.from.language.iso = json[1][3];
            }

            // Did you mean & autocorrect
            if (json[0] && json[0][1] && json[0][1][0]) {
                var str = json[0][1][0][0][1];

                str = str.replace(/<b>(<i>)?/g, '[');
                str = str.replace(/(<\/i>)?<\/b>/g, ']');

                result.from.text.value = str;

                if (json[0][1][0][2] === 1) {
                    result.from.text.autoCorrected = true;
                } else {
                    result.from.text.didYouMean = true;
                }
            }

            return result;
        }).catch(function (err) {
            err.message += `\nUrl: ${url}`;
            if (err.statusCode !== undefined && err.statusCode !== 200) {
                err.code = 'BAD_REQUEST';
            } else {
                err.code = 'BAD_NETWORK';
            }
            throw err;
        });
    });
}

module.exports = translate;
module.exports.languages = languages;
