package com.ganxing.abbeyroad;

import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.Context;

/** 桌面卡片 ③：今日课程清单（最多 4 条） */
public class WidgetTodayProvider extends AppWidgetProvider {
    @Override
    public void onUpdate(Context ctx, AppWidgetManager mgr, int[] ids) {
        WidgetData d = WidgetData.load(ctx);
        for (int i = 0; i < ids.length; i++) {
            mgr.updateAppWidget(ids[i], WidgetRenderer.build(ctx, WidgetRenderer.STYLE_TODAY, d));
        }
    }
}
