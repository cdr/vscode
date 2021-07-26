/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Coder Technologies. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * External interfaces for integration into code-server over IPC.
 */
export interface CodeServerConfiguration {
	authed: boolean
	base: string
	csStaticBase: string
	disableUpdateCheck: boolean
	logLevel: number
}
