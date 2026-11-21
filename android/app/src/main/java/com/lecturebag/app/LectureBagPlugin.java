package com.lecturebag.app;

import android.Manifest;
import android.content.Intent;
import android.graphics.BitmapFactory;
import android.os.*;
import android.view.*;
import android.widget.FrameLayout;
import android.util.Rational;
import androidx.activity.result.ActivityResult;
import androidx.camera.core.*;
import androidx.camera.lifecycle.ProcessCameraProvider;
import androidx.camera.view.PreviewView;
import androidx.core.content.ContextCompat;
import androidx.credentials.*;
import androidx.credentials.exceptions.GetCredentialException;
import androidx.credentials.exceptions.NoCredentialException;
import androidx.exifinterface.media.ExifInterface;
import com.google.android.libraries.identity.googleid.*;
import com.google.android.gms.auth.api.identity.*;
import com.google.android.gms.common.api.Scope;
import com.google.firebase.auth.FirebaseAuth;
import com.google.firebase.auth.GoogleAuthProvider;
import com.getcapacitor.*;
import com.getcapacitor.annotation.*;
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.util.*;
import org.json.*;

@CapacitorPlugin(name = "LectureBag", permissions = {
    @Permission(alias = "camera", strings = {Manifest.permission.CAMERA}),
    @Permission(alias = "microphone", strings = {Manifest.permission.RECORD_AUDIO}),
    @Permission(alias = "notifications", strings = {Manifest.permission.POST_NOTIFICATIONS})
})
public class LectureBagPlugin extends Plugin {
    private PreviewView preview;
    private ProcessCameraProvider provider;
    private ImageCapture capture;
    private long cameraGeneration;
    private boolean takingPhoto;
    private boolean cameraWanted;
    private PluginCall authorizing;
    private long authorizationGeneration;
    private boolean signingIn;
    private long accountGeneration;
    private boolean trusted(PluginCall call) {
        if (NativeSecurity.bundledPage(getBridge().getWebView().getUrl())) return true;
        call.reject("앱 내부 화면에서만 사용할 수 있습니다."); return false;
    }
    private String owner(PluginCall call) throws IOException {
        var user = FirebaseAuth.getInstance().getCurrentUser();
        if (user == null || !NativeSecurity.sameOwner(user.getUid(), call.getString("uid"))) throw new IOException("로그인 계정이 일치하지 않습니다.");
        return user.getUid();
    }
    private String clientId(PluginCall call) throws IOException {
        String expected = getContext().getString(R.string.lecturebag_drive_web_client_id);
        if (!expected.equals(call.getString("clientId"))) throw new IOException("등록된 Google 클라이언트가 아닙니다.");
        return expected;
    }
    @PluginMethod public void account(PluginCall call) { main(() -> {
        if (!trusted(call)) return;
        var user = FirebaseAuth.getInstance().getCurrentUser();
        call.resolve(new JSObject().put("uid", user == null ? JSONObject.NULL : user.getUid()));
    }); }
    @PluginMethod public void logout(PluginCall call) { main(() -> {
        if (!trusted(call)) return;
        ++accountGeneration; cameraWanted = false; ++cameraGeneration;
        try { if (RecordingService.active != null) RecordingService.active.finish(null); }
        catch (Exception ignored) { /* Account cleanup must still complete. */ }
        finally {
            FirebaseAuth.getInstance().signOut();
            if (provider != null) provider.unbindAll(); capture = null;
            if (preview != null) preview.setVisibility(View.GONE);
            call.resolve();
        }
    }); }
    private static JSObject json(JSONObject value) throws JSONException { return new JSObject(value.toString()); }
    private static void writeMetadata(File file, JSONObject value) throws Exception {
        android.util.AtomicFile atomic = new android.util.AtomicFile(file);
        FileOutputStream out = atomic.startWrite();
        try { out.write(value.toString().getBytes(StandardCharsets.UTF_8)); atomic.finishWrite(out); }
        catch (Exception e) { atomic.failWrite(out); throw e; }
    }
    private static void photoDimensions(File file, JSONObject metadata) throws Exception {
        BitmapFactory.Options bounds = new BitmapFactory.Options(); bounds.inJustDecodeBounds = true;
        BitmapFactory.decodeFile(file.getAbsolutePath(), bounds);
        if (bounds.outWidth <= 0 || bounds.outHeight <= 0) throw new IOException("사진이 완성되지 않았습니다.");
        int rotation = new ExifInterface(file).getRotationDegrees();
        metadata.put("width", rotation % 180 == 0 ? bounds.outWidth : bounds.outHeight);
        metadata.put("height", rotation % 180 == 0 ? bounds.outHeight : bounds.outWidth);
    }
    private void main(Runnable action) { getActivity().runOnUiThread(action); }
    private boolean permitted(PluginCall call, String permission, String callback) {
        if (getPermissionState(permission) == PermissionState.GRANTED) return true;
        requestPermissionForAlias(permission, call, callback); return false;
    }
    @PluginMethod public void cameraStart(PluginCall call) {
        main(() -> { if (!trusted(call)) return; if (FirebaseAuth.getInstance().getCurrentUser() == null) { call.reject("로그인이 필요합니다."); return; } cameraWanted = true; if (permitted(call, "camera", "cameraPermission")) configureCamera(call); });
    }
    @PermissionCallback private void cameraPermission(PluginCall call) {
        if (getPermissionState("camera") != PermissionState.GRANTED) { call.reject("카메라 권한을 허용해 주세요."); return; }
        main(() -> configureCamera(call));
    }
    private void configureCamera(PluginCall call) {
        if (!trusted(call)) return;
        if (FirebaseAuth.getInstance().getCurrentUser() == null) { call.reject("로그인이 필요합니다."); return; }
        if (!cameraWanted) { call.reject("카메라 화면이 닫혔습니다."); return; }
        if (takingPhoto) { call.reject("사진 저장 중입니다."); return; }
        final long generation = ++cameraGeneration;
        var future = ProcessCameraProvider.getInstance(getContext());
        future.addListener(() -> {
            if (generation != cameraGeneration) { call.reject("카메라 화면이 변경되었습니다."); return; }
            try {
                provider = future.get(); provider.unbindAll();
                if (preview == null) {
                    preview = new PreviewView(getContext());
                    preview.setImplementationMode(PreviewView.ImplementationMode.COMPATIBLE);
                    ((ViewGroup)getBridge().getWebView().getParent()).addView(preview, 0);
                }
                float scale = getBridge().getWebView().getWidth() / Math.max(1f, call.getFloat("viewportWidth", 1f));
                int width = Math.max(1, Math.round(call.getFloat("width", 1f) * scale));
                int height = Math.max(1, Math.round(call.getFloat("height", 1f) * scale));
                ViewGroup.LayoutParams params = preview.getLayoutParams(); params.width = width; params.height = height; preview.setLayoutParams(params);
                preview.setX(call.getFloat("x", 0f) * scale); preview.setY(call.getFloat("y", 0f) * scale);
                preview.setVisibility(View.VISIBLE);
                int rotation = getActivity().getWindowManager().getDefaultDisplay().getRotation();
                Preview cameraPreview = new Preview.Builder().setTargetRotation(rotation).build();
                cameraPreview.setSurfaceProvider(preview.getSurfaceProvider());
                capture = new ImageCapture.Builder().setCaptureMode(ImageCapture.CAPTURE_MODE_MAXIMIZE_QUALITY)
                    .setJpegQuality(95).setTargetRotation(rotation).build();
                String flash = call.getString("flash", "off");
                capture.setFlashMode("on".equals(flash) ? ImageCapture.FLASH_MODE_ON : "auto".equals(flash) ? ImageCapture.FLASH_MODE_AUTO : ImageCapture.FLASH_MODE_OFF);
                var group = new UseCaseGroup.Builder().addUseCase(cameraPreview).addUseCase(capture)
                    .setViewPort(new ViewPort.Builder(new Rational(width, height), rotation).setScaleType(ViewPort.FILL_CENTER).build()).build();
                provider.bindToLifecycle(getActivity(), "front".equals(call.getString("facing")) ? CameraSelector.DEFAULT_FRONT_CAMERA : CameraSelector.DEFAULT_BACK_CAMERA, group);
                call.resolve();
            } catch (Exception e) { call.reject("카메라를 준비하지 못했습니다."); }
        }, ContextCompat.getMainExecutor(getContext()));
    }
    @PluginMethod public void cameraStop(PluginCall call) { main(() -> {
        if (!trusted(call)) return;
        cameraWanted = false;
        ++cameraGeneration;
        if (!takingPhoto) { if (provider != null) provider.unbindAll(); capture = null; }
        if (preview != null) preview.setVisibility(View.GONE);
        call.resolve();
    }); }
    @PluginMethod public void photo(PluginCall call) { main(() -> {
        if (!trusted(call)) return;
        if (capture == null || takingPhoto) { call.reject("카메라 준비 또는 사진 저장 중입니다."); return; }
        try {
            String uid = owner(call), id = call.getString("id"); RecordingService.validId(id);
            File directory = new File(RecordingService.directory(getContext(), uid), "photos");
            if (!directory.isDirectory() && !directory.mkdirs()) throw new IOException();
            NativeSecurity.requireUnused(directory, id, ".jpg");
            File file = new File(directory, id + ".jpg");
            if (call.getData().toString().length() > 16384) throw new IOException();
            JSONObject metadata = new JSONObject(call.getData().toString());
            metadata.put("uri", android.net.Uri.fromFile(file).toString());
            // Persist ownership/intent before invoking the camera. A process
            // death after the JPEG is written must not orphan a successful photo.
            writeMetadata(new File(directory, id + ".json"), metadata);
            takingPhoto = true;
            capture.takePicture(new ImageCapture.OutputFileOptions.Builder(file).build(), ContextCompat.getMainExecutor(getContext()), new ImageCapture.OnImageSavedCallback() {
                @Override public void onImageSaved(ImageCapture.OutputFileResults result) {
                    try {
                        photoDimensions(file, metadata);
                        writeMetadata(new File(directory, id + ".json"), metadata);
                        call.resolve(json(metadata));
                    } catch (Exception e) { call.reject("촬영 원본은 보존했지만 목록 등록에 실패했습니다."); }
                    finally { takingPhoto = false; if (!cameraWanted && provider != null) { provider.unbindAll(); capture = null; } }
                }
                @Override public void onError(ImageCaptureException error) { takingPhoto = false; if (!cameraWanted && provider != null) { provider.unbindAll(); capture = null; } call.reject("사진 촬영에 실패했습니다."); }
            });
        } catch (Exception e) { call.reject("사진 저장 공간을 확인해 주세요."); }
    }); }
    @PluginMethod public void recordingStart(PluginCall call) { main(() -> {
        if (!trusted(call)) return;
        try { owner(call); } catch (Exception e) { call.reject("로그인이 필요합니다."); return; }
        if (RecordingService.active != null) { call.reject("이미 진행 중인 녹음이 있습니다."); return; }
        if (permitted(call, "microphone", "microphonePermission")) requestNotification(call);
    }); }
    @PermissionCallback private void microphonePermission(PluginCall call) {
        if (getPermissionState("microphone") != PermissionState.GRANTED) { call.reject("마이크 권한을 허용해 주세요."); return; }
        main(() -> requestNotification(call));
    }
    private void requestNotification(PluginCall call) {
        if (Build.VERSION.SDK_INT >= 33 && getPermissionState("notifications") != PermissionState.GRANTED) requestPermissionForAlias("notifications", call, "notificationPermission");
        else beginRecording(call);
    }
    @PermissionCallback private void notificationPermission(PluginCall call) { main(() -> beginRecording(call)); }
    private void beginRecording(PluginCall call) {
        if (!trusted(call)) return;
        try {
            owner(call);
            if (RecordingService.active != null) throw new IOException();
            RecordingService.validId(call.getString("id")); RecordingService.directory(getContext(), call.getString("uid"));
            Intent intent = new Intent(getContext(), RecordingService.class).putExtra("session", call.getData().toString());
            ContextCompat.startForegroundService(getContext(), intent);
            Handler handler = new Handler(Looper.getMainLooper());
            handler.postDelayed(new Runnable() { int attempts;
                public void run() {
                    try {
                        RecordingService service = RecordingService.active;
                        if (service != null && service.belongs(call.getString("uid"))) { call.resolve(json(service.state())); return; }
                        if (++attempts < 50) { handler.postDelayed(this, 100); return; }
                    } catch (Exception ignored) { }
                    call.reject("녹음을 시작하지 못했습니다.");
                }
            }, 100);
        } catch (Exception e) { call.reject("녹음을 시작하지 못했습니다."); }
    }
    @PluginMethod public void recordingPause(PluginCall call) { main(() -> {
        if (!trusted(call)) return;
        try { ownedRecording(call).toggle(); call.resolve(json(ownedRecording(call).state())); }
        catch (Exception e) { call.reject("녹음을 일시정지하거나 재개하지 못했습니다."); }
    }); }
    private RecordingService ownedRecording(PluginCall call) throws IOException {
        owner(call);
        RecordingService service = RecordingService.active;
        if (service == null || !service.belongs(call.getString("uid"))) throw new IOException();
        return service;
    }
    @PluginMethod public void recordingStop(PluginCall call) { main(() -> {
        if (!trusted(call)) return;
        try { ownedRecording(call).finish(null); call.resolve(); }
        catch (Exception e) { call.reject("진행 중인 녹음을 확인하지 못했습니다."); }
    }); }
    @PluginMethod public void status(PluginCall call) { main(() -> {
        if (!trusted(call)) return;
        try {
            String uid = owner(call); File directory = RecordingService.directory(getContext(), uid);
            RecordingService service = RecordingService.active;
            JSObject result = new JSObject(); String activeId = "";
            if (service != null && service.belongs(uid)) { JSObject state = json(service.state()); result.put("active", state); activeId = state.getString("id"); }
            JSArray finished = new JSArray(), photos = new JSArray();
            File[] files = directory.listFiles((dir, name) -> name.endsWith(".json"));
            if (files != null) for (File file : files) {
                JSONObject metadata = RecordingService.read(file);
                if (!uid.equals(metadata.optString("uid")) || activeId.equals(metadata.optString("id"))) continue;
                NativeSecurity.validId(metadata.getString("id"));
                File audio = NativeSecurity.mediaFile(getContext().getFilesDir(), uid, new File(directory, metadata.getString("id") + ".m4a"));
                metadata.put("uri", android.net.Uri.fromFile(audio).toString());
                if (!audio.isFile() || audio.length() == 0) continue;
                if (!"finished".equals(metadata.optString("state"))) metadata.put("warning", "앱이 예기치 않게 종료된 녹음입니다. 길이와 끝부분을 확인해 주세요.");
                finished.put(metadata);
            }
            File[] images = new File(directory, "photos").listFiles((dir, name) -> name.endsWith(".json"));
            if (images != null && !takingPhoto) for (File file : images) {
                JSONObject metadata = RecordingService.read(file);
                NativeSecurity.validId(metadata.getString("id"));
                File image = NativeSecurity.mediaFile(getContext().getFilesDir(), uid, new File(file.getParentFile(), metadata.getString("id") + ".jpg"));
                metadata.put("uri", android.net.Uri.fromFile(image).toString());
                if (!uid.equals(metadata.optString("uid")) || !image.isFile() || image.length() == 0) continue;
                photoDimensions(image, metadata); photos.put(metadata);
            }
            result.put("finished", finished); result.put("photos", photos); call.resolve(result);
        } catch (Exception e) { call.reject("기기 녹음 목록을 읽지 못했습니다."); }
    }); }
    /** Called only after the web library commits its durable source + upload intent. */
    @PluginMethod public void acknowledge(PluginCall call) { main(() -> {
        if (!trusted(call)) return;
        try {
            owner(call);
            if (!"photo".equals(call.getString("kind")) && !"recording".equals(call.getString("kind"))) throw new IOException();
            String id = call.getString("id"); RecordingService.validId(id);
            File dir = RecordingService.directory(getContext(), call.getString("uid"));
            if (RecordingService.active != null && RecordingService.active.belongs(call.getString("uid")) &&
                id.equals(RecordingService.active.state().getString("id"))) throw new IOException();
            boolean photo = "photo".equals(call.getString("kind")); if (photo) dir = new File(dir, "photos");
            File source = new File(dir, id + (photo ? ".jpg" : ".m4a"));
            if (source.exists() && !source.delete()) throw new IOException();
            new android.util.AtomicFile(new File(dir, id + ".json")).delete(); call.resolve();
        } catch (Exception e) { call.reject("기기 임시 원본 정리를 완료하지 못했습니다."); }
    }); }
    @PluginMethod public void signIn(PluginCall call) { main(() -> {
        if (!trusted(call)) return;
        if (FirebaseAuth.getInstance().getCurrentUser() != null) { call.reject("먼저 로그아웃해 주세요."); return; }
        if (signingIn) { call.reject("로그인이 진행 중입니다."); return; }
        final long generation = accountGeneration;
        try {
            // Firebase sign-in and Drive authorization can use different web
            // OAuth clients. Both IDs are pinned, never supplied by arbitrary JS.
            String client = getContext().getString(R.string.default_web_client_id); signingIn = true;
            GetSignInWithGoogleOption option = new GetSignInWithGoogleOption.Builder(client).build();
            GetCredentialRequest request = new GetCredentialRequest.Builder().addCredentialOption(option).build();
            CredentialManager.create(getContext()).getCredentialAsync(getActivity(), request, new CancellationSignal(), ContextCompat.getMainExecutor(getContext()),
                new CredentialManagerCallback<GetCredentialResponse, GetCredentialException>() {
                    @Override public void onResult(GetCredentialResponse response) {
                        try {
                            if (generation != accountGeneration) { signingIn = false; call.reject("로그인이 취소되었습니다."); return; }
                            String token = GoogleIdTokenCredential.createFrom(response.getCredential().getData()).getIdToken();
                            FirebaseAuth.getInstance().signInWithCredential(GoogleAuthProvider.getCredential(token, null))
                                .addOnSuccessListener(result -> {
                                    signingIn = false;
                                    if (generation != accountGeneration) { FirebaseAuth.getInstance().signOut(); call.reject("로그인이 취소되었습니다."); return; }
                                    call.resolve(new JSObject().put("idToken", token).put("uid", result.getUser().getUid()));
                                }).addOnFailureListener(error -> { signingIn = false; call.reject("Google 계정을 확인하지 못했습니다."); });
                        } catch (Exception e) { signingIn = false; call.reject("Google 계정을 확인하지 못했습니다."); }
                    }
                    @Override public void onError(GetCredentialException error) { signingIn = false; call.reject(error instanceof NoCredentialException ? "기기에 Google 계정을 추가하거나 앱 등록 설정을 확인해 주세요." : "Google 로그인이 취소되었거나 앱 등록 설정이 필요합니다."); }
                });
        } catch (Exception e) { signingIn = false; call.reject("Android Google 로그인 설정이 필요합니다."); }
    }); }
    @PluginMethod public void authorizeDrive(PluginCall call) { main(() -> {
        if (!trusted(call)) return;
        if (FirebaseAuth.getInstance().getCurrentUser() == null) { call.reject("로그인이 필요합니다."); return; }
        if (authorizing != null) { call.reject("이미 Google 연결이 진행 중입니다."); return; }
        try {
            String client = clientId(call);
            authorizing = call; authorizationGeneration = accountGeneration;
            AuthorizationRequest request = AuthorizationRequest.builder().setRequestedScopes(Arrays.asList(
                new Scope("openid"), new Scope("email"), new Scope("https://www.googleapis.com/auth/drive.file")))
                .requestOfflineAccess(client, true).build();
            Identity.getAuthorizationClient(getActivity()).authorize(request).addOnSuccessListener(result -> {
                if (authorizationGeneration != accountGeneration) { authorizing = null; call.reject("계정이 변경되어 연결이 취소되었습니다."); return; }
                if (result.hasResolution()) {
                    Intent intent = new Intent(getContext(), AuthorizationActivity.class).putExtra("resolution", result.getPendingIntent());
                    startActivityForResult(call, intent, "driveAuthorized");
                } else finishAuthorization(call, result);
            }).addOnFailureListener(error -> { authorizing = null; call.reject("Google Drive 연결을 시작하지 못했습니다."); });
        } catch (Exception e) { authorizing = null; call.reject("Google Drive 연결 설정을 확인해 주세요."); }
    }); }
    @ActivityCallback private void driveAuthorized(PluginCall call, ActivityResult result) {
        if (call == null) { authorizing = null; return; }
        try { finishAuthorization(call, Identity.getAuthorizationClient(getActivity()).getAuthorizationResultFromIntent(result.getData())); }
        catch (Exception e) { authorizing = null; call.reject("Google Drive 연결이 취소되었습니다."); }
    }
    private void finishAuthorization(PluginCall call, AuthorizationResult result) {
        authorizing = null;
        if (authorizationGeneration != accountGeneration || FirebaseAuth.getInstance().getCurrentUser() == null) {
            call.reject("계정이 변경되어 연결이 취소되었습니다."); return;
        }
        String code = result.getServerAuthCode();
        if (code == null || code.isEmpty()) { call.reject("Google Drive 연결 코드를 받지 못했습니다."); return; }
        call.resolve(new JSObject().put("code", code));
    }
}
