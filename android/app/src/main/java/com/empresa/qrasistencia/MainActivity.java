package com.empresa.qrasistencia;

import android.Manifest;
import android.content.pm.PackageManager;
import android.graphics.Bitmap;
import android.os.Bundle;
import android.os.Environment;
import android.webkit.DownloadListener;
import android.webkit.PermissionRequest;
import android.webkit.WebView;
import android.widget.Toast;
import android.media.MediaScannerConnection;
import android.util.Base64;
import java.io.File;
import java.io.FileOutputStream;
import androidx.core.app.ActivityCompat;
import androidx.core.content.ContextCompat;
import androidx.core.view.WindowCompat;
import com.getcapacitor.BridgeActivity;
import com.getcapacitor.BridgeWebChromeClient;

public class MainActivity extends BridgeActivity {
    private static final int CAMERA_PERMISSION_REQUEST_CODE = 1001;

    @Override
    public void onCreate(Bundle savedInstanceState) {
        // Oculta los bordes y permite que la app ocupe toda la pantalla de extremo a extremo
        WindowCompat.setDecorFitsSystemWindows(getWindow(), false);

        super.onCreate(savedInstanceState);

        if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.KITKAT) {
            WebView.setWebContentsDebuggingEnabled(true);
        }

        // Solicitar permisos de cámara de manera preventiva al iniciar la app
        if (ContextCompat.checkSelfPermission(this, Manifest.permission.CAMERA) != PackageManager.PERMISSION_GRANTED) {
            ActivityCompat.requestPermissions(
                this,
                new String[]{Manifest.permission.CAMERA},
                CAMERA_PERMISSION_REQUEST_CODE
            );
        }

        // Configurar WebChromeClient seguro para evitar crashes nativos de WebView / Chromium en MIUI
        bridge.getWebView().setWebChromeClient(new BridgeWebChromeClient(bridge) {
            @Override
            public Bitmap getDefaultVideoPoster() {
                Bitmap poster = super.getDefaultVideoPoster();
                if (poster == null) {
                    return Bitmap.createBitmap(1, 1, Bitmap.Config.ARGB_8888);
                }
                return poster;
            }

            @Override
            public void onPermissionRequest(final PermissionRequest request) {
                runOnUiThread(() -> {
                    boolean allGranted = true;
                    if (request.getResources() != null) {
                        for (String res : request.getResources()) {
                            if (PermissionRequest.RESOURCE_VIDEO_CAPTURE.equals(res)) {
                                if (ContextCompat.checkSelfPermission(MainActivity.this, Manifest.permission.CAMERA)
                                        != PackageManager.PERMISSION_GRANTED) {
                                    allGranted = false;
                                }
                            }
                        }
                    }

                    if (allGranted) {
                        request.grant(request.getResources());
                    } else {
                        super.onPermissionRequest(request);
                    }
                });
            }
        });

        bridge.getWebView().setDownloadListener(new DownloadListener() {
            @Override
            public void onDownloadStart(String url, String userAgent, String contentDisposition, String mimetype, long contentLength) {
                if (url != null && url.startsWith("data:")) {
                    try {
                        String base64Data = url.substring(url.indexOf(",") + 1);
                        byte[] decodedBytes = Base64.decode(base64Data, Base64.DEFAULT);

                        File downloadsDir = Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS);
                        if (!downloadsDir.exists()) {
                            downloadsDir.mkdirs();
                        }

                        String fileName = "Carnet_Asistencia_" + System.currentTimeMillis() + ".png";
                        File file = new File(downloadsDir, fileName);

                        FileOutputStream fos = new FileOutputStream(file);
                        fos.write(decodedBytes);
                        fos.close();

                        MediaScannerConnection.scanFile(MainActivity.this,
                                new String[]{file.getAbsolutePath()},
                                new String[]{"image/png"}, null);

                        runOnUiThread(new Runnable() {
                            @Override
                            public void run() {
                                Toast.makeText(MainActivity.this, "¡Carnet guardado en Descargas!", Toast.LENGTH_LONG).show();
                            }
                        });

                    } catch (Exception e) {
                        e.printStackTrace();
                        runOnUiThread(new Runnable() {
                            @Override
                            public void run() {
                                Toast.makeText(MainActivity.this, "Error al guardar la imagen", Toast.LENGTH_SHORT).show();
                            }
                        });
                    }
                }
            }
        });
    }
}
