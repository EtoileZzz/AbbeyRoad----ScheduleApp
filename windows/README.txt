Abbey Road · 课表与日程  v0.3.1
====================================

这是什么
  给大学生用的课表与日程管理工具。数据只保存在你自己的电脑上，
  不联网、不注册、不上传。手机（Android）与电脑之间通过「导出 JSON →
  在另一台设备导入」来同步。

怎么用
  1. 双击 AbbeyRoad.exe 启动。
  2. 首次启动有 6 步引导，跟着走一遍即可。
  3. 想导入课表：打开「导入」页 →「复制提示词」→ 粘贴到 DeepSeek / 豆包
     并附上课表截图 → 把 AI 的回复粘回「粘贴 AI 结果」→ 应用。
  4. 想同步到手机：设置 → 导入与同步 → 导出 JSON，把文件传到手机，
     在手机的「导入 → JSON 同步」里选择该文件。

文件说明
  AbbeyRoad.exe               主程序（界面资源已打包在里面）
  WebView2Loader.dll          WebView2 加载器（系统自带 WebView2 运行时）
  Microsoft.Web.WebView2.*.dll WebView2 托管库
  abbeyroad.ico               图标
  README.txt                  本文件

数据位置
  %LOCALAPPDATA%\Abbey Road\      （浏览器数据与解压出来的界面资源）

卸载
  从「设置 → 应用」里卸载，或再次运行安装器点「卸载」。

说明
  运行需要系统自带的 Microsoft Edge WebView2 运行时。
  Windows 10/11 一般已预装；若提示缺失，安装一次即可（微软官网免费下载）。
