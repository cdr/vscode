/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Coder Technologies. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IConfigurationService } from 'vs/platform/configuration/common/configuration';
import { createDecorator } from 'vs/platform/instantiation/common/instantiation';
import { ILogService } from 'vs/platform/log/common/log';
import { ColorScheme } from 'vs/platform/theme/common/theme';
import { INLSExtensionScannerService } from 'vs/server/services/nlsExtensionScannerService';
import { IExtensionResourceLoaderService } from 'vs/workbench/services/extensionResourceLoader/common/extensionResourceLoader';
import { ExtensionMessageCollector, IExtensionPoint, IExtensionPointUser } from 'vs/workbench/services/extensions/common/extensionsRegistry';
import { ColorThemeData } from 'vs/workbench/services/themes/common/colorThemeData';
import { ThemeConfiguration } from 'vs/workbench/services/themes/common/themeConfiguration';
import { registerColorThemeExtensionPoint, ThemeRegistry } from 'vs/workbench/services/themes/common/themeExtensionPoints';
import { IThemeExtensionPoint } from 'vs/workbench/services/themes/common/workbenchThemeService';

export interface IServerThemeService {
	initialize(): Promise<void>;
	fetchColorThemeData(): Promise<ColorThemeData>;
}

export const IServerThemeService = createDecorator<IServerThemeService>('IServerThemeService');
let colorThemesExtPoint: IExtensionPoint<IThemeExtensionPoint[]>;
let colorThemeRegistry: ThemeRegistry<ColorThemeData>;

/** Wrapped to avoid Jest instance issues. */
try {
	colorThemesExtPoint = registerColorThemeExtensionPoint();
	colorThemeRegistry = new ThemeRegistry(colorThemesExtPoint, ColorThemeData.fromExtensionTheme);
} catch (error) {
	if (error instanceof Error && error.message.includes('Handler already set')) {
		// Disregard
	}
	throw error;
}

const extPointName = colorThemesExtPoint.name;

/**
 * The server theme service allows for limited and readonly access to theme resources.
 * @remark This is not yet as robust as `WorkbenchThemeService`
 */
export class ServerThemeService implements IServerThemeService {
	private logPrefix = '[Theme Service]';
	private themeConfiguration = new ThemeConfiguration(this.configurationService);

	constructor(
		@INLSExtensionScannerService private extensionScannerService: INLSExtensionScannerService,
		@ILogService private logService: ILogService,
		@IConfigurationService private configurationService: IConfigurationService,
		@IExtensionResourceLoaderService private extensionResourceLoaderService: IExtensionResourceLoaderService,
	) { }

	async initialize() {
		const availableExtensions = await this.extensionScannerService.scanExtensions();

		this.logService.debug(this.logPrefix, 'Scanning for theme extension...');

		const users: IExtensionPointUser<IThemeExtensionPoint[]>[] = availableExtensions
			.filter(desc => {
				return desc.contributes && Object.hasOwnProperty.call(desc.contributes, extPointName);
			})
			.map(desc => {
				this.logService.debug(this.logPrefix, desc.name);

				return {
					description: desc,
					value: desc.contributes![extPointName as keyof typeof desc.contributes] as IThemeExtensionPoint[],
					collector: new ExtensionMessageCollector(() => { }, desc, extPointName)
				};
			});

		colorThemesExtPoint.acceptUsers(users);
	}

	/**
	 * Returns the color data from a user's currently active theme.
	 * @remark If the theme is not found, a default will be provided.
	 */
	async fetchColorThemeData(): Promise<ColorThemeData> {
		const currentThemeId = this.themeConfiguration.colorTheme;

		this.logService.debug(`Attempting to find user's active theme:`, currentThemeId);
		let theme = colorThemeRegistry.findThemeBySettingsId(currentThemeId);

		if (!theme) {
			this.logService.debug(`User's active theme not found the registry. Was it mispelled or uninstalled?`);

			theme = ColorThemeData.createUnloadedThemeForThemeType(ColorScheme.LIGHT);
		}

		await theme.ensureLoaded(this.extensionResourceLoaderService);

		return theme;
	}
}
