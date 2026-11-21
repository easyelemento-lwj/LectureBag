package com.lecturebag.app;

import android.content.Intent;
import android.net.Uri;
import android.webkit.*;
import com.getcapacitor.*;
import com.google.firebase.auth.FirebaseAuth;
import java.io.*;
import java.util.Collections;

/** Never hand arbitrary local paths or remote top-level pages to the native bridge. */
final class SecureWebViewClient extends BridgeWebViewClient {
    private final Bridge bridge;
    SecureWebViewClient(Bridge bridge) { super(bridge); this.bridge = bridge; }
    static WebResourceResponse denied() {
        return new WebResourceResponse("text/plain", "UTF-8", 403, "Forbidden", Collections.emptyMap(), new ByteArrayInputStream(new byte[0]));
    }
    @Override public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
        Uri uri = request.getUrl(); String path = uri.getPath();
        if (path == null) return denied();
        if (path.startsWith(Bridge.CAPACITOR_CONTENT_START)) return denied();
        if (path.startsWith(Bridge.CAPACITOR_FILE_START)) {
            try {
                if (!"https".equals(uri.getScheme()) || !"localhost".equals(uri.getHost()) || (uri.getPort() != -1 && uri.getPort() != 443) || uri.getUserInfo() != null || request.isForMainFrame() ||
                    uri.getQuery() != null || uri.getFragment() != null || !"GET".equals(request.getMethod())) return denied();
                var user = FirebaseAuth.getInstance().getCurrentUser();
                if (user == null) return denied();
                File file = NativeSecurity.mediaFile(bridge.getContext().getFilesDir(), user.getUid(),
                    new File(path.substring(Bridge.CAPACITOR_FILE_START.length())));
                if (!file.isFile()) return denied();
                RecordingService service = RecordingService.active;
                if (service != null && service.belongs(user.getUid()) && file.getName().startsWith(service.state().getString("id"))) return denied();
                java.util.Map<String, String> headers = new java.util.HashMap<>();
                headers.put("Cache-Control", "no-store"); headers.put("X-Content-Type-Options", "nosniff");
                return new WebResourceResponse(file.getName().endsWith(".jpg") ? "image/jpeg" : "audio/mp4", null,
                    200, "OK", headers, new FileInputStream(file));
            } catch (Exception e) { return denied(); }
        }
        if ("file".equals(uri.getScheme()) || "content".equals(uri.getScheme())) return denied();
        return super.shouldInterceptRequest(view, request);
    }
    @Override public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
        if (!request.isForMainFrame()) return true;
        Uri uri = request.getUrl();
        if (NativeSecurity.bundledPage(uri.toString())) return false;
        // Native Google sign-in/Drive authorization never navigate this WebView.
        if ("https".equals(uri.getScheme()) && uri.getHost() != null && !"localhost".equals(uri.getHost()) && uri.getUserInfo() == null) {
            try { bridge.getActivity().startActivity(new Intent(Intent.ACTION_VIEW, uri).addCategory(Intent.CATEGORY_BROWSABLE)); }
            catch (Exception ignored) { }
        }
        return true;
    }
}
