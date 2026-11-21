package com.lecturebag.app;
import android.app.*;
import android.content.*;
import android.os.Bundle;
/** Internal trampoline for Google's PendingIntent, never exported or deep-linked. */
public class AuthorizationActivity extends Activity {
    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        if (state != null) return;
        PendingIntent resolution = getIntent().getParcelableExtra("resolution");
        try { if (resolution == null) throw new IllegalArgumentException(); startIntentSenderForResult(resolution.getIntentSender(), 1, null, 0, 0, 0); }
        catch (Exception e) { setResult(RESULT_CANCELED); finish(); }
    }
    @Override protected void onActivityResult(int request, int result, Intent data) { super.onActivityResult(request, result, data); setResult(result, data); finish(); }
}
