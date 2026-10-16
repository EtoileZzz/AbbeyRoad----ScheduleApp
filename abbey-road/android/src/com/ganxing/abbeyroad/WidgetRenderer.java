package com.ganxing.abbeyroad;

import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.graphics.Color;
import android.os.Build;
import android.view.View;
import android.widget.RemoteViews;

import java.util.List;

/**
 * 5 种桌面卡片的渲染：
 *   ① head      —— 今日头（日期 / 周次 / 今天几节课）
 *   ② next      —— 下一节课（课程 / 时间 / 地点 / 倒计时）
 *   ③ today     —— 今日课程清单（最多 4 条）
 *   ④ week      —— 本周迷你课表（7 天 × 6 行色块）
 *   ⑤ shortcuts —— 快捷入口（今日 / 周表 / 导入 / 设置）
 *
 * 全部只用 RemoteViews 支持的控件（TextView / ImageView / LinearLayout），
 * 色块用 ImageView 的 setBackgroundColor，避免低版本宿主加载失败。
 */
final class WidgetRenderer {

    static final int STYLE_HEAD = 1;
    static final int STYLE_NEXT = 2;
    static final int STYLE_TODAY = 3;
    static final int STYLE_WEEK = 4;
    static final int STYLE_SHORTCUTS = 5;

    private static final int WEEK_ROWS = 6;
    private static final int[][] WEEK_CELLS = {
            {R.id.wc11, R.id.wc21, R.id.wc31, R.id.wc41, R.id.wc51, R.id.wc61, R.id.wc71},
            {R.id.wc12, R.id.wc22, R.id.wc32, R.id.wc42, R.id.wc52, R.id.wc62, R.id.wc72},
            {R.id.wc13, R.id.wc23, R.id.wc33, R.id.wc43, R.id.wc53, R.id.wc63, R.id.wc73},
            {R.id.wc14, R.id.wc24, R.id.wc34, R.id.wc44, R.id.wc54, R.id.wc64, R.id.wc74},
            {R.id.wc15, R.id.wc25, R.id.wc35, R.id.wc45, R.id.wc55, R.id.wc65, R.id.wc75},
            {R.id.wc16, R.id.wc26, R.id.wc36, R.id.wc46, R.id.wc56, R.id.wc66, R.id.wc76}
    };
    private static final int[] WEEK_DAY_LABEL = {
            R.id.wd1, R.id.wd2, R.id.wd3, R.id.wd4, R.id.wd5, R.id.wd6, R.id.wd7
    };

    private WidgetRenderer() { }

    static RemoteViews build(Context ctx, int style, WidgetData d) {
        if (style == STYLE_NEXT) { return buildNext(ctx, d); }
        if (style == STYLE_TODAY) { return buildToday(ctx, d); }
        if (style == STYLE_WEEK) { return buildWeek(ctx, d); }
        if (style == STYLE_SHORTCUTS) { return buildShortcuts(ctx, d); }
        return buildHead(ctx, d);
    }

    /* ── ① 今日头 ─────────────────────────────────────────────── */

    private static RemoteViews buildHead(Context ctx, WidgetData d) {
        RemoteViews v = new RemoteViews(ctx.getPackageName(), R.layout.widget_head);
        v.setTextViewText(R.id.h_title, empty(d.dateText, "Abbey Road"));
        v.setTextViewText(R.id.h_sub, empty(d.todaySub, "还没有导入课表"));
        v.setTextViewText(R.id.h_badge, empty(d.todayBadge, "—"));
        // 0.4.1c：元素开关（关掉的直接隐藏，不留空位）
        v.setViewVisibility(R.id.h_sub, d.hidden("headSub") ? View.GONE : View.VISIBLE);
        v.setViewVisibility(R.id.h_badge, d.hidden("headBadge") ? View.GONE : View.VISIBLE);
        v.setOnClickPendingIntent(R.id.h_root, open(ctx, "today", 10));
        return v;
    }

    /* ── ② 下一节课 ───────────────────────────────────────────── */

