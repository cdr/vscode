/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as fs from 'fs';
import * as http from 'http';
import * as url from 'url';
import * as util from 'util';
import * as cookie from 'cookie';
import * as crypto from 'crypto';
import { isEqualOrParent } from 'vs/base/common/extpath';
import { getMediaMime } from 'vs/base/common/mime';
import { isLinux } from 'vs/base/common/platform';
import { ILogService } from 'vs/platform/log/common/log';
import { IServerEnvironmentService } from 'vs/server/node/serverEnvironmentService';
import { extname, dirname, join, normalize } from 'vs/base/common/path';
import { FileAccess, connectionTokenCookieName, connectionTokenQueryName } from 'vs/base/common/network';
import { generateUuid } from 'vs/base/common/uuid';
import { IProductService } from 'vs/platform/product/common/productService';
// eslint-disable-next-line code-import-patterns
import type { IWorkbenchConstructionOptions } from 'vs/workbench/workbench.web.main';
import { editorBackground, editorForeground } from 'vs/platform/theme/common/colorRegistry';
import { ClientTheme, getOriginalUrl, HTTPNotFoundError, relativePath, relativeRoot, WebManifest } from 'vs/server/common/net';
import { IServerThemeService } from 'vs/server/serverThemeService';
import { ServerConnectionToken, ServerConnectionTokenType } from 'vs/server/node/serverConnectionToken';
import { asText, IRequestService } from 'vs/platform/request/common/request';
import { IHeaders } from 'vs/base/parts/request/common/request';
import { CancellationToken } from 'vs/base/common/cancellation';
import { URI } from 'vs/base/common/uri';
import { streamToBuffer } from 'vs/base/common/buffer';
import { IProductConfiguration } from 'vs/base/common/product';
import { isString } from 'vs/base/common/types';
import { getLocaleFromConfig, getNLSConfiguration } from 'vs/server/node/remoteLanguagePacks';
import { IThemeService } from 'vs/platform/theme/common/themeService';

const textMimeType = {
	'.html': 'text/html',
	'.js': 'text/javascript',
	'.json': 'application/json',
	'.css': 'text/css',
	'.svg': 'image/svg+xml',
} as { [ext: string]: string | undefined };

/**
 * Serve a file at a given path or 404 if the file is missing.
 */
export async function serveFile(logService: ILogService, req: http.IncomingMessage, res: http.ServerResponse, filePath: string, responseHeaders: Record<string, string> = Object.create(null)): Promise<void> {
	try {
		const stat = await util.promisify(fs.stat)(filePath);

		// Check if file modified since
		const etag = `W/"${[stat.ino, stat.size, stat.mtime.getTime()].join('-')}"`; // weak validator (https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/ETag)
		if (req.headers['if-none-match'] === etag) {
			res.writeHead(304);
			return res.end();
		}

		// Headers
		responseHeaders['Content-Type'] = textMimeType[extname(filePath)] || getMediaMime(filePath) || 'text/plain';
		responseHeaders['Etag'] = etag;

		res.writeHead(200, responseHeaders);

		// Data
		fs.createReadStream(filePath).pipe(res);
	} catch (error) {
		if (error.code !== 'ENOENT') {
			logService.error(error);
			console.error(error.toString());
		}

		res.writeHead(404, { 'Content-Type': 'text/plain' });
		return res.end('Not found');
	}
}

const APP_ROOT = dirname(FileAccess.asFileUri('', require).fsPath);

export class WebClientServer {
	ctor: any;

	private readonly _webExtensionResourceUrlTemplate: URI | undefined;

	constructor(
		private readonly _connectionToken: ServerConnectionToken,
		@IServerEnvironmentService private readonly _environmentService: IServerEnvironmentService,
		@ILogService private readonly _logService: ILogService,
		@IRequestService private readonly _requestService: IRequestService,
		@IThemeService private readonly _themeService: IServerThemeService,
		@IProductService private readonly _productService: IProductService,
	) {
		this._webExtensionResourceUrlTemplate = this._productService.extensionsGallery?.resourceUrlTemplate ? URI.parse(this._productService.extensionsGallery.resourceUrlTemplate) : undefined;
	}

