/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Coder Inc. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Promises } from 'vs/base/common/async';
import { join } from 'vs/base/common/path';
import { IStorage, Storage } from 'vs/base/parts/storage/common/storage';
import { ISQLiteStorageDatabaseLoggingOptions, SQLiteStorageDatabase } from 'vs/base/parts/storage/node/storage';
import { IEnvironmentService } from 'vs/platform/environment/common/environment';
import { ILogService, LogLevel } from 'vs/platform/log/common/log';
import { AbstractStorageService, StorageScope, WillSaveStateReason } from 'vs/platform/storage/common/storage';
import { IWorkspaceInitializationPayload } from 'vs/platform/workspaces/common/workspaces';

/**
 * A simplified server-side storage service.
 * @see `NativeStorageService`
 * @see `GlobalStorageMain`
 */
export class SimpleStorageService extends AbstractStorageService {
	private static readonly STORAGE_NAME = 'state.vscdb';
	private globalStorage: IStorage;

	constructor(
		@ILogService private readonly logService: ILogService,
		@IEnvironmentService private readonly environmentService: IEnvironmentService,
	) {
		super();

		let storagePath = join(this.environmentService.globalStorageHome.fsPath, SimpleStorageService.STORAGE_NAME);

		this.globalStorage = new Storage(new SQLiteStorageDatabase(storagePath, {
			logging: this.createLoggingOptions()
		}));

		this._register(this.globalStorage.onDidChangeStorage(key => this.emitDidChangeValue(StorageScope.GLOBAL, key)));
	}

	protected createLoggingOptions(): ISQLiteStorageDatabaseLoggingOptions {
		return {
			logTrace: (this.logService.getLevel() === LogLevel.Trace) ? msg => this.logService.trace(msg) : undefined,
			logError: error => this.logService.error(error)
		};
	}

	protected async doInitialize(): Promise<void> {
		this.globalStorage.init();
	}

	protected getStorage(_scope: StorageScope): IStorage | undefined {
		return this.globalStorage;
	}

	protected getLogDetails(_scope: StorageScope): string | undefined {
		return this.environmentService.globalStorageHome.fsPath;
	}

	async close(): Promise<void> {

		// Stop periodic scheduler and idle runner as we now collect state normally
		this.stopFlushWhenIdle();

		// Signal as event so that clients can still store data
		this.emitWillSaveState(WillSaveStateReason.SHUTDOWN);

		// Do it
		await Promises.settled([
			this.globalStorage.close(),
		]);
	}

	async migrate(_toWorkspace: IWorkspaceInitializationPayload): Promise<void> {
		// not supported
	}
}
