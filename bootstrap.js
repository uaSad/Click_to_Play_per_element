/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/.
 * The Original Code is mozilla.org code (Firefox 23)
 * The Initial Developer of the Original Code is mozilla.org.
*/

// Template based on Private Tab by Infocatcher
// https://addons.mozilla.org/firefox/addon/private-tab

// "Click To Play" based on
// "Pref for activating single plugins" patch by John Schoenick
// https://bugzilla.mozilla.org/attachment.cgi?id=782759
// https://bugzilla.mozilla.org/show_bug.cgi?id=888705

'use strict';

const WINDOW_LOADED = -1;
const WINDOW_CLOSED = -2;

const LOG_PREFIX = '[Click to Play per-element] ';
const PREF_BRANCH = 'extensions.uaSad@ClickToPlayPerElement.';
const PREF_FILE = 'chrome://uasadclicktoplayperelement/content/defaults/preferences/prefs.js';

const {classes: Cc, interfaces: Ci, utils: Cu} = Components;
Cu.import('resource://gre/modules/Services.jsm');
let console = (Cu.import('resource://gre/modules/devtools/Console.jsm', {})).console;

function install(params, reason) {
}
function uninstall(params, reason) {
	let _deletePrefsOnUninstall = prefs.get('deletePrefsOnUninstall', true);
	if (reason == ADDON_UNINSTALL && _deletePrefsOnUninstall)
		prefs.deletePrefsOnUninstall();
}
function startup(params, reason) {
	windowsObserver.init(reason);
}
function shutdown(params, reason) {
	windowsObserver.destroy(reason);
}

