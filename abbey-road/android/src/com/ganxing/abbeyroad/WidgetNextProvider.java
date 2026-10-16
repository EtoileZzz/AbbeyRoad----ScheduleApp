package com.ganxing.abbeyroad;

import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.Context;

/** 桌面卡片 ②：下一节课（课程 / 时间 / 地点 / 倒计时） */
public class WidgetNextProvider extends AppWidgetProvider {
    @Override
    public void onUpdate(Context ctx, AppWidgetManager mgr, int[] ids) {
        WidgetData d = WidgetData.load(ctx);
        for (int i = 0; i < ids.length; i++) {
            mgr.updateAppWidget(ids[i], WidgetRenderer.build(ctx, WidgetRenderer.STYLE_NEXT, d));
        }
    }
}
