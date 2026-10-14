package com.ganxing.abbeyroad;

import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.Context;

/** 桌面卡片 ①：今日头（日期 / 周次 / 今天几节课） */
public class WidgetHeadProvider extends AppWidgetProvider {
    @Override
    public void onUpdate(Context ctx, AppWidgetManager mgr, int[] ids) {
        WidgetData d = WidgetData.load(ctx);
        for (int i = 0; i < ids.length; i++) {
            mgr.updateAppWidget(ids[i], WidgetRenderer.build(ctx, WidgetRenderer.STYLE_HEAD, d));
        }
    }
}
