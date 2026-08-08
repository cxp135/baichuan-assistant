const RUNTIME_BROWSER_PLATFORM = process.platform === 'darwin' ? {
  navigatorPlatform: 'MacIntel',
  uaPlatform: 'macOS',
  platformVersion: '14.0.0',
  architecture: process.arch === 'arm64' ? 'arm' : 'x86'
} : process.platform === 'linux' ? {
  navigatorPlatform: 'Linux x86_64',
  uaPlatform: 'Linux',
  platformVersion: '0.0.0',
  architecture: process.arch === 'arm64' ? 'arm' : 'x86'
} : {
  navigatorPlatform: 'Win32',
  uaPlatform: 'Windows',
  platformVersion: '15.0.0',
  architecture: 'x86'
};

function installBrowserCompatPatch() {
  try {
    const code = `
      (function () {
        try {
          var isGoogleAuth = /accounts\\.google\\.com$/i.test(location.hostname);
          var chromeVersion = (navigator.userAgent.match(/Chrome\\/([0-9.]+)/) || [])[1] || "142.0.7444.175";
          var chromeMajor = String(chromeVersion).split(".")[0] || "142";
          var defineGetter = function (target, name, value) {
            try {
              Object.defineProperty(target, name, {
                get: function () { return value; },
                configurable: true
              });
            } catch (e) {}
          };
          defineGetter(navigator, "webdriver", false);
          defineGetter(navigator, "languages", ["zh-CN", "zh", "en"]);
          defineGetter(navigator, "language", "zh-CN");
          defineGetter(navigator, "platform", ${JSON.stringify(RUNTIME_BROWSER_PLATFORM.navigatorPlatform)});
          defineGetter(navigator, "vendor", "Google Inc.");
          defineGetter(navigator, "maxTouchPoints", 0);
          if (!window.chrome) window.chrome = {};
          window.chrome.app = window.chrome.app || { isInstalled: false };
          window.chrome.csi = window.chrome.csi || function () { return {}; };
          window.chrome.loadTimes = window.chrome.loadTimes || function () { return {}; };
          window.chrome.runtime = window.chrome.runtime || {};
          try {
            Object.defineProperty(navigator, "userAgentData", {
              get: function () {
                return {
                  brands: [
                    { brand: "Google Chrome", version: chromeMajor },
                    { brand: "Chromium", version: chromeMajor },
                    { brand: "Not_A Brand", version: "99" }
                  ],
                  mobile: false,
                  platform: ${JSON.stringify(RUNTIME_BROWSER_PLATFORM.uaPlatform)},
                  getHighEntropyValues: function (hints) {
                    var values = {
                      brands: [
                        { brand: "Google Chrome", version: chromeMajor },
                        { brand: "Chromium", version: chromeMajor },
                        { brand: "Not_A Brand", version: "99" }
                      ],
                      fullVersionList: [
                        { brand: "Google Chrome", version: chromeVersion },
                        { brand: "Chromium", version: chromeVersion },
                        { brand: "Not_A Brand", version: "99.0.0.0" }
                      ],
                      mobile: false,
                      platform: ${JSON.stringify(RUNTIME_BROWSER_PLATFORM.uaPlatform)},
                      platformVersion: ${JSON.stringify(RUNTIME_BROWSER_PLATFORM.platformVersion)},
                      architecture: ${JSON.stringify(RUNTIME_BROWSER_PLATFORM.architecture)},
                      bitness: "64",
                      model: "",
                      uaFullVersion: chromeVersion,
                      wow64: false
                    };
                    var out = {};
                    (hints || []).forEach(function (hint) {
                      if (Object.prototype.hasOwnProperty.call(values, hint)) out[hint] = values[hint];
                    });
                    out.brands = values.brands;
                    out.mobile = values.mobile;
                    out.platform = values.platform;
                    return Promise.resolve(out);
                  },
                  toJSON: function () {
                    return { brands: this.brands, mobile: false, platform: ${JSON.stringify(RUNTIME_BROWSER_PLATFORM.uaPlatform)} };
                  }
                };
              },
              configurable: true
            });
          } catch (e) {}
          if (isGoogleAuth) {
            var makePasskeyBlockedError = function () {
              try {
                return new DOMException("Passkey disabled in this embedded login flow", "NotAllowedError");
              } catch (e) {
                var err = new Error("Passkey disabled in this embedded login flow");
                err.name = "NotAllowedError";
                return err;
              }
            };
            var wrapCredentialMethod = function (target, name) {
              if (!target || !target[name]) return;
              var original = target[name].bind(target);
              var wrapped = function (options) {
                if (options && options.publicKey) {
                  return Promise.reject(makePasskeyBlockedError());
                }
                return original(options);
              };
              try {
                Object.defineProperty(target, name, { value: wrapped, configurable: true, writable: true });
              } catch (e) {
                try { target[name] = wrapped; } catch (ignore) {}
              }
            };
            if (navigator.credentials) {
              wrapCredentialMethod(navigator.credentials, "get");
              wrapCredentialMethod(navigator.credentials, "create");
            }
            if (window.CredentialsContainer && window.CredentialsContainer.prototype) {
              wrapCredentialMethod(window.CredentialsContainer.prototype, "get");
              wrapCredentialMethod(window.CredentialsContainer.prototype, "create");
            }
            if (window.PublicKeyCredential) {
              try {
                Object.defineProperty(window.PublicKeyCredential, "isUserVerifyingPlatformAuthenticatorAvailable", {
                  value: function () { return Promise.resolve(false); },
                  configurable: true
                });
              } catch (e) {}
              try {
                Object.defineProperty(window.PublicKeyCredential, "isConditionalMediationAvailable", {
                  value: function () { return Promise.resolve(false); },
                  configurable: true
                });
              } catch (e) {}
            }
            window.__AIAM_BROWSER_COMPAT = "google-full-compat";
            return;
          }
          window.__AIAM_BROWSER_COMPAT = true;
        } catch (e) {}
      })();
    `;
    const script = document.createElement('script');
    script.textContent = code;
    (document.documentElement || document.head || document).appendChild(script);
    script.remove();
  } catch (e) {}
}

installBrowserCompatPatch();
