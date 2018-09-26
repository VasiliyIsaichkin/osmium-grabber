const request = require('request-promise-native');
const cheerio = require('cheerio');
const tools = require('osmium-tools');
const tough = require('tough-cookie');
const he = require('he');

class Grabber {
	_initDb() {
		let dbSchema = {};
		this.tableName = this.options.tableName || 'osmium_grabber';
		dbSchema[this.tableName] = {
			jar : 'text',
			name: 'string'
		};
		this.db.defineSchema(dbSchema);
		this.db.disableVirtualRemove();
	}

	constructor(basicUrl, options = {}) {
		this.jar = request.jar();
		this.options = options;
		this.basicUrl = basicUrl;
		this.tools = tools;
		this.host = basicUrl.split('//')[1].split('/')[0].split(':')[0];

		this.defRequestOptions = {
			gzip   : true,
			method : 'GET',
			jar    : this.jar,
			headers: {
				'Accept'         : 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,image/apng,*/*;q=0.8',
				'Accept-Language': 'ru-RU,ru;q=0.9,en-US;q=0.8,en;q=0.7',
				'Cache-Control'  : 'max-age=0',
				'Connection'     : 'keep-alive',
				'Host'           : this.host,
				'User-Agent'     : 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/69.0.3497.100 Safari/537.36',
				'Cookie'         : ''
			}
		};

		if (this.options.cookies) {
			tools.iterate(this.options.cookies, (val, name) => this.jar.setCookie(request.cookie(`${name}=${val}`), this.basicUrl + '/'));
		}

		this.db = false;

		if (options.db && options.name) {
			this.db = options.db;
			this.db_jarReaded = false;
			this._initDb();
		}
	}

	async request(path, options = {}, not$ = false) {
		let resOptions = {};
		let url = `${this.basicUrl}${path}`;
		this.lastUrl = this.lastUrl || url;

		Object.assign(resOptions, this.defRequestOptions, options);
		resOptions.headers = {};
		Object.assign(resOptions.headers, this.defRequestOptions.headers, options.headers || {});

		if (this.db && !this.db_jarReaded) {
			let table = this.db.models[this.tableName];
			let name = this.options.name;
			let res = await table.findOne({name});
			if (res) {
				this.jar._jar = tough.CookieJar.fromJSON(res.jar);
			}
			this.db_jarReaded = true;
		}

		resOptions.headers.Referer = resOptions.headers.Referer || this.lastUrl;

		let reqRes = await request(url, resOptions);
		reqRes = he.decode(reqRes);
		this.lastUrl = url;

		if (this.db) {
			let jar = JSON.stringify(this.jar._jar.toJSON());
			let table = this.db.models[this.tableName];
			let name = this.options.name;

			if (await table.findOne({name})) {
				await table.update({jar}, {where: {name}});
			} else {
				await table.create({name, jar});
			}
		}

		if (not$) return reqRes;

		let $ = cheerio.load(reqRes);
		$.toArray = (selector) => {
			let arr = [];
			(tools.isString(selector) ? $(selector) : selector).each(function () { arr.push($(this)); });
			return arr;
		};
		return $;
	}

	async grab(path, options = {}, not$ = false) {
		let res = await this.request(path, options, not$);
		if (not$ || !this.options.loginHandler || !this.options.loginDetector) return res;
		if (!await this.options.loginDetector(res, options)) return res;

		return await this.options.loginHandler(this, options) ? await this.grab(path, options) : false;
	}

	async get(path, options = {}, not$ = false) {
		options.method = 'GET';
		return await this.grab(path, options, not$);
	}

	async post(path, options = {}, not$ = false) {
		options.method = 'POST';
		return await this.grab(path, options, not$);
	}
}

module.exports = Grabber;