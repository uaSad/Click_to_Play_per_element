/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. 
 * The Original Code is  mozilla.org code (Firefox 23)
 * The Initial Developer of the Original Code is mozilla.org.
*/

/*
 * Template - http://www.oxymoronical.com/blog/2011/01/Playing-with-windows-in-restartless-bootstrapped-extensions
*/

//'use strict';

const {classes: Cc, interfaces: Ci, utils: Cu } = Components;
Cu.import('resource://gre/modules/Services.jsm');

let WindowListener = {
  
  // based on Private Tab by Infocatcher
  // https://addons.mozilla.org/firefox/addon/private-tab
  _stylesLoaded: false,
  loadStyles: function() {
    if(this._stylesLoaded)
      return;
    this._stylesLoaded = true;
    let sss = this.sss;
    let cssURI = this.cssURI = this.makeCSSURI();
    if(!sss.sheetRegistered(cssURI, sss.USER_SHEET))
      sss.loadAndRegisterSheet(cssURI, sss.USER_SHEET);
  },
  unloadStyles: function() {
    if(!this._stylesLoaded)
      return;
    this._stylesLoaded = false;
    let sss = this.sss;
    if(sss.sheetRegistered(this.cssURI, sss.USER_SHEET))
      sss.unregisterSheet(this.cssURI, sss.USER_SHEET);
  },
  get sss() {
    delete this.sss;
    return this.sss = Components.classes["@mozilla.org/content/style-sheet-service;1"]
      .getService(Components.interfaces.nsIStyleSheetService);
  },
  makeCSSURI: function() {     
    return Services.io.newURI("chrome://clicktoplayperelement/content/lightweight.css", null, null);   
  },
  
  // based on ClickToPlay_per-element.js by Infocatcher
  // https://gist.github.com/Infocatcher/6117669
  handleEvent: function(aEvent) {
    if (this[aEvent.type])
      this[aEvent.type](aEvent);
  },
  unload: function(aEvent) {
    let window = aEvent.currentTarget;
    window.removeEventListener("click", this, true);
    window.removeEventListener(aEvent.type, this, false);
  },
  click: function(aEvent) {
    let window = aEvent.currentTarget;
    let document = window.document;
    let plugin = aEvent.target;
    let doc = plugin.ownerDocument; 
    
    if (doc.getAnonymousElementByAttribute(plugin, "class", "mainBox") &&
        plugin instanceof Ci.nsIObjectLoadingContent) {
      let eventType = window.gPluginHandler._getBindingType(plugin);
      if (!eventType)
        return;
      switch (eventType) {
        case "PluginVulnerableNoUpdate":
        case "PluginClickToPlay":
          this._overlayClickListener_HandleEvent(window, document, aEvent);
          break;
      }
    }
  },
  _overlayClickListener_HandleEvent: function(window, document, aEvent) {
    let plugin = document.getBindingParent(aEvent.originalTarget);
    //let pluginName = window.gPluginHandler._getPluginInfo(plugin).pluginName;
    //this._log("plugin: " + pluginName);
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
      //aEvent.target.removeEventListener("click", window.gPluginHandler._overlayClickListener, true);
      return;
    }
    let objLoadingContent = plugin.QueryInterface(Ci.nsIObjectLoadingContent);
    // Have to check that the target is not the link to update the plugin
    if (!(aEvent.originalTarget instanceof window.HTMLAnchorElement) &&
      (aEvent.originalTarget.getAttribute('anonid') != 'closeIcon') &&
      aEvent.button == 0 && aEvent.isTrusted) {
      if (objLoadingContent.pluginFallbackType ==
        Ci.nsIObjectLoadingContent.PLUGIN_VULNERABLE_UPDATABLE ||
        objLoadingContent.pluginFallbackType ==
        Ci.nsIObjectLoadingContent.PLUGIN_VULNERABLE_NO_UPDATE)
        window.gPluginHandler._showClickToPlayNotification(browser, true);
      else
        this.activateSinglePlugin(window, contentWindow, plugin);
      aEvent.stopPropagation();
      aEvent.preventDefault();
    }
  },
  activateSinglePlugin: function PH_activateSinglePlugin(window, aContentWindow, aPlugin) {
    //this._log("activateSinglePlugin()");
    let objLoadingContent = aPlugin.QueryInterface(Ci.nsIObjectLoadingContent);
    if (window.gPluginHandler.canActivatePlugin(objLoadingContent))
      objLoadingContent.playPlugin();

    let cwu = aContentWindow.QueryInterface(Ci.nsIInterfaceRequestor)
      .getInterface(Ci.nsIDOMWindowUtils);
    let pluginNeedsActivation = this._pluginNeedsActivationExceptThese(window, [aPlugin]);
    let browser = window.gBrowser.getBrowserForDocument(aContentWindow.document);
    let notification = window.PopupNotifications.getNotification("click-to-play-plugins", browser);
    if (notification) {
      notification.remove();
    }
    if (pluginNeedsActivation) {
      window.gPluginHandler._showClickToPlayNotification(browser);
    }
  },
  _pluginNeedsActivationExceptThese: function PH_pluginNeedsActivationExceptThese(window, aExceptThese) {
    let contentWindow = window.gBrowser.selectedBrowser.contentWindow;
    let cwu = contentWindow.QueryInterface(Ci.nsIInterfaceRequestor)
      .getInterface(Ci.nsIDOMWindowUtils);
    let pluginNeedsActivation = cwu.plugins.some(function (plugin) {
        let objLoadingContent = plugin.QueryInterface(Ci.nsIObjectLoadingContent);
        return (window.gPluginHandler.canActivatePlugin(objLoadingContent) &&
          aExceptThese.indexOf(plugin) < 0);
      });

    return pluginNeedsActivation;
  },
  
  _log: function(s) {
    let date = new Date();
    let curDate = date.getFullYear() + "-" 
                  + (date.getMonth() + 1) + "-" 
                  + date.getDate() + " "
                  + date.getHours() + ":"
                  + date.getMinutes() + ":"
                  + date.getSeconds() + ":"
                  + date.getMilliseconds();
    Services.console.logStringMessage("[CtPpe] " + curDate + "\n" + s);
  },
  
  setupBrowserUI : function (window) {
    //let document = window.document;
    
    if (parseFloat(Services.appinfo.platformVersion) >= 24 &&
        window.gPluginHandler &&
        window.gPluginHandler._overlayClickListener &&
        window.gPluginHandler._overlayClickListener.handleEvent &&
        window.gPluginHandler.canActivatePlugin &&
        window.gPluginHandler._showClickToPlayNotification &&
        window.gPluginHandler._getBindingType &&       
        !window.gPluginHandler.activateSinglePlugin &&
        !window.gPluginHandler._pluginNeedsActivationExceptThese) {
      window.addEventListener("click", this, true);
      window.addEventListener("unload", this, false);
      this.loadStyles();     
    } else {
      this._log('startup error');
    }
    
    // Take any steps to add UI or anything to the browser window
    // document.getElementById() etc. will work here
  },

  tearDownBrowserUI: function (window) {
    //let document = window.document;
    
    if (parseFloat(Services.appinfo.platformVersion) >= 24) {
      window.removeEventListener("click", this, true);
      window.removeEventListener("unload", this, false);
      this.unloadStyles();
    } else {
      this._log('shutdown error');
    }
    
    // Take any steps to remove UI or anything from the browser window
    // document.getElementById() etc. will work here
  },