	/**
	 * Handle web resources (i.e. only needed by the web client).
	 * **NOTE**: This method is only invoked when the server has web bits.
	 * **NOTE**: This method is only invoked after the connection token has been validated.
	 */
	async handle(req: http.IncomingMessage, res: http.ServerResponse, parsedUrl: url.UrlWithParsedQuery): Promise<void> {
		try {
			const pathname = parsedUrl.pathname!;

			/**
			 * Add a custom manifest.
			 *
			 * @author coder
			 */
			if (pathname === '/manifest.json' || pathname === '/webmanifest.json') {
				return this._handleManifest(req, res, parsedUrl);
			}
			if (pathname === '/favicon.ico' || pathname === '/manifest.json' || pathname === '/code-192.png' || pathname === '/code-512.png') {
				return serveFile(this._logService, req, res, join(APP_ROOT, 'resources', 'server', pathname.substr(1)));
			}
			/**
			 * Add an endpoint for self-hosting webviews.  This must be unique per
			 * webview as the code relies on unique service workers.  In our case we
			 * use /webview/{{uuid}}.
			 *
			 * @author coder
			 */
			if (/^\/webview\//.test(pathname)) {
				// always serve webview requests, even without a token
				return this._handleWebview(req, res, parsedUrl);
			}
			if (/^\/static\//.test(pathname)) {
				return this._handleStatic(req, res, parsedUrl);
			}
			/**
			 * Move the service worker to the root.  This makes the scope the root
			 * (otherwise we would need to include Service-Worker-Allowed).
			 *
			 * @author coder
			 */
			if (pathname === '/' + this._environmentService.serviceWorkerFileName) {
				return serveFile(this._logService, req, res, this._environmentService.serviceWorkerPath);
			}
			if (pathname === '/') {
				return this._handleRoot(req, res, parsedUrl);
			}
			if (pathname === '/callback') {
				// callback support
				return this._handleCallback(res);
			}
			if (/^\/web-extension-resource\//.test(pathname)) {
				// extension resource support
				return this._handleWebExtensionResource(req, res, parsedUrl);
			}

			const error = new HTTPNotFoundError(`"${parsedUrl.pathname}" not found.`);
			req.emit('error', error);

			return;
		} catch (error) {
			console.log('VS CODE ERRORED');
			this._logService.error(error);
			console.error(error.toString());

			return this.serveError(req, res, 500, 'Internal Server Error.', parsedUrl);
		}
	}

	private async fetchClientTheme(): Promise<ClientTheme> {
		await this._themeService.readyPromise;
		const theme = await this._themeService.fetchColorThemeData();

		return {
			backgroundColor: theme.getColor(editorBackground, true)!.toString(),
			foregroundColor: theme.getColor(editorForeground, true)!.toString(),
		};
	}

	private _iconSizes = [192, 512];

	/**
	 * PWA manifest file. This informs the browser that the app may be installed.
	 */
	private async _handleManifest(req: http.IncomingMessage, res: http.ServerResponse, parsedUrl: url.UrlWithParsedQuery): Promise<void> {
		// The manifest URL is used as the base when resolving URLs so we can just
		// use . without having to check the depth since we serve it at the root.
		const clientTheme = await this.fetchClientTheme();
		const webManifest: WebManifest = {
			name: this._productService.nameLong,
			short_name: this._productService.nameShort,
			start_url: '.',
			display: 'fullscreen',
			'background-color': clientTheme.backgroundColor,
			description: 'Run editors on a remote server.',
			icons: this._iconSizes.map((size => ({
				src: `./static/resources/server/code-${size}.png`,
				type: 'image/png',
				sizes: `${size}x${size}`,
			})))
		};

		res.writeHead(200, { 'Content-Type': 'application/manifest+json' });

		return res.end(JSON.stringify(webManifest, null, 2));
	}

