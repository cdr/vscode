/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Coder Technologies. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createReadStream, promises as fs, readFileSync } from 'fs';
import { IncomingMessage, Server, ServerResponse } from 'http';
import { normalize } from 'path';
import { match, MatchFunction } from 'path-to-regexp';
import { getMediaOrTextMime, PLAIN_TEXT_MIME_TYPE } from 'vs/base/common/mime';
import { ProtocolConstants } from 'vs/base/parts/ipc/common/ipc.net';
import { refineServiceDecorator } from 'vs/platform/instantiation/common/instantiation';
import { ILogService } from 'vs/platform/log/common/log';
import { editorBackground, editorForeground } from 'vs/platform/theme/common/colorRegistry';
import { AbstractIncomingRequestService, IAbstractIncomingRequestService, ParsedRequest } from 'vs/server/services/net/abstractIncomingRequestService';
import { IEnvironmentServerService } from 'vs/server/services/environmentService';
import { IServerThemeService } from 'vs/server/services/themeService';
import * as Handlebars from 'handlebars';
import { FileSystemError } from 'vs/workbench/api/common/extHostTypes';
import { WebRequestListener, Callback, compileTemplate, WorkbenchErrorTemplate, WorkbenchTemplate, contentSecurityPolicies, WebManifest, PollingURLQueryKeys, ClientTheme, matcherOptions, CSP_NONCE, wellKnownKeys } from 'vs/server/services/net/common/http';
import { join } from 'vs/base/common/path';

interface RequestHandlerOptions {
	/**
	 * Disables the 404 route handler.
	 * @remark This is especially useful when a parent server is delegating requests.
	 */
	disableFallbackRoute?: boolean
}

export interface IIncomingHTTPRequestService extends IAbstractIncomingRequestService {
	listen(): void;
}

export const IIncomingHTTPRequestService = refineServiceDecorator<IAbstractIncomingRequestService, IIncomingHTTPRequestService>(IAbstractIncomingRequestService);

export class IncomingHTTPRequestService extends AbstractIncomingRequestService<WebRequestListener> implements IIncomingHTTPRequestService {
	private logName = '[Incoming HTTP Service]';

	/** Stored callback URI's sent over from client-side `PollingURLCallbackProvider`. */
	private callbackUriToRequestId = new Map<string, Callback>();

	private templates: {
		workbenchError: HandlebarsTemplateDelegate;
		workbenchDev: HandlebarsTemplateDelegate
		workbenchProd: HandlebarsTemplateDelegate
		callback: string
	};

	private contentSecurityPolicyHeaderContent = Object
		.keys(contentSecurityPolicies)
		.map((policyName) => `${policyName} ${contentSecurityPolicies[policyName]};`)
		.join(' ');

	protected eventName = 'request';
	/**
	 * Event listener which handles all incoming requests.
	 */
	protected eventListener: WebRequestListener = async (req, res) => {
		res.setHeader('Access-Control-Allow-Origin', '*');

		try {
			for (const [pattern, handler] of this.routes.entries()) {
				const handled = await this.route(req, res, pattern, handler);

				if (handled) {
					return;
				}
			}
		} catch (error: any) {
			this.logService.error(error);

			return this.serveError(req, res, 500, 'Internal Server Error.');
		}

		const message = `"${req.parsedUrl.pathname}" not found.`;
		const error = FileSystemError.FileNotFound(message);
		if (this.options.disableFallbackRoute) {
			req.emit('error', error);
		} else {
			return this.serveError(req, res, 404, message);
		}
	};

	/**
	 * Attempts to match a route with a given pattern.
	 */
	private route = async (req: ParsedRequest, res: ServerResponse, pattern: MatchFunction, handler: WebRequestListener<any>) => {
		const match = pattern(req.parsedUrl.pathname);

		if (match) {
			await handler(req, res, match.params);
			return true;
		}

		return false;
	};

	/**
	 * PWA manifest file. This informs the browser that the app may be installed.
	 */
	private $webManifest: WebRequestListener = async (req, res) => {
		const { productConfiguration } = await this.environmentService.createWorkbenchWebConfiguration(req);
		const clientTheme = await this.fetchClientTheme();
		const startUrl = req.pathPrefix.substring(
			0,
			req.pathPrefix.lastIndexOf('/') + 1
		);

		const webManifest: WebManifest = {
			name: productConfiguration.nameLong!,
			short_name: productConfiguration.nameShort!,
			start_url: normalize(startUrl),
			display: 'fullscreen',
			'background-color': clientTheme.backgroundColor,
			description: 'Run editors on a remote server.',
			icons: productConfiguration.icons || [],
		};

		res.writeHead(200, { 'Content-Type': 'application/manifest+json' });

		return res.end(JSON.stringify(webManifest, null, 2));
	};

	/**
	 * Service Worker endpoint.
	 * @remark this is separated to satisfy the browser's relative scope requirements.
	 */
	private $serviceWorker: WebRequestListener = async (req, res) => {
		return this.serveFile(this.environmentService.serviceWorkerPath, req, res, {
			'Service-Worker-Allowed': req.pathPrefix,
		});
	};

