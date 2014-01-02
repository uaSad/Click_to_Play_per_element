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
	appVersion: 0,
	init: function(reason) {
		if (this.initialized)
			return;
		this.initialized = true;
		this.appVersion = parseFloat(Services.appinfo.platformVersion);
		if (this.appVersion < 24) {
			Cu.reportError(LOG_PREFIX + "startup error: version");
			return;
		}
		prefs.init();
		_dbg = prefs.get("debug", false);
		this.checkPrefs();
		this.windows.forEach(function(window) {
			this.initWindow(window, reason);
		}, this);
		Services.ww.registerNotification(this);
		if (prefs.get("styles.enabled"))
				this.loadStyles();
	},
	destroy: function(reason) {
		if (!this.initialized)
			return;
		this.initialized = false;
		Services.ww.unregisterNotification(this);
		if (reason != APP_SHUTDOWN) {
			this.unloadStyles();
			Services.obs.notifyObservers(null, "uasad-ctppe", "shutdown");
		}
		prefs.destroy();
	},

	observe: function(subject, topic, data) {
		if (topic == "domwindowopened") {
			subject.addEventListener("load", this, false);
		}
	},

	handleEvent: function(event) {
		switch (event.type) {
			case "load":
				this.loadHandler(event);
				break;
		}
	},
	loadHandler: function(event) {
		let window = event.originalTarget.defaultView;
		window.removeEventListener("load", this, false);
		this.initWindow(window, WINDOW_LOADED);
	},

	initWindow: function(window, reason) {
		if (reason == WINDOW_LOADED && !this.isTargetWindow(window)) {
			return;
		}
		let {gPluginHandler} = window;
		if (gPluginHandler &&
				gPluginHandler._overlayClickListener &&
				gPluginHandler._overlayClickListener.handleEvent &&
				gPluginHandler.canActivatePlugin &&
				gPluginHandler._getBindingType) {
			let CTPpe = new CTPpeChrome(window);
		} else {
			Cu.reportError(LOG_PREFIX + "startup error: gPluginHandler");
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
		let {document} = window;
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
		} else if (pName == "styles.hidePluginNotifications") {
			if (prefs.get("styles.enabled"))
				this.reloadStyles();
		} else if (pName == "debug") {
			_dbg = pVal;
		}
	},

	getMostRecentWindow: function() {
		let wm = Components.classes["@mozilla.org/appshell/window-mediator;1"]
						.getService(Components.interfaces.nsIWindowMediator);
		let window = wm.getMostRecentWindow("navigator:browser");
		return window;
	},

	checkPrefs: function() {
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
			"styles.enabled",
			"styles.useOldCSS",
			"styles.hidePluginNotifications",
			"debug"
		];
		for (let i in pNamesBooleans) {
			let color = prefs.get(pNamesBooleans[i]);
			if (typeof color != "boolean")
				prefs.reset(pNamesBooleans[i]);
		}
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
	setResetAfterPause: function(pName) {
		let window = this.getMostRecentWindow();
		this.resetAfterPauseWindow = window;
		this.resetAfterPauseTimeoutID = window.setTimeout(function() {
			this.resetAfterPause(pName);
		}.bind(this), 1500);
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

		let hidePluginNotifications = prefs.get("styles.hidePluginNotifications", false);
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
	}
};

function CTPpeChrome(window) {
	this.window = window;
	this.init();
}

