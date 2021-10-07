/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Coder Technologies. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as fs from 'fs';
import { gracefulify } from 'graceful-fs';
import { createServer as createNetServer, Server as NetServer } from 'http';
import { hostname, release } from 'os';
import { toErrorMessage } from 'vs/base/common/errorMessage';
import { setUnexpectedErrorHandler } from 'vs/base/common/errors';
import { combinedDisposable, Disposable } from 'vs/base/common/lifecycle';
import { Schemas } from 'vs/base/common/network';
import { getMachineId } from 'vs/base/node/id';
import { IPCServer, IServerChannel, ProxyChannel } from 'vs/base/parts/ipc/common/ipc';
// eslint-disable-next-line code-import-patterns
import { LogsDataCleaner } from 'vs/code/electron-browser/sharedProcess/contrib/logsDataCleaner';
import { IConfigurationService } from 'vs/platform/configuration/common/configuration';
import { ConfigurationService } from 'vs/platform/configuration/common/configurationService';
import { ExtensionHostDebugBroadcastChannel } from 'vs/platform/debug/common/extensionHostDebugIpc';
import { GlobalExtensionEnablementService } from 'vs/platform/extensionManagement/common/extensionEnablementService';
import { ExtensionGalleryService } from 'vs/platform/extensionManagement/common/extensionGalleryService';
import { IExtensionGalleryService, IExtensionManagementService, IGlobalExtensionEnablementService } from 'vs/platform/extensionManagement/common/extensionManagement';
import { ExtensionManagementChannel } from 'vs/platform/extensionManagement/common/extensionManagementIpc';
import { ExtensionManagementService } from 'vs/platform/extensionManagement/node/extensionManagementService';
import { IFileService } from 'vs/platform/files/common/files';
import { FileService } from 'vs/platform/files/common/fileService';
import { DiskFileSystemProvider } from 'vs/platform/files/node/diskFileSystemProvider';
import { SyncDescriptor } from 'vs/platform/instantiation/common/descriptors';
import { IInstantiationService } from 'vs/platform/instantiation/common/instantiation';
import { InstantiationService } from 'vs/platform/instantiation/common/instantiationService';
import { ServiceCollection } from 'vs/platform/instantiation/common/serviceCollection';
import { ILocalizationsService } from 'vs/platform/localizations/common/localizations';
import { LocalizationsService } from 'vs/platform/localizations/node/localizations';
import { BufferLogService } from 'vs/platform/log/common/bufferLog';
import { ConsoleMainLogger, getLogLevel, ILogger, ILoggerService, ILogService, MultiplexLogService } from 'vs/platform/log/common/log';
import { LogLevelChannel } from 'vs/platform/log/common/logIpc';
import { LoggerService } from 'vs/platform/log/node/loggerService';
import { SpdLogLogger } from 'vs/platform/log/node/spdlogLog';
import product from 'vs/platform/product/common/product';
import { IProductService } from 'vs/platform/product/common/productService';
import { RemoteAgentConnectionContext } from 'vs/platform/remote/common/remoteAgentEnvironment';
import { IRequestService } from 'vs/platform/request/common/request';
import { RequestChannel } from 'vs/platform/request/common/requestIpc';
import { RequestService } from 'vs/platform/request/node/requestService';
import { resolveCommonProperties } from 'vs/platform/telemetry/common/commonProperties';
import { ITelemetryService } from 'vs/platform/telemetry/common/telemetry';
import { TelemetryLogAppender } from 'vs/platform/telemetry/common/telemetryLogAppender';
import { ITelemetryServiceConfig, TelemetryService } from 'vs/platform/telemetry/common/telemetryService';
import { combinedAppender, NullTelemetryService } from 'vs/platform/telemetry/common/telemetryUtils';
import { AppInsightsAppender } from 'vs/platform/telemetry/node/appInsightsAppender';
import ErrorTelemetry from 'vs/platform/telemetry/node/errorTelemetry';
import { IPtyService, IReconnectConstants, LocalReconnectConstants, TerminalSettingId } from 'vs/platform/terminal/common/terminal';
import { PtyHostService } from 'vs/platform/terminal/node/ptyHostService';
import { ExtensionsStorageSyncService, IExtensionsStorageSyncService } from 'vs/platform/userDataSync/common/extensionsStorageSync';
import { IgnoredExtensionsManagementService, IIgnoredExtensionsManagementService } from 'vs/platform/userDataSync/common/ignoredExtensions';
import { UserDataAutoSyncEnablementService } from 'vs/platform/userDataSync/common/userDataAutoSyncService';
import { IUserDataAutoSyncEnablementService, IUserDataSyncBackupStoreService, IUserDataSyncLogService, IUserDataSyncResourceEnablementService, IUserDataSyncService, IUserDataSyncStoreManagementService, IUserDataSyncStoreService, IUserDataSyncUtilService } from 'vs/platform/userDataSync/common/userDataSync';
import { IUserDataSyncAccountService, UserDataSyncAccountService } from 'vs/platform/userDataSync/common/userDataSyncAccount';
import { UserDataSyncBackupStoreService } from 'vs/platform/userDataSync/common/userDataSyncBackupStoreService';
import { UserDataSyncUtilServiceClient } from 'vs/platform/userDataSync/common/userDataSyncIpc';
import { UserDataSyncLogService } from 'vs/platform/userDataSync/common/userDataSyncLog';
import { IUserDataSyncMachinesService, UserDataSyncMachinesService } from 'vs/platform/userDataSync/common/userDataSyncMachines';
import { UserDataSyncResourceEnablementService } from 'vs/platform/userDataSync/common/userDataSyncResourceEnablementService';
import { UserDataSyncService } from 'vs/platform/userDataSync/common/userDataSyncService';
import { UserDataSyncStoreManagementService, UserDataSyncStoreService } from 'vs/platform/userDataSync/common/userDataSyncStoreService';
import { TelemetryClient } from 'vs/server/insights';
import { ExtensionEnvironmentChannel } from 'vs/server/ipc/extensionEnvironmentIpc';
import { FileProviderChannel } from 'vs/server/ipc/fileProviderIpc';
import { TerminalProviderChannel } from 'vs/server/ipc/terminalProviderIpc';
import { EnvironmentServerService, IEnvironmentServerService } from 'vs/server/services/environmentService';
import { IIncomingHTTPRequestService, IncomingHTTPRequestService } from 'vs/server/services/net/incomingHttpRequestService';
import { INLSExtensionScannerService, NLSExtensionScannerService } from 'vs/server/services/nlsExtensionScannerService';
import { IServerThemeService, ServerThemeService } from 'vs/server/services/themeService';
import { IWebSocketServerService, WebSocketServerService } from 'vs/server/services/net/webSocketServerService';
import { createServerURITransformer } from 'vs/server/uriTransformer';
import { REMOTE_TERMINAL_CHANNEL_NAME } from 'vs/workbench/contrib/terminal/common/remoteTerminalChannel';
import { IExtensionResourceLoaderService } from 'vs/workbench/services/extensionResourceLoader/common/extensionResourceLoader';
// eslint-disable-next-line code-import-patterns
import { ExtensionResourceLoaderService } from 'vs/workbench/services/extensionResourceLoader/electron-sandbox/extensionResourceLoaderService';
import { ILifecycleService, NullLifecycleService } from 'vs/workbench/services/lifecycle/common/lifecycle';
import { REMOTE_FILE_SYSTEM_CHANNEL_NAME } from 'vs/workbench/services/remote/common/remoteAgentFileSystemChannel';
import { IUriIdentityService } from 'vs/workbench/services/uriIdentity/common/uriIdentity';
import { UriIdentityService } from 'vs/workbench/services/uriIdentity/common/uriIdentityService';
import { monkeyPatchVSZip } from 'vs/base/node/marketplace';

