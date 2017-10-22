/*!
 * client.js - http client for bcurl
 * Copyright (c) 2017, Christopher Jeffrey (MIT License).
 * https://github.com/bcoin-org/bcurl
 */

'use strict';

const assert = require('assert');
const URL = require('url');
const bsock = require('bsock');
const breq = require('breq');

class Client {
  /**
   * HTTP client.
   * @constructor
   * @param {Object?} options
   */

  constructor(options) {
    super();

    const opt = new ClientOptions(options);

    this.ssl = opt.ssl;
    this.host = opt.host;
    this.port = opt.port;
    this.path = opt.path;
    this.username = opt.username;
    this.password = opt.password;
    this.token = opt.token;
    this.id = 0;
  }

  /**
   * Open a websocket.
   * @returns {Promise}
   */

  connect() {
    return new Promise((resolve, reject) => {
      const {port, host, ssl} = this;
      const socket = bsock.connect(port, host, ssl);
      socket.once('error', reject);
      socket.on('open', () => {
        socket.removeListener('error', reject);
        resolve(socket);
      });
    });
  }

  /**
   * Make an http request to endpoint.
   * @param {String} method
   * @param {String} endpoint - Path.
   * @param {Object} params - Body or query depending on method.
   * @returns {Promise}
   */

  async request(method, endpoint, params) {
    assert(typeof method === 'string');
    assert(typeof endpoint === 'string');

    let query = null;

    if (params == null)
      params = {};

    assert(params && typeof params === 'object');

    if (this.token)
      params.token = this.token;

    if (method === 'GET') {
      query = params;
      params = null;
    }

    const res = await breq({
      method: method,
      ssl: this.ssl,
      host: this.host,
      port: this.port,
      path: this.path + endpoint,
      username: this.username,
      password: this.password,
      query: query,
      pool: true,
      json: params
    });

    if (res.statusCode === 404)
      return null;

    if (res.statusCode === 401)
      throw new Error('Unauthorized (bad API key).');

    if (res.type !== 'json')
      throw new Error('Bad response (wrong content-type).');

    const json = res.json();

    if (!json)
      throw new Error('Bad response (no body).');

    if (json.error) {
      const {error} = json;
      const err = new Error(error.message);
      err.type = String(error.type);
      err.code = error.code;
      throw err;
    }

    if (res.statusCode !== 200)
      throw new Error(`Status code: ${res.statusCode}.`);

    return json;
  }

  /**
   * Make a GET http request to endpoint.
   * @param {String} endpoint - Path.
   * @param {Object} params - Querystring.
   * @returns {Promise}
   */

  get(endpoint, params) {
    return this.request('GET', endpoint, params);
  }

  /**
   * Make a POST http request to endpoint.
   * @param {String} endpoint - Path.
   * @param {Object} params - Body.
   * @returns {Promise}
   */

  post(endpoint, params) {
    return this.request('POST', endpoint, params);
  }

  /**
   * Make a PUT http request to endpoint.
   * @param {String} endpoint - Path.
   * @param {Object} params - Body.
   * @returns {Promise}
   */

  put(endpoint, params) {
    return this.request('PUT', endpoint, params);
  }

  /**
   * Make a DELETE http request to endpoint.
   * @param {String} endpoint - Path.
   * @param {Object} params - Body.
   * @returns {Promise}
   */

  del(endpoint, params) {
    return this.request('DELETE', endpoint, params);
  }

  /**
   * Make a json rpc request.
   * @param {String} endpoint - Path.
   * @param {String} method - RPC method name.
   * @param {Array} params - RPC parameters.
   * @returns {Promise} - Returns Object?.
   */

  async call(endpoint, method, params) {
    assert(typeof endpoint === 'string');
    assert(typeof method === 'string');

    if (params == null)
      params = null;

    this.id += 1;

    const res = await breq({
      method: 'POST',
      ssl: this.ssl,
      host: this.host,
      port: this.port,
      path: this.path + endpoint,
      username: this.username,
      password: this.password,
      pool: true,
      json: {
        method: method,
        params: params,
        id: this.id
      }
    });

    if (res.statusCode === 401)
      throw new RPCError('Unauthorized (bad API key).', -1);

    if (res.type !== 'json')
      throw new Error('Bad response (wrong content-type).');

    if (!res.body)
      throw new Error('No body for JSON-RPC response.');

    if (res.body.error) {
      const {message, code} = res.body.error;
      throw new RPCError(message, code);
    }

    if (res.statusCode !== 200)
      throw new Error(`Status code: ${res.statusCode}.`);

    return res.body.result;
  }
}

class ClientOptions {
  constructor(options) {
    this.ssl = false;
    this.host = 'localhost';
    this.port = 80;
    this.path = '/';
    this.username = null;
    this.password = null;
    this.token = null;

    if (options)
      this.fromOptions(options);
  }

  fromOptions(options) {
    if (typeof options === 'string')
      options = { url: options };

    assert(options && typeof options === 'object');

    if (options.ssl != null) {
      assert(typeof options.ssl === 'boolean');
      this.ssl = options.ssl;
      this.port = 443;
    }

    if (options.host != null) {
      assert(typeof options.host === 'string');
      this.host = options.host;
    }

    if (options.port != null) {
      assert((options.port & 0xffff) === options.port);
      assert(options.port !== 0);
      this.port = options.port;
    }

    if (options.path != null) {
      assert(typeof options.path === 'string');
      this.port = options.port;
    }

    if (options.url != null) {
      assert(typeof options.url === 'string');

      let url = options.url;

      if (url.indexOf('://') === -1)
        url = 'http://' + url;

      const data = URL.parse(url);

      if (data.protocol !== 'http:'
          && data.protocol !== 'https:') {
        throw new Error('Malformed URL.');
      }

      if (!data.hostname)
        throw new Error('Malformed URL.');

      if (data.protocol === 'https:') {
        this.ssl = true;
        this.port = 443;
      }

      this.host = data.hostname;

      if (data.port) {
        const port = parseInt(data.port, 10);
        assert((port & 0xffff) === port);
        assert(port !== 0);
        this.port = port;
      }

      this.path = data.pathname;

      if (data.auth) {
        const parts = data.auth.split(':');
        this.username = data.auth.shift();
        this.password = data.auth.join(':');
      }
    }

    if (options.apiKey != null) {
      assert(typeof options.apiKey === 'string');
      this.password = options.apiKey;
    }

    if (options.key != null) {
      assert(typeof options.key === 'string');
      this.password = options.key;
    }

    if (options.username != null) {
      assert(typeof options.username === 'string');
      this.username = options.username;
    }

    if (options.password != null) {
      assert(typeof options.password === 'string');
      this.password = options.password;
    }

    if (options.token != null) {
      assert(typeof options.token === 'string');
      this.token = options.token;
    }

    return this;
  }
}

/*
 * Helpers
 */

class RPCError extends Error {
  constructor(msg, code) {
    super();

    this.type = 'RPCError';
    this.message = String(msg);
    this.code = code >>> 0;

    if (Error.captureStackTrace)
      Error.captureStackTrace(this, RPCError);
  }
}

/*
 * Expose
 */

module.exports = Client;