CTPpeChrome.prototype = {
	window: null,

	init: function(event) {
		let {window} = this;
		let {gBrowser} = window;
		window.addEventListener("unload", this, false);
		gBrowser.addEventListener("PluginBindingAttached", this, true, true);
		Services.obs.addObserver(this, "uasad-ctppe", false);

		_dbg && console.log(LOG_PREFIX + "CTPpeChrome.init()");
	},
	destroy: function(event) {
		let {window} = this;
		let {gBrowser} = window;;
		window.removeEventListener("unload", this, false);
		gBrowser.removeEventListener("PluginBindingAttached", this, true, true);
		Services.obs.removeObserver(this, "uasad-ctppe", false);

		this.window = null;

		_dbg && console.log(LOG_PREFIX + "CTPpeChrome.destroy()");
	},
	shutdown: function() {
		this.destroy();

		_dbg && console.log(LOG_PREFIX + "CTPpeChrome.shutdown()");
	},

	observe: function(subject, topic, data) {
		if (topic != "uasad-ctppe")
			return;
		if (data == "shutdown")
			this.shutdown();
	},

	handleEvent: function(event) {
		switch (event.type) {
			case "unload":
				this.destroy(event);
				break;
			case "PluginBindingAttached":
				let {window} = this;
				window.setTimeout(function() {
					this.pluginBindingAttached(event);
				}.bind(this), 1);
				break;
		}
	},

	// fallback
	getPluginUI: function(plugin, doc) {
		return doc.getAnonymousElementByAttribute(plugin, "class", "mainBox") ||
				doc.getAnonymousElementByAttribute(plugin, "anonid", "main");
	},

	pluginBindingAttached: function(event) {
		let {window} = this;
		let {gPluginHandler} = window;
		let eventType = event.type;
		if (eventType == "PluginRemoved") {
			return;
		}
		let plugin = event.target;
		let doc = plugin.ownerDocument;
		if (!(plugin instanceof Ci.nsIObjectLoadingContent))
			return;
		if (eventType == "PluginBindingAttached") {
			// The plugin binding fires this event when it is created.
			// As an untrusted event, ensure that this object actually has a binding
			// and make sure we don't handle it twice
			let overlay = gPluginHandler.getPluginUI(plugin, "main") ||
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
		if (eventType == "PluginClickToPlay") {
			this._handleClickToPlayEvent(plugin);
		}

		_dbg && console.log(LOG_PREFIX + "CTPpeChrome.pluginBindingAttached()");
	},
	_handleClickToPlayEvent: function PH_handleClickToPlayEvent(aPlugin) {
		let {window} = this;
		let {gBrowser, gPluginHandler} = window;
		let doc = aPlugin.ownerDocument;
		let browser = gBrowser.getBrowserForDocument(doc.defaultView.top.document);
		let objLoadingContent = aPlugin.QueryInterface(Ci.nsIObjectLoadingContent);
		// guard against giving pluginHost.getPermissionStringForType a type
		// not associated with any known plugin
		if (!gPluginHandler.isKnownPlugin(objLoadingContent))
			return;
		let overlay = gPluginHandler.getPluginUI(aPlugin, "main") ||
							this.getPluginUI(aPlugin, doc);
		if (overlay) {
			this._overlayClickListener.CTPpe = this;
			overlay.addEventListener("click", this._overlayClickListener, true);
			if (windowsObserver.appVersion >= 27)
				overlay.removeEventListener("click", gPluginHandler._overlayClickListener, true);
		}

		_dbg && console.log(LOG_PREFIX + "CTPpeChrome._handleClickToPlayEvent()");
	},
	_overlayClickListener: {
		handleEvent: function PH_handleOverlayClick(aEvent) {
			let {CTPpe} = this;
			let {window} = CTPpe;
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
				aEvent.target.removeEventListener("click", CTPpe._overlayClickListener, true);
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
							let notification = PopupNotifications.getNotification("click-to-play-plugins", browser);
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

			_dbg && console.log(LOG_PREFIX + "CTPpeChrome._overlayClickListener()");
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
		let scope = {
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
		};
		Services.scriptloader.loadSubScript(prefsFile, scope);

		_dbg && console.log(LOG_PREFIX + "prefs.loadDefaultPrefs()");
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
	"defaultBackgroundColor": "rgb(142,142,142)",
	"defaultTextColor": "rgb(0,0,0)"
};

// Be careful, loggers always works until prefs aren't initialized
// (and if "debug" preference has default value)
let _dbg = true;
