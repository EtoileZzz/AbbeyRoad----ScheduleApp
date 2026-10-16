using System;
using System.IO;
using System.Text;

namespace AbbeyRoad
{
    /// <summary>极简日志：写到 %LOCALAPPDATA%\Abbey Road\app.log，出问题时方便定位。</summary>
    internal static class Log
    {
        private static readonly object Gate = new object();
        private static string _path;

        private static string PathFile
        {
            get
            {
                if (_path == null)
                {
                    try
                    {
                        Directory.CreateDirectory(AppPaths.Root);
                        _path = Path.Combine(AppPaths.Root, "app.log");
                    }
                    catch (Exception)
                    {
                        _path = Path.Combine(Path.GetTempPath(), "abbeyroad.log");
                    }
                }
                return _path;
            }
        }

        public static void Write(string message)
        {
            try
            {
                lock (Gate)
                {
                    string line = DateTime.Now.ToString("yyyy-MM-dd HH:mm:ss.fff") + "  " + message
                        + Environment.NewLine;
                    File.AppendAllText(PathFile, line, new UTF8Encoding(false));
                }
            }
            catch (Exception) { }
        }
    }
}