let windowsObserver = {
	initialized: false,
	appVersion: 0,
	init: function(reason) {
		if (this.initialized)
			return;
		this.initialized = true;
		this.appVersion = parseFloat(Services.appinfo.platformVersion);
		if (this.appVersion < 24) {
			Cu.reportError(LOG_PREFIX + 'startup error: version');
			return;
		}
		prefs.init();
		_dbg = prefs.get('debug', false);
		this.checkPrefs();
		this.windows.forEach(function(window) {
			this.initWindow(window, reason);
		}, this);
		Services.ww.registerNotification(this);
		if (prefs.get('styles.enabled', true))
				this.loadStyles();
	},
	destroy: function(reason) {
		if (!this.initialized)
			return;
		this.initialized = false;
		this.windows.forEach(function(window) {
			this.destroyWindow(window, reason);
		}, this);
		Services.ww.unregisterNotification(this);
		if (reason != APP_SHUTDOWN) {
			this.unloadStyles();
		}
		prefs.destroy();
	},

	observe: function(subject, topic, data) {
		if (topic == 'domwindowopened')
			subject.addEventListener('load', this, false);
		else if (topic == 'domwindowclosed')
			this.destroyWindow(subject, WINDOW_CLOSED);
	},

	handleEvent: function(event) {
		switch (event.type) {
			case 'load':
				this.loadHandler(event);
				break;
			case 'unload':
				this.windowClosingHandler(event);
				break;
			case 'PluginBindingAttached':
				this.pluginBindingAttached(event);
				break;
		}
	},
	loadHandler: function(event) {
		let window = event.originalTarget.defaultView;
		window.removeEventListener('load', this, false);
		this.initWindow(window, WINDOW_LOADED);
	},
	windowClosingHandler: function(event) {
		let window = event.currentTarget;
		this.destroyWindowClosingHandler(window);
	},
	destroyWindowClosingHandler: function(window) {
		let {gBrowser} = window;
		window.removeEventListener('unload', this, false);
		gBrowser.removeEventListener('PluginBindingAttached', this, true, true);
	},

	initWindow: function(window, reason) {
		if (reason == WINDOW_LOADED && !this.isTargetWindow(window)) {
			return;
		}
		let {gPluginHandler} = window;
		if (gPluginHandler &&
				'_overlayClickListener' in gPluginHandler &&
				'handleEvent' in gPluginHandler._overlayClickListener &&
				'canActivatePlugin' in gPluginHandler &&
				'_getBindingType' in gPluginHandler) {
			let {gBrowser} = window;
			window.addEventListener('unload', this, false);
			gBrowser.addEventListener('PluginBindingAttached', this, true, true);
		} else {
			Cu.reportError(LOG_PREFIX + 'startup error: gPluginHandler');
		}
	},
	destroyWindow: function(window, reason) {
		window.removeEventListener('load', this, false); // Window can be closed before "load"
		if (reason == WINDOW_CLOSED && !this.isTargetWindow(window))
			return;
		if (reason != WINDOW_CLOSED) {
			// See resource:///modules/sessionstore/SessionStore.jsm
			// "domwindowclosed" => onClose() => "SSWindowClosing"
			// This may happens after our "domwindowclosed" notification!
			this.destroyWindowClosingHandler(window);
		}
	},

	get windows() {
		let windows = [];
		let ws = Services.wm.getEnumerator('navigator:browser');
		while (ws.hasMoreElements()) {
			let window = ws.getNext();
			//if (this.isTargetWindow(window))
				windows.push(window);
		}
		return windows;
	},
	isTargetWindow: function(window) {
		let {document} = window;
		let rs = document.readyState;
		// We can't touch document.documentElement in not yet loaded window!
		// See https://github.com/Infocatcher/Private_Tab/issues/61
		if (rs != 'interactive' && rs != 'complete')
			return false;
		let winType = document.documentElement.getAttribute('windowtype');
		return winType == 'navigator:browser';
	},
	prefChanged: function(pName, pVal) {
		switch (pName) {
			case 'styles.enabled':
				if (pVal) {
					this.loadStyles();
				} else {
					this.unloadStyles();
				}
				break;
			case 'styles.useOldCSS':
			case 'styles.hidePluginNotifications':
				if (prefs.get('styles.enabled', true))
					this.reloadStyles();
				break;
			case 'styles.customHoverBackgroundColor':
			case 'styles.customHoverTextColor':
				this.setColor(pName, pVal);
				break;
			case 'debug':
				_dbg = pVal;
				break;
			case 'showPluginUIEvenIfItsTooBig':
				_prefs['showPluginUIEvenIfItsTooBig'] = pVal;
				break;
		}
	},

	getMostRecentWindow: function() {
		let wm = Cc['@mozilla.org/appshell/window-mediator;1']
						.getService(Ci.nsIWindowMediator);
		let window = wm.getMostRecentWindow('navigator:browser');
		return window;
	},

	checkPrefs: function() {
		let pNamesColors = [
			'styles.customHoverBackgroundColor',
			'styles.customHoverTextColor'
		];
		for (let i = 0, len = pNamesColors.length; i < len; i++) {
			let color = prefs.get(pNamesColors[i]);
			if (!this.checkColor(color))
				prefs.reset(pNamesColors[i]);
		}
		let pNamesBooleans = [
			'styles.enabled',
			'styles.useOldCSS',
			'styles.hidePluginNotifications',
			'showPluginUIEvenIfItsTooBig',
			'debug'
		];
		for (let i = 0, len = pNamesBooleans.length; i < len; i++) {
			let pVal = prefs.get(pNamesBooleans[i]);
			if (typeof pVal != 'boolean')
				prefs.reset(pNamesBooleans[i]);
		}
		_prefs['showPluginUIEvenIfItsTooBig'] = prefs.get('showPluginUIEvenIfItsTooBig', false);
	},
	checkColor: function(color) {
		if (/^rgb\([0-9]{1,3}, ?[0-9]{1,3}, ?[0-9]{1,3}\)$/.test(color)) {
			let matchColor = /^rgb\(([0-9]{1,3}), ?([0-9]{1,3}), ?([0-9]{1,3})\)$/.exec(color);
			if (!matchColor)
				return false;
			let arr = [];
			arr.push(matchColor[1], matchColor[2], matchColor[3]);
			let res = arr.every(function(colorVal) colorVal >= 0 && colorVal <= 255);
			return res;
		}
		else if (/^#[0-9a-f]{3}(?:[0-9a-f]{3})?$/i.test(color) ||
			/^[a-z]{3,30}$/i.test(color))
			return true;
		else
			return false;
	},
	setColor: function(pName, color) {
		this.cancelResetAfterPause();
		if (!prefs.get('styles.enabled', true))
			return;
		if (this.checkColor(color)) {
			prefs.set(pName, color);
			this.reloadStyles();
		} else if (color == '') {
			this.reloadStyles();
		} else {
			this.setResetAfterPause(pName);
		}
	},
	setResetAfterPause: function(pName) {
		let window = this.getMostRecentWindow();
		this.resetAfterPauseWindow = window;
		this.resetAfterPauseTimeoutID = window.setTimeout(function() {
			this.resetAfterPause(pName);
		}.bind(this), 1500);
	},
	cancelResetAfterPause: function() {
		let window = this.resetAfterPauseWindow;
		if (window && typeof this.resetAfterPauseTimeoutID == 'number') {
			window.clearTimeout(this.resetAfterPauseTimeoutID);
			this.resetAfterPauseTimeoutID = null;
			this.resetAfterPauseWindow = null;
		}
	},
	resetAfterPause: function(pName) {
		prefs.reset(pName);
		this.resetAfterPauseTimeoutID = null;
		this.resetAfterPauseWindow = null;
	},

	_stylesLoaded: false,
	loadStyles: function() {
		if (this._stylesLoaded)
			return;
		this._stylesLoaded = true;
		let sss = this.sss;

		let cssURI = this.cssURI = this.makeCSSURI();
		if (!sss.sheetRegistered(cssURI, sss.USER_SHEET))
			sss.loadAndRegisterSheet(cssURI, sss.USER_SHEET);
	},
	unloadStyles: function() {
		if (!this._stylesLoaded)
			return;
		this._stylesLoaded = false;
		let sss = this.sss;
		if (sss.sheetRegistered(this.cssURI, sss.USER_SHEET))
			sss.unregisterSheet(this.cssURI, sss.USER_SHEET);
	},
	reloadStyles: function() {
		this.unloadStyles();
		this.loadStyles();
	},
	get sss() {
		delete this.sss;
		return this.sss = Cc['@mozilla.org/content/style-sheet-service;1']
			.getService(Ci.nsIStyleSheetService);
	},
	makeCSSURI: function() {
		let cssStr;

		if (prefs.get('styles.useOldCSS', false)) {
			cssStr = '@namespace url(http://www.w3.org/1999/xhtml);\n' +
					'@namespace xul url(http://www.mozilla.org/keymaster/gatekeeper/there.is.only.xul);\n' +
					':-moz-handler-clicktoplay .icon {\n' +
					'	opacity: 0.7;\n' +
					'	background-image: url(chrome://uasadclicktoplayperelement/content/skin/media/clicktoplay-bgtexture.png),\n' +
					'						url(chrome://uasadclicktoplayperelement/content/skin/media/videoClickToPlayButton.svg) !important;\n' +
					'}\n' +
					':-moz-handler-clicktoplay .hoverBox:hover .icon {\n' +
					'	opacity: 1 !important;\n' +
					'}\n' +
					':-moz-handler-clicktoplay .mainBox {\n' +
					'	background-color: hsla(0,0%,100%,.2) !important;\n' +
					'	color: hsl(0,0%,35%) !important;\n' +
					'	outline: 1px dashed hsla(0,0%,50%,0.5) !important;\n' +
					'	outline-offset: -1px !important;\n' +
					'}\n' +
					':-moz-handler-clicktoplay .mainBox:hover {\n' +
					'	background-color: hsla(0,0%,90%,.7) !important;\n' +
					'}\n' +
					':-moz-handler-clicktoplay .hoverBox:hover {\n' +
					'	color: hsl(0,0%,20%) !important;\n' +
					'}\n';
		} else {
			let setBgColor = prefs.get('styles.customHoverBackgroundColor', '');
			let setTColor= prefs.get('styles.customHoverTextColor', '');
			if (!setBgColor || setBgColor == '')
				setBgColor = _prefs['defaultBackgroundColor'];
			if (!setTColor || setTColor == '')
				setTColor = _prefs['defaultTextColor'];

			cssStr = '@namespace url(http://www.w3.org/1999/xhtml);\n' +
					'@namespace xul url(http://www.mozilla.org/keymaster/gatekeeper/there.is.only.xul);\n' +
					':-moz-handler-clicktoplay .mainBox:hover {\n' +
					'	background-color: ' + setBgColor + ' !important;\n' +
					'}\n' +
					':-moz-handler-clicktoplay .hoverBox:hover {\n' +
					'	color: ' + setTColor + ' !important;\n' +
					'}\n';
		}

		let hidePluginNotifications = prefs.get('styles.hidePluginNotifications', false);
		if (hidePluginNotifications) {
			cssStr += '\n' +
					'xul|notification[value="plugin-hidden"] {\n'+
					'	display: none !important;\n' +
					'}\n';
		}

		_dbg && console.log(LOG_PREFIX + '\n' + cssStr);

		return Services.io.newURI('data:text/css,' + encodeURIComponent(cssStr), null, null);
	},


	get dwu() {
		delete this.dwu;
		return this.dwu = Cc['@mozilla.org/inspector/dom-utils;1']
			.getService(Ci.inIDOMUtils);
	},
	getTopWindow: function(event) {
		let eventTarget = event.currentTarget || event.originalTarget || event.target;
		let window = eventTarget.ownerDocument.defaultView.top;
		for (;;) {
			let browser = this.dwu.getParentForNode(window.document, true);
			if (!browser)
				break;
			window = browser.ownerDocument.defaultView.top;
		}
		return window;
	},

	// fallback
	getPluginUI: function(plugin, doc) {
		return doc.getAnonymousElementByAttribute(plugin, 'class', 'mainBox') ||
				doc.getAnonymousElementByAttribute(plugin, 'anonid', 'main');
	},

	pluginBindingAttached: function(event) {
		let window = windowsObserver.getTopWindow(event);
		window.setTimeout(function() {
			this.pluginAttached(event, window);
		}.bind(this), 50);

		_dbg && console.log(LOG_PREFIX + 'CTPpe.pluginBindingAttached()');
	},
	pluginAttached: function(event, window) {
		let eventType = event.type;
		if (eventType == 'PluginRemoved') {
			return;
		}
		let plugin = event.target;
		let doc = plugin.ownerDocument;
		if (!(plugin instanceof Ci.nsIObjectLoadingContent))
			return;
		if (eventType == 'PluginBindingAttached') {
			// The plugin binding fires this event when it is created.
			// As an untrusted event, ensure that this object actually has a binding
			// and make sure we don't handle it twice
			let {gPluginHandler} = window;
			let overlay = gPluginHandler.getPluginUI(plugin, 'main') ||
							this.getPluginUI(plugin, doc);
			if (!overlay) {
				return;
			}
			// Lookup the handler for this binding
			eventType = gPluginHandler._getBindingType(plugin);
			if (!eventType) {
				// Not all bindings have handlers
				return;
			}
		}
		if (eventType == 'PluginClickToPlay') {
			this._handleClickToPlayEvent(plugin, window);
		}

		_dbg && console.log(LOG_PREFIX + 'CTPpe.pluginAttached()');
	},
	_handleClickToPlayEvent: function PH_handleClickToPlayEvent(aPlugin, window) {
		let doc = aPlugin.ownerDocument;
		let {gPluginHandler, gBrowser} = window;
		let browser = gBrowser.getBrowserForDocument(doc.defaultView.top.document);
		let objLoadingContent = aPlugin.QueryInterface(Ci.nsIObjectLoadingContent);
		// guard against giving pluginHost.getPermissionStringForType a type
		// not associated with any known plugin
		if (!gPluginHandler.isKnownPlugin(objLoadingContent))
			return;
		let overlay = gPluginHandler.getPluginUI(aPlugin, 'main') ||
							this.getPluginUI(aPlugin, doc);
		if (overlay) {
			overlay.addEventListener('click', windowsObserver._overlayClickListener, true);
			if (windowsObserver.appVersion >= 27)
				overlay.removeEventListener('click', gPluginHandler._overlayClickListener, true);
			if (_prefs['showPluginUIEvenIfItsTooBig']) {
				window.setTimeout(function() {
					try {
						if (gPluginHandler.isTooSmall && overlay &&
								gPluginHandler.isTooSmall(aPlugin, overlay))
							overlay.style.visibility = 'visible';
					} catch (ex) {
						console.error(LOG_PREFIX + ex);
					}
				}.bind(this), 100);
			}
		}

		_dbg && console.log(LOG_PREFIX + 'CTPpe._handleClickToPlayEvent()');
	},
	_overlayClickListener: {
		handleEvent: function PH_handleOverlayClick(aEvent) {
			let window = windowsObserver.getTopWindow(aEvent);
			let {gBrowser, gPluginHandler, PopupNotifications, HTMLAnchorElement} = window;
			let document = window.document;
			let plugin = document.getBindingParent(aEvent.target);
			let contentWindow = plugin.ownerDocument.defaultView.top;
			// gBrowser.getBrowserForDocument does not exist in the case where we
			// drag-and-dropped a tab from a window containing only that tab. In
			// that case, the window gets destroyed.
			let browser = gBrowser.getBrowserForDocument ?
				gBrowser.getBrowserForDocument(contentWindow.document) :
				null;
			// If browser is null here, we've been drag-and-dropped from another
			// window, and this is the wrong click handler.
			if (!browser) {
				aEvent.target.removeEventListener('click', windowsObserver._overlayClickListener, true);
				return;
			}
			let objLoadingContent = plugin.QueryInterface(Ci.nsIObjectLoadingContent);
			// Have to check that the target is not the link to update the plugin
			if (!(aEvent.originalTarget instanceof HTMLAnchorElement) &&
					(aEvent.originalTarget.getAttribute('anonid') != 'closeIcon') &&
					aEvent.button == 0 && aEvent.isTrusted) {
				if (gPluginHandler.canActivatePlugin(objLoadingContent) &&
						objLoadingContent.pluginFallbackType !=
						Ci.nsIObjectLoadingContent.PLUGIN_VULNERABLE_UPDATABLE &&
						objLoadingContent.pluginFallbackType !=
						Ci.nsIObjectLoadingContent.PLUGIN_VULNERABLE_NO_UPDATE) {
					objLoadingContent.playPlugin();
					if (windowsObserver.appVersion < 27) {
						window.setTimeout(function() {
							let notification = PopupNotifications.getNotification('click-to-play-plugins', browser);
							if (notification) {
								notification.remove();
							}
						}.bind(this), 1);
					}
				} else {
					if (windowsObserver.appVersion >= 27)
						gPluginHandler._showClickToPlayNotification(browser, plugin);
				}
				aEvent.stopPropagation();
				aEvent.preventDefault();
			}

			_dbg && console.log(LOG_PREFIX + 'CTPpe._overlayClickListener()');
		}
	}
};

