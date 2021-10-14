/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Coder Technologies. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as http from 'http';
import * as argon2 from 'argon2';
import { ILogService } from 'vs/platform/log/common/log';
import safeCompare = require('safe-compare');
import { isFalsyOrWhitespace } from 'vs/base/common/strings';
import { createDecorator } from 'vs/platform/instantiation/common/instantiation';
import { randomBytes } from 'crypto';
import { IConfigurationService } from 'vs/platform/configuration/common/configuration';
import { AuthenticationSettings, AuthType, HashedPasswordResult } from 'vs/platform/authentication/common/authentication';

export interface ILocalAuthenticationService {
	createRandomPassword: () => string;
	hashPassword: (password: string) => Promise<HashedPasswordResult>;
	hashedPassword: string | undefined;
	verifyAuthentication: (req: http.IncomingMessage, authType: AuthType) => Promise<boolean>;
	saveHashedPassword: (hashedPassword: string) => Promise<void>;
}

export const ILocalAuthenticationService = createDecorator<ILocalAuthenticationService>('localAuthenticationService');

export class LocalAuthenticationService implements ILocalAuthenticationService {
	private logPrefix = '[Authentication]';

	constructor(
		@IConfigurationService private configurationService: IConfigurationService,
		@ILogService private logService: ILogService
	) { }

	get authHeaders(): Record<string, string> {
		const { hashedPassword } = this;

		return hashedPassword ? {
			'X-Account-Type': 'local',
			'authorization': `Bearer ${hashedPassword}`,
		} : {};
	}

	public createRandomPassword() {
		return randomBytes(16).toString('base64');
	}

	public validatePassword(password: string): string {
		password = password!.trim();

		if (isFalsyOrWhitespace(password)) {
			throw new Error('Password cannot be blank');
		}

		return password;
	}

	/**
	 * Used to hash the plaintext password.
	 */
	public hashPassword = async (password: string): Promise<HashedPasswordResult> => {
		const validatedPassword = this.validatePassword(password);

		return {
			password: validatedPassword,
			hashedPassword: await argon2.hash(validatedPassword),
		};
	};

	public get hashedPassword() {
		return this.configurationService.getValue<string | undefined>(AuthenticationSettings.HASHED_PASSWORD);
	}

	public saveHashedPassword = async (hashedPassword: string): Promise<void> => {
		return this.configurationService.updateValue(AuthenticationSettings.HASHED_PASSWORD, hashedPassword);
	};

	/**
	 * Used to verify if the password matches the hash
	 */
	public isHashMatch = async (password: string, hash: string) => {
		if (password === '' || hash === '' || !hash.startsWith('$')) {
			return false;
		}
		try {
			return await argon2.verify(hash, password);
		} catch (error: any) {
			throw new Error(error);
		}
	};

	public verifyAuthentication = async (req: http.IncomingMessage, authType: AuthType): Promise<boolean> => {
		this.logService.debug(this.logPrefix, authType);

		if (authType === AuthType.None) {
			return true;
		}
		if (authType !== AuthType.Password) {
			throw new Error(`Unsupported auth type ${authType}`);
		}

		const authHeader = req.headers.authorization;
		const { hashedPassword } = this;

		if (isFalsyOrWhitespace(authHeader)) {
			throw new Error(`Invalid authorization header ${authHeader}`);
		}

		if (isFalsyOrWhitespace(hashedPassword)) {
			throw new Error(`Stored and hashed password is unexpectedly empty`);
		}

		const [, token] = authHeader!.split(' ');


		this.validatePassword(token);

		return safeCompare(token, hashedPassword!);
	};
}




