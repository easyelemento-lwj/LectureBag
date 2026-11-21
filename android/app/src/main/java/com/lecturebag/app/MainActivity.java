package com.lecturebag.app;
import android.os.Bundle;
import com.getcapacitor.BridgeActivity;
public class MainActivity extends BridgeActivity {
    private void clearLaunchPayload(android.content.Intent intent) {
        // Capacitor/Cordova copies Activity extras into runtime preferences.
        // Our launcher accepts no external settings, URLs, or file grants.
        if (intent == null) return;
        intent.replaceExtras((Bundle) null); intent.setData(null); intent.setClipData(null);
    }
    @Override public void onCreate(Bundle state) {
        clearLaunchPayload(getIntent());
        registerPlugin(LectureBagPlugin.class);
        registerPlugin(RestrictedBridgePlugins.Assets.class);
        registerPlugin(RestrictedBridgePlugins.Http.class);
        registerPlugin(RestrictedBridgePlugins.Cookies.class);
        super.onCreate(state);
        var webView = getBridge().getWebView();
        webView.setBackgroundColor(android.graphics.Color.TRANSPARENT);
        var settings = webView.getSettings();
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(false);
        settings.setAllowFileAccessFromFileURLs(false);
        settings.setAllowUniversalAccessFromFileURLs(false);
        settings.setMixedContentMode(android.webkit.WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        settings.setGeolocationEnabled(false);
        settings.setJavaScriptCanOpenWindowsAutomatically(false);
        android.webkit.WebView.setWebContentsDebuggingEnabled(false);
        getBridge().setWebViewClient(new SecureWebViewClient(getBridge()));
        webView.setWebChromeClient(new com.getcapacitor.BridgeWebChromeClient(getBridge()) {
            @Override public void onPermissionRequest(android.webkit.PermissionRequest request) {
                // Camera/microphone are owned by the authenticated native plugin.
                request.deny();
            }
        });
        var workers = android.webkit.ServiceWorkerController.getInstance();
        workers.getServiceWorkerWebSettings().setAllowFileAccess(false);
        workers.getServiceWorkerWebSettings().setAllowContentAccess(false);
        workers.getServiceWorkerWebSettings().setBlockNetworkLoads(true);
        workers.setServiceWorkerClient(new android.webkit.ServiceWorkerClient() {
            @Override public android.webkit.WebResourceResponse shouldInterceptRequest(android.webkit.WebResourceRequest request) {
                return SecureWebViewClient.denied();
            }
        });
        // The legacy JavascriptInterface exposes all frames. Require the modern,
        // main-frame/origin-restricted bridge instead of silently falling back.
        webView.removeJavascriptInterface("androidBridge");
        webView.removeJavascriptInterface("CapacitorHttpAndroidInterface");
        webView.removeJavascriptInterface("CapacitorCookiesAndroidInterface");
        if (!androidx.webkit.WebViewFeature.isFeatureSupported(androidx.webkit.WebViewFeature.WEB_MESSAGE_LISTENER)) {
            settings.setJavaScriptEnabled(false);
            new androidx.appcompat.app.AlertDialog.Builder(this).setMessage("Android System WebView를 업데이트한 뒤 다시 실행해 주세요.")
                .setPositiveButton("닫기", (dialog, which) -> finish()).setCancelable(false).show();
        }
    }
    @Override protected void onNewIntent(android.content.Intent intent) {
        clearLaunchPayload(intent);
        super.onNewIntent(intent);
    }
}
