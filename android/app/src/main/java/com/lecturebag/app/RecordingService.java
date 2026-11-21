package com.lecturebag.app;

import android.app.*;
import android.content.*;
import android.content.pm.ServiceInfo;
import android.media.MediaMetadataRetriever;
import android.media.MediaRecorder;
import android.media.AudioManager;
import android.media.AudioRecordingConfiguration;
import android.os.*;
import android.util.AtomicFile;
import androidx.core.app.NotificationCompat;
import java.io.*;
import java.nio.charset.StandardCharsets;
import com.google.firebase.auth.FirebaseAuth;
import org.json.*;

/** Owns the microphone independently of the Activity/WebView. Never auto-starts. */
public final class RecordingService extends Service {
    static volatile RecordingService active;
    static final String CHANNEL = "lecturebag_recording";
    private MediaRecorder recorder;
    private AudioManager.AudioRecordingCallback audioChanges;
    private JSONObject session;
    private File directory;
    private long elapsed, runningSince;
    private boolean paused;
    private PowerManager.WakeLock wakeLock;
    private final Handler handler = new Handler(Looper.getMainLooper());
    private final Runnable checkpoint = new Runnable() { public void run() {
        if (recorder == null) return;
        try { if (!paused) wakeLock.acquire(600_000L); save("recording"); } catch (Exception e) { finish("녹음 상태를 저장하지 못했습니다."); }
        handler.postDelayed(this, 5000);
    }};

