using System;
using System.IO;

namespace AbbeyRoad
{
    /// <summary>统一的路径与版本常量。</summary>
    internal static class AppPaths
    {
        public const string Version = "0.3.0";
        public const string Product = "Abbey Road";
        public const string Host = "abbeyroad.local";
        public const string Url = "https://abbeyroad.local/index.html";

        public static string Root
        {
            get { return Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), Product); }
        }

        public static string WebDir
        {
            get { return Path.Combine(Root, "web", "v" + Version); }
        }

        public static string UserDataDir
        {
            get { return Path.Combine(Root, "browser"); }
        }

        public static void EnsureDirs()
        {
            Directory.CreateDirectory(Root);
            Directory.CreateDirectory(WebDir);
            Directory.CreateDirectory(UserDataDir);
        }
    }
}
