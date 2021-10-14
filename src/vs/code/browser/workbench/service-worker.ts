/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Coder Technologies. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference lib="webworker" />

const sw = self as unknown as ServiceWorkerGlobalScope;

sw.addEventListener('install', () => {
	console.log('[Service Worker] installed');
});

sw.addEventListener('activate', (event) => {
	event.waitUntil(sw.clients.claim());
	console.log('[Service Worker] activated');
});

sw.addEventListener('fetch', () => {
	// Without this event handler we won't be recognized as a PWA.
});
