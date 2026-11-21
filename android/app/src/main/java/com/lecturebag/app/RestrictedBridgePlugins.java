package com.lecturebag.app;

import com.getcapacitor.Plugin;
import com.getcapacitor.annotation.CapacitorPlugin;

/** This app uses bundled assets and browser fetch only. Do not expose unused
 * native APIs that can replace the asset root or bypass browser network policy. */
public final class RestrictedBridgePlugins {
    @CapacitorPlugin(name = "WebView")
    public static class Assets extends Plugin { }
    @CapacitorPlugin(name = "CapacitorHttp")
    public static class Http extends Plugin { }
    @CapacitorPlugin(name = "CapacitorCookies")
    public static class Cookies extends Plugin { }
}