	/**
	 * Static files endpoint.
	 */
	private $static: WebRequestListener<string[]> = async (req, res, params) => {
		return this.serveFile(join(this.environmentService.appRoot, params[0]), req, res);
	};

	/**
	 * Root application endpoint.
	 * @remark This is generally where the server and client interact for the first time.
	 */
	private $root: WebRequestListener = async (req, res) => {
		const webConfigJSON = await this.environmentService.createWorkbenchWebConfiguration(req);
		const { isBuilt } = this.environmentService;
		const clientTheme = await this.fetchClientTheme();

		res.writeHead(200, {
			'Content-Type': 'text/html',
			[isBuilt ? 'Content-Security-Policy' : 'Content-Security-Policy-Report-Only']: this.contentSecurityPolicyHeaderContent
		});


		// TODO: investigate auth session for authentication.
		// const authSessionInfo = null;
		const template = this.templates[isBuilt ? 'workbenchProd' : 'workbenchDev'];

		return res.end(template({
			// Inject server-side workbench configuration for client-side workbench.
			WORKBENCH_WEB_CONFIGURATION: webConfigJSON,
			WORKBENCH_BUILTIN_EXTENSIONS: [],
			CLIENT_BACKGROUND_COLOR: clientTheme.backgroundColor,
			CLIENT_FOREGROUND_COLOR: clientTheme.foregroundColor,
			// WORKBENCH_AUTH_SESSION: authSessionInfo ? escapeJSON(authSessionInfo) : '',
			CSP_NONCE,
		})
		);
	};

	/**
 * Web Config endpoint.
 * @remark This can be helpful in debugging a server-side configuration.
 */
	private $webConfig: WebRequestListener = async (req, res) => {
		const webConfigJSON = await this.environmentService.createWorkbenchWebConfiguration(req);

		res.writeHead(200, { 'Content-Type': 'application/json' });

		return res.end(JSON.stringify(webConfigJSON, null, 2));
	};

	/**
	 * Callback endpoint.
	 * @remark The callback cycle is further documented in `PollingURLCallbackProvider`.
	 */
	private $callback: WebRequestListener = async (req, res) => {
		const { parsedUrl } = req;
		const [requestId, vscodeScheme = 'code-oss', vscodeAuthority, vscodePath, vscodeQuery, vscodeFragment] = wellKnownKeys.map(key => {
			const value = parsedUrl.searchParams.get(key);

			return value && value !== null ? decodeURIComponent(value) : undefined;
		});

		if (!requestId) {
			res.writeHead(400, { 'Content-Type': PLAIN_TEXT_MIME_TYPE });
			return res.end('Bad request.');
		}

		// Merge over additional query values that we got.
		let query = new URLSearchParams(vscodeQuery || '');

		for (const key in query.keys()) {
			// Omit duplicate keys within query.
			if (wellKnownKeys.includes(key as PollingURLQueryKeys)) {
				query.delete(key);
			}
		}

		const callback: Callback = {
			uri: {
				scheme: vscodeScheme || 'code-oss',
				authority: vscodeAuthority,
				path: vscodePath,
				query: query.toString(),
				fragment: vscodeFragment,
			},
			// Make sure the map doesn't leak if nothing fetches this URI.
			timeout: setTimeout(() => this.callbackUriToRequestId.delete(requestId), ProtocolConstants.ReconnectionShortGraceTime),
		};

		// Add to map of known callbacks.
		this.callbackUriToRequestId.set(requestId, callback);

		res.writeHead(200, { 'Content-Type': 'text/html' });
		return res.end(this.templates.callback);
	};

	/**
	 * Fetch callback endpoint.
	 * @remark This is the follow up to a client's initial `/callback` lifecycle.
	 */
	private $fetchCallback: WebRequestListener = (req, res) => {
		const requestId = req.parsedUrl.searchParams.get('vscode-requestId');
		if (!requestId) {
			res.writeHead(400, { 'Content-Type': PLAIN_TEXT_MIME_TYPE });
			return res.end(`Bad request.`);
		}

		const knownCallback = this.callbackUriToRequestId.get(requestId);

		if (knownCallback) {
			this.callbackUriToRequestId.delete(requestId);
			clearTimeout(knownCallback.timeout);
		}

		res.writeHead(200, { 'Content-Type': 'text/json' });
		return res.end(JSON.stringify(knownCallback?.uri));
	};

	/**
	 * Remote resource endpoint.
	 * @remark Used to load resources on the client-side. See `FileAccessImpl` for details.
	 */
	private $remoteResource: WebRequestListener = async (req, res) => {
		const path = req.parsedUrl.searchParams.get('path');

		if (path) {
			res.setHeader('Content-Type', getMediaOrTextMime(path) || PLAIN_TEXT_MIME_TYPE);
			res.end(await fs.readFile(path));
		}
	};

	/**
	 * Webview endpoint
	 */
	private $webview: WebRequestListener<string[]> = async (req, res, params) => {
		return this.serveFile(join(this.environmentService.webviewBasePath, params[0]), req, res);
	};

