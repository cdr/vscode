/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Coder Technologies. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export enum AuthType {
	Password = 'password',
	None = 'none',
}

export enum AuthenticationSettings {
	HASHED_PASSWORD = 'server.hashedPassword',
}

export interface HashedPasswordResult {
	password: string;
	hashedPassword: string;
}
