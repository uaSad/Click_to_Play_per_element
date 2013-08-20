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

const{classes:Cc,interfaces:Ci,utils:Cu}=Components;
Cu.import('resource://gre/modules/Services.jsm');


let WindowListener = {
  
  // based on Private Tab by Infocatcher
  // https://addons.mozilla.org/firefox/addon/private-tab
  _stylesLoaded: false,
  loadStyles: function(window) {
    if(this._stylesLoaded)
      return;
    this._stylesLoaded = true;
    let sss = this.sss;
    let cssURI = this.cssURI = this.makeCSSURI(window);
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
  makeCSSURI: function(window) {     
    return Services.io.newURI("chrome://clicktoplayperelement/content/lightweight.css", null, null);   
  },
  
  // based on ClickToPlay_per-element.js by Infocatcheron 
  // https://gist.github.com/Infocatcher/6117669
  handleEvent: function(aEvent) {
    let trg = aEvent.originalTarget;
    if( // I don't know, how do better checks here :(
      trg.className != "hoverBox"
      || String.toLowerCase(trg.localName) != "div"
      || !trg.parentNode
      || trg.parentNode.className != "mainBox"
      //|| String.toLowerCase(aEvent.target.localName) != "embed"
      || !(aEvent.target instanceof Ci.nsIObjectLoadingContent)
    )
      return;

    let window = aEvent.currentTarget;
    let document = window.document;

    let plugin = document.getBindingParent(trg);
    //Services.console.logStringMessage("plugin: " + plugin);
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
    //Services.console.logStringMessage("activateSinglePlugin()");
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
  
  setupBrowserUI : function (window) {
    let document = window.document;
    
    if (parseFloat(Services.appinfo.platformVersion) >= 24 &&
      window.gPluginHandler &&
      window.gPluginHandler._overlayClickListener &&
      window.gPluginHandler._overlayClickListener.handleEvent &&
      !window.gPluginHandler.activateSinglePlugin &&
      !window.gPluginHandler._pluginNeedsActivationExceptThese) {
     window.addEventListener("click", WindowListener, true);     
    } else {
      Services.console.logStringMessage('CtPpe: startup error');
    }

    this.loadStyles(window);
    // Take any steps to add UI or anything to the browser window
    // document.getElementById() etc. will work here
  },

  tearDownBrowserUI : function (window) {
    let document = window.document;

    if (parseFloat(Services.appinfo.platformVersion) >= 24) {
      window.removeEventListener("click", WindowListener, true);
    } else {
      Services.console.logStringMessage('CtPpe: shutdown error');
    }
    
    this.unloadStyles(window);
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