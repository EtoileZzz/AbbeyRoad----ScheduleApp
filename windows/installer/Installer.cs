using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.IO.Compression;
using System.Reflection;
using System.Threading;
using System.Windows.Forms;
using Microsoft.Win32;

namespace AbbeyRoadSetup
{
    /// <summary>
    /// Abbey Road Windows 安装器（无需管理员权限）：
    ///   安装 → 解压到 %LOCALAPPDATA%\Programs\Abbey Road，建快捷方式，写卸载信息
    ///   卸载 → 删快捷方式、注册表项、安装目录（可选连带用户数据）
    /// 支持静默：AbbeyRoad-Setup.exe /S 安装，/U 卸载。
    /// </summary>
    internal static class Program
    {
        private const string Product = "Abbey Road";
        private const string Version = "0.3.1";
        private const string ExeName = "AbbeyRoad.exe";
        private const string UninstallKey = @"Software\Microsoft\Windows\CurrentVersion\Uninstall\AbbeyRoad";

        private static string DefaultDir
        {
            get
            {
                return Path.Combine(
                    Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
                    "Programs", Product);
            }
        }

        [STAThread]
        private static void Main(string[] args)
        {
            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);

            bool silent = Has(args, "/S") || Has(args, "-s");
            bool uninstall = Has(args, "/U") || Has(args, "-u");

            if (silent)
            {
                try
                {
                    if (uninstall) { DoUninstall(DefaultDir, true); }
                    else { DoInstall(DefaultDir); }
                    Environment.Exit(0);
                }
                catch (Exception ex)
                {
                    File.AppendAllText(Path.Combine(Path.GetTempPath(), "abbeyroad-setup.log"),
                        DateTime.Now + " 静默模式失败: " + ex + Environment.NewLine);
                    Environment.Exit(1);
                }
                return;
            }

            if (uninstall)
            {
                DoUninstall(DefaultDir, false);
                MessageBox.Show("Abbey Road 已卸载。", Product, MessageBoxButtons.OK, MessageBoxIcon.Information);
                return;
            }

            Application.Run(new SetupForm());
        }

        private static bool Has(string[] args, string flag)
        {
            for (int i = 0; i < args.Length; i++)
            {
                if (string.Equals(args[i], flag, StringComparison.OrdinalIgnoreCase)) { return true; }
            }
            return false;
        }

        /* ── 安装 ─────────────────────────────────────────────── */

        public static string DoInstall(string targetDir)
        {
            Directory.CreateDirectory(targetDir);
            ExtractPayload(targetDir);
            string exe = Path.Combine(targetDir, ExeName);
            if (!File.Exists(exe)) { throw new FileNotFoundException("安装包内容不完整：" + exe); }

            CreateShortcut(Path.Combine(StartMenuDir(), Product + ".lnk"), exe, targetDir);
            CreateShortcut(Path.Combine(DesktopDir(), Product + ".lnk"), exe, targetDir);
            WriteUninstallInfo(targetDir, exe);
            return exe;
        }

        private static void ExtractPayload(string targetDir)
        {
            Assembly asm = Assembly.GetExecutingAssembly();
            string res = null;
            string[] names = asm.GetManifestResourceNames();
            for (int i = 0; i < names.Length; i++)
            {
                if (names[i].EndsWith("app.zip", StringComparison.OrdinalIgnoreCase)) { res = names[i]; break; }
            }
            if (res == null) { throw new InvalidOperationException("安装包缺少负载（app.zip）。"); }

            string tmp = Path.Combine(Path.GetTempPath(), "abbeyroad-setup-" + Guid.NewGuid().ToString("N"));
            Directory.CreateDirectory(tmp);
            string zip = Path.Combine(tmp, "app.zip");
            using (Stream input = asm.GetManifestResourceStream(res))
            using (FileStream output = File.Create(zip))
            {
                input.CopyTo(output);
            }
            string outDir = Path.Combine(tmp, "out");
            ZipFile.ExtractToDirectory(zip, outDir);
            foreach (string file in Directory.GetFiles(outDir, "*", SearchOption.AllDirectories))
            {
                string rel = file.Substring(outDir.Length).TrimStart('\\', '/');
                string dest = Path.Combine(targetDir, rel);
                Directory.CreateDirectory(Path.GetDirectoryName(dest));
                File.Copy(file, dest, true);
            }
            try { Directory.Delete(tmp, true); } catch (Exception) { }
        }

