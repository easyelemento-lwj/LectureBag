package com.lecturebag.app;

import java.io.File;
import java.io.IOException;
import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;

/** Pure policy: tested without an Android runtime. Origins are not user identities. */
final class NativeSecurity {
    static boolean bundledPage(String raw) {
        try {
            URI uri = new URI(raw);
            return "https".equals(uri.getScheme()) && "localhost".equals(uri.getHost()) &&
                (uri.getPort() == -1 || uri.getPort() == 443) && uri.getRawUserInfo() == null && uri.getRawQuery() == null &&
                ("/".equals(uri.getRawPath()) || "/index.html".equals(uri.getRawPath()));
        } catch (Exception e) { return false; }
    }
    static void validId(String id) throws IOException {
        if (id == null || !id.matches("[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}")) throw new IOException("잘못된 파일 ID");
    }
    static void requireUnused(File directory, String id, String suffix) throws IOException {
        validId(id);
        for (String ending : new String[] { suffix, ".json", ".json.bak", ".json.new" }) {
            if (new File(directory, id + ending).exists()) throw new IOException("이미 존재하는 파일입니다.");
        }
    }
    static String ownerHash(String uid) throws Exception {
        if (uid == null || uid.isEmpty() || uid.length() > 128) throw new IOException("로그인이 필요합니다.");
        byte[] hash = MessageDigest.getInstance("SHA-256").digest(uid.getBytes(StandardCharsets.UTF_8));
        StringBuilder value = new StringBuilder(); for (byte b : hash) value.append(String.format("%02x", b));
        return value.toString();
    }
    static boolean sameOwner(String authenticatedUid, String requestedUid) {
        return authenticatedUid != null && !authenticatedUid.isEmpty() && authenticatedUid.equals(requestedUid);
    }
    static File mediaFile(File filesDir, String uid, File candidate) throws Exception {
        File owner = new File(filesDir, "recordings/" + ownerHash(uid)).getCanonicalFile();
        // Reject traversal and symlinks, even if they happen to end inside the root.
        File canonical = candidate.getCanonicalFile();
        if (!canonical.equals(candidate.getAbsoluteFile())) throw new IOException("허용되지 않은 경로");
        boolean photo = canonical.getParentFile().equals(new File(owner, "photos"));
        if (!photo && !canonical.getParentFile().equals(owner)) throw new IOException("다른 계정 또는 저장소 경로");
        String suffix = photo ? ".jpg" : ".m4a", name = canonical.getName();
        if (!name.endsWith(suffix)) throw new IOException("지원하지 않는 파일 형식");
        validId(name.substring(0, name.length() - suffix.length()));
        return canonical;
    }
}
