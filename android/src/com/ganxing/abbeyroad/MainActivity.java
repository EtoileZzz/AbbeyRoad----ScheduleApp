package com.ganxing.abbeyroad;

import android.app.Activity;
import android.content.ClipData;
import android.content.ClipboardManager;
import android.content.ContentValues;
import android.content.Context;
import android.content.Intent;
import android.content.res.Configuration;
import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Environment;
import android.os.VibrationEffect;
import android.os.Vibrator;
import android.provider.AlarmClock;
import android.provider.CalendarContract;
import android.provider.MediaStore;
import android.util.Log;
import android.view.View;
import android.view.Window;
import android.webkit.ConsoleMessage;
import android.webkit.JavascriptInterface;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Toast;

import org.json.JSONObject;

import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.TimeZone;

/**
 * Abbey Road · Android 外壳
 *
 * 职责很窄：用一个 WebView 承载 app/ 里的界面（两端共用同一套代码），
 * 再把「震动、剪贴板、文件读写、日历/闹钟/地图跳转、系统栏配色」这些
 * 系统能力通过 @JavascriptInterface 暴露给网页。
 *
 * 网页通过 https://abbeyroad.local/ 访问，资源全部来自 assets/web/，
 * 这样既有安全的 https 源（localStorage 可持久化），又完全离线。
 */
public class MainActivity extends Activity {

    private static final String TAG = "AbbeyRoad";
    private static final String HOST = "abbeyroad.local";
    private static final String ORIGIN = "https://" + HOST + "/";
    private static final int REQ_EXPORT = 1001;
    private static final int REQ_IMPORT = 1002;

    /** 桌面卡片点进来的目标视图：today / week / import / settings */
    static final String EXTRA_VIEW = "ar_view";

