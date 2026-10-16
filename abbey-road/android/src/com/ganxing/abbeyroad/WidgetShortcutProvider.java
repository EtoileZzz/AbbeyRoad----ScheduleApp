package com.ganxing.abbeyroad;

import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.Context;

/** 桌面卡片 ⑤：快捷入口（今日 / 周表 / 导入 / 设置） */
public class WidgetShortcutProvider extends AppWidgetProvider {
    @Override
    public void onUpdate(Context ctx, AppWidgetManager mgr, int[] ids) {
        WidgetData d = WidgetData.load(ctx);
        for (int i = 0; i < ids.length; i++) {
            mgr.updateAppWidget(ids[i], WidgetRenderer.build(ctx, WidgetRenderer.STYLE_SHORTCUTS, d));
        }
    }
}
