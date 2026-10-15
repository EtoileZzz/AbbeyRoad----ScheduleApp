using System;
using System.Windows.Forms;

namespace AbbeyRoad
{
    /// <summary>Abbey Road · Windows 端入口。</summary>
    internal static class Program
    {
        [STAThread]
        private static void Main(string[] args)
        {
            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);
            AppDomain.CurrentDomain.UnhandledException += delegate(object s, UnhandledExceptionEventArgs e)
            {
                MessageBox.Show("Abbey Road 遇到未处理的错误：\n" + e.ExceptionObject,
                    "Abbey Road", MessageBoxButtons.OK, MessageBoxIcon.Error);
            };
            try
            {
                Application.Run(new MainForm(args));
            }
            catch (Exception ex)
            {
                MessageBox.Show(ex.Message, "Abbey Road 启动失败", MessageBoxButtons.OK, MessageBoxIcon.Error);
            }
        }
    }
}
