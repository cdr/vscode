/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Coder Technologies. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as os from 'os';
import { Event } from 'vs/base/common/event';
import { IDisposable } from 'vs/base/common/lifecycle';
import * as platform from 'vs/base/common/platform';
import * as resources from 'vs/base/common/resources';
import { IServerChannel } from 'vs/base/parts/ipc/common/ipc';
import { ILogService } from 'vs/platform/log/common/log';
import product from 'vs/platform/product/common/product';
import { RemoteAgentConnectionContext } from 'vs/platform/remote/common/remoteAgentEnvironment';
import { IShellLaunchConfig, ITerminalEnvironment } from 'vs/platform/terminal/common/terminal';
import { IEnvironmentVariableCollection } from 'vs/workbench/contrib/terminal/common/environmentVariable';
import { MergedEnvironmentVariableCollection } from 'vs/workbench/contrib/terminal/common/environmentVariableCollection';
import { deserializeEnvironmentVariableCollection } from 'vs/workbench/contrib/terminal/common/environmentVariableShared';
import * as terminal from 'vs/workbench/contrib/terminal/common/remoteTerminalChannel';
import * as terminalEnvironment from 'vs/workbench/contrib/terminal/common/terminalEnvironment';
import { PtyHostService } from 'vs/platform/terminal/node/ptyHostService';
import { transformIncoming } from 'vs/server/uriTransformer';
import { VariableResolverService } from 'vs/server/services/variableResolverService';

export class TerminalProviderChannel implements IServerChannel<RemoteAgentConnectionContext>, IDisposable {
	public constructor(
		private readonly logService: ILogService,
		private readonly ptyService: PtyHostService,
	) { }

	public listen(_: RemoteAgentConnectionContext, event: string, args: any): Event<any> {
		this.logService.trace('TerminalProviderChannel:listen', event, args);

		switch (event) {
			case '$onPtyHostExitEvent': return this.ptyService.onPtyHostExit || Event.None;
			case '$onPtyHostStartEvent': return this.ptyService.onPtyHostStart || Event.None;
			case '$onPtyHostUnresponsiveEvent': return this.ptyService.onPtyHostUnresponsive || Event.None;
			case '$onPtyHostResponsiveEvent': return this.ptyService.onPtyHostResponsive || Event.None;
			case '$onPtyHostRequestResolveVariablesEvent': return this.ptyService.onPtyHostRequestResolveVariables || Event.None;
			case '$onProcessDataEvent': return this.ptyService.onProcessData;
			case '$onProcessExitEvent': return this.ptyService.onProcessExit;
			case '$onProcessReadyEvent': return this.ptyService.onProcessReady;
			case '$onProcessReplayEvent': return this.ptyService.onProcessReplay;
			case '$onProcessTitleChangedEvent': return this.ptyService.onProcessTitleChanged;
			case '$onProcessShellTypeChangedEvent': return this.ptyService.onProcessShellTypeChanged;
			case '$onProcessOverrideDimensionsEvent': return this.ptyService.onProcessOverrideDimensions;
			case '$onProcessResolvedShellLaunchConfigEvent': return this.ptyService.onProcessResolvedShellLaunchConfig;
			case '$onProcessOrphanQuestion': return this.ptyService.onProcessOrphanQuestion;
			case '$onDidRequestDetach': return this.ptyService.onDidRequestDetach;
			case '$onProcessDidChangeHasChildProcesses': return this.ptyService.onProcessDidChangeHasChildProcesses;
			// NOTE@asher: I think this must have something to do with running
			// commands on the terminal that will do things in VS Code but we
			// already have that functionality via a socket so I'm not sure what
			// this is for.
			// NOTE: VSCODE_IPC_HOOK_CLI is now missing, perhaps this is meant to
			// replace that in some way.
			case '$onExecuteCommand': return Event.None;
		}

		throw new Error(`Invalid listen '${event}'`);
	}

	public call(context: RemoteAgentConnectionContext, command: string, args: any): Promise<any> {
		this.logService.trace('TerminalProviderChannel:call', command, args);

		switch (command) {
			case '$restartPtyHost': return this.ptyService.restartPtyHost();
			case '$createProcess': return this.createProcess(context.remoteAuthority, args);
			case '$attachToProcess': return this.ptyService.attachToProcess(args[0]);
			case '$start': return this.ptyService.start(args[0]);
			case '$input': return this.ptyService.input(args[0], args[1]);
			case '$acknowledgeDataEvent': return this.ptyService.acknowledgeDataEvent(args[0], args[1]);
			case '$shutdown': return this.ptyService.shutdown(args[0], args[1]);
			case '$resize': return this.ptyService.resize(args[0], args[1], args[2]);
			case '$getInitialCwd': return this.ptyService.getInitialCwd(args[0]);
			case '$getCwd': return this.ptyService.getCwd(args[0]);
			case '$sendCommandResult': return this.sendCommandResult(args[0], args[1], args[2], args[3]);
			case '$orphanQuestionReply': return this.ptyService.orphanQuestionReply(args[0]);
			case '$listProcesses': return this.ptyService.listProcesses();
			case '$setTerminalLayoutInfo': return this.ptyService.setTerminalLayoutInfo(args);
			case '$getTerminalLayoutInfo': return this.ptyService.getTerminalLayoutInfo(args);
			case '$getEnvironment': return this.ptyService.getEnvironment();
			case '$getDefaultSystemShell': return this.ptyService.getDefaultSystemShell(args[0]);
			case '$reduceConnectionGraceTime': return this.ptyService.reduceConnectionGraceTime();
			case '$updateTitle': return this.ptyService.updateTitle(args[0], args[1], args[2]);
			case '$getProfiles': return this.ptyService.getProfiles(args[0], args[1], args[2]);
			case '$acceptPtyHostResolvedVariables': return this.ptyService.acceptPtyHostResolvedVariables(args[0], args[1]);
			case '$updateIcon': return this.ptyService.updateIcon(args[0], args[1], args[2]);
		}

		throw new Error(`Invalid call '${command}'`);
	}