	/**
	 * @TODO Consider replacing with FileService.
	 */
	serveFile = async (filePath: string, req: IncomingMessage, res: ServerResponse, responseHeaders = Object.create(null)): Promise<void> => {
		try {
			// Sanity checks
			filePath = normalize(filePath); // ensure no "." and ".."

			const stat = await fs.stat(filePath);

			// Check if file modified since
			// Weak validator (https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/ETag)
			const etag = `W/"${[stat.ino, stat.size, stat.mtime.getTime()].join('-')}"`;
			if (req.headers['if-none-match'] === etag) {
				res.writeHead(304);
				return res.end();
			}

			// Headers
			responseHeaders['Content-Type'] = getMediaOrTextMime(filePath) || PLAIN_TEXT_MIME_TYPE;
			responseHeaders['Etag'] = etag;

			res.writeHead(200, responseHeaders);

			// Data
			createReadStream(filePath).pipe(res);
		} catch (error: any) {
			this.logService.error(error.toString());
			responseHeaders['Content-Type'] = PLAIN_TEXT_MIME_TYPE;
			res.writeHead(404, responseHeaders);
			return res.end('Not found');
		}
	};

	serveError = async (req: ParsedRequest, res: ServerResponse, code: number, message: string): Promise<void> => {
		this.logService.debug(`[${req.parsedUrl.toString()}] ${code}: ${message}`);

		const { applicationName, commit, version } = this.environmentService;

		res.statusCode = code;
		res.statusMessage = message;

		if (req.parsedUrl.pathname.endsWith('.json')) {
			res.setHeader('Content-Type', 'application/json');

			res.end(JSON.stringify({ code, message }));
			return;
		}

		const template = this.templates.workbenchError;
		const clientTheme = await this.fetchClientTheme();

		res.setHeader('Content-Type', 'text/html');
		res.end(template({
			ERROR_HEADER: `${applicationName}`,
			ERROR_CODE: code.toString(),
			ERROR_MESSAGE: message,
			ERROR_FOOTER: `${version} — ${commit}`,
			CSP_NONCE,
			CLIENT_BACKGROUND_COLOR: clientTheme.backgroundColor,
			CLIENT_FOREGROUND_COLOR: clientTheme.foregroundColor,
		}));
	};


	public override dispose() {
		super.dispose();

		this.callbackUriToRequestId.forEach(({ timeout }) => clearTimeout(timeout));
		this.callbackUriToRequestId.clear();
	}

	private async fetchClientTheme(): Promise<ClientTheme> {
		const theme = await this.themeService.fetchColorThemeData();

		return {
			backgroundColor: theme.getColor(editorBackground, true)!.toString(),
			foregroundColor: theme.getColor(editorForeground, true)!.toString(),
		};
	}

	/**
	 * Publically available routes.
	 * @remark The order of entry defines a route's priority.
	 */
	private readonly routes: Map<MatchFunction, WebRequestListener<any>>;
	private themeService: IServerThemeService;

	constructor(
		netServer: Server,
		themeService: IServerThemeService,
		environmentService: IEnvironmentServerService,
		logService: ILogService,
		private options: RequestHandlerOptions = {},
	) {
		super(netServer, environmentService, logService);
		this.themeService = themeService;
		const { isBuilt } = this.environmentService;

		Handlebars.registerHelper('toJSON', obj => {
			// Pretty print in development.
			return JSON.stringify(obj, null, isBuilt ? undefined : 2);
		});

		const { workbenchTemplatePath, callbackEndpoint, serviceWorkerFileName, staticBase } = environmentService;

		this.templates = {
			workbenchError: compileTemplate<WorkbenchErrorTemplate>(join(workbenchTemplatePath, 'workbench-error.html')),
			workbenchDev: compileTemplate<WorkbenchTemplate>(join(workbenchTemplatePath, 'workbench-dev.html')),
			workbenchProd: compileTemplate<WorkbenchTemplate>(join(workbenchTemplatePath, 'workbench.html')),
			callback: readFileSync(callbackEndpoint).toString(),
		};

		const routePairs: readonly RoutePair[] = [
			['/manifest.webmanifest', this.$webManifest],
			[`/${serviceWorkerFileName}`, this.$serviceWorker],
			// Legacy browsers.
			['/manifest.json', this.$webManifest],
			[`${staticBase}/(.*)`, this.$static],
			['/webview/(.*)', this.$webview],
			['/', this.$root],
			['/.json', this.$webConfig],
			['/callback', this.$callback],
			['/fetch-callback', this.$fetchCallback],
			['/vscode-remote-resource', this.$remoteResource],
		];

		this.logService.debug(this.logName, 'Listening for the following routes:');

		for (const [pattern] of routePairs) {
			this.logService.debug(this.logName, pattern);
		}

		this.routes = new Map(routePairs.map(([pattern, handler]) => [match(pattern, matcherOptions), handler]));

	}
}

type RoutePair = readonly [string, WebRequestListener<any>];
