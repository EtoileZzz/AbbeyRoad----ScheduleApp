package com.ganxing.abbeyroad;

import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.Context;

/** 桌面卡片 ④：本周迷你课表（7 天 × 6 行色块） */
public class WidgetWeekProvider extends AppWidgetProvider {
    @Override
    public void onUpdate(Context ctx, AppWidgetManager mgr, int[] ids) {
        WidgetData d = WidgetData.load(ctx);
        for (int i = 0; i < ids.length; i++) {
            mgr.updateAppWidget(ids[i], WidgetRenderer.build(ctx, WidgetRenderer.STYLE_WEEK, d));
        }
    }
}
