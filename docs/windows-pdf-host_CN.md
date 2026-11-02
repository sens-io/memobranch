# Windows 选页 PDF 处理管理程序

仅限开发源码，尚未发布。**2026-10-29 按用户要求跳过 Windows 实机及访问权限验证。**
编译、跨系统进程协调测试和源码审查都不表示 Windows 实机通过。普通文字层 PDF
导入不使用这个程序。

## 一次性准备

Windows 选页渲染与 OCR 要求 Windows 10 / Server 2016 或更新系统、本机已安装的处理器，
以及操作人从 `assets/windows-pdf-host.cs` 预先编译的程序。源码独立实现，使用 MIT
许可证。处理时不编译、不调用 PowerShell、不安装依赖、不修改执行策略或系统安全设置。

已有 Windows PowerShell 5.1 / .NET Framework 4.5+ 编译器的操作人，可在自己控制的目录中
编译一次。输出路径必须是新文件。以下仅是准备命令，**不是已经验证成功的 Windows 编译结果**：

```powershell
Add-Type -TypeDefinition (Get-Content 'C:\source\memobranch\assets\windows-pdf-host.cs' -Raw) `
  -ReferencedAssemblies 'System.Core.dll','System.Runtime.Serialization.dll' `
  -OutputType ConsoleApplication -OutputAssembly 'C:\tools\memobranch-pdf-host.exe'
```

命令使用 [Windows PowerShell 5.1 的 Add-Type](https://learn.microsoft.com/en-us/powershell/module/microsoft.powershell.utility/add-type?view=powershell-5.1)。
PowerShell 7 不支持这种控制台可执行文件输出方式。编译器不可用或被策略禁止时，应报告
无法准备依赖，不绕过主机策略。程序及其目录须由操作人控制。单独的主机 JSON 配置示例：

```json
{
  "version": 1,
  "renderer": "C:\\tools\\poppler\\pdftoppm.exe",
  "ocr": "C:\\tools\\tesseract\\tesseract.exe",
  "languageData": "C:\\tools\\tesseract\\tessdata",
  "workRoot": "C:\\private\\memobranch-pdf",
  "windowsHost": "C:\\tools\\memobranch-pdf-host.exe"
}
```

工作目录须属于运行用户，并使用禁止继承上级授权的 DACL（Windows 目录访问规则）。允许规则
只能授予当前用户、Local System 或本机 Administrators 组。当前用户须拥有 Full Control，
规则同时继承到文件和子目录，且没有传播限制。程序先检查这些规则，再检查本次创建的私有目录，
通过后才写入 PDF。它不会修改权限，也不接受重解析点目录。工作根目录应专用于本功能。

## 进程归属与清理

程序使用 [PROC_THREAD_ATTRIBUTE_JOB_LIST](https://learn.microsoft.com/en-us/windows/win32/api/processthreadsapi/nf-processthreadsapi-updateprocthreadattribute)
在创建处理器时就将其加入具名的 [Job Object](https://learn.microsoft.com/en-us/windows/win32/procthread/job-objects)
（统一管理一组进程的系统功能）。处理器最初暂停，建立归属后才恢复执行；最后一个管理句柄关闭时
会终止该组进程。处理器只继承 NUL 输入、输出及错误句柄。即使主处理器先退出，后台子进程仍由
同一个 Job Object 管理。程序终止剩余进程，确认活动进程数为零后才返回完成标记。

请求是有长度限制的 JSON，通过输入管道传送，不经过命令行解释器。请求后的输入管道保持打开，
关闭表示取消或父进程退出。处理器只收到已有的最小环境和私有工作目录；管理程序本身从配置系统的
System32 目录运行。其二进制哈希和协议版本进入不可变来源记录，保存前再次检查；程序改变须重新预览。

每次工作目录的版本 2 `owner.json` 保存随机生成的 Job Object 标识。清理使用这个标识，
不依赖可能被复用的处理器编号。正常退出、失败和取消都须确认清理，才能接受结果。先给予一秒
合作退出时间，随后可终止管理程序，并发起独立、不受取消影响、最多十秒的清理请求。无法确认
清理完成时拒绝结果，保留私有目录供检查；不保证 Windows 内核或驱动可以瞬间终止进程。

崩溃恢复只处理经核实属于本功能、原父进程已退出的目录。旧 Windows 版本 1 工作目录会被拒绝，
由操作人检查恢复，不猜测后台进程归属。POSIX 版本 1 规则保持原样。缺少有效管理程序或系统不支持
所需接口时拒绝选页处理；默认文字层导入仍可用。新增源码和说明没有修改真实主机配置。

[English](windows-pdf-host.md)
