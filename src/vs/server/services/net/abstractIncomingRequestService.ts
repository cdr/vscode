/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Coder Technologies. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as http from 'http';
import * as net from 'net';
import { Disposable } from 'vs/base/common/lifecycle';
import { createDecorator } from 'vs/platform/instantiation/common/instantiation';
import { ILogService } from 'vs/platform/log/common/log';
import { IEnvironmentServerService } from 'vs/server/services/environmentService';
import { getPathPrefix } from 'vs/server/services/net/common/http';

export interface ParsedRequest extends http.IncomingMessage {
	parsedUrl: URL;
	pathPrefix: string;
}

export interface IAbstractIncomingRequestService {
	listen(): void;
}

export const IAbstractIncomingRequestService = createDecorator<IAbstractIncomingRequestService>('abstractNetRequestHandler');

export type NetEventListener = (req: ParsedRequest, ...args: any[]) => void;
export abstract class AbstractIncomingRequestService<E extends NetEventListener> extends Disposable implements IAbstractIncomingRequestService {
	protected abstract eventName: string;
	protected abstract eventListener: E;

	constructor(
		protected readonly netServer: net.Server,
		@IEnvironmentServerService protected readonly environmentService: IEnvironmentServerService,
		@ILogService protected readonly logService: ILogService,
	) {
		super();
	}

	private _handleEvent = (req: http.IncomingMessage, ...args: any[]) => {
		const parsedUrl = new URL(req.url || '/', `${this.environmentService.serverUrl.protocol}//${req.headers.host}`);

		Object.assign(req, {
			parsedUrl,
			pathPrefix: getPathPrefix(parsedUrl.pathname),
		});

		this.eventListener(req as ParsedRequest, ...args);
	};

	/**
	 * Begins listening for `eventName` defined in super class.
	 */
	public listen() {
		this.netServer.on(this.eventName, this._handleEvent);
	}

	override dispose(): void {
		super.dispose();

		if (this.netServer) {
			this.netServer.off(this.eventName, this._handleEvent);
		}
	}
}
