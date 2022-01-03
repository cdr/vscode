/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { parse as parseUrl, Url } from 'url';
import { isBoolean } from 'vs/base/common/types';

export type Agent = any;

function getSystemProxyURI(requestURL: Url, env: typeof process.env): string | null {
	if (requestURL.protocol === 'http:') {
		return env.HTTP_PROXY || env.http_proxy || null;
	} else if (requestURL.protocol === 'https:') {
		return env.HTTPS_PROXY || env.https_proxy || env.HTTP_PROXY || env.http_proxy || null;
	}

	return null;
}

export interface IOptions {
	proxyUrl?: string;
	strictSSL?: boolean;
}

export async function getProxyAgent(rawRequestURL: string, env: typeof process.env, options: IOptions = {}): Promise<Agent> {
	const requestURL = parseUrl(rawRequestURL);
	const proxyURL = options.proxyUrl || getSystemProxyURI(requestURL, env);

	if (!proxyURL) {
		return null;
	}

	const proxyEndpoint = parseUrl(proxyURL);

	if (!/^https?:$/.test(proxyEndpoint.protocol || '')) {
		return null;
	}

	const opts = {
		host: proxyEndpoint.hostname || '',
		port: proxyEndpoint.port || (proxyEndpoint.protocol === 'https' ? '443' : '80'),
		auth: proxyEndpoint.auth,
		rejectUnauthorized: isBoolean(options.strictSSL) ? options.strictSSL : true,
	};

	return requestURL.protocol === 'http:'
		? new (await import('http-proxy-agent'))(opts as any as Url)
		: new (await import('https-proxy-agent'))(opts);
}

/**
 * Patch the node http and https modules to route all requests through the agent
 * we get from the proxy-agent package if a proxy is set in the environment.
 *
 * @author coder
 */
export async function monkeyPatchHttpAgent(): Promise<void> {
	if (process.env.http_proxy || process.env.https_proxy || process.env.HTTP_PROXY || process.env.HTTPS_PROXY) {
		const http = require('http')
		const https = require('https')

		// If we do not pass in a proxy URL, proxy-agent will get the URL from the
		// environment.  See https://www.npmjs.com/package/proxy-from-env.
		const pa = new (await import('proxy-agent'))();
		http.globalAgent = pa;
		https.globalAgent = pa;
	}
}