    private static RemoteViews buildNext(Context ctx, WidgetData d) {
        RemoteViews v = new RemoteViews(ctx.getPackageName(), R.layout.widget_next);
        boolean has = d.nextName != null && d.nextName.length() > 0;
        v.setTextViewText(R.id.n_label, empty(d.nextLabel, "下一节课"));
        v.setTextViewText(R.id.n_in, has ? empty(d.nextIn, "") : "");
        v.setTextViewText(R.id.n_name, has ? d.nextName : "最近没有安排");
        v.setTextViewText(R.id.n_time, has ? d.nextTime : "导入课表后这里会显示下一节课");
        v.setTextViewText(R.id.n_place, has ? d.nextPlace : "");
        // 0.4.1c：元素开关 —— 关掉的行隐藏
        v.setViewVisibility(R.id.n_in, d.hidden("nextIn") ? View.GONE : View.VISIBLE);
        v.setViewVisibility(R.id.n_time, d.hidden("nextTime") ? View.GONE : View.VISIBLE);
        v.setViewVisibility(R.id.n_place, d.hidden("nextPlace") ? View.GONE : View.VISIBLE);
        v.setOnClickPendingIntent(R.id.n_root, open(ctx, has ? "today" : "import", 11));
        return v;
    }

    /* ── ③ 今日课程清单 ───────────────────────────────────────── */

    private static RemoteViews buildToday(Context ctx, WidgetData d) {
        RemoteViews v = new RemoteViews(ctx.getPackageName(), R.layout.widget_today);
        int n = Math.min(d.today.size(), 4);
        int[] rows = {R.id.t_row1, R.id.t_row2, R.id.t_row3, R.id.t_row4};
        int[] bars = {R.id.t_bar1, R.id.t_bar2, R.id.t_bar3, R.id.t_bar4};
        int[] names = {R.id.t_name1, R.id.t_name2, R.id.t_name3, R.id.t_name4};
        int[] metas = {R.id.t_meta1, R.id.t_meta2, R.id.t_meta3, R.id.t_meta4};

        v.setTextViewText(R.id.t_title, empty(d.todayTitle, "今天"));
        v.setTextViewText(R.id.t_sub, d.today.size() > 0 ? (d.today.size() + " 节课") : "");
        v.setViewVisibility(R.id.t_empty, n == 0 ? View.VISIBLE : View.GONE);
        v.setTextViewText(R.id.t_empty, "今天没有课，好好休息 ☕");

        for (int i = 0; i < 4; i++) {
            if (i < n) {
                WidgetData.Row r = d.today.get(i);
                v.setViewVisibility(rows[i], View.VISIBLE);
                v.setInt(bars[i], "setBackgroundColor", color(r.color, 0xFF5B8DEF));
                v.setTextViewText(names[i], r.name);
                v.setTextViewText(metas[i], joinMeta(r.time, r.place));
                // 时间/地点都关掉（或本来就是空）时，整行 meta 隐藏，不留空行
                boolean metaHidden = d.hidden("todayTime") && d.hidden("todayPlace");
                v.setViewVisibility(metas[i], metaHidden ? View.GONE : View.VISIBLE);
            } else {
                v.setViewVisibility(rows[i], View.GONE);
            }
        }
        v.setOnClickPendingIntent(R.id.t_root, open(ctx, "today", 12));
        return v;
    }

    /* ── ④ 本周迷你课表 ───────────────────────────────────────── */

    private static RemoteViews buildWeek(Context ctx, WidgetData d) {
        RemoteViews v = new RemoteViews(ctx.getPackageName(), R.layout.widget_week);
        v.setTextViewText(R.id.w_title, d.weekNo > 0 ? ("第 " + d.weekNo + " 周") : "本周课表");
        v.setTextViewText(R.id.w_sub, empty(d.weekTotalText, ""));
        // 0.4.1c：总节数可以关掉
        v.setViewVisibility(R.id.w_sub, d.hidden("weekSub") ? View.GONE : View.VISIBLE);

        int slot = ctx.getResources().getColor(R.color.widget_slot);
        for (int row = 0; row < WEEK_ROWS; row++) {
            for (int day = 0; day < 7; day++) {
                v.setInt(WEEK_CELLS[row][day], "setBackgroundColor", slot);
            }
        }
        for (int i = 0; i < d.week.size(); i++) {
            WidgetData.Cell c = d.week.get(i);
            int day = c.day - 1;
            if (day < 0 || day > 6) { continue; }
            int from = Math.max(1, c.start) - 1;
            int to = Math.min(WEEK_ROWS, Math.max(c.end, c.start)) - 1;
            int col = color(c.color, 0xFF5B8DEF);
            for (int row = from; row <= to && row < WEEK_ROWS; row++) {
                v.setInt(WEEK_CELLS[row][day], "setBackgroundColor", col);
            }
        }
        // 日期行：今天是星期几就高亮哪一个
        int accent = ctx.getResources().getColor(R.color.accent);
        int dim = ctx.getResources().getColor(R.color.widget_dim);
        for (int day = 0; day < 7; day++) {
            String txt = day < d.dates.size() ? d.dates.get(day) : "";
            v.setTextViewText(WEEK_DAY_LABEL[day], txt);
            v.setTextColor(WEEK_DAY_LABEL[day], (d.todayIdx == day + 1) ? accent : dim);
        }
        v.setOnClickPendingIntent(R.id.w_root, open(ctx, "week", 13));
        return v;
    }