        /* ── 卸载 ─────────────────────────────────────────────── */

        public static void DoUninstall(string targetDir, bool silent)
        {
            try
            {
                Process[] procs = Process.GetProcessesByName("AbbeyRoad");
                for (int i = 0; i < procs.Length; i++)
                {
                    try { procs[i].Kill(); procs[i].WaitForExit(3000); }
                    catch (Exception) { }
                }
            }
            catch (Exception) { }

            TryDelete(Path.Combine(StartMenuDir(), Product + ".lnk"));
            TryDelete(Path.Combine(DesktopDir(), Product + ".lnk"));
            try { Registry.CurrentUser.DeleteSubKeyTree(UninstallKey, false); } catch (Exception) { }

            // 安装目录可能被占用，重试几次
            for (int attempt = 0; attempt < 5; attempt++)
            {
                try
                {
                    if (Directory.Exists(targetDir)) { Directory.Delete(targetDir, true); }
                    break;
                }
                catch (Exception) { Thread.Sleep(500); }
            }

            if (!silent)
            {
                DialogResult keep = MessageBox.Show(
                    "是否同时删除本机保存的课表数据？\n\n" +
                    "目录：" + Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), Product) +
                    "\n\n选择「否」将保留数据，下次安装可继续使用。",
                    Product, MessageBoxButtons.YesNo, MessageBoxIcon.Question);
                if (keep == DialogResult.Yes)
                {
                    try
                    {
                        Directory.Delete(Path.Combine(
                            Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), Product), true);
                    }
                    catch (Exception) { }
                }
            }
        }

        /* ── 快捷方式 / 注册表 ─────────────────────────────────── */

        private static string StartMenuDir()
        {
            return Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.Programs), Product);
        }

        private static string DesktopDir()
        {
            return Environment.GetFolderPath(Environment.SpecialFolder.DesktopDirectory);
        }

        private static void CreateShortcut(string lnkPath, string targetExe, string workDir)
        {
            try
            {
                Directory.CreateDirectory(Path.GetDirectoryName(lnkPath));
                Type shellType = Type.GetTypeFromProgID("WScript.Shell");
                if (shellType == null) { return; }
                object shell = Activator.CreateInstance(shellType);
                object lnk = shellType.InvokeMember("CreateShortcut", BindingFlags.InvokeMethod, null,
                    shell, new object[] { lnkPath });
                Type lnkType = lnk.GetType();
                lnkType.InvokeMember("TargetPath", BindingFlags.SetProperty, null, lnk, new object[] { targetExe });
                lnkType.InvokeMember("WorkingDirectory", BindingFlags.SetProperty, null, lnk, new object[] { workDir });
                lnkType.InvokeMember("Description", BindingFlags.SetProperty, null, lnk,
                    new object[] { "Abbey Road · 课表与日程" });
                string ico = Path.Combine(workDir, "abbeyroad.ico");
                if (File.Exists(ico))
                {
                    lnkType.InvokeMember("IconLocation", BindingFlags.SetProperty, null, lnk, new object[] { ico });
                }
                lnkType.InvokeMember("Save", BindingFlags.InvokeMethod, null, lnk, null);
            }
            catch (Exception) { }
        }

        private static void WriteUninstallInfo(string dir, string exe)
        {
            try
            {
                using (RegistryKey key = Registry.CurrentUser.CreateSubKey(UninstallKey))
                {
                    key.SetValue("DisplayName", Product + " · 课表与日程");
                    key.SetValue("DisplayVersion", Version);
                    key.SetValue("Publisher", "GanXing");
                    key.SetValue("InstallLocation", dir);
                    key.SetValue("DisplayIcon", exe);
                    key.SetValue("UninstallString", "\"" + Path.Combine(AppDomain.CurrentDomain.BaseDirectory,
                        Path.GetFileName(Application.ExecutablePath)) + "\" /U");
                    key.SetValue("NoModify", 1, RegistryValueKind.DWord);
                    key.SetValue("NoRepair", 1, RegistryValueKind.DWord);
                    key.SetValue("EstimatedSize", 60 * 1024, RegistryValueKind.DWord);
                }
            }
            catch (Exception) { }
        }

        private static void TryDelete(string path)
        {
            try { if (File.Exists(path)) { File.Delete(path); } }
            catch (Exception) { }
        }

        public static string DefaultInstallDir { get { return DefaultDir; } }
    }

    /// <summary>安装向导窗口。</summary>
    internal class SetupForm : Form
    {
        private TextBox _path;
        private Label _status;
        private ProgressBar _bar;
        private Button _install;
        private Button _uninstall;
        private Button _close;
        private CheckBox _launch;

        public SetupForm()
        {
            Text = "Abbey Road 安装程序";
            Width = 560;
            Height = 330;
            StartPosition = FormStartPosition.CenterScreen;
            FormBorderStyle = FormBorderStyle.FixedDialog;
            MaximizeBox = false;
            MinimizeBox = false;
            BackColor = Color.White;

            Label title = new Label();
            title.Text = "Abbey Road · 课表与日程";
            title.Font = new Font("Microsoft YaHei UI", 15F, FontStyle.Bold);
            title.SetBounds(24, 20, 480, 30);
            Controls.Add(title);

            Label sub = new Label();
            sub.Text = "版本 " + "0.3.1" + " · 本地优先，不联网、不收集数据\n"
                + "安装到当前用户目录，无需管理员权限。";
            sub.SetBounds(24, 54, 500, 40);
            sub.ForeColor = Color.FromArgb(90, 96, 114);
            Controls.Add(sub);

            Label pathLabel = new Label();
            pathLabel.Text = "安装位置";
            pathLabel.SetBounds(24, 104, 80, 22);
            Controls.Add(pathLabel);

            _path = new TextBox();
            _path.Text = Program.DefaultInstallDir;
            _path.SetBounds(24, 128, 400, 26);
            Controls.Add(_path);

            Button browse = new Button();
            browse.Text = "浏览…";
            browse.SetBounds(432, 127, 92, 28);
            browse.Click += delegate
            {
                using (FolderBrowserDialog dlg = new FolderBrowserDialog())
                {
                    dlg.SelectedPath = _path.Text;
                    if (dlg.ShowDialog(this) == DialogResult.OK) { _path.Text = dlg.SelectedPath; }
                }
            };
            Controls.Add(browse);

            _bar = new ProgressBar();
            _bar.SetBounds(24, 170, 500, 8);
            _bar.Style = ProgressBarStyle.Continuous;
            _bar.Value = 0;
            Controls.Add(_bar);

            _status = new Label();
            _status.Text = "准备就绪";
            _status.SetBounds(24, 184, 500, 22);
            _status.ForeColor = Color.FromArgb(90, 96, 114);
            Controls.Add(_status);

            _launch = new CheckBox();
            _launch.Text = "安装完成后启动 Abbey Road";
            _launch.Checked = true;
            _launch.SetBounds(24, 212, 300, 24);
            Controls.Add(_launch);

            _install = new Button();
            _install.Text = "安装";
            _install.SetBounds(250, 248, 90, 32);
            _install.Click += delegate { RunInstall(); };
            Controls.Add(_install);

            _uninstall = new Button();
            _uninstall.Text = "卸载";
            _uninstall.SetBounds(346, 248, 90, 32);
            _uninstall.Click += delegate
            {
                _status.Text = "正在卸载…";
                Program.DoUninstall(_path.Text, false);
                _status.Text = "已卸载";
                _bar.Value = 0;
            };
            Controls.Add(_uninstall);

            _close = new Button();
            _close.Text = "退出";
            _close.SetBounds(442, 248, 80, 32);
            _close.Click += delegate { Close(); };
            Controls.Add(_close);
        }

        private void RunInstall()
        {
            try
            {
                _install.Enabled = false;
                _status.Text = "正在复制文件…";
                _bar.Value = 30;
                Application.DoEvents();
                string exe = Program.DoInstall(_path.Text);
                _bar.Value = 100;
                _status.Text = "安装完成：" + exe;
                if (_launch.Checked)
                {
                    ProcessStartInfo psi = new ProcessStartInfo(exe);
                    psi.WorkingDirectory = _path.Text;
                    Process.Start(psi);
                }
            }
            catch (Exception ex)
            {
                _status.Text = "安装失败：" + ex.Message;
                MessageBox.Show("安装失败：\n" + ex.Message, "Abbey Road", MessageBoxButtons.OK, MessageBoxIcon.Error);
            }
            finally
            {
                _install.Enabled = true;
            }
        }
    }
}