interface IServerProcessMainStartupOptions {
	listenWhenReady?: boolean;
}

interface IServerProcessMain {
	startup(startupOptions: IServerProcessMainStartupOptions): Promise<NetServer>;
}

interface ServicesResult {
	instantiationService: IInstantiationService;
	logService: ILogService;
	initializeSpdLogger: () => ILogger
}

/**
 * Handles client connections to a editor instance via IPC.
 */
export class ServerProcessMain extends Disposable implements IServerProcessMain {
	netServer = createNetServer();

	constructor(private readonly configuration: CodeServerLib.ServerConfiguration) {
		super();

		// Enable gracefulFs
		gracefulify(fs);

		monkeyPatchVSZip(product);
		this.registerListeners();
	}

	private registerListeners(): void {
		process.once('exit', () => this.dispose());
	}

	public async startup(startupOptions: IServerProcessMainStartupOptions = { listenWhenReady: true }): Promise<NetServer> {
		// Services
		const {
			instantiationService,
			initializeSpdLogger,
			logService,
		} = await this.createServices(startupOptions);

		// Log info
		logService.trace('Server configuration', JSON.stringify(this.configuration));

		// Error handler
		this.registerErrorHandler(logService);

		// Instantiate Contributions
		this._register(combinedDisposable(
			instantiationService.createInstance(LogsDataCleaner),
			instantiationService.invokeFunction(accessor => new ErrorTelemetry(accessor.get(ITelemetryService)))
,		));

		initializeSpdLogger();

		// Listen for incoming connections
		if (startupOptions.listenWhenReady) {
			const { serverUrl } = this.configuration;

			await listen(this.netServer, parseInt(serverUrl.port, 10), serverUrl.hostname);
			logService.info('Code Server active and listening at:', serverUrl.toString());
		}

		return this.netServer;
	}

