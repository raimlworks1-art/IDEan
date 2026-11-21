package com.xyr.idean;

import android.app.Activity;
import android.content.ContentResolver;
import android.content.Intent;
import android.database.Cursor;
import android.net.Uri;
import android.provider.DocumentsContract;

import androidx.activity.result.ActivityResult;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.HashSet;
import java.util.List;
import java.util.Set;
import java.util.regex.Pattern;

@CapacitorPlugin(name = "DiskAccess")
public class DiskAccessPlugin extends Plugin {
    private static final Set<String> SKIP_DIRS = new HashSet<>(Arrays.asList(
        ".git", "node_modules", ".svn", ".hg", ".idea", ".vscode", "dist", "build", "__pycache__"
    ));
    private static final Pattern BINARY_EXT = Pattern.compile(
        ".*\\.(png|jpe?g|gif|webp|ico|bmp|pdf|zip|gz|tar|7z|rar|exe|dll|so|dylib|o|a|obj|class|jar|woff2?|ttf|otf|mp3|mp4|wav|ogg|mov|avi|rbxl|rbxm|bin|dat)$",
        Pattern.CASE_INSENSITIVE
    );
    private static final long MAX_FILE_BYTES = 1024L * 1024L;
    private static final long MAX_TOTAL_BYTES = 24L * 1024L * 1024L;
    private static final int MAX_FILES = 500;

    private static class Stats {
        int skipped = 0;
        int count = 0;
        long total = 0;
    }