	/**
	 * Handle HTTP requests for /static/*
	 */
	private async _handleStatic(req: http.IncomingMessage, res: http.ServerResponse, parsedUrl: url.UrlWithParsedQuery): Promise<void> {
		const headers: Record<string, string> = Object.create(null);

		// Strip `/static/` from the path
		const normalizedPathname = decodeURIComponent(parsedUrl.pathname!); // support paths that are uri-encoded (e.g. spaces => %20)
		const relativeFilePath = normalize(normalizedPathname.substr('/static/'.length));

		const filePath = join(APP_ROOT, relativeFilePath);
		if (!isEqualOrParent(filePath, APP_ROOT, !isLinux)) {
			return this.serveError(req, res, 400, `Bad request.`, parsedUrl);
		}

		return serveFile(this._logService, req, res, filePath, headers);
	}

	/**
	 * Handle HTTP requests for /webview/*
	 *
	 * A unique path is required for every webview service worker.
	 */
	private async _handleWebview(req: http.IncomingMessage, res: http.ServerResponse, parsedUrl: url.UrlWithParsedQuery): Promise<void> {
		const headers: Record<string, string> = Object.create(null);

		// support paths that are uri-encoded (e.g. spaces => %20)
		const normalizedPathname = decodeURIComponent(parsedUrl.pathname!);

		// Strip `/webview/{uuid}` from the path.
		const relativeFilePath = normalize(normalizedPathname.split('/').splice(3).join('/'));

		const filePath = join(APP_ROOT, 'out/vs/workbench/contrib/webview/browser/pre', relativeFilePath);
		if (!isEqualOrParent(filePath, APP_ROOT, !isLinux)) {
			return this.serveError(req, res, 400, `Bad request.`, parsedUrl);
		}

		return serveFile(this._logService, req, res, filePath, headers);
	}

	private _getResourceURLTemplateAuthority(uri: URI): string | undefined {
		const index = uri.authority.indexOf('.');
		return index !== -1 ? uri.authority.substring(index + 1) : undefined;
	}

	/**
	 * Handle extension resources
	 */
	private async _handleWebExtensionResource(req: http.IncomingMessage, res: http.ServerResponse, parsedUrl: url.UrlWithParsedQuery): Promise<void> {
		if (!this._webExtensionResourceUrlTemplate) {
			return this.serveError(req, res, 500, 'No extension gallery service configured.');
		}

		// Strip `/web-extension-resource/` from the path
		const normalizedPathname = decodeURIComponent(parsedUrl.pathname!); // support paths that are uri-encoded (e.g. spaces => %20)
		const path = normalize(normalizedPathname.substr('/web-extension-resource/'.length));
		const uri = URI.parse(path).with({
			scheme: this._webExtensionResourceUrlTemplate.scheme,
			authority: path.substring(0, path.indexOf('/')),
			path: path.substring(path.indexOf('/') + 1)
		});

		if (this._getResourceURLTemplateAuthority(this._webExtensionResourceUrlTemplate) !== this._getResourceURLTemplateAuthority(uri)) {
			return this.serveError(req, res, 403, 'Request Forbidden');
		}

		const headers: IHeaders = {};
		const setRequestHeader = (header: string) => {
			const value = req.headers[header];
			if (value && (isString(value) || value[0])) {
				headers[header] = isString(value) ? value : value[0];
			} else if (header !== header.toLowerCase()) {
				setRequestHeader(header.toLowerCase());
			}
		};
		setRequestHeader('X-Client-Name');
		setRequestHeader('X-Client-Version');
		setRequestHeader('X-Machine-Id');
		setRequestHeader('X-Client-Commit');

		const context = await this._requestService.request({
			type: 'GET',
			url: uri.toString(true),
			headers
		}, CancellationToken.None);

		const status = context.res.statusCode || 500;
		if (status !== 200) {
			let text: string | null = null;
			try {
				text = await asText(context);
			} catch (error) {/* Ignore */ }
			return this.serveError(req, res, status, text || `Request failed with status ${status}`);
		}

		const responseHeaders: Record<string, string> = Object.create(null);
		const setResponseHeader = (header: string) => {
			const value = context.res.headers[header];
			if (value) {
				responseHeaders[header] = value;
			} else if (header !== header.toLowerCase()) {
				setResponseHeader(header.toLowerCase());
			}
		};
		setResponseHeader('Cache-Control');
		setResponseHeader('Content-Type');
		res.writeHead(200, responseHeaders);
		const buffer = await streamToBuffer(context.stream);
		return res.end(buffer.buffer);
	}