	// References:
	// ../../electron-browser/sharedProcess/sharedProcessMain.ts#L148
	// ../../../code/electron-main/app.ts
	public async createServices(startupOptions: IServerProcessMainStartupOptions): Promise<ServicesResult> {
		const services = new ServiceCollection();

		// Product
		const productService: IProductService = {
			_serviceBrand: undefined,
			...product,
		};

		services.set(IProductService, productService);

		// Environment
		const environmentServerService = new EnvironmentServerService(this.configuration.args, productService, {
			disableUpdateCheck: this.configuration.disableUpdateCheck,
			serverUrl: this.configuration.serverUrl,
		});

		services.set(IEnvironmentServerService, environmentServerService);

		await Promise.all(
			environmentServerService.environmentPaths.map(p =>
				fs.promises.mkdir(p, { recursive: true }).catch(error => {
					console.warn(error.message || error);
				}),
			),
		);

		// Loggers
		// src/vs/code/electron-main/main.ts#142
		const bufferLogService = new BufferLogService();
		const logService = new MultiplexLogService([new ConsoleMainLogger(getLogLevel(environmentServerService)), bufferLogService]);
		process.once('exit', () => logService.dispose());
		services.set(ILogService, logService);

		// Files
		const fileService = new FileService(logService);
		fileService.registerProvider(Schemas.file, new DiskFileSystemProvider(logService));

		const loggerService = new LoggerService(logService, fileService);

		services.set(ILogService, logService);
		services.set(ILoggerService, loggerService);

		// Configuration
		const configurationService = new ConfigurationService(environmentServerService.settingsResource, fileService);
		await configurationService.initialize();
		services.set(IConfigurationService, configurationService);

		// (Outgoing) Request
		services.set(IRequestService, new SyncDescriptor(RequestService));

		// File Service can now be set...
		services.set(IFileService, fileService);
		services.set(IUriIdentityService, new SyncDescriptor(UriIdentityService));

		// Configuration
		await configurationService.initialize();
		services.set(IConfigurationService, configurationService);

		// Lifecycle
		services.set(ILifecycleService, NullLifecycleService);

		// Instantiation
		const instantiationService = new InstantiationService(services);

		// Telemetry
		let telemetryService: ITelemetryService;

		if (!environmentServerService.isExtensionDevelopment && !environmentServerService.disableTelemetry && productService.enableTelemetry) {
			const machineId = await this.resolveMachineId();

			const appender = combinedAppender(new AppInsightsAppender('code-server', null, () => new TelemetryClient()), new TelemetryLogAppender(loggerService, environmentServerService));

			const commonProperties = resolveCommonProperties(fileService, release(), hostname(), process.arch, environmentServerService.commit, product.version, machineId, undefined, environmentServerService.installSourcePath, 'code-server');

			const config: ITelemetryServiceConfig = {
				appender,
				commonProperties,
				piiPaths: environmentServerService.piiPaths,
				sendErrorTelemetry: true,
			};

			telemetryService = new TelemetryService(config, configurationService);
		} else {
			telemetryService = NullTelemetryService;
		}

		services.set(ITelemetryService, telemetryService);

		// Extensions
		services.set(IExtensionManagementService, new SyncDescriptor(ExtensionManagementService));
		services.set(IExtensionGalleryService, new SyncDescriptor(ExtensionGalleryService));

		const extensionResourceLoaderService = new ExtensionResourceLoaderService(fileService);
		services.set(IExtensionResourceLoaderService, extensionResourceLoaderService);

		const extensionScannerService = new NLSExtensionScannerService(environmentServerService, logService, productService);
		services.set(INLSExtensionScannerService, extensionScannerService);

		// Themes
		const serverThemeService = new ServerThemeService(
			extensionScannerService,
			logService,
			configurationService,
			extensionResourceLoaderService,
		);
		await serverThemeService.initialize();
		services.set(IServerThemeService, serverThemeService);

		// Localization
		services.set(ILocalizationsService, new SyncDescriptor(LocalizationsService));

		// Web
		const webSocketServerService = new WebSocketServerService(
			this.netServer,
			productService,
			environmentServerService,
			logService,
		);
		webSocketServerService.listen();
		services.set(IWebSocketServerService, webSocketServerService);

		const incomingHTTPRequestService = new IncomingHTTPRequestService(
			this.netServer,
			serverThemeService,
			environmentServerService,
			logService,
			{ disableFallbackRoute: !startupOptions.listenWhenReady },
		);
		incomingHTTPRequestService.listen();
		services.set(IIncomingHTTPRequestService, incomingHTTPRequestService);

		// IPC Server
		const ipcServer = this._register(new
			IPCServer<RemoteAgentConnectionContext>(webSocketServerService.
				onDidClientConnect
	,		));

		// Settings Sync
		services.set(IUserDataSyncAccountService, new SyncDescriptor(UserDataSyncAccountService));
		services.set(IUserDataSyncLogService, new SyncDescriptor(UserDataSyncLogService));
		services.set(IUserDataSyncUtilService, new UserDataSyncUtilServiceClient(
			ipcServer.getChannel('userDataSyncUtil', client => client.ctx.remoteAuthority !== this.configuration.serverUrl.hostname)));
		services.set(IGlobalExtensionEnablementService, new SyncDescriptor(GlobalExtensionEnablementService));
		services.set(IIgnoredExtensionsManagementService, new SyncDescriptor(IgnoredExtensionsManagementService));
		services.set(IExtensionsStorageSyncService, new SyncDescriptor(ExtensionsStorageSyncService));
		services.set(IUserDataSyncStoreManagementService, new SyncDescriptor(UserDataSyncStoreManagementService));
		services.set(IUserDataSyncStoreService, new SyncDescriptor(UserDataSyncStoreService));
		services.set(IUserDataSyncMachinesService, new SyncDescriptor(UserDataSyncMachinesService));
		services.set(IUserDataSyncBackupStoreService, new SyncDescriptor(UserDataSyncBackupStoreService));
		services.set(IUserDataAutoSyncEnablementService, new SyncDescriptor(UserDataAutoSyncEnablementService));
		services.set(IUserDataSyncResourceEnablementService, new SyncDescriptor(UserDataSyncResourceEnablementService));
		services.set(IUserDataSyncService, new SyncDescriptor(UserDataSyncService));

		// Terminal
		const reconnectConstants: IReconnectConstants = {
			graceTime: LocalReconnectConstants.GraceTime,
			shortGraceTime: LocalReconnectConstants.ShortGraceTime,
			scrollback: configurationService.getValue<number>(TerminalSettingId.PersistentSessionScrollback) ?? 100,
			useExperimentalSerialization: configurationService.getValue<boolean>(TerminalSettingId.PersistentSessionExperimentalSerializer) ?? true,
		};

		const ptyHostService = new PtyHostService(reconnectConstants, configurationService, logService, telemetryService);
		services.set(IPtyService, this._register(ptyHostService));

		// Channels
		await this.initChannels(instantiationService, ipcServer);

		return {
			instantiationService,
			// Delay creation of spdlog for perf reasons (https://github.com/microsoft/vscode/issues/72906)
			initializeSpdLogger: () => {
				logService.debug('Initializing Spd logger...');
				bufferLogService.logger = new SpdLogLogger(
					'main',
					environmentServerService.remoteExtensionLogsPath,
					true,
					bufferLogService.getLevel()
				);

				return bufferLogService.logger;
			},
			logService,
		};
	}