// nsIWindowMediatorListener functions
  onOpenWindow : function (xulWindow) {
    // A new window has opened
    let domWindow = xulWindow.QueryInterface(Ci.nsIInterfaceRequestor)
      .getInterface(Ci.nsIDOMWindow);

    // Wait for it to finish loading
    domWindow.addEventListener("load", function listener() {
      domWindow.removeEventListener("load", listener, false);

      // If this is a browser window then setup its UI
      if (domWindow.document.documentElement.getAttribute("windowtype") == "navigator:browser")
        WindowListener.setupBrowserUI(domWindow);
    }, false);
  },

  onCloseWindow : function (xulWindow) {},

  onWindowTitleChange : function (xulWindow, newTitle) {}
};

function startup(data, reason) {
  let wm = Cc["@mozilla.org/appshell/window-mediator;1"].
    getService(Ci.nsIWindowMediator);

  // Get the list of browser windows already open
  let windows = wm.getEnumerator("navigator:browser");
  while (windows.hasMoreElements()) {
    let domWindow = windows.getNext().QueryInterface(Ci.nsIDOMWindow);

    WindowListener.setupBrowserUI(domWindow);
  }

  // Wait for any new browser windows to open
  wm.addListener(WindowListener);
}

function shutdown(data, reason) {
  // When the application is shutting down we normally don't have to clean
  // up any UI changes made
  if (reason == APP_SHUTDOWN)
    return;

  let wm = Cc["@mozilla.org/appshell/window-mediator;1"].
    getService(Ci.nsIWindowMediator);

  // Get the list of browser windows already open
  let windows = wm.getEnumerator("navigator:browser");
  while (windows.hasMoreElements()) {
    let domWindow = windows.getNext().QueryInterface(Ci.nsIDOMWindow);

    WindowListener.tearDownBrowserUI(domWindow);
  }

  // Stop listening for any new browser windows to open
  wm.removeListener(WindowListener);
}

function install(data, reason) {}
function uninstall(data, reason) {}