    private WebView web;
    private String pendingExportContent = null;
    private String pendingExportMime = "application/json";
    private String pendingView = null;
    /** 「用 Abbey Road 打开」进来的文件（微信里点配置文件 → 用其他应用打开） */
    private Uri pendingOpenUri = null;
    private String pendingOpenName = null;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        web = new WebView(this);
        setContentView(web);

        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setDatabaseEnabled(true);
        s.setAllowFileAccess(false);
        s.setAllowContentAccess(true);
        s.setSupportZoom(false);
        s.setBuiltInZoomControls(false);
        s.setDisplayZoomControls(false);
        s.setMediaPlaybackRequiresUserGesture(true);
        s.setCacheMode(WebSettings.LOAD_DEFAULT);
        s.setTextZoom(100);
        // 系统字号放大时不要让网页文字跟着变大（否则会撑破布局）
        try {
            s.setMinimumFontSize(1);
            s.setMinimumLogicalFontSize(1);
        } catch (Exception ignored) { }
        // 让网页拿到和系统一致的深色偏好
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            s.setForceDark(WebSettings.FORCE_DARK_OFF);
        }

        web.setBackgroundColor(Color.TRANSPARENT);
        web.setOverScrollMode(View.OVER_SCROLL_NEVER);
        web.setVerticalScrollBarEnabled(false);
        web.setHorizontalScrollBarEnabled(false);

        web.setWebViewClient(new WebViewClient() {
            @Override
            public void onPageFinished(WebView view, String url) {
                super.onPageFinished(view, url);
                flushPendingView();
                flushPendingOpen();
            }

            @Override
            public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                Uri u = request.getUrl();
                if (u != null && HOST.equals(u.getHost())) {
                    return serveAsset(u.getPath());
                }
                return null;
            }

            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                Uri u = request.getUrl();
                // 站内导航交给 WebView，外部链接交给系统
                if (u != null && HOST.equals(u.getHost())) {
                    return false;
                }
                try {
                    startActivity(new Intent(Intent.ACTION_VIEW, u));
                } catch (Exception e) {
                    Log.w(TAG, "外部链接无法打开: " + u, e);
                }
                return true;
            }
        });

        web.setWebChromeClient(new WebChromeClient() {
            @Override
            public boolean onConsoleMessage(ConsoleMessage m) {
                Log.i(TAG, "[web] " + m.message() + " @" + m.lineNumber());
                return true;
            }
        });

        web.addJavascriptInterface(new Bridge(), "ARBridge");
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.KITKAT) {
            WebView.setWebContentsDebuggingEnabled(true);
        }

        web.loadUrl(ORIGIN + "index.html");
        pendingView = viewFromIntent(getIntent());
        captureOpenIntent(getIntent());
    }

    /**
     * 记下启动/切回前台时由系统丢过来的配置文件。
     * 微信收到的文件在自己的私有目录里，系统文件选择器看不到，
     * 所以「用其他应用打开 → Abbey Road」是手机上最靠谱的导入路径。
     */
    private void captureOpenIntent(Intent intent) {
        if (intent == null) { return; }
        Uri uri = null;
        String name = null;
        String action = intent.getAction();
        if (Intent.ACTION_VIEW.equals(action)) {
            uri = intent.getData();
        } else if (Intent.ACTION_SEND.equals(action)) {
            Object extra = intent.getParcelableExtra(Intent.EXTRA_STREAM);
            if (extra instanceof Uri) { uri = (Uri) extra; }
            name = intent.getStringExtra(Intent.EXTRA_TITLE);
        }
        if (uri == null) { return; }
        pendingOpenUri = uri;
        pendingOpenName = (name == null || name.length() == 0) ? displayNameOf(uri) : name;
    }

    /** content:// 的 lastPathSegment 往往只是一串数字，能查就查真实文件名 */
    private String displayNameOf(Uri uri) {
        try {
            android.database.Cursor c = getContentResolver().query(uri,
                    new String[]{android.provider.OpenableColumns.DISPLAY_NAME}, null, null, null);
            if (c != null) {
                try {
                    if (c.moveToFirst()) {
                        int idx = c.getColumnIndex(android.provider.OpenableColumns.DISPLAY_NAME);
                        if (idx >= 0) {
                            String n = c.getString(idx);
                            if (n != null && n.length() > 0) { return n; }
                        }
                    }
                } finally {
                    c.close();
                }
            }
        } catch (Exception ignored) { }
        return uri.getLastPathSegment();
    }

    /** 把待导入的文件读出来交给网页（读文件放到后台线程，避免卡住界面） */
    private void flushPendingOpen() {
        final Uri uri = pendingOpenUri;
        final String name = pendingOpenName;
        if (uri == null) { return; }
        pendingOpenUri = null;
        pendingOpenName = null;
        new Thread(new Runnable() {
            public void run() {
                try {
                    InputStream in = getContentResolver().openInputStream(uri);
                    ByteArrayOutputStream bos = new ByteArrayOutputStream();
                    byte[] buf = new byte[16384];
                    int n;
                    while ((n = in.read(buf)) > 0) { bos.write(buf, 0, n); }
                    in.close();
                    final String text = new String(bos.toByteArray(), StandardCharsets.UTF_8);
                    callJs("window.AR && AR.onFileText && AR.onFileText(" + q(text) + "," + q(name) + ")");
                } catch (Exception e) {
                    toast("读取文件失败");
                }
            }
        }).start();
    }

    /** 桌面卡片可能带着「直接打开哪一屏」进来 */
    private static String viewFromIntent(Intent intent) {
        if (intent == null) { return null; }
        String v = intent.getStringExtra(EXTRA_VIEW);
        if (v == null || v.length() == 0) { return null; }
        if (!"today".equals(v) && !"week".equals(v) && !"import".equals(v) && !"settings".equals(v)) {
            return null;
        }
        return v;
    }

    /** 页面加载完成后再切视图，避免网页还没初始化 */
    private void flushPendingView() {
        final String v = pendingView;
        if (v == null) { return; }
        pendingView = null;
        callJs("window.AR && AR.onOpenView && AR.onOpenView(" + q(v) + ")");
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        pendingView = viewFromIntent(intent);
        captureOpenIntent(intent);
        if (web != null) {
            flushPendingView();
            flushPendingOpen();
        }
    }

    /** 从 assets/web/ 读取被拦截的请求；找不到就返回 404，避免整页白屏。 */
    private WebResourceResponse serveAsset(String path) {
        String rel = (path == null || path.isEmpty() || "/".equals(path)) ? "index.html" : path.substring(1);
        if (rel.endsWith("/")) {
            rel = rel + "index.html";
        }
        String mime = mimeOf(rel);
        try {
            InputStream in = getAssets().open("web/" + rel);
            ByteArrayOutputStream bos = new ByteArrayOutputStream();
            byte[] buf = new byte[16384];
            int n;
            while ((n = in.read(buf)) > 0) {
                bos.write(buf, 0, n);
            }
            in.close();
            WebResourceResponse r = new WebResourceResponse(mime, "UTF-8",
                    new ByteArrayInputStream(bos.toByteArray()));
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
                java.util.Map<String, String> headers = new java.util.HashMap<String, String>();
                headers.put("Cache-Control", "no-cache");
                r.setResponseHeaders(headers);
            }
            return r;
        } catch (Exception e) {
            Log.w(TAG, "资源缺失: " + rel);
            return new WebResourceResponse("text/plain", "UTF-8",
                    new ByteArrayInputStream("404".getBytes(StandardCharsets.UTF_8)));
        }
    }

    private static String mimeOf(String rel) {
        String p = rel.toLowerCase(Locale.US);
        if (p.endsWith(".html") || p.endsWith(".htm")) return "text/html";
        if (p.endsWith(".css")) return "text/css";
        if (p.endsWith(".js")) return "application/javascript";
        if (p.endsWith(".json")) return "application/json";
        if (p.endsWith(".svg")) return "image/svg+xml";
        if (p.endsWith(".png")) return "image/png";
        if (p.endsWith(".jpg") || p.endsWith(".jpeg")) return "image/jpeg";
        if (p.endsWith(".woff2")) return "font/woff2";
        if (p.endsWith(".woff")) return "font/woff";
        if (p.endsWith(".txt") || p.endsWith(".md")) return "text/plain";
        return "application/octet-stream";
    }

    // ---------------------------------------------------------------- 桥

    /** 暴露给网页的本地能力，方法名与 windows/Bridge.cs 保持一致。 */
    private class Bridge {

        @JavascriptInterface
        public String platform() {
            return "android";
        }

        @JavascriptInterface
        public int sdkInt() {
            return Build.VERSION.SDK_INT;
        }

        @JavascriptInterface
        public String deviceName() {
            return (Build.MANUFACTURER + " " + Build.MODEL).trim();
        }

        @JavascriptInterface
        public String appVersion() {
            try {
                return getPackageManager().getPackageInfo(getPackageName(), 0).versionName;
            } catch (Exception e) {
                return "0.1.0";
            }
        }

        /** 重要操作震动：ms 时长，amp 振幅（1-255，0 表示用系统默认）。 */
        @JavascriptInterface
        public void vibrate(final int ms, final int amp) {
            runOnUiThread(new Runnable() {
                public void run() {
                    try {
                        Vibrator v = (Vibrator) getSystemService(Context.VIBRATOR_SERVICE);
                        if (v == null || !v.hasVibrator()) return;
                        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                            int amplitude = amp <= 0 ? VibrationEffect.DEFAULT_AMPLITUDE : amp;
                            v.vibrate(VibrationEffect.createOneShot(ms, amplitude));
                        } else {
                            v.vibrate(ms);
                        }
                    } catch (Exception e) {
                        Log.w(TAG, "vibrate failed", e);
                    }
                }
            });
        }

        @JavascriptInterface
        public void copy(final String text) {
            runOnUiThread(new Runnable() {
                public void run() {
                    try {
                        ClipboardManager cm = (ClipboardManager) getSystemService(Context.CLIPBOARD_SERVICE);
                        cm.setPrimaryClip(ClipData.newPlainText("Abbey Road", text));
                        toast("已复制");
                    } catch (Exception e) {
                        toast("复制失败");
                    }
                }
            });
        }

        @JavascriptInterface
        public void toast(final String msg) {
            runOnUiThread(new Runnable() {
                public void run() {
                    Toast.makeText(MainActivity.this, msg, Toast.LENGTH_SHORT).show();
                }
            });
        }

        @JavascriptInterface
        public void shareText(final String title, final String text) {
            runOnUiThread(new Runnable() {
                public void run() {
                    try {
                        Intent i = new Intent(Intent.ACTION_SEND);
                        i.setType("text/plain");
                        i.putExtra(Intent.EXTRA_SUBJECT, title);
                        i.putExtra(Intent.EXTRA_TEXT, text);
                        startActivity(Intent.createChooser(i, "分享到"));
                    } catch (Exception e) {
                        toast("没有可用的分享目标");
                    }
                }
            });
        }

        @JavascriptInterface
        public boolean canHandle(String url) {
            try {
                Intent i = new Intent(Intent.ACTION_VIEW, Uri.parse(url));
                return i.resolveActivity(getPackageManager()) != null;
            } catch (Exception e) {
                return false;
            }
        }

        /**
         * 「导出到微信」：先把配置文件写进系统「下载 / Abbey Road」目录，
         * 再用 ACTION_SEND 拉起系统分享面板 —— 选微信就是发文件，选别的 App 也一样能用。
         *
         * 为什么先落盘：分享面板拿 content:// 地址才能把文件真发出去；
         * 只发文本的话，几十 KB 的配置在聊天里既难读也容易被编辑器改坏。
         * Android 10（API 29）以下没有 MediaStore.Downloads，降级成分享文本。
         */
        @JavascriptInterface
        public void shareFile(final String fileName, final String content, final String mime, final String title) {
            runOnUiThread(new Runnable() {
                public void run() {
                    String type = (mime == null || mime.length() == 0) ? "application/json" : mime;
                    Uri uri = writeToDownloads(fileName, content, type);
                    try {
                        Intent i = new Intent(Intent.ACTION_SEND);
                        i.putExtra(Intent.EXTRA_SUBJECT, title == null ? "Abbey Road 课表配置" : title);
                        if (uri != null) {
                            i.setType("*/*");                                  // 微信等 App 只认通用类型
                            i.putExtra(Intent.EXTRA_STREAM, uri);
                            i.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
                        } else {
                            i.setType("text/plain");
                            i.putExtra(Intent.EXTRA_TEXT, content);
                        }
                        startActivity(Intent.createChooser(i, "导出到微信 / 分享"));
                    } catch (Exception e) {
                        toast("没有可用的分享目标");
                    }
                }
            });
        }

        /** Android 10+：写进「下载/Abbey Road」，返回可分享的 content:// 地址；失败返回 null */
        private Uri writeToDownloads(String fileName, String content, String mime) {
            if (Build.VERSION.SDK_INT < 29 || content == null) { return null; }
            try {
                ContentValues cv = new ContentValues();
                cv.put(MediaStore.MediaColumns.DISPLAY_NAME,
                        (fileName == null || fileName.length() == 0) ? "AbbeyRoad-backup.json" : fileName);
                cv.put(MediaStore.MediaColumns.MIME_TYPE, mime);
                cv.put(MediaStore.MediaColumns.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS + "/Abbey Road");
                Uri uri = getContentResolver().insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, cv);
                if (uri == null) { return null; }
                OutputStream os = getContentResolver().openOutputStream(uri);
                os.write(content.getBytes(StandardCharsets.UTF_8));
                os.flush();
                os.close();
                return uri;
            } catch (Exception e) {
                return null;
            }
        }

        @JavascriptInterface
        public void openUrl(final String url) {
            runOnUiThread(new Runnable() {
                public void run() {
                    try {
                        Intent i = new Intent(Intent.ACTION_VIEW, Uri.parse(url));
                        i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                        startActivity(i);
                    } catch (Exception e) {
                        toast("无法打开链接");
                    }
                }
            });
        }

        /**
         * 导航：按「用户偏好 → 系统地图 → 浏览器」的意图阶梯逐级降级。
         * pref: system / amap / baidu
         */
        @JavascriptInterface
        public void openMap(final String pref, final String keyword, final String webFallback) {
            runOnUiThread(new Runnable() {
                public void run() {
                    String kw = Uri.encode(keyword);
                    List<Intent> ladder = new ArrayList<Intent>();
                    if ("amap".equals(pref)) {
                        Intent a1 = new Intent(Intent.ACTION_VIEW,
                                Uri.parse("androidamap://keywordNavi?keyword=" + kw + "&style=2"));
                        a1.setPackage("com.autonavi.minimap");
                        ladder.add(a1);
                        Intent a2 = new Intent(Intent.ACTION_VIEW,
                                Uri.parse("amapuri://route/plan/?dname=" + kw + "&dev=0&t=0"));
                        a2.setPackage("com.autonavi.minimap");
                        ladder.add(a2);
                    } else if ("baidu".equals(pref)) {
                        Intent b1 = new Intent(Intent.ACTION_VIEW,
                                Uri.parse("baidumap://map/geocoder?src=abbeyroad&address=" + kw));
                        b1.setPackage("com.baidu.BaiduMap");
                        ladder.add(b1);
                    }
                    ladder.add(new Intent(Intent.ACTION_VIEW, Uri.parse("geo:0,0?q=" + kw)));
                    if (webFallback != null && webFallback.length() > 0) {
                        ladder.add(new Intent(Intent.ACTION_VIEW, Uri.parse(webFallback)));
                    }
                    for (Intent i : ladder) {
                        try {
                            i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                            startActivity(i);
                            return;
                        } catch (Exception ignored) {
                        }
                    }
                    toast("没有可用的地图应用，已复制地址：" + keyword);
                }
            });
        }

        /**
         * 设置闹钟阶梯：ACTION_SET_ALARM（预填，用户确认）→ 打开时钟 → 提示。
         */
        @JavascriptInterface
        public void setAlarm(final int hour, final int minute, final String message) {
            runOnUiThread(new Runnable() {
                public void run() {
                    // ① 标准闹钟 Intent（不需要 resolveActivity 预检：Android 11+ 包可见性会返回 null）
                    try {
                        Intent i = new Intent(AlarmClock.ACTION_SET_ALARM);
                        i.putExtra(AlarmClock.EXTRA_HOUR, hour);
                        i.putExtra(AlarmClock.EXTRA_MINUTES, minute);
                        i.putExtra(AlarmClock.EXTRA_MESSAGE, message);
                        i.putExtra(AlarmClock.EXTRA_SKIP_UI, false);
                        i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                        startActivity(i);
                        return;
                    } catch (Exception e) {
                        Log.w(TAG, "SET_ALARM 失败", e);
                    }
                    // ② 只是打开时钟
                    try {
                        Intent show = new Intent(AlarmClock.ACTION_SHOW_ALARMS);
                        show.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                        startActivity(show);
                        toast("已打开时钟，请手动新建闹钟");
                        return;
                    } catch (Exception e2) {
                        Log.w(TAG, "SHOW_ALARMS 失败", e2);
                    }
                    // ③ 直接拉起各家的时钟 App
                    String[] clocks = {"com.oplus.alarmclock", "com.coloros.alarmclock",
                            "com.android.deskclock", "com.google.android.deskclock"};
                    for (String pkg : clocks) {
                        if (launchPackage(pkg)) {
                            toast("已打开时钟，请手动新建闹钟 " + pad(hour) + ":" + pad(minute));
                            return;
                        }
                    }
                    // ④ 兜底：复制时间
                    copyText(pad(hour) + ":" + pad(minute) + " " + message);
                    toast("本机时钟不支持跳转，已复制时间 " + pad(hour) + ":" + pad(minute));
                }
            });
        }

        /**
         * 系统日历阶梯：ACTION_INSERT（预填，用户点保存）→ 打开日历 → 提示复制。
         * beginMs / endMs 为毫秒时间戳。
         */
        @JavascriptInterface
        public void addCalendarEvent(final String title, final String location,
                                     final String description, final long beginMs, final long endMs) {
            runOnUiThread(new Runnable() {
                public void run() {
                    // ① 标准 ACTION_INSERT（预填，用户点保存）
                    try {
                        Intent i = new Intent(Intent.ACTION_INSERT);
                        i.setData(CalendarContract.Events.CONTENT_URI);
                        i.putExtra(CalendarContract.EXTRA_EVENT_BEGIN_TIME, beginMs);
                        i.putExtra(CalendarContract.EXTRA_EVENT_END_TIME, endMs);
                        i.putExtra(CalendarContract.Events.TITLE, title);
                        i.putExtra(CalendarContract.Events.EVENT_LOCATION, location);
                        i.putExtra(CalendarContract.Events.DESCRIPTION, description);
                        i.putExtra(CalendarContract.Events.EVENT_TIMEZONE, TimeZone.getDefault().getID());
                        i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                        startActivity(i);
                        return;
                    } catch (Exception e) {
                        Log.w(TAG, "ACTION_INSERT 失败", e);
                    }
                    // ② 有的 ROM 只认 INSERT_OR_EDIT
                    try {
                        Intent i2 = new Intent(Intent.ACTION_INSERT_OR_EDIT);
                        i2.setType("vnd.android.cursor.item/event");
                        i2.putExtra(CalendarContract.EXTRA_EVENT_BEGIN_TIME, beginMs);
                        i2.putExtra(CalendarContract.EXTRA_EVENT_END_TIME, endMs);
                        i2.putExtra(CalendarContract.Events.TITLE, title);
                        i2.putExtra(CalendarContract.Events.EVENT_LOCATION, location);
                        i2.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                        startActivity(i2);
                        return;
                    } catch (Exception e2) {
                        Log.w(TAG, "INSERT_OR_EDIT 失败", e2);
                    }
                    // ③ 跳到日历的某一天
                    try {
                        Intent view = new Intent(Intent.ACTION_VIEW,
                                Uri.parse("content://com.android.calendar/time/" + beginMs));
                        view.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                        startActivity(view);
                        toast("日历不支持预填，已跳到当天，请手动新建");
                        return;
                    } catch (Exception e3) {
                        Log.w(TAG, "日历 VIEW 失败", e3);
                    }
                    // ④ 直接拉起各家日历 App
                    String[] cals = {"com.oplus.calendar", "com.coloros.calendar",
                            "com.android.calendar", "com.google.android.calendar"};
                    for (String pkg : cals) {
                        if (launchPackage(pkg)) {
                            toast("已打开日历，请手动新建事件");
                            return;
                        }
                    }
                    copyText(title + " " + location);
                    toast("本机日历不支持跳转，已复制事件信息");
                }
            });
        }

        /** 导出文本（JSON / Markdown）：调用系统「新建文件」选择器。 */
        @JavascriptInterface
        public void exportText(final String fileName, final String content, final String mime) {
            runOnUiThread(new Runnable() {
                public void run() {
                    String type = (mime == null || mime.length() == 0) ? "application/json" : mime;
                    Intent i = new Intent(Intent.ACTION_CREATE_DOCUMENT);
                    i.addCategory(Intent.CATEGORY_OPENABLE);
                    i.setType(type);
                    i.putExtra(Intent.EXTRA_TITLE, fileName);
                    // 选择器不可用（个别系统会这样）时不要静默失败：直接存到「下载 / Abbey Road」
                    if (i.resolveActivity(getPackageManager()) == null) {
                        fallbackSave(fileName, content, type);
                        return;
                    }
                    try {
                        pendingExportContent = content;
                        pendingExportMime = type;
                        startActivityForResult(i, REQ_EXPORT);
                    } catch (Exception e) {
                        fallbackSave(fileName, content, type);
                    }
                }
            });
        }

        /** 选择器用不了时的兜底：写进「下载 / Abbey Road」并告诉用户文件名 */
        private void fallbackSave(String fileName, String content, String mime) {
            Uri uri = writeToDownloads(fileName, content, mime);
            if (uri != null) {
                toast("已保存到「下载 / Abbey Road」：" + fileName);
            } else {
                toast("导出失败，请在「数据与备份」里再试一次");
            }
        }

        /** 导入文本：调用系统「打开文件」选择器，读完后回调网页。 */
        @JavascriptInterface
        public void importText() {
            runOnUiThread(new Runnable() {
                public void run() {
                    try {
                        Intent i = new Intent(Intent.ACTION_OPEN_DOCUMENT);
                        i.addCategory(Intent.CATEGORY_OPENABLE);
                        i.setType("*/*");
                        // 只挑文件、不要目录；把 .json 可能被识别成的几种类型都列上，
                        // 否则某些系统文件管理器会把刚导出的配置文件过滤掉。
                        i.putExtra(Intent.EXTRA_MIME_TYPES,
                                new String[]{"application/json", "application/x-json", "application/octet-stream",
                                        "text/plain", "text/markdown", "text/*"});
                        startActivityForResult(i, REQ_IMPORT);
                    } catch (Exception e) {
                        toast("无法打开文件选择器");
                    }
                }
            });
        }

        /**
         * 列出 App 自己导出的配置文件（「下载 / Abbey Road」目录）。
         * 有些系统的文件选择器很难用（比如找不到刚导出的文件），
         * 这里给网页一份可直接导入的清单，完全绕开系统选择器。
         * 返回 JSON 数组字符串：[{name, uri, size, modified}]
         */
        @JavascriptInterface
        public String listExports() {
            if (Build.VERSION.SDK_INT < 29) { return "[]"; }
            StringBuilder sb = new StringBuilder("[");
            android.database.Cursor c = null;
            try {
                Uri collection = MediaStore.Downloads.EXTERNAL_CONTENT_URI;
                String[] cols = {MediaStore.MediaColumns._ID, MediaStore.MediaColumns.DISPLAY_NAME,
                        MediaStore.MediaColumns.SIZE, MediaStore.MediaColumns.DATE_MODIFIED,
                        MediaStore.MediaColumns.RELATIVE_PATH};
                String sel = MediaStore.MediaColumns.RELATIVE_PATH + " LIKE ?";
                String[] args = new String[]{Environment.DIRECTORY_DOWNLOADS + "/Abbey Road%"};
                c = getContentResolver().query(collection, cols, sel, args,
                        MediaStore.MediaColumns.DATE_MODIFIED + " DESC");
                boolean first = true;
                while (c != null && c.moveToNext()) {
                    long id = c.getLong(0);
                    String name = c.getString(1);
                    long size = c.getLong(2);
                    long modified = c.getLong(3);
                    if (name == null || name.length() == 0) { continue; }
                    if (!first) { sb.append(','); }
                    first = false;
                    sb.append("{\"name\":").append(JSONObject.quote(name))
                      .append(",\"uri\":").append(JSONObject.quote(
                              android.content.ContentUris.withAppendedId(collection, id).toString()))
                      .append(",\"size\":").append(size)
                      .append(",\"modified\":").append(modified * 1000L).append('}');
                }
            } catch (Exception e) {
                return "[]";
            } finally {
                if (c != null) { c.close(); }
            }
            return sb.append(']').toString();
        }

        /** 读取一个 content:// 文件的文本（给上面的清单用；失败返回空串） */
        @JavascriptInterface
        public String readTextUri(final String uriText) {
            if (uriText == null || uriText.length() == 0) { return ""; }
            try {
                Uri uri = Uri.parse(uriText);
                InputStream in = getContentResolver().openInputStream(uri);
                ByteArrayOutputStream bos = new ByteArrayOutputStream();
                byte[] buf = new byte[16384];
                int n;
                while ((n = in.read(buf)) > 0) { bos.write(buf, 0, n); }
                in.close();
                return new String(bos.toByteArray(), StandardCharsets.UTF_8);
            } catch (Exception e) {
                return "";
            }
        }

        /** 系统声音（Windows 端用真实音效，Android 端留给系统反馈，这里只做提示音兜底）。 */
        @JavascriptInterface
        public void beep() {
            // Android 端不额外发声，避免打扰；震动已经提供了触觉反馈。
        }

        /** 由网页决定何时真正退出（例如不在任何弹窗中时按返回键）。 */
        @JavascriptInterface
        public void exitApp() {
            runOnUiThread(new Runnable() {
                public void run() {
                    finish();
                }
            });
        }

        /**
         * 桌面卡片的数据同步：网页把渲染好的课表快照交过来，
         * 这里落盘 + 立即刷新所有卡片实例。
         */
        @JavascriptInterface
        public void syncWidget(final String json) {
            if (json == null || json.length() == 0) { return; }
            try {
                getSharedPreferences(WidgetData.PREFS, Context.MODE_PRIVATE)
                        .edit().putString("payload", json).apply();
            } catch (Exception ignored) { }
            final Context ctx = MainActivity.this;
            new Thread(new Runnable() {
                public void run() {
                    try {
                        WidgetRenderer.refresh(ctx);
                    } catch (Exception e) {
                        Log.w(TAG, "桌面卡片刷新失败", e);
                    }
                }
            }).start();
        }

        /**
         * 开发用：把 5 种卡片按真实 RemoteViews 渲染成 PNG，
         * 写到 App 外部私有目录（Android/data/<pkg>/files/widget-preview/），
         * 方便在没有桌面宿主的环境里核对排版。用户正常使用不会触发。
         */
        @JavascriptInterface
        public String devWidgetPreview() {
            final Context ctx = MainActivity.this;
            try {
                return WidgetPreview.dump(ctx);
            } catch (Exception e) {
                Log.w(TAG, "卡片预览渲染失败", e);
                return "ERR: " + e;
            }
        }

        /** 让网页跟随主题调整状态栏/导航栏颜色与图标明暗。 */
        @JavascriptInterface
        public void setSystemBars(final String hexColor, final boolean lightIcons) {
            runOnUiThread(new Runnable() {
                public void run() {
                    try {
                        int c = Color.parseColor(hexColor);
                        Window w = getWindow();
                        w.setStatusBarColor(c);
                        w.setNavigationBarColor(c);
                        View decor = w.getDecorView();
                        int flags = decor.getSystemUiVisibility();
                        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                            flags = lightIcons
                                    ? (flags | View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR)
                                    : (flags & ~View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR);
                        }
                        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                            flags = lightIcons
                                    ? (flags | View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR)
                                    : (flags & ~View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR);
                        }
                        decor.setSystemUiVisibility(flags);
                    } catch (Exception ignored) {
                    }
                }
            });
        }
    }

    private static String pad(int v) {
        return v < 10 ? "0" + v : String.valueOf(v);
    }

    /** 直接按包名拉起 App（拿不到入口就返回 false，不抛异常）。 */
    private boolean launchPackage(String pkg) {
        try {
            Intent i = getPackageManager().getLaunchIntentForPackage(pkg);
            if (i == null) { return false; }
            i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            startActivity(i);
            return true;
        } catch (Exception e) {
            return false;
        }
    }

    /** 跳转全部失败时的兜底：把内容复制到剪贴板。 */
    private void copyText(String text) {
        try {
            ClipboardManager cm = (ClipboardManager) getSystemService(Context.CLIPBOARD_SERVICE);
            cm.setPrimaryClip(ClipData.newPlainText("Abbey Road", text));
        } catch (Exception ignored) { }
    }

    /** 外层工具提示（内部类 Bridge 也有同名方法，供网页直接调用）。 */
    private void toast(final String msg) {
        runOnUiThread(new Runnable() {
            public void run() {
                Toast.makeText(MainActivity.this, msg, Toast.LENGTH_SHORT).show();
            }
        });
    }

    /** 统一的「回调网页」入口：把结果作为参数传给 window.AR 上的处理函数。 */
    private void callJs(final String js) {
        runOnUiThread(new Runnable() {
            public void run() {
                if (web != null) {
                    web.evaluateJavascript(js, null);
                }
            }
        });
    }

    private static String q(String s) {
        return JSONObject.quote(s == null ? "" : s);
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode == REQ_EXPORT && resultCode == RESULT_OK && data != null && data.getData() != null) {
            Uri uri = data.getData();
            try {
                java.io.OutputStream os = getContentResolver().openOutputStream(uri);
                os.write(pendingExportContent.getBytes(StandardCharsets.UTF_8));
                os.flush();
                os.close();
                toast("已保存：" + uri.getLastPathSegment());
                callJs("window.AR && AR.onExported && AR.onExported(" + q(uri.getLastPathSegment()) + ")");
            } catch (Exception e) {
                toast("写入文件失败");
            } finally {
                pendingExportContent = null;
            }
        } else if (requestCode == REQ_IMPORT && resultCode == RESULT_OK && data != null && data.getData() != null) {
            Uri uri = data.getData();
            final String name = uri.getLastPathSegment();
            try {
                InputStream in = getContentResolver().openInputStream(uri);
                ByteArrayOutputStream bos = new ByteArrayOutputStream();
                byte[] buf = new byte[16384];
                int n;
                while ((n = in.read(buf)) > 0) {
                    bos.write(buf, 0, n);
                }
                in.close();
                final String text = new String(bos.toByteArray(), StandardCharsets.UTF_8);
                callJs("window.AR && AR.onFileText && AR.onFileText(" + q(text) + "," + q(name) + ")");
            } catch (Exception e) {
                toast("读取文件失败");
            }
        }
    }

    @Override
    public void onBackPressed() {
        // 交给网页决定：先关弹窗 → 回上一屏 → 都没有才退出
        callJs("window.AR && AR.onBack && AR.onBack()");
    }

    @Override
    public void onConfigurationChanged(Configuration newConfig) {
        super.onConfigurationChanged(newConfig);
        callJs("window.AR && AR.onResize && AR.onResize()");
    }

    @Override
    protected void onResume() {
        super.onResume();
        // 回到前台：网页侧据此刷新时钟，并在跨天时自动跟到新的「今天」
        callJs("window.AR && AR.onResume && AR.onResume()");
    }
}