	private initChannels(instantiationService: IInstantiationService, ipcServer: IPCServer<RemoteAgentConnectionContext>): Promise<void> {
		return new Promise(resolve => {
			instantiationService.invokeFunction(async accessor => {
				const uriIdentityService = accessor.get(IUriIdentityService);
				const ptyHostService = accessor.get(IPtyService);
				const logService = accessor.get(ILogService);
				const telemetryService = accessor.get(ITelemetryService);
				const extensionManagementService = accessor.get(IExtensionManagementService);
				const environmentServerService = accessor.get(IEnvironmentServerService);
				const nlsExtensionScannerService = accessor.get(INLSExtensionScannerService);
				const localizationsService = accessor.get(ILocalizationsService);
				const requestService = accessor.get(IRequestService);

				ipcServer.registerChannel('logger', new LogLevelChannel(logService));
				ipcServer.registerChannel(ExtensionHostDebugBroadcastChannel.ChannelName, new ExtensionHostDebugBroadcastChannel());

				ipcServer.registerChannel('extensions', new ExtensionManagementChannel(extensionManagementService, context => createServerURITransformer(context.remoteAuthority)));

				ipcServer.registerChannel('remoteextensionsenvironment', new ExtensionEnvironmentChannel(environmentServerService, nlsExtensionScannerService, telemetryService, ''));
				ipcServer.registerChannel('request', new RequestChannel(requestService));
				ipcServer.registerChannel('localizations', <IServerChannel<any>>ProxyChannel.fromService(localizationsService));
				ipcServer.registerChannel(REMOTE_FILE_SYSTEM_CHANNEL_NAME, new FileProviderChannel(environmentServerService, logService));
				ipcServer.registerChannel(REMOTE_TERMINAL_CHANNEL_NAME, new TerminalProviderChannel(
					uriIdentityService,
					ptyHostService,
					logService,
				));

				resolve();
			});
		});
	}

	private registerErrorHandler(logService: ILogService): void {
		// Install handler for unexpected errors
		setUnexpectedErrorHandler(error => {
			const message = toErrorMessage(error, true);
			if (!message) {
				return;
			}

			logService.error(`[uncaught exception in sharedProcess]: ${message}`);
		});
	}

	// TODO cache machine ID with StateService for faster startup.
	private async resolveMachineId(): Promise<string> {
		return getMachineId();
	}

	public override dispose() {
		this.netServer.close();
		super.dispose();
	}
}

export const listen = (server: NetServer, port: number, host: string) => {
	return new Promise<void>(async (resolve, reject) => {
		server.on('error', reject);

		const onListen = () => {
			// Promise resolved earlier so this is an unrelated error.
			server.off('error', reject);

			resolve();
		};
		// [] is the correct format when using :: but Node errors with them.
		server.listen(port, host.replace(/^\[|\]$/g, ''), onListen);
	});
};