    @PluginMethod
    public void pick_folder(PluginCall call) {
        Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT_TREE);
        intent.addFlags(
            Intent.FLAG_GRANT_READ_URI_PERMISSION
                | Intent.FLAG_GRANT_WRITE_URI_PERMISSION
                | Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION
                | Intent.FLAG_GRANT_PREFIX_URI_PERMISSION
        );
        startActivityForResult(call, intent, "pick_folder_result");
    }

    @ActivityCallback
    private void pick_folder_result(PluginCall call, ActivityResult result) {
        if (call == null) return;
        Intent data = result.getData();
        if (result.getResultCode() != Activity.RESULT_OK || data == null || data.getData() == null) {
            call.reject("cancelled");
            return;
        }
        final Uri tree = data.getData();
        try {
            getContext().getContentResolver().takePersistableUriPermission(
                tree,
                Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_WRITE_URI_PERMISSION
            );
        } catch (Exception ignored) {
        }
        new Thread(() -> read_tree(call, tree)).start();
    }

    private void read_tree(PluginCall call, Uri tree) {
        try {
            ContentResolver resolver = getContext().getContentResolver();
            String root_id = DocumentsContract.getTreeDocumentId(tree);
            String name = query_name(resolver, DocumentsContract.buildDocumentUriUsingTree(tree, root_id));
            JSArray files = new JSArray();
            Stats stats = new Stats();
            walk(resolver, tree, root_id, "", files, stats);
            JSObject out = new JSObject();
            out.put("name", name);
            out.put("tree_uri", tree.toString());
            out.put("files", files);
            out.put("skipped", stats.skipped);
            call.resolve(out);
        } catch (Exception e) {
            call.reject("read_failed: " + e.getMessage());
        }
    }

    private String query_name(ContentResolver resolver, Uri doc) {
        try (Cursor c = resolver.query(doc, new String[]{DocumentsContract.Document.COLUMN_DISPLAY_NAME}, null, null, null)) {
            if (c != null && c.moveToFirst() && !c.isNull(0)) return c.getString(0);
        } catch (Exception ignored) {
        }
        return "Folder";
    }

    private void walk(ContentResolver resolver, Uri tree, String dir_id, String prefix, JSArray out, Stats stats) throws Exception {
        Uri children = DocumentsContract.buildChildDocumentsUriUsingTree(tree, dir_id);
        String[] cols = {
            DocumentsContract.Document.COLUMN_DOCUMENT_ID,
            DocumentsContract.Document.COLUMN_DISPLAY_NAME,
            DocumentsContract.Document.COLUMN_MIME_TYPE,
            DocumentsContract.Document.COLUMN_SIZE
        };
        List<String[]> entries = new ArrayList<>();
        try (Cursor c = resolver.query(children, cols, null, null, null)) {
            if (c == null) return;
            while (c.moveToNext()) {
                entries.add(new String[]{
                    c.getString(0),
                    c.getString(1),
                    c.getString(2),
                    String.valueOf(c.isNull(3) ? -1L : c.getLong(3))
                });
            }
        }
        for (String[] e : entries) {
            String id = e[0];
            String name = e[1];
            String mime = e[2];
            long size = Long.parseLong(e[3]);
            if (name == null) continue;
            if (DocumentsContract.Document.MIME_TYPE_DIR.equals(mime)) {
                if (SKIP_DIRS.contains(name)) continue;
                walk(resolver, tree, id, prefix + name + "/", out, stats);
                continue;
            }
            if (stats.count >= MAX_FILES || stats.total >= MAX_TOTAL_BYTES) {
                stats.skipped++;
                continue;
            }
            if (BINARY_EXT.matcher(name).matches() || size > MAX_FILE_BYTES) {
                stats.skipped++;
                continue;
            }
            try {
                byte[] bytes = read_bytes(resolver, DocumentsContract.buildDocumentUriUsingTree(tree, id), MAX_FILE_BYTES);
                if (bytes == null) {
                    stats.skipped++;
                    continue;
                }
                String text = new String(bytes, StandardCharsets.UTF_8);
                if (text.substring(0, Math.min(4000, text.length())).indexOf('\u0000') >= 0) {
                    stats.skipped++;
                    continue;
                }
                JSObject file = new JSObject();
                file.put("path", prefix + name);
                file.put("content", text);
                out.put(file);
                stats.count++;
                stats.total += bytes.length;
            } catch (Exception ex) {
                stats.skipped++;
            }
        }
    }

    private byte[] read_bytes(ContentResolver resolver, Uri uri, long limit) throws Exception {
        try (InputStream in = resolver.openInputStream(uri)) {
            if (in == null) return null;
            ByteArrayOutputStream buf = new ByteArrayOutputStream();
            byte[] chunk = new byte[16384];
            int n;
            while ((n = in.read(chunk)) != -1) {
                buf.write(chunk, 0, n);
                if (buf.size() > limit) return null;
            }
            return buf.toByteArray();
        }
    }

    @PluginMethod
    public void write_file(PluginCall call) {
        final String tree_uri = call.getString("tree_uri");
        final String path = call.getString("path");
        final String content = call.getString("content", "");
        if (tree_uri == null || path == null || path.isEmpty()) {
            call.reject("missing_args");
            return;
        }
        new Thread(() -> {
            try {
                ContentResolver resolver = getContext().getContentResolver();
                Uri tree = Uri.parse(tree_uri);
                String[] parts = path.split("/");
                String parent_id = DocumentsContract.getTreeDocumentId(tree);
                for (int i = 0; i < parts.length - 1; i++) {
                    if (parts[i].isEmpty()) continue;
                    parent_id = find_or_create(resolver, tree, parent_id, parts[i], true);
                }
                String file_id = find_or_create(resolver, tree, parent_id, parts[parts.length - 1], false);
                Uri doc = DocumentsContract.buildDocumentUriUsingTree(tree, file_id);
                try (OutputStream out = resolver.openOutputStream(doc, "wt")) {
                    if (out == null) throw new Exception("no_stream");
                    out.write(content.getBytes(StandardCharsets.UTF_8));
                }
                call.resolve();
            } catch (Exception e) {
                call.reject("write_failed: " + e.getMessage());
            }
        }).start();
    }

    private String find_or_create(ContentResolver resolver, Uri tree, String parent_id, String name, boolean is_dir) throws Exception {
        Uri children = DocumentsContract.buildChildDocumentsUriUsingTree(tree, parent_id);
        String[] cols = {
            DocumentsContract.Document.COLUMN_DOCUMENT_ID,
            DocumentsContract.Document.COLUMN_DISPLAY_NAME
        };
        try (Cursor c = resolver.query(children, cols, null, null, null)) {
            if (c != null) {
                while (c.moveToNext()) {
                    if (name.equals(c.getString(1))) return c.getString(0);
                }
            }
        }
        Uri parent_uri = DocumentsContract.buildDocumentUriUsingTree(tree, parent_id);
        String mime = is_dir ? DocumentsContract.Document.MIME_TYPE_DIR : "application/octet-stream";
        Uri created = DocumentsContract.createDocument(resolver, parent_uri, mime, name);
        if (created == null) throw new Exception("create_failed");
        return DocumentsContract.getDocumentId(created);
    }
}
