/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Coder Technologies. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// @ts-check

'use strict';

const gulp = require('gulp');
const log = require('fancy-log');
const path = require('path');
const es = require('event-stream');
const util = require('./lib/util');
const task = require('./lib/task');
const { getProductionDependencies } = require('./lib/dependencies');
const common = require('./lib/optimize');
const createAsar = require('./lib/asar').createAsar;
const product = require('../product.json');
const rename = require('gulp-rename');
const filter = require('gulp-filter');
const json = require('gulp-json-editor');

const _ = require('underscore');
const vfs = require('vinyl-fs');
const packageJson = require('../package.json');
const { compileBuildTask } = require('./gulpfile.compile');

const REPO_ROOT = path.dirname(__dirname);
const commit = util.getVersion(REPO_ROOT);
const BUILD_ROOT = path.dirname(REPO_ROOT);

const vscodeServerResources = [
	// Bootstrap
	'out-build/main.js',
	'out-build/cli.js',
	'out-build/driver.js',

	'out-build/bootstrap.js',
	'out-build/bootstrap-fork.js',
	'out-build/bootstrap-amd.js',
	'out-build/bootstrap-node.js',
	'out-build/bootstrap-window.js',

	// Base
	'out-build/vs/base/common/performance.js',
	'out-build/vs/base/node/languagePacks.js',
	'out-build/vs/base/node/{stdForkStart.js,terminateProcess.sh,cpuUsage.sh,ps.sh}',
	'out-build/vs/base/browser/ui/codicons/codicon/**',
	'out-build/vs/base/parts/sandbox/electron-browser/preload.js',
	'out-build/vs/platform/environment/node/userDataPath.js',

	// Workbench
	'out-build/vs/code/browser/workbench/service-worker.js',
	'out-build/vs/workbench/browser/media/*-theme.css',
	'out-build/vs/workbench/contrib/debug/**/*.json',
	'out-build/vs/workbench/contrib/externalTerminal/**/*.scpt',
	'out-build/vs/webPackagePaths.js',

	// Webview
	'out-build/vs/workbench/contrib/webview/browser/pre/*.js',

	// Extension Worker
	'out-build/vs/workbench/services/extensions/worker/extensionHostWorkerMain.js',

	// Assets
	'out-build/vs/**/*.{svg,png,html,jpg}',
	'out-build/vs/**/markdown.css',
	'out-build/vs/base/browser/ui/octiconLabel/octicons/**',
	'out-build/vs/workbench/contrib/tasks/**/*.json',

	// Excludes
	'!out-build/vs/**/{electron-browser}/**',
	'!out-build/vs/editor/standalone/**/*.svg',
	'!out-build/vs/workbench/**/*-tb.png',
	'!**/test/**',
];

const buildfile = require('../src/buildfile');

const vscodeServerEntryPoints = _.flatten([
	buildfile.entrypoint('vs/workbench/workbench.web.api'),
	buildfile.entrypoint('vs/server/entry'),

	buildfile.base,
	buildfile.code,
	buildfile.keyboardMaps,
	buildfile.workbenchDesktop,
	buildfile.workbenchWeb,
	buildfile.workerExtensionHost,
	buildfile.workerLanguageDetection,
	buildfile.workerLocalFileSearch,
	buildfile.workerNotebook,
]);

const optimizeVSCodeServerTask = task.define('optimize-vscode-server', task.series(
	util.rimraf('out-vscode-server'),
	common.optimizeTask({
		src: 'out-build',
		entryPoints: _.flatten(vscodeServerEntryPoints),
		otherSources: [],
		resources: vscodeServerResources,
		loaderConfig: common.loaderConfig(),
		out: 'out-vscode-server',
		bundleInfo: undefined
	})
));
gulp.task(optimizeVSCodeServerTask);

const sourceMappingURLBase = `https://ticino.blob.core.windows.net/sourcemaps/${commit}`;

const minifyVSCodeServerTask = task.define('minify-vscode-server', task.series(
	optimizeVSCodeServerTask,
	util.rimraf('out-vscode-server-min'),
	common.minifyTask('out-vscode-server', `${sourceMappingURLBase}/core`)
));
gulp.task(minifyVSCodeServerTask);

