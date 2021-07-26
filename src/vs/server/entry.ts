/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Coder Technologies. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { setUnexpectedErrorHandler } from 'vs/base/common/errors';
import * as proxyAgent from 'vs/base/node/proxy_agent';
import { enableCustomMarketplace } from 'vs/server/marketplace';
import { CodeServerMain, VscodeServerArgs as ServerArgs } from 'vs/server/server';
import { createServer, IncomingHttpHeaders, IncomingMessage } from 'http';
import * as net from 'net';

// eslint-disable-next-line code-import-patterns
import { requestHandler as defaultRequestHandler } from '../../../resources/web/code-web';
import { createHash } from 'crypto';
import { ConnectionOptions, parseQueryConnectionOptions } from 'vs/server/connection/abstractConnection';

const logger = console;

setUnexpectedErrorHandler((error) => {
	logger.warn('Uncaught error', error instanceof Error ? error.message : error);
});

enableCustomMarketplace();
proxyAgent.monkeyPatch(true);

type UpgradeHandler = (request: IncomingMessage, socket: net.Socket, upgradeHead: Buffer) => void;

export async function main(args: ServerArgs) {
	const serverUrl = new URL(`http://${args.server}`);

	const codeServer = new CodeServerMain();
	const workbenchConstructionOptions = await codeServer.createWorkbenchConstructionOptions(serverUrl);

	const httpServer = createServer((req, res) => defaultRequestHandler(req, res, workbenchConstructionOptions));

	const upgrade: UpgradeHandler = (req, socket) => {
		if (req.headers['upgrade'] !== 'websocket' || !req.url) {
			logger.error(`failed to upgrade for header "${req.headers['upgrade']}" and url: "${req.url}".`);
			socket.end('HTTP/1.1 400 Bad Request');
			return;
		}

		const upgradeUrl = new URL(req.url, serverUrl.toString());
		logger.log('Upgrade from', upgradeUrl.toString());

		let connectionOptions: ConnectionOptions;

		try {
			connectionOptions = parseQueryConnectionOptions(upgradeUrl.searchParams);
		} catch (error: unknown) {
			logger.error(error);
			socket.end('HTTP/1.1 400 Bad Request');
			return;
		}

		socket.on('error', e => {
			logger.error(`[${connectionOptions.reconnectionToken}] Socket failed for "${req.url}".`, e);
		});


		const { responseHeaders, permessageDeflate } = createReponseHeaders(req.headers);
		socket.write(responseHeaders);

		codeServer.handleWebSocket(socket, connectionOptions, permessageDeflate);
	};

	httpServer.on('upgrade', upgrade);

	return new Promise((resolve, reject) => {
		httpServer.listen(parseInt(serverUrl.port, 10), serverUrl.hostname, () => {
			logger.info('Code Server active listening at:', serverUrl.toString());
		});
	});
}

function createReponseHeaders(incomingHeaders: IncomingHttpHeaders) {
	const acceptKey = incomingHeaders['sec-websocket-key'];
	// WebSocket standard hash suffix.
	const hash = createHash('sha1').update(acceptKey + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');

	const responseHeaders = ['HTTP/1.1 101 Web Socket Protocol Handshake', 'Upgrade: WebSocket', 'Connection: Upgrade', `Sec-WebSocket-Accept: ${hash}`];

	let permessageDeflate = false;

	if (String(incomingHeaders['sec-websocket-extensions']).indexOf('permessage-deflate') !== -1) {
		permessageDeflate = true;
		responseHeaders.push('Sec-WebSocket-Extensions: permessage-deflate; server_max_window_bits=15');
	}

	return {
		responseHeaders: responseHeaders.join('\r\n') + '\r\n\r\n',
		permessageDeflate
	};
}

