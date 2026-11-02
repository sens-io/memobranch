# 本机选定 PDF 页面与 OCR

仅限开发源码，尚未发布到 npm。导入、保存和读取已通过[本地验收与独立审查](git-executable-lookup-verification-2026-11-02.md)，包括原有 macOS Node 20 完整集合。[Windows 后台子进程修复](pdf-windows-host-verification-2026-10-29.md)已有跨系统回归测试和独立源码复审。按用户要求跳过 Windows 实机验证，不表示该平台通过。已验收范围见[路线图](remaining-roadmap.md)。

原有[文字层 PDF 导入](pdf-import.md)仍是默认行为。新增选项通过本机已配置的 Poppler `pdftoppm` 渲染指定页面，也可以用 Tesseract 识别文字。不调用模型、不上传资料、不自动下载依赖或语言文件，也不批准 Wiki 知识。

## 主机配置与明确选择

操作人自行准备本机程序、语言文件和私有工作目录；POSIX 系统要求该目录只允许所属用户访问。单独的主机 JSON 配置格式如下，不接受额外字段：

```json
{
  "version": 1,
  "renderer": "/absolute/path/to/pdftoppm",
  "ocr": "/absolute/path/to/tesseract",
  "languageData": "/absolute/path/to/tessdata",
  "fontDirectory": "/absolute/path/to/selected-fallback-fonts",
  "workRoot": "/absolute/path/to/private-work-directory"
}
```

选择 `--ocr-languages` 时必须提供 OCR 程序和语言目录；不提供这个参数时只渲染图片。`fontDirectory` 可省略；如果提供，须为只包含 1–32 个普通 `.ttf`/`.otf` 文件的目录，单文件最多 32 MB、合计 128 MB。系统保存字体名称和哈希，使用独立的 Fontconfig 配置与缓存，不继承系统字体选择。缺少合适字体可能导致字形重叠和识别错误，无法保证还原任意 PDF 字体。MemoBranch 不自动安装程序或修改真实主机配置。

Windows 选择页面处理还须提供 `windowsHost`，指向操作人预先编译的本机管理程序，步骤见 [Windows 配置说明](windows-pdf-host_CN.md)。它检查私有目录访问权限，在处理器创建时将其加入 Windows 的 Job Object（统一管理一组进程的系统功能）。缺少或不支持该程序时拒绝处理，不改用无法管理的进程。普通文字层导入不依赖它；处理来源记录保存该程序的哈希和版本。POSIX 不执行该程序。

```sh
memobranch import pdf-preview ./source.pdf --processor-config ./host.json \
  --pages 2,4 --ocr-languages eng --timeout-ms 30000 > pdf-plan.json

# 先查看页码、覆盖情况、哈希、版本及警告，再明确导入。
memobranch import pdf-apply --plan pdf-plan.json --processor-config ./host.json \
  --scope project --sensitivity internal --timeout-ms 30000 --root ./vault
```

预览只含摘要、哈希和文字长度，不含 PDF 原件、PNG 图片、识别正文、可执行程序路径或语言目录。应用时须单独提供主机配置，并使用预览里的页码和语言；改变选择需要重新预览。原件、输出、程序、语言文件、字体或预览发生变化会拒绝保存。完全相同的重试复用不可变证据，不增加提交。分类和敏感级别覆盖完整原件及派生内容，包括隐藏的 PDF 内容；识别结果不会自动成为已批准知识。

## 本机读取保存的原件和页面

```sh
memobranch import pdf-original ev-EXAMPLE --output ./new-original.pdf --root ./vault
memobranch import pdf-page ev-EXAMPLE --page 2 --output ./new-page.png --root ./vault
```

需要当前记录读取权限和解密密钥，输出必须是新文件，已有文件会被拒绝。只能读取实际保存的选定页面。本地库可调用 `previewPdfImport(path, { processing, processor })`、`applyPdfImport(vault, plan, { processor, scope, sensitivity })`、`readPdfOriginal(vault, evidenceId)` 和 `readPdfPage(vault, evidenceId, pageNumber)`，继续支持取消和执行期限。不要把这些本机路径或主机配置变成服务端请求参数。

原件、页面图片、OCR 文字及处理器来源记录保存在同一条不可变证据中，共用加密、权限、事务和恢复规则。所有模型输入、Agent 和公开返回内容继续移除完整媒体编码对象；操作人曾经读取过原件也不会放宽此规则。不增加 MCP、Harness、Web 文件读取器、程序选择器、媒体接口或授权编辑器。

## 范围、限制与兼容性

- 原件最多 5 MB、100 页；完整证据文字最多 200000 字符。
- 选择 1–5 个不同页码，可选 1–2 种已安装语言。
- PNG 最长边 1600 像素，每页 2 MB、合计 4 MB，累计 1000 万像素。校验 CRC、原始区块名称、压缩输入是否完整消费、解码长度和行过滤器。超限时拒绝完整结果，不截断保存。
- OCR 每页最多 40000 字符，要求有效 UTF-8。空识别结果会明确标注；原文字层、渲染图片、识别文字和未处理页可区分。
- `--timeout-ms` 为 1–120000 毫秒，默认 10000。PDF 解析使用该期限；本机程序另有一次涵盖全部执行和版本探测的总期限。排队及有读取上限的文件和指纹检查不计入程序执行期限。
- Windows 取消时先关闭管理程序的输入；一秒后可终止该管理程序，再发起独立、不受取消信号影响、最多十秒的清理请求。清理时间独立于处理期限。无法确认清理完成时拒绝结果，保留私有工作文件。
- 同一工作目录串行处理，只清理经过核实且所属进程已退出的私有目录，保留其他操作的文件和进程。字体缓存在每次程序完成后检查，单文件最多 4 MB、合计 8 MB；这不是即时磁盘配额，也不保证本机程序峰值内存。
- 工作文件暂存明文，即使最终证据加密也是如此。本机程序是受信依赖，系统不能隔离恶意主机程序。OCR 可能出错，不保证表格、图表、阅读顺序、图片含义或任意文档的完整理解。

新处理结果使用原件格式版本 2、证据摘要版本 5；原有文字层原件版本 1、摘要版本 3 保持可读，不自动迁移。旧程序会拒绝新格式，不会把 OCR 当成旧文字层格式。共享时须保证读取程序支持相应版本。

[核心验证记录](pdf-processing-core-verification-2026-10-28.md)保留真实本机工具的成功和识别失败，[独立审查记录](pdf-processing-review-2026-10-29.md)保留修复与当时未完成的平台问题。后续[完整验收记录](git-executable-lookup-verification-2026-11-02.md)说明 macOS 检查已完成，Windows 实机验证按要求跳过；不承诺任意文档的识别质量。
