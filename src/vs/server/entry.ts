/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Coder Technologies. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ArgumentParser } from '../platform/environment/node/argumentParser';
import { ServerProcessMain } from './main';

/**
 * The primary entrypoint for running an editor in the browser.
 * This can be invoked from the CLI in development.
 * @example
 * ```sh
 * # Terminal 1
 * $ yarn watch-client
 * # Terminal 2
 * $ yarn watch-web
 * # Terminal 3
 * $ node out/cli.js --log trace --server http://localhost:8080 --user-data-dir /foo/bar/.local/share/code-server/ ../../some-project-dir
 * ```
 */
export const main = async () => {
	const argumentParser = new ArgumentParser();
	const args = argumentParser.resolveArgs();

	if (!args['server']) {
		throw new Error('Server argument was not given');
	}

	const serverUrl = new URL(args['server']);

	const codeServer = new ServerProcessMain({
		args,
		authed: false,
		disableUpdateCheck: true,
		serverUrl,
	});

	const netServer = await codeServer.startup();

	return new Promise(resolve => {
		netServer.on('close', resolve);
	});
};

/**
 * @deprecated This exists solely to give code-server direct access to `ServerProcessMain`
 * It should eventually be phased out and folded into VS Code's existing CLI flow.
 */
export const createVSServer: CodeServerLib.CreateVSServer = async serverConfig => {
	const codeServer = new ServerProcessMain(serverConfig);

	return codeServer.startup({ listenWhenReady: false });
};