	/**
	 * Handle HTTP requests for /
	 */
	private async _handleRoot(req: http.IncomingMessage, res: http.ServerResponse, parsedUrl: url.UrlWithParsedQuery): Promise<void> {
		if (!req.headers.host) {
			return this.serveError(req, res, 400, `Bad request.`, parsedUrl);
		}

		// const { backgroundColor, foregroundColor } = await this.fetchClientTheme();
		const queryConnectionToken = parsedUrl.query[connectionTokenQueryName];
		if (typeof queryConnectionToken === 'string') {
			// We got a connection token as a query parameter.
			// We want to have a clean URL, so we strip it
			const responseHeaders: Record<string, string> = Object.create(null);
			responseHeaders['Set-Cookie'] = cookie.serialize(
				connectionTokenCookieName,
				queryConnectionToken,
				{
					sameSite: 'strict',
					maxAge: 60 * 60 * 24 * 7 /* 1 week */
				}
			);

			const newQuery = Object.create(null);
			for (let key in parsedUrl.query) {
				if (key !== connectionTokenQueryName) {
					newQuery[key] = parsedUrl.query[key];
				}
			}
			const newLocation = url.format({ pathname: '/', query: newQuery });
			responseHeaders['Location'] = newLocation;

			res.writeHead(302, responseHeaders);
			return res.end();
		}

		/**
		 * It is not possible to reliably detect the remote authority on the server
		 * in all cases.  Set this to something invalid to make sure we catch code
		 * that is using this when it should not.
		 *
		 * @author coder
		 */
		const remoteAuthority = 'remote';
		// const transformer = createRemoteURITransformer(remoteAuthority);
		// const { workspacePath, isFolder } = await this._getWorkspaceFromCLI();

		function escapeAttribute(value: string): string {
			return value.replace(/"/g, '&quot;');
		}

		let _wrapWebWorkerExtHostInIframe: undefined | false = undefined;
		if (this._environmentService.driverHandle) {
			// integration tests run at a time when the built output is not yet published to the CDN
			// so we must disable the iframe wrapping because the iframe URL will give a 404
			_wrapWebWorkerExtHostInIframe = false;
		}

		const filePath = FileAccess.asFileUri(this._environmentService.isBuilt ? 'vs/code/browser/workbench/workbench.html' : 'vs/code/browser/workbench/workbench-dev.html', require).fsPath;
		const authSessionInfo = !this._environmentService.isBuilt && this._environmentService.args['github-auth'] ? {
			id: generateUuid(),
			providerId: 'github',
			accessToken: this._environmentService.args['github-auth'],
			scopes: [['user:email'], ['repo']]
		} : undefined;

		const locale = this._environmentService.args.locale || await getLocaleFromConfig(this._environmentService.argvResource);
		const nlsConfiguration = await getNLSConfiguration(locale, this._environmentService.userDataPath)

		const base = relativeRoot(getOriginalUrl(req))
		const vscodeBase = relativePath(getOriginalUrl(req))
		const data = (await util.promisify(fs.readFile)(filePath)).toString()
			.replace('{{WORKBENCH_WEB_CONFIGURATION}}', escapeAttribute(JSON.stringify(<IWorkbenchConstructionOptions>{
				// TODO@jsjoeio check if this still works (passing them via the CLI)
				// folderUri: (workspacePath && isFolder) ? transformer.transformOutgoing(URI.file(workspacePath)) : undefined,
				// workspaceUri: (workspacePath && !isFolder) ? transformer.transformOutgoing(URI.file(workspacePath)) : undefined,
				remoteAuthority,
				_wrapWebWorkerExtHostInIframe,
				developmentOptions: {
					enableSmokeTestDriver: this._environmentService.driverHandle === 'web' ? true : undefined,
					logLevel: this._logService.getLevel(),
				},
				userDataPath: this._environmentService.userDataPath,
				settingsSyncOptions: !this._environmentService.isBuilt && this._environmentService.args['enable-sync'] ? { enabled: true } : undefined,
				productConfiguration: <Partial<IProductConfiguration>>{
					...this._productService,

					// Session
					auth: this._environmentService.auth,

					// Service Worker
					serviceWorker: {
						scope: vscodeBase + '/',
						url: vscodeBase + '/' + this._environmentService.serviceWorkerFileName,
					},

					// Endpoints
					base,
					logoutEndpointUrl: base + '/logout',
					proxyEndpointUrlTemplate: base + '/proxy/{{port}}',
					webEndpointUrl: vscodeBase + '/static',
					webEndpointUrlTemplate: vscodeBase + '/static',
					webviewContentExternalBaseUrlTemplate: vscodeBase + '/webview/{{uuid}}/',
					updateUrl: base + '/update/check',
					// NOTE@coder
					// TODO@jsjoeio - we need to test web extensions and make sure they still work.
					extensionsGallery: this._webExtensionResourceUrlTemplate ? {
						...this._productService.extensionsGallery,
						'resourceUrlTemplate': this._webExtensionResourceUrlTemplate.with({
							scheme: 'http',
							authority: remoteAuthority,
							path: `web-extension-resource/${this._webExtensionResourceUrlTemplate.authority}${this._webExtensionResourceUrlTemplate.path}`
						}).toString(true)
					} : undefined
				},
			})))
			.replace(/{{NLS_CONFIGURATION}}/g, () => escapeAttribute(JSON.stringify(nlsConfiguration)))
			// .replace(/{{CLIENT_BACKGROUND_COLOR}}/g, () => backgroundColor)
			// .replace(/{{CLIENT_FOREGROUND_COLOR}}/g, () => foregroundColor)
			.replace('{{WORKBENCH_AUTH_SESSION}}', () => authSessionInfo ? escapeAttribute(JSON.stringify(authSessionInfo)) : '')
			.replace(/{{BASE}}/g, () => vscodeBase);

		const cspDirectives = [
			'default-src \'self\';',
			'img-src \'self\' https: data: blob:;',
			'media-src \'self\';',
			`script-src 'self' 'unsafe-eval' ${this._getScriptCspHashes(data).join(' ')} 'sha256-9CevbjD7QdrWdGrVTVJD74tTH4eAhisvCOlLtWUn+Iw=';`, // the sha is the same as in src/vs/workbench/services/extensions/worker/httpWebWorkerExtensionHostIframe.html
			'child-src \'self\';',
			`frame-src 'self' ${this._productService.webEndpointUrl || ''} data:;`,
			'worker-src \'self\' data:;',
			'style-src \'self\' \'unsafe-inline\';',
			'connect-src \'self\' ws: wss: https:;',
			'font-src \'self\' blob:;',
			'manifest-src \'self\' https://cloud.coder.com https://github.com;'
		].join(' ');

		const headers: http.OutgoingHttpHeaders = {
			'Content-Type': 'text/html',
			'Content-Security-Policy': cspDirectives
		};
		if (this._connectionToken.type !== ServerConnectionTokenType.None) {
			// At this point we know the client has a valid cookie
			// and we want to set it prolong it to ensure that this
			// client is valid for another 1 week at least
			headers['Set-Cookie'] = cookie.serialize(
				connectionTokenCookieName,
				this._connectionToken.value,
				{
					sameSite: 'strict',
					maxAge: 60 * 60 * 24 * 7 /* 1 week */
				}
			);
		}

		res.writeHead(200, headers);
		return res.end(data);
	}

	private _getScriptCspHashes(content: string): string[] {
		// Compute the CSP hashes for line scripts. Uses regex
		// which means it isn't 100% good.
		const regex = /<script>([\s\S]+?)<\/script>/img;
		const result: string[] = [];
		let match: RegExpExecArray | null;
		while (match = regex.exec(content)) {
			const hasher = crypto.createHash('sha256');
			// This only works on Windows if we strip `\r` from `\r\n`.
			const script = match[1].replace(/\r\n/g, '\n');
			const hash = hasher
				.update(Buffer.from(script))
				.digest().toString('base64');

			result.push(`'sha256-${hash}'`);
		}
		return result;
	}

	/**
	 * Handle HTTP requests for /callback
	 */
	private async _handleCallback(res: http.ServerResponse): Promise<void> {
		const filePath = FileAccess.asFileUri('vs/code/browser/workbench/callback.html', require).fsPath;
		const data = (await util.promisify(fs.readFile)(filePath)).toString();
		const cspDirectives = [
			'default-src \'self\';',
			'img-src \'self\' https: data: blob:;',
			'media-src \'none\';',
			`script-src 'self' ${this._getScriptCspHashes(data).join(' ')};`,
			'style-src \'self\' \'unsafe-inline\';',
			'font-src \'self\' blob:;'
		].join(' ');

		res.writeHead(200, {
			'Content-Type': 'text/html',
			'Content-Security-Policy': cspDirectives
		});
		return res.end(data);
	}

	serveError = async (req: http.IncomingMessage, res: http.ServerResponse, code: number, message: string, parsedUrl?: url.UrlWithParsedQuery): Promise<void> => {
		const { applicationName, commit = 'development', version } = this._productService;

		res.statusCode = code;
		res.statusMessage = message;

		if (parsedUrl) {
			this._logService.debug(`[${parsedUrl.toString()}] ${code}: ${message}`);

			if (parsedUrl.pathname?.endsWith('.json')) {
				res.setHeader('Content-Type', 'application/json');

				res.end(JSON.stringify({ code, message, commit }));
				return;
			}
		}

		const clientTheme = await this.fetchClientTheme();

		res.setHeader('Content-Type', 'text/html');

		const filePath = FileAccess.asFileUri('vs/code/browser/workbench/workbench-error.html', require).fsPath;
		const data = (await util.promisify(fs.readFile)(filePath)).toString()
			.replace(/{{ERROR_HEADER}}/g, () => `${applicationName}`)
			.replace(/{{ERROR_CODE}}/g, () => code.toString())
			.replace(/{{ERROR_MESSAGE}}/g, () => message)
			.replace(/{{ERROR_FOOTER}}/g, () => `${version} - ${commit}`)
			.replace(/{{CLIENT_BACKGROUND_COLOR}}/g, () => clientTheme.backgroundColor)
			.replace(/{{CLIENT_FOREGROUND_COLOR}}/g, () => clientTheme.foregroundColor)
			.replace(/{{BASE}}/g, () => relativePath(getOriginalUrl(req)));

		res.end(data);
	};

	// TODO@jsjoeio maybe delete this
	// private async _getWorkspaceFromCLI(): Promise<{ workspacePath?: string, isFolder?: boolean }> {

	// 	// check for workspace argument
	// 	const workspaceCandidate = this._environmentService.args['workspace'];
	// 	if (workspaceCandidate && workspaceCandidate.length > 0) {
	// 		const workspace = sanitizeFilePath(workspaceCandidate, cwd());
	// 		if (await util.promisify(fs.exists)(workspace)) {
	// 			return { workspacePath: workspace };
	// 		}
	// 	}

	// 	// check for folder argument
	// 	const folderCandidate = this._environmentService.args['folder'];
	// 	if (folderCandidate && folderCandidate.length > 0) {
	// 		const folder = sanitizeFilePath(folderCandidate, cwd());
	// 		if (await util.promisify(fs.exists)(folder)) {
	// 			return { workspacePath: folder, isFolder: true };
	// 		}
	// 	}

	// 	// empty window otherwise
	// 	return {};
	// }
}
