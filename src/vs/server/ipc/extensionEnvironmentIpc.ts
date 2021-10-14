/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Coder Technologies. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as path from 'path';
import { Event } from 'vs/base/common/event';
import * as platform from 'vs/base/common/platform';
import { URI } from 'vs/base/common/uri';
import { transformOutgoingURIs } from 'vs/base/common/uriIpc';
import { IServerChannel } from 'vs/base/parts/ipc/common/ipc';
import { IDiagnosticInfo } from 'vs/platform/diagnostics/common/diagnostics';
import { INativeEnvironmentService } from 'vs/platform/environment/common/environment';
import { IRemoteAgentEnvironment } from 'vs/platform/remote/common/remoteAgentEnvironment';
import { ITelemetryData, ITelemetryService } from 'vs/platform/telemetry/common/telemetry';
import { INLSExtensionScannerService } from 'vs/server/services/nlsExtensionScannerService';
import { createServerURITransformer } from 'vs/server/uriTransformer';


/**
 * @see `RemoteExtensionEnvironmentChannelClient`
 * @TODO Consider using `ProxyChannel.fromService`
 */
export class ExtensionEnvironmentChannel implements IServerChannel {
	public constructor(
		@INativeEnvironmentService private readonly environment: INativeEnvironmentService,
		@INLSExtensionScannerService private readonly extensionScannerService: INLSExtensionScannerService,
		@ITelemetryService private readonly telemetry: ITelemetryService,
		private readonly connectionToken: string,
	) { }

	public listen(_: unknown, event: string): Event<any> {
		throw new Error(`Invalid listen '${event}'`);
	}

	public async call(context: any, command: string, args: any): Promise<any> {
		switch (command) {
			case 'getEnvironmentData':
				return transformOutgoingURIs(
					await this.getEnvironmentData(),
					createServerURITransformer(context.remoteAuthority),
				);
			case 'scanExtensions':
				return transformOutgoingURIs(
					await this.extensionScannerService.scanExtensions(args.language),
					createServerURITransformer(context.remoteAuthority),
				);
			case 'getDiagnosticInfo': return this.getDiagnosticInfo();
			case 'disableTelemetry': return this.disableTelemetry();
			case 'logTelemetry': return this.logTelemetry(args.eventName, args.data);
			case 'flushTelemetry': return this.flushTelemetry();
		}
		throw new Error(`Invalid call '${command}'`);
	}

	private async getEnvironmentData(): Promise<IRemoteAgentEnvironment> {
		return {
			pid: process.pid,
			connectionToken: this.connectionToken,
			appRoot: URI.file(this.environment.appRoot),
			settingsPath: this.environment.settingsResource,
			logsPath: URI.file(this.environment.logsPath),
			extensionsPath: URI.file(this.environment.extensionsPath!),
			extensionHostLogsPath: URI.file(path.join(this.environment.logsPath, 'extension-host')),
			globalStorageHome: this.environment.globalStorageHome,
			workspaceStorageHome: this.environment.workspaceStorageHome,
			userHome: this.environment.userHome,
			arch: process.arch,
			useHostProxy: false,
			os: platform.OS,
			marks: []
		};
	}

	private getDiagnosticInfo(): Promise<IDiagnosticInfo> {
		throw new Error('Not implemented');
	}

	private async disableTelemetry(): Promise<void> {
		throw new Error('Not implemented');
	}

	private async logTelemetry(eventName: string, data: ITelemetryData): Promise<void> {
		this.telemetry.publicLog(eventName, data);
	}

	private async flushTelemetry(): Promise<void> {
		// We always send immediately at the moment.
	}
}
