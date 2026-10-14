using System;
using System.Runtime.InteropServices;

namespace AbbeyRoad
{
    /// <summary>
    /// 原生窗口外观：Win11 用 Mica/Acrylic 系统背景，Win10 用亚克力模糊，
    /// 另外负责深色标题栏与圆角。失败一律静默降级（界面本身是自绘毛玻璃）。
    /// </summary>
    internal static class Native
    {
        [DllImport("dwmapi.dll", PreserveSig = true)]
        private static extern int DwmSetWindowAttribute(IntPtr hwnd, int attr, ref int value, int size);

        [DllImport("user32.dll")]
        private static extern int SetWindowCompositionAttribute(IntPtr hwnd, ref WindowCompositionAttributeData data);

        [StructLayout(LayoutKind.Sequential)]
        private struct AccentPolicy
        {
            public int AccentState;
            public int AccentFlags;
            public int GradientColor;
            public int AnimationId;
        }

        [StructLayout(LayoutKind.Sequential)]
        private struct WindowCompositionAttributeData
        {
            public int Attribute;
            public IntPtr Data;
            public int SizeOfData;
        }

        private const int DWMWA_USE_IMMERSIVE_DARK_MODE = 20;
        private const int DWMWA_WINDOW_CORNER_PREFERENCE = 33;
        private const int DWMWA_SYSTEMBACKDROP_TYPE = 38;
        private const int DWMSBT_MAINWINDOW = 2;      // Mica
        private const int DWMWA_CAPTION_COLOR = 35;
        private const int DWMWA_TEXT_COLOR = 36;

        private const int WCA_ACCENT_POLICY = 19;
        private const int ACCENT_ENABLE_ACRYLICBLURBEHIND = 4;
        private const int ACCENT_ENABLE_BLURBEHIND = 3;
        private const int ACCENT_ENABLE_GRADIENT = 1;

        private static int _osBuild = -1;

        private static int OsBuild()
        {
            if (_osBuild < 0)
            {
                try { _osBuild = Environment.OSVersion.Version.Build; }
                catch (Exception) { _osBuild = 0; }
            }
            return _osBuild;
        }

        /// <summary>应用窗口外观（圆角 + 系统背景材质）。</summary>
        public static void ApplyWindowChrome(IntPtr hwnd)
        {
            TryRound(hwnd);
            if (OsBuild() >= 22000)
            {
                // Windows 11：Mica
                int type = DWMSBT_MAINWINDOW;
                TryAttr(hwnd, DWMWA_SYSTEMBACKDROP_TYPE, type);
            }
            else if (OsBuild() >= 17763)
            {
                // Windows 10 1809+：亚克力
                TryAcrylic(hwnd);
            }
        }

        public static void TryRound(IntPtr hwnd)
        {
            int pref = 2; // DWMWCP_ROUND
            TryAttr(hwnd, DWMWA_WINDOW_CORNER_PREFERENCE, pref);
        }

        public static void SetDarkTitleBar(IntPtr hwnd, bool dark)
        {
            int v = dark ? 1 : 0;
            TryAttr(hwnd, DWMWA_USE_IMMERSIVE_DARK_MODE, v);
        }

        /// <summary>把标题栏颜色刷成和 App 主题一致（浅色 #FFFFFF / 深色 #0E1116）。</summary>
        public static void SetCaptionColor(IntPtr hwnd, bool dark)
        {
            int color = dark ? 0x0016110E : 0x00FFFFFF; // DWMWA_COLOR 是 0x00BBGGRR
            TryAttr(hwnd, DWMWA_CAPTION_COLOR, color);
            int text = dark ? 0x00F0EAE8 : 0x00181311;
            TryAttr(hwnd, DWMWA_TEXT_COLOR, text);
        }

        private static void TryAttr(IntPtr hwnd, int attr, int value)
        {
            try
            {
                int v = value;
                DwmSetWindowAttribute(hwnd, attr, ref v, 4);
            }
            catch (Exception) { }
        }

        private static void TryAcrylic(IntPtr hwnd)
        {
            try
            {
                AccentPolicy policy = new AccentPolicy();
                policy.AccentState = ACCENT_ENABLE_ACRYLICBLURBEHIND;
                policy.AccentFlags = 2;
                policy.GradientColor = unchecked((int)0x99FFFFFF);
                policy.AnimationId = 0;

                int size = Marshal.SizeOf(policy);
                IntPtr ptr = Marshal.AllocHGlobal(size);
                try
                {
                    Marshal.StructureToPtr(policy, ptr, false);
                    WindowCompositionAttributeData data = new WindowCompositionAttributeData();
                    data.Attribute = WCA_ACCENT_POLICY;
                    data.Data = ptr;
                    data.SizeOfData = size;
                    SetWindowCompositionAttribute(hwnd, ref data);
                }
                finally
                {
                    Marshal.FreeHGlobal(ptr);
                }
            }
            catch (Exception) { }
        }

        /// <summary>切回"无系统材质"（用户关掉毛玻璃时用）。</summary>
        public static void DisableBackdrop(IntPtr hwnd)
        {
            try
            {
                AccentPolicy policy = new AccentPolicy();
                policy.AccentState = ACCENT_ENABLE_GRADIENT;
                policy.GradientColor = 0;
                int size = Marshal.SizeOf(policy);
                IntPtr ptr = Marshal.AllocHGlobal(size);
                try
                {
                    Marshal.StructureToPtr(policy, ptr, false);
                    WindowCompositionAttributeData data = new WindowCompositionAttributeData();
                    data.Attribute = WCA_ACCENT_POLICY;
                    data.Data = ptr;
                    data.SizeOfData = size;
                    SetWindowCompositionAttribute(hwnd, ref data);
                }
                finally { Marshal.FreeHGlobal(ptr); }
                if (OsBuild() >= 22000)
                {
                    int none = 1; // DWMSBT_NONE
                    TryAttr(hwnd, DWMWA_SYSTEMBACKDROP_TYPE, none);
                }
            }
            catch (Exception) { }
        }
    }
}
