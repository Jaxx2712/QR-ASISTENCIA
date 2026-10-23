package com.empresa.qrasistencia;

import android.os.Bundle;
import android.webkit.WebView;
import android.webkit.DownloadListener;
import android.os.Environment;
import android.widget.Toast;
import android.media.MediaScannerConnection;
import android.util.Base64;
import java.io.File;
import java.io.FileOutputStream;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.KITKAT) {
            WebView.setWebContentsDebuggingEnabled(true);
        }

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