let prefs = {
	ns: PREF_BRANCH,
	initialized: false,
	init: function() {
		if (this.initialized)
			return;
		this.initialized = true;

		//~ todo: add condition when https://bugzilla.mozilla.org/show_bug.cgi?id=564675 will be fixed
		this.loadDefaultPrefs();
		Services.prefs.addObserver(this.ns, this, false);
	},
	destroy: function() {
		if (!this.initialized)
			return;
		this.initialized = false;

		Services.prefs.removeObserver(this.ns, this);
	},
	observe: function(subject, topic, pName) {
		if (topic != 'nsPref:changed')
			return;
		let shortName = pName.substr(this.ns.length);
		let val = this.getPref(pName);
		this._cache[shortName] = val;
		windowsObserver.prefChanged(shortName, val);
	},

	deletePrefsOnUninstall: function() {
		try {
			Services.prefs.deleteBranch(this.ns);
		} catch (ex) {
			console.error(LOG_PREFIX + ex);
		}

		_dbg && console.log(LOG_PREFIX + 'prefs.deletePrefsOnUninstall()');
 	},

	loadDefaultPrefs: function() {
		let defaultBranch = Services.prefs.getDefaultBranch('');
		let prefsFile = PREF_FILE;
		let prefs = this;
		let scope = {
			pref: function(pName, val) {
				let pType = defaultBranch.getPrefType(pName);
				if (pType != defaultBranch.PREF_INVALID && pType != prefs.getValueType(val)) {
					Cu.reportError(
						LOG_PREFIX + 'Changed preference type for "' + pName
						+ '", old value will be lost!'
					);
					defaultBranch.deleteBranch(pName);
				}
				prefs.setPref(pName, val, defaultBranch);
			}
		};
		Services.scriptloader.loadSubScript(prefsFile, scope);

		_dbg && console.log(LOG_PREFIX + 'prefs.loadDefaultPrefs()');
	},

	_cache: { __proto__: null },
	get: function(pName, defaultVal) {
		let cache = this._cache;
		return pName in cache
			? cache[pName]
			: (cache[pName] = this.getPref(this.ns + pName, defaultVal));
	},
	set: function(pName, val) {
		return this.setPref(this.ns + pName, val);
	},
	getPref: function(pName, defaultVal, prefBranch) {
		let ps = prefBranch || Services.prefs;
		switch (ps.getPrefType(pName)) {
			case ps.PREF_BOOL:
				return ps.getBoolPref(pName);
			case ps.PREF_INT:
				return ps.getIntPref(pName);
			case ps.PREF_STRING:
				return ps.getComplexValue(pName, Ci.nsISupportsString).data;
		}
		return defaultVal;
	},
	setPref: function(pName, val, prefBranch) {
		let ps = prefBranch || Services.prefs;
		let pType = ps.getPrefType(pName);
		if (pType == ps.PREF_INVALID)
			pType = this.getValueType(val);
		switch (pType) {
			case ps.PREF_BOOL:
				ps.setBoolPref(pName, val);
				break;
			case ps.PREF_INT:
				ps.setIntPref(pName, val);
				break;
			case ps.PREF_STRING:
				let ss = Ci.nsISupportsString;
				let str = Cc['@mozilla.org/supports-string;1']
					.createInstance(ss);
				str.data = val;
				ps.setComplexValue(pName, ss, str);
		}
		return this;
	},
	getValueType: function(val) {
		switch (typeof val) {
			case 'boolean':
				return Services.prefs.PREF_BOOL;
			case 'number':
				return Services.prefs.PREF_INT;
		}
		return Services.prefs.PREF_STRING;

	},
	has: function(pName) {
		return this._has(pName);
	},
	_has: function(pName) {
		let ps = Services.prefs;
		pName = this.ns + pName;
		return (ps.getPrefType(pName) != Ci.nsIPrefBranch.PREF_INVALID);
	},
	reset: function(pName) {
		if (this.has(pName))
			this._reset(pName);
	},
	_reset: function(pName) {
		let ps = Services.prefs;
		pName = this.ns + pName;
		try {
			ps.clearUserPref(pName);
		} catch (ex) {
			// The pref service throws NS_ERROR_UNEXPECTED when the caller tries
			// to reset a pref that doesn't exist or is already set to its default
			// value.  This interface fails silently in those cases, so callers
			// can unconditionally reset a pref without having to check if it needs
			// resetting first or trap exceptions after the fact.  It passes through
			// other exceptions, however, so callers know about them, since we don't
			// know what other exceptions might be thrown and what they might mean.
			if (ex.result != Cr.NS_ERROR_UNEXPECTED)
				throw ex;
		}
	}
};

let _prefs = {
	'defaultBackgroundColor': 'rgb(142,142,142)',
	'defaultTextColor': 'rgb(0,0,0)',
	'showPluginUIEvenIfItsTooBig': false
};

// Be careful, loggers always works until prefs aren't initialized
// (and if "debug" preference has default value)
let _dbg = true;