function packageTask(sourceFolderName, destinationFolderName) {
	const destination = path.join(BUILD_ROOT, destinationFolderName);
	const { platform } = process;

	return () => {
		const json = require('gulp-json-editor');

		const out = sourceFolderName;

		const checksums = util.computeChecksums(out, [
			'vs/workbench/workbench.web.api.js',
			'vs/workbench/workbench.web.api.css',
			'vs/workbench/services/extensions/node/extensionHostProcess.js',
		]);

		const src = gulp.src(out + '/**', { base: '.' })
			.pipe(rename(function (path) { path.dirname = path.dirname.replace(new RegExp('^' + out), 'out'); }))
			.pipe(util.setExecutableBit(['**/*.sh']));

		const platformSpecificBuiltInExtensionsExclusions = product.builtInExtensions.filter(ext => {
			if (!ext.platforms) {
				return false;
			}

			const set = new Set(ext.platforms);
			return !set.has(platform);
		}).map(ext => `!.build/extensions/${ext.name}/**`);

		const extensions = gulp.src(['.build/extensions/**', ...platformSpecificBuiltInExtensionsExclusions], { base: '.build', dot: true });

		const sources = es.merge(src, extensions)
			.pipe(filter(['**', '!**/*.js.map'], { dot: true }));

		let version = packageJson.version;
		const quality = product.quality;

		if (quality && quality !== 'stable') {
			version += '-' + quality;
		}

		const name = product.nameShort;
		const packageJsonUpdates = { name, version, checksums };

		// for linux url handling
		if (platform === 'linux') {
			packageJsonUpdates.desktopName = `${product.applicationName}-url-handler.desktop`;
		}

		const packageJsonStream = gulp.src(['package.json'], { base: '.' })
			.pipe(json(packageJsonUpdates));

		const date = new Date().toISOString();
		const productJsonUpdate = {
			commit,
			date,
			checksums,
			// settingsSearchBuildId: getSettingsSearchBuildId(packageJson),
		};

		const productJsonStream = gulp.src(['product.json'], { base: '.' })
			.pipe(json(productJsonUpdate));

		const license = gulp.src(['LICENSES.chromium.html', product.licenseFileName, 'ThirdPartyNotices.txt', 'licenses/**'], { base: '.', allowEmpty: true });

		const jsFilter = util.filter(data => !data.isDirectory() && /\.js$/.test(data.path));
		const root = path.resolve(path.join(__dirname, '..'));
		const productionDependencies = getProductionDependencies(root);
		const dependenciesSrc = _.flatten(productionDependencies.map(d => path.relative(root, d.path)).map(d => [`${d}/**`, `!${d}/**/{test,tests}/**`]));

		const deps = gulp.src(dependenciesSrc, { base: '.', dot: true })
			.pipe(filter(['**', '!**/package-lock.json', '!**/yarn.lock', '!**/*.js.map']))
			.pipe(util.cleanNodeModules(path.join(__dirname, '.moduleignore')))
			.pipe(jsFilter)
			.pipe(util.rewriteSourceMappingURL(sourceMappingURLBase))
			.pipe(jsFilter.restore)
			.pipe(createAsar(path.join(process.cwd(), 'node_modules'), [
				'**/*.node',
				'**/vscode-ripgrep/bin/*',
				'**/node-pty/build/Release/*',
				'**/node-pty/lib/worker/conoutSocketWorker.js',
				'**/node-pty/lib/shared/conout.js',
				'**/*.wasm',
			], 'node_modules.asar'));

		const favicon = es.merge(
			gulp.src('resources/server/favicon-dark-support.svg', { base: '.' }),
			gulp.src('resources/server/favicon.svg', { base: '.' }),
		);

		const pwaicons = es.merge(
			gulp.src('resources/server/code-192.png', { base: '.' }),
			gulp.src('resources/server/code-512.png', { base: '.' })
		);

		let all = es.merge(
			packageJsonStream,
			productJsonStream,
			license,
			sources,
			deps,
			favicon,
			pwaicons
		);

		let result = all
			.pipe(util.skipDirectories())
			.pipe(util.fixWin32DirectoryPermissions());

		return result.pipe(vfs.dest(destination));
	};
}

const dashed = (str) => (str ? `-${str}` : ``);

['', 'min'].forEach(minified => {
	const sourceFolderName = `out-vscode-server${dashed(minified)}`;
	const destinationFolderName = `vscode-server`;

	// Optimize
	const vscodeServerTaskCI = task.define(`vscode-server${dashed(minified)}-ci`, task.series(
		minified ? minifyVSCodeServerTask : optimizeVSCodeServerTask,
		util.rimraf(path.join(BUILD_ROOT, destinationFolderName)),
		packageTask(sourceFolderName, destinationFolderName)
	));
	gulp.task(vscodeServerTaskCI);

	// Compile and optimize
	const vscodeServerTask = task.define(`vscode-server${dashed(minified)}`, task.series(
		compileBuildTask,
		vscodeServerTaskCI
	));

	gulp.task(vscodeServerTask);
});