	public async dispose(): Promise<void> {
		// Nothing at the moment.
	}

	// References: - ../../workbench/api/node/extHostTerminalService.ts
	//             - ../../workbench/contrib/terminal/browser/terminalProcessManager.ts
	private async createProcess(remoteAuthority: string, args: terminal.ICreateTerminalProcessArguments): Promise<terminal.ICreateTerminalProcessResult> {
		const shellLaunchConfig: IShellLaunchConfig = {
			name: args.shellLaunchConfig.name,
			executable: args.shellLaunchConfig.executable,
			args: args.shellLaunchConfig.args,
			// TODO: Should we transform if it's a string as well? The incoming
			// transform only takes `UriComponents` so I suspect it's not necessary.
			cwd: typeof args.shellLaunchConfig.cwd !== 'string'
				? transformIncoming(remoteAuthority, args.shellLaunchConfig.cwd)
				: args.shellLaunchConfig.cwd,
			env: args.shellLaunchConfig.env,
		};

		const activeWorkspaceUri = transformIncoming(remoteAuthority, args.activeWorkspaceFolder?.uri);
		const activeWorkspace = activeWorkspaceUri && args.activeWorkspaceFolder ? {
			...args.activeWorkspaceFolder,
			uri: activeWorkspaceUri,
			toResource: (relativePath: string) => resources.joinPath(activeWorkspaceUri, relativePath),
		} : undefined;

		const resolverService = new VariableResolverService(remoteAuthority, args, process.env);
		const resolver = terminalEnvironment.createVariableResolver(activeWorkspace, process.env, resolverService);

		shellLaunchConfig.cwd = terminalEnvironment.getCwd(
			shellLaunchConfig,
			os.homedir(),
			resolver,
			activeWorkspaceUri,
			args.configuration['terminal.integrated.cwd'],
			this.logService,
		);

		// Use instead of `terminal.integrated.env.${platform}` to make types work.
		const getEnvFromConfig = (): ITerminalEnvironment => {
			if (platform.isWindows) {
				return args.configuration['terminal.integrated.env.windows'];
			} else if (platform.isMacintosh) {
				return args.configuration['terminal.integrated.env.osx'];
			}
			return args.configuration['terminal.integrated.env.linux'];
		};

		// ptyHostService calls getEnvironment in the ptyHost process it creates,
		// which uses that process's environment, and adds some variables.
		const getEnvironment = async (): Promise<platform.IProcessEnvironment> => {
			const env = await this.ptyService.getEnvironment();
			env.VSCODE_IPC_HOOK_CLI = process.env.VSCODE_IPC_HOOK_CLI;
			env.VSCODE_PROXY_URI = args.resolverEnv?.VSCODE_PROXY_URI || process.env.VSCODE_PROXY_URI;
			return env;
		};

		const env = terminalEnvironment.createTerminalEnvironment(
			shellLaunchConfig,
			getEnvFromConfig(),
			resolver,
			product.version,
			args.configuration['terminal.integrated.detectLocale'],
			await getEnvironment()
		);

		// Apply extension environment variable collections to the environment.
		if (!shellLaunchConfig.strictEnv) {
			// They come in an array and in serialized format.
			const envVariableCollections = new Map<string, IEnvironmentVariableCollection>();
			for (const [k, v] of args.envVariableCollections) {
				envVariableCollections.set(k, { map: deserializeEnvironmentVariableCollection(v) });
			}
			const mergedCollection = new MergedEnvironmentVariableCollection(envVariableCollections);
			mergedCollection.applyToProcessEnvironment(env);
		}

		const persistentTerminalId = await this.ptyService.createProcess(
			shellLaunchConfig,
			shellLaunchConfig.cwd,
			args.cols,
			args.rows,
			'11',
			env,
			process.env as platform.IProcessEnvironment, // Environment used for findExecutable
			false, // windowsEnableConpty
			args.shouldPersistTerminal,
			args.workspaceId,
			args.workspaceName,
		);

		return {
			persistentTerminalId,
			resolvedShellLaunchConfig: shellLaunchConfig,
		};
	}

	private async sendCommandResult(_id: number, _reqId: number, _isError: boolean, _payload: any): Promise<void> {
		// NOTE: Not required unless we implement the matching event, see above.
		throw new Error('not implemented');
	}
}
