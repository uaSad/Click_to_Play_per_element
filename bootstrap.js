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

"use strict";

const WINDOW_LOADED = -1;
const WINDOW_CLOSED = -2;

const LOG_PREFIX = "[Click to Play per-element] ";
const PREF_BRANCH = "extensions.uaSad@ClickToPlayPerElement.";
const PREF_FILE = "chrome://uasadclicktoplayperelement/content/defaults/preferences/prefs.js";
//const OLD_STYLE_FILE = "chrome://uasadclicktoplayperelement/content/skin/media/oldclicktoplay.css";

const {classes: Cc, interfaces: Ci, utils: Cu} = Components;
Cu.import("resource://gre/modules/Services.jsm");
let console = (Cu.import("resource://gre/modules/devtools/Console.jsm", {})).console;

function install(params, reason) {
}
function uninstall(params, reason) {
	let _deletePrefsOnUninstall = prefs.get("deletePrefsOnUninstall", true);
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
	init: function(reason) {
		if (this.initialized)
			return;
		this.initialized = true;
		if (24 > parseFloat(Services.appinfo.platformVersion)) {
			Cu.reportError(LOG_PREFIX + "startup error: version");
			return;
		}
		prefs.init();
		this.checkPrefs();

		this.windows.forEach(function(window) {
			this.initWindow(window, reason);
		}, this);
		Services.ww.registerNotification(this);
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
		if (topic == "domwindowopened")
			subject.addEventListener("load", this, false);
		else if (topic == "domwindowclosed")
			this.destroyWindow(subject, WINDOW_CLOSED);
	},

	handleEvent: function(event) {
		switch (event.type) {
			case "load":
				this.loadHandler(event);
				break;
			case "unload":
				this.windowClosingHandler(event);
				break;
			case "PluginBindingAttached":
				this.pluginBindingAttached(event);
				break;
			case "click":
				this.clickHandler(event);
				break;
		}
	},
	loadHandler: function(event) {
		let window = event.originalTarget.defaultView;
		window.removeEventListener("load", this, false);
		this.initWindow(window, WINDOW_LOADED);
	},
	windowClosingHandler: function(event) {
		let window = event.currentTarget;
		this.destroyWindowClosingHandler(window);
	},
	destroyWindowClosingHandler: function(window) {
		this.toggleEventListener(window, "remove");
	},

	toggleEventListener: function(window, tReason) {
		let tListener = (tReason == "add") ? "addEventListener" : "removeEventListener";
		window[tListener]("unload", this, false);
		let implem = prefs.get("CtPpeImplementation", 0);
		if (implem == 1)
			window[tListener]("click", this, true);
		else
			window[tListener]("PluginBindingAttached", this, true, true);
	},
	setCtPpeImplementation: function(pVal) {
		this.windows.forEach(function(window) {
			if (pVal == 1) {
				window.removeEventListener("PluginBindingAttached", this, true, true);
				window.addEventListener("click", this, true);
			} else {
				window.addEventListener("PluginBindingAttached", this, true, true);
				window.removeEventListener("click", this, true);
			}
		}, this);
	},

	initWindow: function(window, reason) {
		if (reason == WINDOW_LOADED && !this.isTargetWindow(window)) {
			return;
		}
		if (window.gPluginHandler &&
				window.gPluginHandler._overlayClickListener &&
				window.gPluginHandler._overlayClickListener.handleEvent &&
				window.gPluginHandler.canActivatePlugin &&
				window.gPluginHandler._getBindingType) {
			this.toggleEventListener(window, "add");
			if (prefs.get("styles.enabled"))
				this.loadStyles();
		} else {
			Cu.reportError(LOG_PREFIX + "startup error: gPluginHandler");
		}
	},
	destroyWindow: function(window, reason) {
		window.removeEventListener("load", this, false); // Window can be closed before "load"
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
		let ws = Services.wm.getEnumerator("navigator:browser");
		while (ws.hasMoreElements()) {
			let window = ws.getNext();
			//if (this.isTargetWindow(window))
				windows.push(window);
		}
		return windows;
	},
	isTargetWindow: function(window) {
		let document = window.document;
		/*let rs = document.readyState;
		// We can't touch document.documentElement in not yet loaded window!
		// See https://github.com/Infocatcher/Private_Tab/issues/61
		if (rs != "interactive" && rs != "complete")
			return false;*/
		let winType = document.documentElement.getAttribute("windowtype");
		return winType == "navigator:browser";
	},
	prefChanged: function(pName, pVal) {
		if (pName == "styles.enabled") {
			if (pVal)
				this.loadStyles();
			else
				this.unloadStyles();
		} else if (pName == "styles.useOldCSS") {
			if (prefs.get("styles.enabled"))
				this.reloadStyles();
		} else if (pName == "styles.customHoverBackgroundColor" ||
					pName == "styles.customHoverTextColor") {
			this.setColor(pName, pVal);
		} else if (pName == "timeout.add_to_handleClickToPlayEvent") {
			_prefs[pName] = pVal;
		} else if (pName == "timeout.handleClickToPlayEvent") {
			this.setTimeout(pName, pVal);
		} else if (pName == "CtPpeImplementation") {
			this.setCtPpeImplementation(pVal);
		} else if (pName == "hidePluginNotifications") {
			if (prefs.get("styles.enabled"))
				this.reloadStyles();
		}
	},

	getMostRecentWindow: function() {
		let wm = Components.classes["@mozilla.org/appshell/window-mediator;1"]
						.getService(Components.interfaces.nsIWindowMediator);
		let window = wm.getMostRecentWindow("navigator:browser");
		return window;
	},
	get dwu() {
		delete this.dwu;
		return this.dwu = Components.classes["@mozilla.org/inspector/dom-utils;1"]
			.getService(Components.interfaces.inIDOMUtils);
	},
	getTopWindow: function(event) {
		let window = event.currentTarget.ownerDocument.defaultView.top;
		for (;;) {
			let browser = this.dwu.getParentForNode(window.document, true);
			if (!browser)
				break;
			window = browser.ownerDocument.defaultView.top;
		}
		return window;
	},

	checkPrefs: function() {
		let pNamesTimeouts = [
			"timeout.handleClickToPlayEvent"
		];
		for (let i in pNamesTimeouts) {
			let timeout = prefs.get(pNamesTimeouts[i]);
			if (!this.checkTimeout(timeout))
				prefs.reset(pNamesTimeouts[i]);
		}
		let pNamesColors = [
			"styles.customHoverBackgroundColor",
			"styles.customHoverTextColor"
		];
		for (let i in pNamesColors) {
			let color = prefs.get(pNamesColors[i]);
			if (!this.checkColor(color))
				prefs.reset(pNamesColors[i]);
		}
		let pNamesBooleans = [
			"timeout.add_to_handleClickToPlayEvent",
			"styles.enabled",
			"styles.useOldCSS",
			"hidePluginNotifications"
		];
		for (let i in pNamesBooleans) {
			let color = prefs.get(pNamesBooleans[i]);
			if (typeof color != "boolean")
				prefs.reset(pNamesBooleans[i]);
		}
		if (typeof prefs.get("CtPpeImplementation") != "number") {
			prefs.reset("CtPpeImplementation");
		}
		_prefs["timeout.add_to_handleClickToPlayEvent"] = prefs.get("timeout.add_to_handleClickToPlayEvent", false);
		_prefs["timeout.handleClickToPlayEvent"] = prefs.get("timeout.handleClickToPlayEvent", 100);
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
		if (!prefs.get("styles.enabled"))
			return;
		if (this.checkColor(color)) {
			prefs.set(pName, color);
			this.reloadStyles();
		} else if (color == "") {
			this.reloadStyles();
		} else {
			this.setResetAfterPause(pName);
		}
	},
	checkTimeout: function(timeout) {
		if (typeof timeout == "number" &&
		  0 <= timeout && timeout <= 5000)
			return true;
		else
			return false;
	},
	setTimeout: function(pName, timeout) {
		this.cancelResetAfterPause();
		if (this.checkTimeout(timeout)) {
			prefs.set(pName, timeout);
			_prefs[pName] = timeout;
		} else {
			this.setResetAfterPause(pName);
		}
	},
	setResetAfterPause: function(pName) {
		let window = this.getMostRecentWindow();
		this.resetAfterPauseWindow = window;
		let _this = this;
		this.resetAfterPauseTimeoutID = window.setTimeout(function() {
			_this.resetAfterPause.call(_this, pName);
		}, 2000);
	},
	cancelResetAfterPause: function() {
		let window = this.resetAfterPauseWindow;
		if (window && typeof this.resetAfterPauseTimeoutID == "number") {
			window.clearTimeout(this.resetAfterPauseTimeoutID);
			delete this.resetAfterPauseTimeoutID;
			delete this.resetAfterPauseWindow;
		}
	},
	resetAfterPause: function(pName) {
		prefs.reset(pName);
		delete this.resetAfterPauseTimeoutID;
		delete this.resetAfterPauseWindow;
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
		return this.sss = Components.classes["@mozilla.org/content/style-sheet-service;1"]
			.getService(Components.interfaces.nsIStyleSheetService);
	},
	makeCSSURI: function() {
		let cssStr;

		if (prefs.get("styles.useOldCSS", true)) {
			cssStr = '\
@namespace url(http://www.w3.org/1999/xhtml);\n\
@namespace xul url(http://www.mozilla.org/keymaster/gatekeeper/there.is.only.xul);\n\
:-moz-handler-clicktoplay .icon {\n\
	opacity: 0.7;\n\
	background-image: url(chrome://uasadclicktoplayperelement/content/skin/media/clicktoplay-bgtexture.png),\n\
						url(chrome://uasadclicktoplayperelement/content/skin/media/videoClickToPlayButton.svg) !important;\n\
}\n\
:-moz-handler-clicktoplay .hoverBox:hover .icon {\n\
	opacity: 1 !important;\n\
}\n\
:-moz-handler-clicktoplay .mainBox {\n\
	background-color: hsla(0,0%,100%,.2) !important;\n\
	color: hsl(0,0%,35%) !important;\n\
	outline: 1px dashed hsla(0,0%,50%,0.5) !important;\n\
	outline-offset: -1px !important;\n\
}\n\
:-moz-handler-clicktoplay .mainBox:hover {\n\
	background-color: hsla(0,0%,90%,.7) !important;\n\
}\n\
:-moz-handler-clicktoplay .hoverBox:hover {\n\
	color: hsl(0,0%,20%) !important;\n\
}\n\
';
		} else {
			let setBgColor = prefs.get("styles.customHoverBackgroundColor");
			let setTColor= prefs.get("styles.customHoverTextColor");
			if (!setBgColor || setBgColor == "")
				setBgColor = _prefs["defaultBackgroundColor"];
			if (!setTColor || setTColor == "")
				setTColor = _prefs["defaultTextColor"];

			cssStr = '\
@namespace url(http://www.w3.org/1999/xhtml);\n\
@namespace xul url(http://www.mozilla.org/keymaster/gatekeeper/there.is.only.xul);\n\
:-moz-handler-clicktoplay .mainBox:hover';
			cssStr += '\
 {\n\
	background-color: ' + setBgColor + ' !important;\n\
}\n\
:-moz-handler-clicktoplay .hoverBox:hover';
			cssStr += '\
 {\n\
	color: ' + setTColor + ' !important;\n\
}\n\
';
		}

		let hidePluginNotifications = prefs.get("hidePluginNotifications", false);
		if (hidePluginNotifications) {
			let pluginHidden = '\
\n\
xul|notification[value="plugin-hidden"] {\n\
	display: none !important;\n\
}\n\
';
			cssStr += pluginHidden;
		}
		return Services.io.newURI("data:text/css," + encodeURIComponent(cssStr), null, null);
	},

	//
	getPluginUI: function(plugin, doc) {
		return doc.getAnonymousElementByAttribute(plugin, "anonid", "main") ||
					doc.getAnonymousElementByAttribute(plugin, "class", "mainBox");
	},

	// Implementation - 0 (default)
	pluginBindingAttached: function(event) {
		let window;
		let document;
		let plugin;
		let doc;
		try {
			window = event.currentTarget;
			document = window.document;
			plugin = event.target;
			doc = plugin.ownerDocument;
			let _this = this;
			if (_prefs["timeout.add_to_handleClickToPlayEvent"]) {
				let timeout = _prefs["timeout.handleClickToPlayEvent"] || 100;
				window.setTimeout(function() {
					_this._handleClickToPlayEvent.call(_this, window, document, plugin, doc);
				}, timeout);
			} else
				this._handleClickToPlayEvent(window, document, plugin, doc);
		} catch (ex) {
			console.error(LOG_PREFIX + ex);
		}
	},
	_handleClickToPlayEvent: function PH_handleClickToPlayEvent(window, document, plugin, doc) {
		let overlay;
		let eventType;
		try {
			overlay = this.getPluginUI(plugin, doc);
			if (!overlay && !(plugin instanceof Ci.nsIObjectLoadingContent)) {
				console.error(LOG_PREFIX + "_handleClickToPlayEvent(): overlay", overlay);
				return;
			}
			eventType = window.gPluginHandler._getBindingType(plugin);
		} catch (ex) {
			console.error(LOG_PREFIX + ex);
			return;
		}
		if (eventType == "PluginClickToPlay") {
			plugin.addEventListener("click", windowsObserver._overlayClickListener, true);
		}
	},
	_overlayClickListener: {
		handleEvent: function PH_handleOverlayClick(aEvent) {
			let window = windowsObserver.getTopWindow(aEvent);
			if (!window)
				return;
			let document = window.document;
			let plugin = document.getBindingParent(aEvent.originalTarget);
			let contentWindow = plugin.ownerDocument.defaultView.top;
			// gBrowser.getBrowserForDocument does not exist in the case where we
			// drag-and-dropped a tab from a window containing only that tab. In
			// that case, the window gets destroyed.
			let browser = window.gBrowser.getBrowserForDocument ?
				window.gBrowser.getBrowserForDocument(contentWindow.document) :
				null;
			// If browser is null here, we've been drag-and-dropped from another
			// window, and this is the wrong click handler.
			if (!browser) {
				return;
			}
			let objLoadingContent = plugin.QueryInterface(Ci.nsIObjectLoadingContent);
			// Have to check that the target is not the link to update the plugin
			if (!(aEvent.originalTarget instanceof window.HTMLAnchorElement) &&
				(aEvent.originalTarget.getAttribute('anonid') != 'closeIcon') &&
				aEvent.button == 0 && aEvent.isTrusted) {
				// If this isn't a vulnerable plugin, try to activate
				// just this element without changing any other state.
				aEvent.target.removeEventListener("click", windowsObserver._overlayClickListener, true);
				if (!window.gPluginHandler.canActivatePlugin(objLoadingContent))
					return;
				if (objLoadingContent.pluginFallbackType ==
						Ci.nsIObjectLoadingContent.PLUGIN_VULNERABLE_UPDATABLE ||
						objLoadingContent.pluginFallbackType ==
						Ci.nsIObjectLoadingContent.PLUGIN_VULNERABLE_NO_UPDATE)
					return;
				objLoadingContent.playPlugin();
				aEvent.stopPropagation();
				aEvent.preventDefault();
			}
		}
	},

	// Implementation - 1 (maybe this will work if previous won't)
	clickHandler: function(aEvent) {
		let window = aEvent.currentTarget;
		let document = window.document;
		let plugin = aEvent.target;
		let doc = plugin.ownerDocument;
		let overlay = this.getPluginUI(plugin, doc);
		if (!overlay && !(plugin instanceof Ci.nsIObjectLoadingContent)) {
			return;
		}
		let objLoadingContent = plugin.QueryInterface(Ci.nsIObjectLoadingContent);
		if (objLoadingContent.activated) {
			return;
		}
		let eventType = window.gPluginHandler._getBindingType(plugin);
		if (!eventType)
			return;
		if (eventType == "PluginClickToPlay") {
			this._overlayClickListener_HandleEvent(window, document, aEvent);
		}
	},
	_overlayClickListener_HandleEvent: function(window, document, aEvent) {
		let plugin = document.getBindingParent(aEvent.originalTarget);
		let contentWindow = plugin.ownerDocument.defaultView.top;
		// gBrowser.getBrowserForDocument does not exist in the case where we
		// drag-and-dropped a tab from a window containing only that tab. In
		// that case, the window gets destroyed.
		let browser = window.gBrowser.getBrowserForDocument ?
			window.gBrowser.getBrowserForDocument(contentWindow.document) :
			null;
		// If browser is null here, we've been drag-and-dropped from another
		// window, and this is the wrong click handler.
		if (!browser) {
			return;
		}
		let objLoadingContent = plugin.QueryInterface(Ci.nsIObjectLoadingContent);
		// Have to check that the target is not the link to update the plugin
		if (!(aEvent.originalTarget instanceof window.HTMLAnchorElement) &&
			(aEvent.originalTarget.getAttribute('anonid') != 'closeIcon') &&
			aEvent.button == 0 && aEvent.isTrusted) {
			// If this isn't a vulnerable plugin, try to activate
			// just this element without changing any other state.
			if (!window.gPluginHandler.canActivatePlugin(objLoadingContent))
					return;
			if (objLoadingContent.pluginFallbackType ==
					Ci.nsIObjectLoadingContent.PLUGIN_VULNERABLE_UPDATABLE ||
					objLoadingContent.pluginFallbackType ==
					Ci.nsIObjectLoadingContent.PLUGIN_VULNERABLE_NO_UPDATE)
				return;
			objLoadingContent.playPlugin();
			aEvent.stopPropagation();
			aEvent.preventDefault();
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
		if (topic != "nsPref:changed")
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
 	},

	loadDefaultPrefs: function() {
		let defaultBranch = Services.prefs.getDefaultBranch("");
		let prefsFile = PREF_FILE;
		let prefs = this;
		let o = {};
		Components.utils.import("resource://gre/modules/Services.jsm", o);
		o.Services.scriptloader.loadSubScript(prefsFile, {
			pref: function(pName, val) {
				let pType = defaultBranch.getPrefType(pName);
				if (pType != defaultBranch.PREF_INVALID && pType != prefs.getValueType(val)) {
					Components.utils.reportError(
						LOG_PREFIX + 'Changed preference type for "' + pName
						+ '", old value will be lost!'
					);
					defaultBranch.deleteBranch(pName);
				}
				prefs.setPref(pName, val, defaultBranch);
			}
		});
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
				return ps.getComplexValue(pName, Components.interfaces.nsISupportsString).data;
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
				let ss = Components.interfaces.nsISupportsString;
				let str = Components.classes["@mozilla.org/supports-string;1"]
					.createInstance(ss);
				str.data = val;
				ps.setComplexValue(pName, ss, str);
		}
		return this;
	},
	getValueType: function(val) {
		switch (typeof val) {
			case "boolean":
				return Services.prefs.PREF_BOOL;
			case "number":
				return Services.prefs.PREF_INT;
		}
		return Services.prefs.PREF_STRING;

	},
	has: function(pName, comBranch) {
		return this._has(pName, comBranch);
	},
	_has: function(pName, comBranch) {
		let ps = Services.prefs;
		if (!comBranch)
			pName = this.ns + pName;
		return (ps.getPrefType(pName) != Ci.nsIPrefBranch.PREF_INVALID);
	},
	reset: function(pName, comBranch) {
		if (this.has(pName, comBranch))
			this._reset(pName);
	},
	_reset: function(pName, comBranch) {
		let ps = Services.prefs;
		if (!comBranch)
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
	"defaultBackgroundColor": "rgb(142,142,142)",
	"defaultTextColor": "rgb(0,0,0)",
	"timeout.add_to_handleClickToPlayEvent": false,
	"timeout.handleClickToPlayEvent": 100
};
