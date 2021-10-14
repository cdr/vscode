/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Coder Technologies. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { randomBytes } from 'crypto';
import { readFileSync } from 'fs';
import { ServerResponse } from 'http';
import * as path from 'path';
import { MatchResult } from 'path-to-regexp';
import { UriComponents } from 'vs/base/common/uri';
import { ParsedRequest } from 'vs/server/services/net/abstractIncomingRequestService';
import * as Handlebars from 'handlebars';
import { IWorkbenchConfigurationSerialized } from 'vs/platform/workspaces/common/workbench';

// TODO: needs to resolve from here and when bundled
export const APP_ROOT = path.join(__dirname, '..', '..', '..');
export const WORKBENCH_PATH = path.join(APP_ROOT, 'out', 'vs', 'code', 'browser', 'workbench');
export const SERVICE_WORKER_FILE_NAME = 'service-worker.js';

export const AssetPaths = {
	StaticBase: '/static',
	ProxyUri: '/proxy/{port}',
	Webview: path.join(APP_ROOT, 'out', 'vs', 'workbench', 'contrib', 'webview', 'browser', 'pre'),
	Favicon: path.join(APP_ROOT, 'resources', 'web', 'favicon.ico'),
	ServiceWorker: path.join(APP_ROOT, 'out', 'vs', 'code', 'browser', 'workbench', SERVICE_WORKER_FILE_NAME),
};

/** Matching the given keys in `PollingURLCallbackProvider.QUERY_KEYS` */
export const wellKnownKeys = [
	'vscode-requestId',
	'vscode-scheme',
	'vscode-authority',
	'vscode-path',
	'vscode-query',
	'vscode-fragment',
] as const;

export type PollingURLQueryKeys = typeof wellKnownKeys[number];

/**
 * See [Web app manifest on MDN](https://developer.mozilla.org/en-US/docs/Web/Manifest) for additional information.
 */
export interface WebManifest {
	name: string;
	short_name: string;
	start_url: string;
	display: string;
	'background-color': string;
	description: string;
	icons: Array<{ src: string; type: string; sizes: string }>;
}

/**
 * A callback response matching the expected value in `PollingURLCallbackProvider`
 */
export interface Callback {
	uri: Partial<UriComponents>;
	/** This should be no longer than `PollingURLCallbackProvider.FETCH_TIMEOUT` */
	timeout: NodeJS.Timeout;
}

/**
 * A function which may respond to a request with an possible set of URL params.
 */
export type WebRequestListener<T extends object | null = null> = T extends object
	? (req: ParsedRequest, res: ServerResponse, params: MatchResult<T>['params']) => void | Promise<void>
	: (req: ParsedRequest, res: ServerResponse) => void | Promise<void>;

export const matcherOptions = { encode: encodeURI, decode: decodeURIComponent };

/**
 * A nonce used to mark specific inline scripts as secure.
 * @example To use, apply the following attribute:
 * ```html
 * <script nonce="{{CSP_NONCE}}">...</script>
 * ```
 */
export const CSP_NONCE = randomBytes(16).toString('base64');

/**
 * Content security policies derived from existing inline Workbench CSPs.
 */
export const contentSecurityPolicies: Record<string, string> = {
	'default-src': `'nonce-${CSP_NONCE}'`,
	'manifest-src': `'self'`,
	'img-src': `'self' https: data: blob: vscode-remote-resource:`,
	'media-src': `'none'`,
	'frame-src': `'self' vscode-webview:`,
	'object-src': `'self'`,
	'script-src': `'self' 'nonce-${CSP_NONCE}' 'unsafe-eval' blob:`,
	'style-src': `'self' 'unsafe-inline'`,
	'connect-src': `'self' https: ws:`,
	'font-src': `'self' https: vscode-remote-resource:`,

	'require-trusted-types-for': `'script'`,
	'trusted-types': [
		'TrustedFunctionWorkaround',
		'ExtensionScripts',
		'amdLoader',
		'cellRendererEditorText',
		'defaultWorkerFactory',
		'diffEditorWidget',
		'editorGhostText',
		'domLineBreaksComputer',
		'editorViewLayer',
		'diffReview',
		'extensionHostWorker',
		'insane',
		'notebookRenderer',
		'safeInnerHtml',
		'standaloneColorizer',
		'tokenizeToString',
		'webNestedWorkerExtensionHost',
		'ServiceWorkerScripts',
	].join(' ')
};

export function compileTemplate<T = any>(templatePath: string) {
	return Handlebars.compile<T>(readFileSync(templatePath).toString());
}

export interface BaseWorkbenchTemplate {
	CLIENT_BACKGROUND_COLOR: string;
	CLIENT_FOREGROUND_COLOR: string;
	CSP_NONCE: string;
}

export interface WorkbenchTemplate extends BaseWorkbenchTemplate {
	WORKBENCH_WEB_CONFIGURATION: IWorkbenchConfigurationSerialized;
	WORKBENCH_BUILTIN_EXTENSIONS: Array<never>;
	CLIENT_BACKGROUND_COLOR: string;
	CLIENT_FOREGROUND_COLOR: string;
}

export interface WorkbenchErrorTemplate extends BaseWorkbenchTemplate {
	ERROR_HEADER: string;
	ERROR_CODE: string;
	ERROR_MESSAGE: string;
	ERROR_FOOTER: string;
}

export interface ClientTheme {
	backgroundColor: string;
	foregroundColor: string;
}

export const ICON_SIZES = [192, 512];

/**
 * Returns the relative path prefix for a given URL path.
 * @remark This is especially useful when creating URLs which have to remain
 * relative to an initial request.
 *
 * @example
 * ```ts
 * const url = new URL('https://www.example.com/foo/bar/baz.js')
 * getPathPrefix(url.pathname) // '/foo/bar/'
 * ```
 */
export function getPathPrefix(pathname: string) {
	return path.join(path.dirname(pathname), '/');
}
