package com.lecturebag.app;

import org.junit.Test;
import org.junit.Rule;
import org.junit.rules.TemporaryFolder;
import java.io.File;
import java.nio.file.Files;
import static org.junit.Assert.*;

public class NativeSecurityTest {
    @Rule public TemporaryFolder temporary = new TemporaryFolder();
    private static final String ID = "9a91b172-6694-44d3-af25-605d58952d4c";
    private File root() throws Exception { return temporary.getRoot().getCanonicalFile(); }
    private File owner(String uid) throws Exception { return new File(root(), "recordings/" + NativeSecurity.ownerHash(uid)); }
    @Test public void bridgeRequiresExactBundledOriginAndEntryPoint() {
        assertTrue(NativeSecurity.bundledPage("https://localhost/"));
        assertTrue(NativeSecurity.bundledPage("https://localhost/index.html#settings"));
        for (String uri : new String[] { null, "https://localhost.evil.test/", "http://localhost/", "https://evil@localhost/", "https://localhost:444/", "file:///index.html", "https://localhost/other.html", "https://localhost/?next=https://evil.test", "https://localhost/%2e%2e/index.html" }) {
            assertFalse(String.valueOf(uri), NativeSecurity.bundledPage(uri));
        }
    }
    @Test public void identityRequiresAuthenticatedExactUid() {
        assertTrue(NativeSecurity.sameOwner("alice", "alice"));
        assertFalse(NativeSecurity.sameOwner(null, "alice"));
        assertFalse(NativeSecurity.sameOwner("alice", "bob"));
        assertFalse(NativeSecurity.sameOwner("", ""));
    }
    @Test public void onlyCurrentOwnersMediaCanBeRead() throws Exception {
        File audio = new File(owner("alice"), ID + ".m4a");
        File photo = new File(owner("alice"), "photos/" + ID + ".jpg");
        assertEquals(audio, NativeSecurity.mediaFile(root(), "alice", audio));
        assertEquals(photo, NativeSecurity.mediaFile(root(), "alice", photo));
        for (File file : new File[] { new File(owner("bob"), ID + ".m4a"), new File(owner("alice"), ID + ".json"), new File(owner("alice"), "photos/" + ID + ".m4a"), new File(root(), "shared_prefs/auth.xml"), new File(owner("alice"), "../" + NativeSecurity.ownerHash("alice") + "/" + ID + ".m4a") }) {
            assertThrows(Exception.class, () -> NativeSecurity.mediaFile(root(), "alice", file));
        }
    }
    @Test public void symbolicLinksCannotEscapeOrAliasAllowedMedia() throws Exception {
        assertTrue(owner("alice").mkdirs());
        File target = temporary.newFile("private.txt"), link = new File(owner("alice"), ID + ".m4a");
        Files.createSymbolicLink(link.toPath(), target.toPath());
        assertThrows(Exception.class, () -> NativeSecurity.mediaFile(root(), "alice", link));
    }
    @Test public void malformedIdsCannotChoosePaths() throws Exception {
        NativeSecurity.validId(ID);
        for (String id : new String[] { null, "------------------------------------", "../" + ID, ID + ".json", ID.toUpperCase() }) {
            assertThrows(Exception.class, () -> NativeSecurity.validId(id));
        }
    }
    @Test public void duplicateMediaAndAtomicJournalArePreserved() throws Exception {
        for (String suffix : new String[] { ".m4a", ".json", ".json.bak", ".json.new" }) {
            File dir = temporary.newFolder();
            NativeSecurity.requireUnused(dir, ID, ".m4a");
            File original = new File(dir, ID + suffix);
            Files.write(original.toPath(), "original".getBytes(java.nio.charset.StandardCharsets.UTF_8));
            assertThrows(Exception.class, () -> NativeSecurity.requireUnused(dir, ID, ".m4a"));
            assertEquals("original", new String(Files.readAllBytes(original.toPath()), java.nio.charset.StandardCharsets.UTF_8));
        }
    }
    @Test public void accountIdsCannotSelectFilesystemLocations() throws Exception {
        assertEquals(64, NativeSecurity.ownerHash("../../shared_prefs").length());
        assertNotEquals(NativeSecurity.ownerHash("alice"), NativeSecurity.ownerHash("bob"));
        assertThrows(Exception.class, () -> NativeSecurity.ownerHash(""));
        assertThrows(Exception.class, () -> NativeSecurity.ownerHash("x".repeat(129)));
    }
}