    /* ── ⑤ 快捷入口 ───────────────────────────────────────────── */

    private static RemoteViews buildShortcuts(Context ctx, WidgetData d) {
        RemoteViews v = new RemoteViews(ctx.getPackageName(), R.layout.widget_shortcuts);
        String title = d.today.size() > 0
                ? (empty(d.dateText, "今天") + " · " + d.today.size() + " 节课")
                : empty(d.dateText, "Abbey Road") + " · 今天没有课";
        v.setTextViewText(R.id.s_title, title);
        v.setOnClickPendingIntent(R.id.s_today, open(ctx, "today", 20));
        v.setOnClickPendingIntent(R.id.s_week, open(ctx, "week", 21));
        v.setOnClickPendingIntent(R.id.s_import, open(ctx, "import", 22));
        v.setOnClickPendingIntent(R.id.s_settings, open(ctx, "settings", 23));
        return v;
    }

    /* ── 公共 ─────────────────────────────────────────────────── */

    /** 打开 App 并直接切到某个视图（today / week / import / settings） */
    static PendingIntent open(Context ctx, String view, int req) {
        Intent i = new Intent(ctx, MainActivity.class);
        i.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        i.putExtra(MainActivity.EXTRA_VIEW, view);
        int flags = PendingIntent.FLAG_UPDATE_CURRENT;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) { flags |= PendingIntent.FLAG_IMMUTABLE; }
        return PendingIntent.getActivity(ctx, req, i, flags);
    }

    /** 数据变了：把 5 种卡片的实例全部重画一遍 */
    static void refresh(Context ctx) {
        AppWidgetManager m = AppWidgetManager.getInstance(ctx);
        WidgetData d = WidgetData.load(ctx);
        Class<?>[] classes = {
                WidgetHeadProvider.class, WidgetNextProvider.class, WidgetTodayProvider.class,
                WidgetWeekProvider.class, WidgetShortcutProvider.class
        };
        int[] styles = {STYLE_HEAD, STYLE_NEXT, STYLE_TODAY, STYLE_WEEK, STYLE_SHORTCUTS};
        for (int i = 0; i < classes.length; i++) {
            try {
                ComponentName cn = new ComponentName(ctx, classes[i]);
                int[] ids = m.getAppWidgetIds(cn);
                for (int k = 0; k < ids.length; k++) {
                    m.updateAppWidget(ids[k], build(ctx, styles[i], d));
                }
            } catch (Exception ignored) { }
        }
    }

    static int color(String hex, int fallback) {
        try {
            if (hex == null || hex.length() == 0) { return fallback; }
            return Color.parseColor(hex.startsWith("#") ? hex : ("#" + hex));
        } catch (Exception e) {
            return fallback;
        }
    }

    private static String empty(String s, String fallback) {
        return (s == null || s.length() == 0) ? fallback : s;
    }

    private static String joinMeta(String time, String place) {
        if (time == null || time.length() == 0) { return place == null ? "" : place; }
        if (place == null || place.length() == 0) { return time; }
        return time + " · " + place;
    }

    /** 迷你周表和今日清单用不到的字段（留给后续样式扩展） */
    static List<WidgetData.Cell> cells(WidgetData d) { return d.week; }
}