    static File directory(Context context, String uid) throws Exception {
        File folder = new File(context.getFilesDir(), "recordings/" + NativeSecurity.ownerHash(uid));
        if (!folder.isDirectory() && !folder.mkdirs()) throw new IOException("저장 공간을 확인해 주세요.");
        return folder;
    }
    static void validId(String id) throws IOException {
        NativeSecurity.validId(id);
    }
    static JSONObject read(File file) throws Exception {
        try (FileInputStream in = new AtomicFile(file).openRead()) {
            ByteArrayOutputStream bytes = new ByteArrayOutputStream(); byte[] buffer = new byte[4096]; int size;
            while ((size = in.read(buffer)) != -1) {
                if (bytes.size() + size > 65536) throw new IOException("기록 크기 제한 초과");
                bytes.write(buffer, 0, size);
            }
            return new JSONObject(bytes.toString("UTF-8"));
        }
    }
    private long duration() { return elapsed + (recorder != null && !paused ? SystemClock.elapsedRealtime() - runningSince : 0); }
    JSONObject state() throws Exception {
        JSONObject result = new JSONObject(session.toString());
        result.put("elapsedMs", duration()).put("state", paused ? "paused" : "recording");
        return result;
    }
    boolean belongs(String uid) { return session != null && uid.equals(session.optString("uid")); }
    private void save(String state) throws Exception {
        session.put("elapsedMs", duration()).put("state", state);
        AtomicFile file = new AtomicFile(new File(directory, session.getString("id") + ".json"));
        FileOutputStream out = file.startWrite();
        try { out.write(session.toString().getBytes(StandardCharsets.UTF_8)); file.finishWrite(out); }
        catch (Exception e) { file.failWrite(out); throw e; }
    }
    @Override public void onCreate() {
        super.onCreate(); active = this;
        if (Build.VERSION.SDK_INT >= 26) getSystemService(NotificationManager.class).createNotificationChannel(
            new NotificationChannel(CHANNEL, "녹음", NotificationManager.IMPORTANCE_LOW));
        wakeLock = ((PowerManager)getSystemService(POWER_SERVICE)).newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "LectureBag:recording");
        wakeLock.setReferenceCounted(false);
    }
    private Notification notification() {
        PendingIntent open = PendingIntent.getActivity(this, 0, new Intent(this, MainActivity.class), PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
        PendingIntent stop = PendingIntent.getService(this, 1, new Intent(this, RecordingService.class).setAction("stop"), PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
        PendingIntent toggle = PendingIntent.getService(this, 2, new Intent(this, RecordingService.class).setAction("pause"), PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
        return new NotificationCompat.Builder(this, CHANNEL).setSmallIcon(android.R.drawable.ic_btn_speak_now)
            .setContentTitle(paused ? "녹음 일시정지" : "LectureBag 녹음 중")
            .setContentText("화면을 잠가도 녹음이 계속됩니다.").setContentIntent(open).setOngoing(true)
            .addAction(0, paused ? "계속 녹음" : "일시정지", toggle).addAction(0, "저장 후 종료", stop).build();
    }
    @Override public int onStartCommand(Intent intent, int flags, int startId) {
        if (intent == null) { stopSelf(); return START_NOT_STICKY; }
        if ("stop".equals(intent.getAction())) { finish(null); return START_NOT_STICKY; }
        if ("pause".equals(intent.getAction())) { try { toggle(); } catch (Exception e) { finish("녹음 제어 중 오류가 발생했습니다."); } return START_NOT_STICKY; }
        if (recorder != null) return START_NOT_STICKY;
        try {
            String raw = intent.getStringExtra("session");
            if (raw == null || raw.length() > 16384) throw new IOException("잘못된 녹음 요청");
            JSONObject candidate = new JSONObject(raw);
            var user = FirebaseAuth.getInstance().getCurrentUser();
            if (user == null || !NativeSecurity.sameOwner(user.getUid(), candidate.optString("uid"))) throw new IOException("로그인이 필요합니다.");
            validId(candidate.getString("id"));
            File target = directory(this, user.getUid());
            // Validate before assigning session: failure cleanup must not overwrite
            // an earlier recording's journal or touch its audio.
            NativeSecurity.requireUnused(target, candidate.getString("id"), ".m4a");
            File output = new File(target, candidate.getString("id") + ".m4a");
            session = candidate; directory = target;
            session.put("uri", android.net.Uri.fromFile(output).toString());
            elapsed = 0; paused = true; save("starting");
            if (Build.VERSION.SDK_INT >= 30) startForeground(41, notification(), ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE);
            else startForeground(41, notification());
            recorder = Build.VERSION.SDK_INT >= 31 ? new MediaRecorder(this) : new MediaRecorder();
            recorder.setAudioSource(MediaRecorder.AudioSource.MIC);
            recorder.setOutputFormat(MediaRecorder.OutputFormat.MPEG_4);
            recorder.setAudioEncoder(MediaRecorder.AudioEncoder.AAC);
            recorder.setAudioEncodingBitRate(96000); recorder.setAudioSamplingRate(44100);
            recorder.setOutputFile(output.getAbsolutePath());
            recorder.setOnErrorListener((r, what, extra) -> finish("마이크 또는 저장 장치 오류로 녹음이 중단되었습니다."));
            if (Build.VERSION.SDK_INT >= 29) {
                audioChanges = new AudioManager.AudioRecordingCallback() {
                    @Override public void onRecordingConfigChanged(java.util.List<AudioRecordingConfiguration> configs) {
                        if (recorder == null || paused) return;
                        for (AudioRecordingConfiguration config : configs) if (config.isClientSilenced()) {
                            finish("전화 또는 다른 앱의 마이크 사용으로 녹음이 중단되었습니다."); return;
                        }
                    }
                };
                recorder.registerAudioRecordingCallback(getMainExecutor(), audioChanges);
            }
            recorder.prepare(); recorder.start(); runningSince = SystemClock.elapsedRealtime(); paused = false;
            wakeLock.acquire(600_000L); save("recording"); handler.postDelayed(checkpoint, 5000);
        } catch (Exception e) { finish("녹음을 시작하지 못했습니다. 마이크 권한과 저장 공간을 확인해 주세요."); }
        return START_NOT_STICKY;
    }
    void toggle() throws Exception {
        if (recorder == null) throw new IOException("진행 중인 녹음이 없습니다.");
        if (paused) { recorder.resume(); runningSince = SystemClock.elapsedRealtime(); paused = false; wakeLock.acquire(600_000L); }
        else { recorder.pause(); elapsed = duration(); paused = true; if (wakeLock.isHeld()) wakeLock.release(); }
        save("recording"); getSystemService(NotificationManager.class).notify(41, notification());
    }
    void finish(String warning) {
        handler.removeCallbacks(checkpoint);
        elapsed = duration(); paused = true;
        if (recorder != null) {
            if (Build.VERSION.SDK_INT >= 29 && audioChanges != null) {
                try { recorder.unregisterAudioRecordingCallback(audioChanges); } catch (Exception ignored) { }
                audioChanges = null;
            }
            try { recorder.stop(); } catch (Exception e) { warning = "녹음 파일 마무리에 실패했습니다. 원본 확인이 필요합니다."; }
            try { recorder.release(); } catch (Exception ignored) { }
            recorder = null;
        }
        if (wakeLock != null && wakeLock.isHeld()) wakeLock.release();
        if (session != null && directory != null) {
            try {
                if (warning != null) session.put("warning", warning);
                MediaMetadataRetriever meta = new MediaMetadataRetriever();
                try {
                    meta.setDataSource(new File(directory, session.getString("id") + ".m4a").getAbsolutePath());
                    session.put("mediaDurationMs", Long.parseLong(meta.extractMetadata(MediaMetadataRetriever.METADATA_KEY_DURATION)));
                } catch (Exception e) { session.put("warning", "녹음 파일의 재생 길이를 확인하지 못했습니다. 원본은 보존됩니다."); }
                finally { meta.release(); }
                save("finished");
            } catch (Exception ignored) { /* The original and earlier journal remain on disk. */ }
        }
        session = null; active = null; stopForeground(STOP_FOREGROUND_REMOVE); stopSelf();
    }
    @Override public void onTaskRemoved(Intent intent) { finish(null); }
    @Override public void onDestroy() { if (recorder != null) finish("앱 서비스가 종료되어 녹음을 마무리했습니다."); if (active == this) active = null; super.onDestroy(); }
    @Override public IBinder onBind(Intent intent) { return null; }
}
