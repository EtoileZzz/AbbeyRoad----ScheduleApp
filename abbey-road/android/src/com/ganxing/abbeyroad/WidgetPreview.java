package com.ganxing.abbeyroad;

import android.content.Context;
import android.graphics.Bitmap;
import android.graphics.Canvas;
import android.view.View;
import android.widget.RemoteViews;

import java.io.File;
import java.io.FileOutputStream;
import java.io.OutputStream;

/**
 * 开发辅助：把 5 种桌面卡片用真实的 RemoteViews 渲染成位图。
 *
 * 没有桌面宿主（比如模拟器的启动器不支持小组件）时，用它来核对卡片排版：
 * 走的是同一套 layout + RemoteViews.apply()，所以能真实反映卡片长什么样。
 * 输出目录：Android/data/com.ganxing.abbeyroad/files/widget-preview/
 */
final class WidgetPreview {

    private WidgetPreview() { }

    static String dump(Context ctx) throws Exception {
        File dir = ctx.getExternalFilesDir("widget-preview");
        if (dir == null) { throw new IllegalStateException("no external dir"); }
        if (!dir.exists() && !dir.mkdirs()) { throw new IllegalStateException("mkdir failed"); }

        WidgetData d = WidgetData.load(ctx);
        float den = ctx.getResources().getDisplayMetrics().density;

        int[][] plan = {
                {WidgetRenderer.STYLE_HEAD, 4, 1},
                {WidgetRenderer.STYLE_NEXT, 2, 2},
                {WidgetRenderer.STYLE_TODAY, 4, 2},
                {WidgetRenderer.STYLE_WEEK, 4, 3},
                {WidgetRenderer.STYLE_SHORTCUTS, 4, 1}
        };
        String[] names = {"1-head", "2-next", "3-today", "4-week", "5-shortcuts"};

        StringBuilder sb = new StringBuilder();
        for (int i = 0; i < plan.length; i++) {
            int style = plan[i][0];
            int w = Math.round((plan[i][1] * 78 - 16) * den);      // 一个单元格约 78dp，去掉宿主留白
            int h = Math.round((plan[i][2] * 78 - 16) * den);
            RemoteViews rv = WidgetRenderer.build(ctx, style, d);
            View v = rv.apply(ctx, null);
            v.measure(View.MeasureSpec.makeMeasureSpec(w, View.MeasureSpec.EXACTLY),
                      View.MeasureSpec.makeMeasureSpec(h, View.MeasureSpec.EXACTLY));
            v.layout(0, 0, w, h);
            Bitmap bmp = Bitmap.createBitmap(w, h, Bitmap.Config.ARGB_8888);
            Canvas canvas = new Canvas(bmp);
            canvas.drawColor(0xFFDDE3EE);       // 桌面底色，方便看清卡片圆角
            v.draw(canvas);
            File out = new File(dir, names[i] + ".png");
            OutputStream os = new FileOutputStream(out);
            bmp.compress(Bitmap.CompressFormat.PNG, 100, os);
            os.close();
            bmp.recycle();
            sb.append(out.getName()).append(' ');
        }
        return dir.getAbsolutePath() + " :: " + sb;
    }
}
