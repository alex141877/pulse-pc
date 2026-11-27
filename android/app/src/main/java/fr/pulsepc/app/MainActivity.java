package fr.pulsepc.app;

import android.app.Activity;
import android.app.AlertDialog;
import android.app.DownloadManager;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
import android.os.Environment;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.widget.Toast;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import androidx.webkit.WebViewAssetLoader;
import androidx.webkit.WebViewCompat;
import androidx.webkit.WebViewFeature;
import java.io.IOException;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.util.Collections;
import org.json.JSONObject;
import java.net.URL;
import java.net.HttpURLConnection;
import java.util.Scanner;

public class MainActivity extends Activity {
    private static final String RELEASE = "https://api.github.com/repos/alex141877/pulse-pc/releases/latest";
    private static final String ASSET_PREFIX = "https://github.com/alex141877/pulse-pc/releases/download/";
    private static final String LOCAL = "appassets.androidplatform.net";
    private static final int IMPORT_PROGRAMS = 87;
    private static final int EXPORT_PROGRAMS = 88;
    private ValueCallback<Uri[]> importCallback;
    private String pendingExport;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        if (savedInstanceState != null) pendingExport = savedInstanceState.getString("pendingExport");
        getWindow().setStatusBarColor(0xff101821);
        getWindow().setNavigationBarColor(0xff101821);
        WebViewAssetLoader loader = new WebViewAssetLoader.Builder()
                .addPathHandler("/assets/", new WebViewAssetLoader.AssetsPathHandler(this)).build();
        WebView webView = new WebView(this);
        webView.setBackgroundColor(0xff101821);
        webView.getSettings().setJavaScriptEnabled(true);
        webView.getSettings().setDomStorageEnabled(true);
        webView.getSettings().setAllowFileAccess(false);
        webView.setWebChromeClient(new WebChromeClient() {
            @Override
            public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback, FileChooserParams params) {
                if (importCallback != null) importCallback.onReceiveValue(null);
                importCallback = callback;
                Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT).addCategory(Intent.CATEGORY_OPENABLE)
                        .setType("*/*").putExtra(Intent.EXTRA_MIME_TYPES, new String[]{"application/json", "text/plain"});
                try {
                    startActivityForResult(intent, IMPORT_PROGRAMS);
                } catch (ActivityNotFoundException unsupported) {
                    importCallback = null;
                    callback.onReceiveValue(null);
                }
                return true;
            }
        });
        if (WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER)) {
            WebViewCompat.addWebMessageListener(webView, "pulsepcFiles", Collections.singleton("https://" + LOCAL),
                    (view, message, origin, mainFrame, reply) -> {
                        if (mainFrame) exportPrograms(message.getData());
                    });
        }
        webView.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                Uri url = request.getUrl();
                return !"https".equals(url.getScheme()) || !LOCAL.equals(url.getHost())
                        || !"/assets/index.html".equals(url.getPath());
            }
            @Override
            public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                return loader.shouldInterceptRequest(request.getUrl());
            }
        });
        setContentView(webView);
        webView.loadUrl("https://" + LOCAL + "/assets/index.html");
        new Thread(this::checkForUpdate, "pulsepc-update").start();
    }

    private void exportPrograms(String data) {
        if (data == null || data.getBytes(StandardCharsets.UTF_8).length > 65536 || pendingExport != null) return;
        pendingExport = data;
        Intent intent = new Intent(Intent.ACTION_CREATE_DOCUMENT).addCategory(Intent.CATEGORY_OPENABLE)
                .setType("application/json").putExtra(Intent.EXTRA_TITLE, "PulsePC-programmes.json");
        try {
            startActivityForResult(intent, EXPORT_PROGRAMS);
        } catch (ActivityNotFoundException unsupported) {
            pendingExport = null;
            Toast.makeText(this, "Sélecteur de fichiers indisponible.", Toast.LENGTH_SHORT).show();
        }
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode == IMPORT_PROGRAMS && importCallback != null) {
            ValueCallback<Uri[]> callback = importCallback;
            importCallback = null;
            callback.onReceiveValue(WebChromeClient.FileChooserParams.parseResult(resultCode, data));
        }
        if (requestCode == EXPORT_PROGRAMS) {
            String output = pendingExport;
            pendingExport = null;
            Uri destination = data == null ? null : data.getData();
            if (resultCode != RESULT_OK || destination == null || output == null) return;
            try (OutputStream stream = getContentResolver().openOutputStream(destination, "wt")) {
                if (stream == null) throw new IOException();
                stream.write(output.getBytes(StandardCharsets.UTF_8));
                Toast.makeText(this, "Liste exportée.", Toast.LENGTH_SHORT).show();
            } catch (IOException | SecurityException failure) {
                Toast.makeText(this, "Impossible d’enregistrer la liste.", Toast.LENGTH_SHORT).show();
            }
        }
    }

    @Override
    protected void onSaveInstanceState(Bundle savedInstanceState) {
        super.onSaveInstanceState(savedInstanceState);
        savedInstanceState.putString("pendingExport", pendingExport);
    }


    private static int compareVersions(String left, String right) {
        String[] a = left.replaceFirst("^v", "").split("\\.");
        String[] b = right.split("\\.");
        if (a.length != 3 || b.length != 3) return 0;
        for (int i = 0; i < 3; i++) {
            int difference = Integer.compare(Integer.parseInt(a[i]), Integer.parseInt(b[i]));
            if (difference != 0) return difference;
        }
        return 0;
    }

    private void checkForUpdate() {
        HttpURLConnection connection = null;
        try {
            String version = getPackageManager().getPackageInfo(getPackageName(), 0).versionName;
            connection = (HttpURLConnection) new URL(RELEASE).openConnection();
            connection.setConnectTimeout(5000);
            connection.setReadTimeout(5000);
            connection.setRequestProperty("Accept", "application/vnd.github+json");
            JSONObject release;
            try (Scanner scanner = new Scanner(connection.getInputStream(), "UTF-8").useDelimiter("\\A")) {
                release = new JSONObject(scanner.next());
            }
            String tag = release.getString("tag_name");
            if (!tag.matches("v[0-9]+\\.[0-9]+\\.[0-9]+") || compareVersions(tag, version) <= 0) return;
            String filename = "PulsePC-Android.apk";
            org.json.JSONArray assets = release.getJSONArray("assets");
            for (int i = 0; i < assets.length(); i++) {
                JSONObject asset = assets.getJSONObject(i);
                String url = asset.optString("browser_download_url");
                if (asset.optString("name").equals(filename) && url.equals(ASSET_PREFIX + tag + "/" + filename)) {
                    runOnUiThread(() -> offerUpdate(tag, url));
                    break;
                }
            }
        } catch (Exception ignored) {
            // An offline update check must not interrupt monitoring.
        } finally {
            if (connection != null) connection.disconnect();
        }
    }

    private void offerUpdate(String tag, String url) {
        android.content.SharedPreferences preferences = getSharedPreferences("updates", MODE_PRIVATE);
        if (isFinishing() || isDestroyed() || preferences.getString("downloaded", "").equals(tag)) return;
        try {
            DownloadManager.Request request = new DownloadManager.Request(Uri.parse(url))
                    .setTitle("PulsePC " + tag)
                    .setMimeType("application/vnd.android.package-archive")
                    .setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED)
                    .setDestinationInExternalPublicDir(Environment.DIRECTORY_DOWNLOADS, "PulsePC-" + tag + ".apk");
            getSystemService(DownloadManager.class).enqueue(request);
            preferences.edit().putString("downloaded", tag).apply();
            new AlertDialog.Builder(this)
                    .setTitle("Mise à jour PulsePC " + tag)
                    .setMessage("Le téléchargement a démarré. À la fin, ouvre l’APK dans tes téléchargements et confirme l’installation.")
                    .setPositiveButton("OK", null).show();
        } catch (RuntimeException ignored) {
            // Retry on the next launch if the Android download service is unavailable.
        }
    }
}
