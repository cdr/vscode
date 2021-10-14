/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { FileAccess } from 'vs/base/common/network';
import { globals } from 'vs/base/common/platform';
import { env } from 'vs/base/common/process';
import { IProductConfiguration } from 'vs/base/common/product';
import { dirname, joinPath } from 'vs/base/common/resources';
import { ISandboxConfiguration } from 'vs/base/parts/sandbox/common/sandboxTypes';

let product: IProductConfiguration;

// Native sandbox environment
if (typeof globals.vscode !== 'undefined' && typeof globals.vscode.context !== 'undefined') {
	const configuration: ISandboxConfiguration | undefined = globals.vscode.context.configuration();
	if (configuration) {
		product = configuration.product;
	} else {
		throw new Error('Sandbox: unable to resolve product configuration from preload script.');
	}
}

// Native node.js environment
else if (typeof require?.__$__nodeRequire === 'function') {

	// Obtain values from product.json and package.json
	const rootPath = dirname(FileAccess.asFileUri('', require));

	product = require.__$__nodeRequire(joinPath(rootPath, 'product.json').fsPath);
	const pkg = require.__$__nodeRequire(joinPath(rootPath, 'package.json').fsPath) as { version: string; };

	// Running out of sources
	if (env['VSCODE_DEV']) {
		Object.assign(product, {
			nameShort: `${product.nameShort} Dev`,
			nameLong: `${product.nameLong} Dev`,
			dataFolderName: `${product.dataFolderName}-dev`
		});
	}

	Object.assign(product, {
		version: pkg.version
	});
}

// Web environment or unknown
else {

	// Built time configuration (do NOT modify)
	product = { /*BUILD->INSERT_PRODUCT_CONFIGURATION*/ } as IProductConfiguration;

	// Running out of sources
	if (Object.keys(product).length === 0) {
		Object.assign(product, {
			version: '1.61.0-dev',
			nameShort: 'Code Server - Dev',
			nameLong: 'Code Server - Dev',
			applicationName: 'code-server',
			dataFolderName: '.code-server',
			urlProtocol: 'code-oss',
			reportIssueUrl: 'https://github.com/cdr/code-server/issues/new',
			licenseName: 'MIT',
			licenseUrl: 'https://github.com/cdr/code-server/blob/main/LICENSE.txt',
			extensionAllowedProposedApi: [
				'ms-vscode.vscode-js-profile-flame',
				'ms-vscode.vscode-js-profile-table',
				'ms-vscode.remotehub',
				'ms-vscode.remotehub-insiders',
				'GitHub.remotehub',
				'GitHub.remotehub-insiders',
				'coder.vscode-link'
			],
		});
	}
}

/**
 * Override original functionality so we can use a custom marketplace with
 * either tars or zips.
 * @deprecated This should be phased out as we move toward Open VSX.
 */
function parseExtensionsGallery(product: IProductConfiguration) {
	if (typeof env['EXTENSIONS_GALLERY'] === 'undefined') {
		return;
	}

	let extensionsGallery: NonNullable<IProductConfiguration['extensionsGallery']>;

	try {
		extensionsGallery = {
			serviceUrl: '',
			itemUrl: '',
			resourceUrlTemplate: '',
			controlUrl: '',
			recommendationsUrl: '',
			...JSON.parse(env['EXTENSIONS_GALLERY'])
		};
	} catch (error) {
		console.error(error);
		return;
	}

	console.log(`Custom marketplace enabled.`);
	console.log(JSON.stringify(extensionsGallery, null, 2));

	// Workaround for readonly property.
	Object.assign(product, { extensionsGallery });
}

parseExtensionsGallery(product);

export default product;
