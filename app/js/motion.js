/* ──────────────────────────────────────────────────────────────
   Abbey Road · 过渡动画注册表（AR.Motion）

   两个设计要点：
   ① **进和出是一件事**。今日页聚焦、弹窗这类"有进有出"的场景只占一行，
      样式里同时给出 in / out 参数 —— 以前放大和缩小是两个独立选项，
      很容易选成两套风格，一进一出像两个 App。
   ② 样式描述的是"内容相对栏框的姿态"：翻转、折纸、景深、扩散…
      栏框本身永远是真实几何补间（left/top/width/height），不做缩放变形，
      所以文字不会跟着被拉伸。

   开发者模式（设置 → 长按外观）里可以逐场景换样式，改完立刻生效。
   ────────────────────────────────────────────────────────────── */

var AR = window.AR || (window.AR = {});

(function () {
  'use strict';

  /** 缓动家族：全部非线性（linear 只留给"无动画"这类特殊选择） */
  var EASE = {
    quint: 'cubic-bezier(.18,1,.28,1)',        // 强缓出，默认
    expo: 'cubic-bezier(.16,1,.30,1)',         // 更急的缓出
    soft: 'cubic-bezier(.40,0,.20,1)',         // 柔和进出
    emphasized: 'cubic-bezier(.05,.70,.10,1)', // Material emphasized
    ios: 'cubic-bezier(.32,.72,0,1)',          // iOS 风格
    snappy: 'cubic-bezier(.20,.90,.10,1)',     // 快速收尾
    spring: 'cubic-bezier(.34,1.42,.52,1)',    // 轻微回弹
    back: 'cubic-bezier(.28,1.30,.46,1)',      // 明显回弹
    gentle: 'cubic-bezier(.25,.80,.35,1)',
    tile: 'cubic-bezier(.20,.80,.20,1)',       // 磁贴式：先快后稳
    reveal: 'cubic-bezier(.45,0,.55,1)',       // 揭示式扩散：S 型，波前一路匀速走完
    quartOut: 'cubic-bezier(.17,.84,.44,1)',
    expoIn: 'cubic-bezier(.70,0,.84,0)',       // 缓入（用于"先离场"）
    overshoot: 'cubic-bezier(.22,1.35,.36,1)',
    linear: 'linear'
  };

  /**
   * 场景表。styles[].k 是存档键，name 是设置里显示的名字。
   * in / out 里可用字段：
   *   dur / ease      时长（ms）与曲线名
   *   content         内容层淡入方式：settle / rise / fade / none
   *   fx / fxDur / fxStagger   内容层特效（见 ui.js playContentFx）
   *   stagger         三栏错峰（ms）
   *   from / to       弹窗姿势：{ o 透明度, x, y, s 缩放, rot 旋转, rx 绕X, blur 模糊 }
   *   origin          弹窗变换原点；childStagger 内容逐条错峰
   */
  var SCENARIOS = {
    zoneFocus: {
      name: '今日页 · 聚焦放大 / 缩小',
      default: 'rippleSpring',
      styles: [
        {
          k: 'rippleSpring', name: '点击处扩散 + 回弹放大（默认）',
          in: { dur: 460, ease: 'back', fx: 'ripple', fxDur: 500, content: 'none' },
          out: { dur: 300, ease: 'soft', fx: 'depthOut', fxDur: 300, content: 'settle' }
        },
        {
          // 磁贴翻转：以"你点的位置"那条边为轴翻进来（点右半屏 → 从右往左翻）
          k: 'tileFlip', name: '磁贴翻转（从点击处翻入）', tile: true,
          in: { dur: 520, ease: 'tile', fx: 'hingeFlip', fxDur: 640, content: 'none' },
          out: { dur: 380, ease: 'tile', fx: 'hingeFlipOut', fxDur: 420, content: 'none' }
        },
        {
          k: 'tileMosaic', name: '磁贴拼合',
          in: { dur: 420, ease: 'quartOut', fx: 'mosaic', fxDur: 460, fxStagger: 55, content: 'none' },
          out: { dur: 260, ease: 'soft', fx: 'fade', fxDur: 220, content: 'none' }
        },
        {
          k: 'origami', name: '折纸展开',
          in: { dur: 460, ease: 'expo', fx: 'foldX', fxDur: 520, fxStagger: 45, content: 'none' },
          out: { dur: 330, ease: 'expoIn', fx: 'foldXOut', fxDur: 320, content: 'none' }
        },
        {
          k: 'depth', name: '景深推移',
          in: { dur: 440, ease: 'ios', fx: 'depth', fxDur: 520, content: 'none' },
          out: { dur: 320, ease: 'soft', fx: 'depthOut', fxDur: 320, content: 'none' }
        },
        {
          k: 'spotlight', name: '聚光显影',
          in: { dur: 420, ease: 'emphasized', fx: 'spotlight', fxDur: 560, content: 'none' },
          out: { dur: 260, ease: 'soft', fx: 'fade', content: 'none' }
        },
        {
          k: 'cascade', name: '瀑布逐条',
          in: { dur: 380, ease: 'quint', fx: 'cascade', fxDur: 420, fxStagger: 70, content: 'none' },
          out: { dur: 240, ease: 'soft', fx: 'fade', content: 'none' }
        },
        {
          k: 'sharedAxis', name: '共享轴推进',
          in: { dur: 420, ease: 'emphasized', fx: 'axialZ', fxDur: 460, content: 'none' },
          out: { dur: 320, ease: 'emphasized', fx: 'axialZOut', fxDur: 340, content: 'none' }
        },
        {
          k: 'spring', name: '回弹放大',
          in: { dur: 520, ease: 'back', fx: 'settle', content: 'settle' },
          out: { dur: 300, ease: 'soft', content: 'settle' }
        },
        {
          k: 'ios', name: '顺滑展开',
          in: { dur: 460, ease: 'ios', fx: 'settle', content: 'rise' },
          out: { dur: 330, ease: 'ios', content: 'fade' }
        },
        {
          k: 'fadeThrough', name: '淡出淡入',
          in: { dur: 340, ease: 'emphasized', content: 'fade' },
          out: { dur: 260, ease: 'emphasized', content: 'fade' }
        },
        {
          k: 'stagger', name: '错峰推进',
          in: { dur: 420, ease: 'expo', content: 'rise', stagger: 45 },
          out: { dur: 300, ease: 'emphasized', content: 'fade', stagger: 35 }
        },
        {
          k: 'snap', name: '快速吸附',
          in: { dur: 240, ease: 'snappy', content: 'none' },
          out: { dur: 200, ease: 'snappy', content: 'none' }
        },
        {
          k: 'instant', name: '无动画（瞬切）',
          in: { dur: 0, ease: 'linear', content: 'none' },
          out: { dur: 0, ease: 'linear', content: 'none' }
        }
      ]
    },
    contentIn: {
      name: '卡片内容 · 浮入',
      default: 'settle',
      styles: [
        { k: 'settle', name: '上浮落定（默认）', dur: 300, ease: 'expo', y: 10, s: .986, hold: .45 },
        { k: 'rise', name: '纯上浮', dur: 300, ease: 'quint', y: 16, s: 1, hold: .5 },
        { k: 'fade', name: '只淡入', dur: 240, ease: 'soft', y: 0, s: 1, hold: .6 },
        { k: 'zoom', name: '轻微放大', dur: 340, ease: 'back', y: 0, s: .92, hold: .45 },
        { k: 'slide', name: '侧向滑入', dur: 320, ease: 'ios', x: 28, y: 0, s: 1, hold: .5 },
        { k: 'blurIn', name: '模糊聚焦', dur: 340, ease: 'expo', y: 6, s: 1.02, blur: 10, hold: .55 },
        { k: 'tileFlip', name: '磁贴翻转（从点击处翻入）', tile: true,
          dur: 420, ease: 'tile', fx: 'hingeFlip', fxDur: 560, content: 'none' },
        { k: 'none', name: '不要内容动画', dur: 0 }
      ]
    },
    modal: {
      name: '弹窗 · 进入 / 退出',
      // 默认改成磁贴翻转：所有弹窗（位置 / 时间 / 老师 / 备注 / 课程详情 …）
      // 都从点击处翻入、原路翻回，和卡片、页面切换是同一套语言。
      default: 'tileFlip',
      styles: [
        {
          k: 'cascade', name: '内容逐条拼合',
          in: { dur: 320, ease: 'quint', from: { o: 0, y: 18, s: .985 }, childStagger: 45 },
          out: { dur: 200, ease: 'soft', to: { o: 0, y: 8, s: .98 } }
        },
        {
          k: 'pop', name: '弹起',
          in: { dur: 300, ease: 'expo', from: { o: 0, y: 14, s: .94 } },
          out: { dur: 190, ease: 'soft', to: { o: 0, y: 6, s: .975 } }
        },
        {
          k: 'tileFlip', name: '磁贴翻转（默认）',
          in: { dur: 460, ease: 'tile', from: { o: 0, ry: 94, s: .94 }, origin: 'click', childStagger: 40 },
          out: { dur: 320, ease: 'tile', to: { o: 0, ry: 88, s: .96 }, origin: 'click' },
          tile: true
        },
        {
          k: 'unfold', name: '自上而下展开',
          in: { dur: 420, ease: 'expo', from: { o: 0, rx: -70, y: -8 }, origin: 'center top', childStagger: 38 },
          out: { dur: 300, ease: 'expoIn', to: { o: 0, rx: -64, y: -10 }, origin: 'center bottom' }
        },
        {
          k: 'dropIn', name: '落体回弹',
          in: { dur: 520, ease: 'overshoot', from: { o: 0, y: -46, s: 1 } },
          out: { dur: 320, ease: 'emphasized', to: { o: 0, y: 64, s: .96 } }
        },
        {
          k: 'spin', name: '旋入放大',
          in: { dur: 400, ease: 'back', from: { o: 0, s: .72, rot: -6 } },
          out: { dur: 280, ease: 'emphasized', to: { o: 0, s: .72, rot: 5 } }
        },
        {
          k: 'slideUp', name: '底部推入',
          in: { dur: 340, ease: 'emphasized', from: { o: 0, y: 52, s: 1 } },
          out: { dur: 240, ease: 'emphasized', to: { o: 0, y: 60, s: 1 } }
        },
        {
          k: 'sheet', name: '底部抽屉',
          in: { dur: 400, ease: 'ios', from: { o: 0, y: 120, s: 1 }, childStagger: 40 },
          out: { dur: 300, ease: 'emphasized', to: { o: 0, y: 130, s: 1 } }
        },
        {
          k: 'slideSide', name: '侧向滑入 / 滑出',
          in: { dur: 320, ease: 'ios', from: { o: 0, x: 60, s: 1 } },
          out: { dur: 240, ease: 'emphasized', to: { o: 0, x: 70, s: 1 } }
        },
        {
          k: 'blurIn', name: '模糊聚焦',
          in: { dur: 360, ease: 'expo', from: { o: 0, s: 1.03, blur: 14 }, childStagger: 35 },
          out: { dur: 260, ease: 'soft', to: { o: 0, s: 1.02, blur: 10 } }
        },
        {
          k: 'zoomIn', name: '从零放大',
          in: { dur: 300, ease: 'back', from: { o: 0, s: .78 } },
          out: { dur: 200, ease: 'emphasized', to: { o: 0, s: .88 } }
        },
        {
          k: 'none', name: '无动画',
          in: { dur: 0 }, out: { dur: 0 }
        }
      ]
    },
    viewIn: {
      name: '页面切换 · 入场',
      default: 'rise',
      styles: [
        { k: 'rise', name: '错峰上浮（默认）', dur: 500, ease: 'gentle', y: 12, headY: -24, stagger: 60, s: .97 },
        { k: 'tile', name: '磁贴翻入', dur: 460, ease: 'tile', y: 0, headY: 0, stagger: 55, s: 1,
          rx: -82, origin: 'center top', tile: true },
        { k: 'cascade', name: '逐块落下', dur: 380, ease: 'expo', y: -22, headY: -22, stagger: 70, s: 1 },
        { k: 'depth', name: '景深推近', dur: 480, ease: 'ios', y: 0, headY: 0, stagger: 40, s: .90, blur: 12 },
        { k: 'fade', name: '只淡入', dur: 260, ease: 'soft', y: 0, headY: 0, stagger: 0, s: 1 },
        { k: 'slideLeft', name: '右侧滑入', dur: 380, ease: 'ios', x: 26, y: 0, headY: 0, stagger: 30, s: 1 },
        { k: 'slideUp', name: '整屏上移', dur: 420, ease: 'emphasized', y: 26, headY: 0, stagger: 0, s: 1 },
        { k: 'zoom', name: '轻微放大', dur: 380, ease: 'back', y: 6, headY: 0, stagger: 0, s: .96 },
        { k: 'none', name: '无动画', dur: 0 }
      ]
    },
    listIn: {
      name: '列表 · 逐条入场',
      default: 'fade',
      styles: [
        { k: 'fade', name: '逐条淡入（默认）', dur: 180, ease: 'quint', stagger: 30, y: 0, s: 1 },
        { k: 'tile', name: '逐条翻转', dur: 320, ease: 'tile', stagger: 45, y: 0, s: 1,
          rx: -78, origin: 'center top', tile: true },
        { k: 'cascade', name: '逐条落下', dur: 300, ease: 'expo', stagger: 60, y: -26, s: 1 },
        { k: 'depth', name: '逐条推近', dur: 340, ease: 'ios', stagger: 40, y: 0, s: .88, blur: 10 },
        { k: 'rise', name: '逐条上浮', dur: 260, ease: 'expo', stagger: 36, y: 12, s: .99 },
        { k: 'slide', name: '逐条侧入', dur: 260, ease: 'ios', stagger: 30, x: 22, s: 1 },
        { k: 'zoom', name: '逐条放大', dur: 260, ease: 'back', stagger: 30, s: .94 },
        { k: 'none', name: '无动画', dur: 0 }
      ]
    },
    /**
     * 切换日期（今日页的「今天 / 前一天 / 后一天」，以及本周概览里点日期）。
     * 只描述"内容层"的姿态，方向由代码按 dir（+1 往后一天 / -1 往前一天）代入：
     *   dir: true  → 位移跟着方向走（往后一天从右边进、往前一天从左边进）
     *   flip: true → 方向感更强的绕 Y 轴翻入
     * 日期栏上的滑块不受这里影响，它永远是一条顺滑的滑动动画。
     */
    dateSwitch: {
      name: '切换日期 · 今日 / 前后天',
      default: 'settle',
      styles: [
        /**
         * 默认：位移小、时间稍长、曲线更柔 —— "沉稳优雅"。
         * 以前默认是 30px 的强滑入（340ms expo），整页三块内容一起甩，
         * 看着躁；现在换成 12px 侧移 + 8px 上浮、440ms gentle。
         */
        { k: 'settle', name: '沉稳落定（默认）', dir: true, dur: 440, ease: 'gentle', x: 12, y: 8, s: .994, o: .42 },
        { k: 'slideDir', name: '随方向滑入', dir: true, dur: 380, ease: 'expo', x: 26, s: .992, o: .2 },
        { k: 'slideSoft', name: '轻柔侧移', dir: true, dur: 300, ease: 'ios', x: 18, s: 1 },
        { k: 'tile', name: '磁贴翻转（从滑动方向翻入）', dir: true, flip: true, dur: 380, ease: 'tile', x: 8, s: .99, tile: true },
        { k: 'rise', name: '上浮落定', dir: false, dur: 320, ease: 'gentle', x: 0, y: 14, s: .994 },
        { k: 'zoom', name: '轻微放大', dir: false, dur: 300, ease: 'back', x: 0, y: 0, s: .96 },
        { k: 'fade', name: '原地淡入', dir: false, dur: 240, ease: 'soft', x: 0, y: 0, s: 1 },
        { k: 'none', name: '无动画', dir: false, dur: 0 }
      ]
    },
    /**
     * 明暗主题切换。切的是"整页颜色"，所以这里的 dur 同时决定
     * 颜色令牌插值的总时长（见 ui.js playThemeSwitch）：
     *   fx: ripple → 以点击处为圆心扩散一层柔光
     *   fx: sweep  → 从最顶上一整条往下扫（系统自己切换时用）
     *   fx: none   → 只做颜色渐变，不叠加光
     *   cross      → 整页交叉淡入（View Transitions 可用时；否则等同只渐变）
     */
    themeSwitch: {
      name: '切换主题 · 亮 / 暗',
      default: 'auto',
      styles: [
        {
          k: 'auto', name: '自动（点按=扩散 / 系统=顶部下扫）',
          dur: 420, ease: 'linear', fx: 'auto'
        },
        {
          /**
           * 点击处扩散（v0.3.7 第 3 版）：
           *   · 底层是"旧主题快照"，上层是一块目标主题底色的"墨滴"；
           *   · 墨滴用 transform: scale() 线性长大（合成器直接跑，不再逐帧改 mask）；
           *   · 墨滴的不透明度随扩散从 0.35 涨到 1，铺满后淡出 140ms。
           * 线性是用户要的：不用缓动，靠"透明度随扩散增加"来出层次。
           */
          k: 'ripple', name: '点击处扩散', dur: 420, ease: 'linear',
          fx: 'ripple', feather: 96
        },
        {
          k: 'sweepTop', name: '顶部整条下扫', dur: 460, ease: 'linear',
          fx: 'sweep', feather: 96
        },
        {
          k: 'colorOnly', name: '只渐变色', dur: 420, ease: 'quint', fx: 'none'
        },
        {
          k: 'cross', name: '整页交叉淡入', dur: 380, ease: 'soft', fx: 'cross'
        },
        {
          k: 'none', name: '无动画（瞬切）', dur: 0, ease: 'linear', fx: 'none'
        }
      ]
    }
  };

  /** 旧存档键 → 新场景键（v0.2.7 之前放大/缩小、进入/退出是分开存的） */
  var LEGACY = {
    zoneFocus: ['zoneExpand', 'zoneCollapse'],
    modal: ['modalIn', 'modalOut']
  };

  var ORDER = ['zoneFocus', 'contentIn', 'dateSwitch', 'themeSwitch', 'modal', 'viewIn', 'listIn'];

  /** 是否开着"全局磁贴风格" */
  function tileMode() {
    var s = settings();
    return !!(s && s.appearance && s.appearance.tileStyle === true);
  }

  /** 某个场景里的磁贴样式（没有就是 null） */
  function tileStyleOf(scenario) {
    var sc = SCENARIOS[scenario];
    if (!sc) { return null; }
    for (var i = 0; i < sc.styles.length; i++) {
      if (sc.styles[i].tile === true) { return sc.styles[i]; }
    }
    return null;
  }

  function settings() {
    try { return AR.Store && AR.Store.get().settings; } catch (e) { return null; }
  }

  /* ── 流畅模式（设置 → 外观 → 流畅模式）─────────────────────────
     full 关闭：全部动效与光效（默认）
     lite 标准：砍掉开销大的光效 —— 质感模糊、模糊类特效、主题墨滴扩散，
          几何动效（翻转 / 折纸 / 错峰）全部保留
     min  深度：在标准之上再简化 3D 旋转、逐条错峰，时长收紧；
          功能完全不变，只是动画换便宜的等价物
     降级集中在 get() / pose() 两个出口做，调用方一行不用改。 */
  var PERF_VALID = { full: 1, lite: 1, min: 1 };

  function perfLevel() {
    var s = settings();
    var v = s && s.appearance && s.appearance.perfMode;
    return PERF_VALID[v] ? v : 'full';
  }

  /** 模糊类 / 过曝类特效 → 便宜等价（lite 起生效）：zoom 是"缩放淡入"，无 filter */
  var FX_LITE = { depth: 'zoom', depthOut: 'zoomOut', spotlight: 'zoom' };
  /** 3D 翻折类特效 → 便宜等价（min 额外生效）；cascade / mosaic 靠 stagger=0 整组播，不换名 */
  var FX_MIN = {
    hingeFlip: 'zoom', hingeFlipOut: 'fade',
    foldX: 'zoom', foldXOut: 'fade',
    flipY: 'zoom', flipYOut: 'fade',
    axialZ: 'zoom', axialZOut: 'fade'
  };

  function copyOwn(src) {
    var out = {};
    for (var k in src) {
      if (Object.prototype.hasOwnProperty.call(src, k)) { out[k] = src[k]; }
    }
    return out;
  }

  /** 姿势对象降级：lite 去 blur，min 再去 3D 旋转（保留 o/x/y/s） */
  function cleanPose(p, lvl) {
    if (!p) { return p; }
    var out = copyOwn(p);
    delete out.blur;
    if (lvl === 'min') {
      delete out.rx;
      delete out.ry;
      delete out.rot;
    }
    return out;
  }

  /** 一个方向（in / out）的参数降级 */
  function degradeDir(d, lvl, scenario) {
    if (!d) { return d; }
    var out = copyOwn(d);
    if (out.from) { out.from = cleanPose(out.from, lvl); }
    if (out.to) { out.to = cleanPose(out.to, lvl); }
    delete out.blur;
    if (lvl !== 'full' && out.fx) {
      // 主题切换的 ripple / sweep 是整页墨滴光效（贵），聚焦场景的 ripple 只是缩放（便宜）
      if (scenario === 'themeSwitch') {
        if (lvl === 'min' || out.fx === 'ripple' || out.fx === 'sweep') { out.fx = 'none'; }
      } else {
        var map = (lvl === 'min') ? FX_MIN : FX_LITE;
        if (map[out.fx]) { out.fx = map[out.fx]; }
        else if (lvl === 'min' && FX_LITE[out.fx]) { out.fx = FX_LITE[out.fx]; }
      }
    }
    if (lvl === 'min') {
      // 无条件清零（哪怕原本没写这个字段 —— 调用方的默认值也要被压掉）
      out.stagger = 0;
      out.fxStagger = 0;
      out.childStagger = 0;
      if (out.flip) { out.flip = false; }
      if (out.dur > 240) { out.dur = 240; }
      if (out.fxDur > 260) { out.fxDur = 260; }
    }
    return out;
  }

  /** 整个样式降级（dir() 走这里；dir() 本身基于 get()，自动继承） */
  function degrade(st, lvl, scenario) {
    if (!st || lvl === 'full') { return st; }
    var out = copyOwn(st);
    if (st.in) { out.in = degradeDir(st.in, lvl, scenario); }
    if (st.out) { out.out = degradeDir(st.out, lvl, scenario); }
    // 扁平样式（contentIn / viewIn / listIn / dateSwitch / themeSwitch）
    out = degradeDir(out, lvl, scenario);
    return out;
  }

  function saved() {
    var s = settings();
    var m = s && s.appearance && s.appearance.motion;
    return (m && typeof m === 'object') ? m : {};
  }

  /** 取某个场景当前生效的样式定义（流畅模式下自动降级，返回副本） */
  function get(scenario) {
    var sc = SCENARIOS[scenario];
    if (!sc) { return null; }
    var store = saved();
    var st = null;
    // 全局磁贴风格优先：所有能"从点击处翻入"的场景统一用它
    if (tileMode()) {
      st = tileStyleOf(scenario);
    }
    if (!st) {
      var key = store[scenario];
      if (!key && LEGACY[scenario]) {
        for (var L = 0; L < LEGACY[scenario].length; L++) {
          if (store[LEGACY[scenario][L]]) { key = store[LEGACY[scenario][L]]; break; }
        }
      }
      if (!key) { key = sc.default; }
      for (var i = 0; i < sc.styles.length; i++) {
        if (sc.styles[i].k === key) { st = sc.styles[i]; break; }
      }
      if (!st) {
        for (i = 0; i < sc.styles.length; i++) {
          if (sc.styles[i].k === sc.default) { st = sc.styles[i]; break; }
        }
      }
      if (!st) { st = sc.styles[0]; }
    }
    return degrade(st, perfLevel(), scenario);
  }

  /** 取某个方向（in / out）的参数；缺一边就回落到另一边 */
  function dir(scenario, which) {
    var st = get(scenario);
    if (!st) { return null; }
    return st[which] || st[which === 'out' ? 'in' : 'out'] || null;
  }

  /** 按 k 取某个场景里的具体样式（主题切换的「自动」要靠它落到 ripple / sweepTop） */
  function styleOf(scenario, key) {
    var sc = SCENARIOS[scenario];
    if (!sc || !key) { return null; }
    for (var i = 0; i < sc.styles.length; i++) {
      if (sc.styles[i].k === key) { return degrade(sc.styles[i], perfLevel(), scenario); }
    }
    return null;
  }

  function set(scenario, key) {
    var sc = SCENARIOS[scenario];
    if (!sc) { return false; }
    var ok = false;
    for (var i = 0; i < sc.styles.length; i++) { if (sc.styles[i].k === key) { ok = true; } }
    if (!ok) { return false; }
    var s = settings();
    if (!s) { return false; }
    if (!s.appearance) { s.appearance = {}; }
    if (!s.appearance.motion || typeof s.appearance.motion !== 'object') { s.appearance.motion = {}; }
    s.appearance.motion[scenario] = key;
    if (LEGACY[scenario]) {
      for (var L = 0; L < LEGACY[scenario].length; L++) { delete s.appearance.motion[LEGACY[scenario][L]]; }
    }
    try { AR.Store.save(true); } catch (e) { }
    return true;
  }

  function reset() {
    var s = settings();
    if (!s || !s.appearance) { return; }
    s.appearance.motion = {};
    try { AR.Store.save(true); } catch (e) { }
  }

  /** 曲线名 → cubic-bezier 字符串 */
  function ease(name) { return EASE[name] || EASE.quint; }

  /**
   * 在某个进度上求曲线值 —— 给"不归浏览器管"的插值用（比如主题切换的颜色渐变：
   * CSS 变量没法交给 CSS transition，只能自己逐帧算，但曲线必须和别处同一条）。
   * 二分求 x(t)=p 的 t，再算 y(t)，24 次迭代精度足够（误差 < 1e-6）。
   */
  function cubicAt(nameOrCurve, p) {
    if (!(p > 0)) { return 0; }
    if (p >= 1) { return 1; }
    var str = EASE[nameOrCurve] || nameOrCurve || 'linear';
    var m = /cubic-bezier\(([^)]+)\)/.exec(str);
    if (!m) { return p; }                       // linear
    var v = m[1].split(',').map(function (s) { return parseFloat(s); });
    if (v.length < 4) { return p; }
    function bez(t, a, b) {
      var u = 1 - t;
      return 3 * u * u * t * a + 3 * u * t * t * b + t * t * t;
    }
    var lo = 0, hi = 1, mid = p;
    for (var i = 0; i < 24; i++) {
      mid = (lo + hi) / 2;
      if (bez(mid, v[0], v[2]) < p) { lo = mid; } else { hi = mid; }
    }
    return bez(mid, v[1], v[3]);
  }

  /**
   * 姿势 → WAAPI 关键帧。
   *   o 不透明度 / x,y 位移 / s 缩放 / rot 平面旋转 / rx 绕 X 轴 / blur 模糊
   * 缺省就是"原始状态"，所以同一个函数既描述进场起点，也描述退场终点。
   */
  function pose(p) {
    p = p || {};
    var lvl = perfLevel();
    var tf = [];
    var x = p.x || 0, y = p.y || 0;
    if (x || y) { tf.push('translate3d(' + x + 'px,' + y + 'px,0)'); }
    if (p.rx && lvl !== 'min') { tf.push('perspective(900px) rotateX(' + p.rx + 'deg)'); }
    if (p.ry && lvl !== 'min') { tf.push('perspective(760px) rotateY(' + p.ry + 'deg)'); }
    if (p.rot && lvl !== 'min') { tf.push('rotate(' + p.rot + 'deg)'); }
    if (p.s != null && p.s !== 1) { tf.push('scale(' + p.s + ')'); }
    if (!tf.length) { tf.push('none'); }
    var out = { opacity: p.o == null ? 1 : p.o, transform: tf.join(' ') };
    out.filter = (p.blur && lvl === 'full') ? ('blur(' + p.blur + 'px)') : 'none';
    return out;
  }

  AR.Motion = {
    order: ORDER,
    table: SCENARIOS,
    legacy: LEGACY,
    perfLevel: perfLevel,
    ease: ease,
    cubicAt: cubicAt,
    easeTable: EASE,
    pose: pose,
    get: get,
    dir: dir,
    styleOf: styleOf,
    set: set,
    reset: reset,
    saved: saved,
    tileMode: tileMode,
    tileStyleOf: tileStyleOf,
    setTileMode: function (on) {
      var s = settings();
      if (!s) { return; }
      if (!s.appearance) { s.appearance = {}; }
      s.appearance.tileStyle = !!on;
      try { AR.Store.save(true); } catch (e) { }
    },
    /** 样式总数（开发者模式面板会显示，普通用户看不到） */
    count: function () {
      var n = 0;
      for (var i = 0; i < ORDER.length; i++) { n += SCENARIOS[ORDER[i]].styles.length; }
      return n;
    }
  };
})();
