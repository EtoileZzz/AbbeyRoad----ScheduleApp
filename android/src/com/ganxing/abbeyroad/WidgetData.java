package com.ganxing.abbeyroad;

import android.content.Context;
import android.content.SharedPreferences;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.List;

/**
 * 桌面卡片的数据源。
 *
 * 课表本体存在网页侧的 localStorage 里（两端共用同一套数据结构），
 * 网页每次数据变化都会把一份「渲染好的快照」通过 ARBridge.syncWidget() 写进
 * SharedPreferences；桌面卡片的进程只读这份快照，不解析业务规则。
 */
final class WidgetData {

    static final String PREFS = "abbeyroad_widget";
    private static final String KEY = "payload";

    /** 今日课程清单里的一行 */
    static final class Row {
        String time = "";
        String name = "";
        String place = "";
        String color = "#5B8DEF";
    }

    /** 迷你周表里的一个课程块 */
    static final class Cell {
        int day = 1;
        int start = 1;
        int end = 1;
        String color = "#5B8DEF";
        String name = "";
    }

    String dateText = "";        // 9月14日 周一
    int weekNo = 0;              // 第几周（0 = 未知）
    String weekRange = "";       // 9月14日 – 9月20日
    String todayTitle = "今天";
    String todaySub = "";
    String todayBadge = "";
    String nextLabel = "下一节课";
    String nextIn = "";
    String nextName = "";
    String nextTime = "";
    String nextPlace = "";
    String weekTotalText = "";
    int todayIdx = 0;            // 今天是一周里的第几天（1-7，0 = 不在本周）
    final List<String> dates = new ArrayList<String>();
    final List<Row> today = new ArrayList<Row>();
    final List<Cell> week = new ArrayList<Cell>();
    /** 0.4.1c：用户关掉的元素（headSub / headBadge / nextIn / nextTime / nextPlace / todayTime / todayPlace / weekSub） */
    final List<String> hide = new ArrayList<String>();

    boolean hidden(String key) { return hide.contains(key); }

    static WidgetData load(Context ctx) {
        WidgetData d = new WidgetData();
        try {
            SharedPreferences sp = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
            String raw = sp.getString(KEY, null);
            if (raw == null || raw.length() == 0) { return d; }
            d.parse(new JSONObject(raw));
        } catch (Exception ignored) {
            // 数据坏了就当空数据，卡片显示占位文案，不影响 App 本体
        }
        return d;
    }

    private void parse(JSONObject o) {
        dateText = o.optString("dateText", dateText);
        weekNo = o.optInt("weekNo", 0);
        weekRange = o.optString("weekRange", "");
        todayTitle = o.optString("todayTitle", todayTitle);
        todaySub = o.optString("todaySub", "");
        todayBadge = o.optString("todayBadge", "");
        nextLabel = o.optString("nextLabel", nextLabel);
        nextIn = o.optString("nextIn", "");
        nextName = o.optString("nextName", "");
        nextTime = o.optString("nextTime", "");
        nextPlace = o.optString("nextPlace", "");
        weekTotalText = o.optString("weekTotalText", "");
        todayIdx = o.optInt("todayIdx", 0);

        JSONArray ds = o.optJSONArray("dates");
        if (ds != null) {
            for (int i = 0; i < ds.length(); i++) { dates.add(ds.optString(i, "")); }
        }
        JSONArray hd = o.optJSONArray("hide");
        if (hd != null) {
            for (int i = 0; i < hd.length(); i++) { hide.add(hd.optString(i, "")); }
        }
        JSONArray rows = o.optJSONArray("today");
        if (rows != null) {
            for (int i = 0; i < rows.length(); i++) {
                JSONObject r = rows.optJSONObject(i);
                if (r == null) { continue; }
                Row row = new Row();
                row.time = r.optString("time", "");
                row.name = r.optString("name", "");
                row.place = r.optString("place", "");
                row.color = r.optString("color", row.color);
                today.add(row);
            }
        }
        JSONArray cells = o.optJSONArray("week");
        if (cells != null) {
            for (int i = 0; i < cells.length(); i++) {
                JSONObject c = cells.optJSONObject(i);
                if (c == null) { continue; }
                Cell cell = new Cell();
                cell.day = c.optInt("d", 1);
                cell.start = c.optInt("s", 1);
                cell.end = c.optInt("e", cell.start);
                cell.color = c.optString("color", cell.color);
                cell.name = c.optString("name", "");
                week.add(cell);
            }
        }
    }
}
