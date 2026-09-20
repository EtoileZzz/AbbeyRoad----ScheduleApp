using System;
using System.IO;
using System.IO.Compression;
using System.Reflection;

namespace AbbeyRoad
{
    /// <summary>
    /// 界面资源打包在 EXE 里（web.zip 资源），首次运行解压到本机目录，
    /// 这样只有一个 EXE 需要分发，也避免用户误删 assets 目录。
    /// </summary>
    internal static class WebAssets
    {
        public static string EnsureExtracted()
        {
            AppPaths.EnsureDirs();
            string marker = Path.Combine(AppPaths.WebDir, "index.html");
            string stampFile = Path.Combine(AppPaths.WebDir, ".extracted");
            string stamp = BuildStamp();
            if (File.Exists(marker) && File.Exists(stampFile))
            {
                bool same = false;
                try { same = File.ReadAllText(stampFile).Trim() == stamp; } catch (Exception) { }
                if (same) { return AppPaths.WebDir; }
                // 版本号相同但程序被重新打包过（例如本地改了界面重编 exe）：
                // 旧资源必须先清掉，否则界面会一直停在上一版。
                try
                {
                    Directory.Delete(AppPaths.WebDir, true);
                    Directory.CreateDirectory(AppPaths.WebDir);
                }
                catch (Exception) { }
            }

            Assembly asm = Assembly.GetExecutingAssembly();
            string[] names = asm.GetManifestResourceNames();
            string res = null;
            for (int i = 0; i < names.Length; i++)
            {
                if (names[i].EndsWith("web.zip", StringComparison.OrdinalIgnoreCase)) { res = names[i]; break; }
            }
            if (res == null)
            {
                throw new InvalidOperationException("安装包缺少界面资源（web.zip）。请重新下载完整安装包。");
            }

            string tmp = Path.Combine(Path.GetTempPath(), "abbeyroad-web-" + Guid.NewGuid().ToString("N"));
            Directory.CreateDirectory(tmp);
            string zipPath = Path.Combine(tmp, "web.zip");
            using (Stream input = asm.GetManifestResourceStream(res))
            using (FileStream output = File.Create(zipPath))
            {
                input.CopyTo(output);
            }

            string extractTo = Path.Combine(tmp, "out");
            ZipFile.ExtractToDirectory(zipPath, extractTo);
            CopyTree(extractTo, AppPaths.WebDir);
            File.WriteAllText(stampFile, stamp + Environment.NewLine + DateTime.Now.ToString("s"));

            try { Directory.Delete(tmp, true); } catch (Exception) { }
            return AppPaths.WebDir;
        }

        /// <summary>用 EXE 的写入时间当资源指纹：同一个版本号重新打包也能刷新界面。</summary>
        private static string BuildStamp()
        {
            try
            {
                string exe = Assembly.GetExecutingAssembly().Location;
                return File.GetLastWriteTimeUtc(exe).Ticks.ToString();
            }
            catch (Exception)
            {
                return AppPaths.Version;
            }
        }

        private static void CopyTree(string from, string to)
        {
            Directory.CreateDirectory(to);
            foreach (string file in Directory.GetFiles(from))
            {
                string target = Path.Combine(to, Path.GetFileName(file));
                File.Copy(file, target, true);
            }
            foreach (string dir in Directory.GetDirectories(from))
            {
                CopyTree(dir, Path.Combine(to, Path.GetFileName(dir)));
            }
        }
    }
}
