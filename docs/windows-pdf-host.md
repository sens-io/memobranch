# Windows helper for selected local PDF processing

Development source only, not published. **Actual Windows execution and ACL
verification are skipped by the user's request on 2026-10-29.** Compilation,
portable coordination tests and source review do not establish Windows runtime
acceptance. The ordinary text-layer PDF workflow does not use this helper.

## Provision once

Selected rendering/OCR on Windows requires Windows 10 / Server 2016 or later,
locally installed processors, and an operator-prebuilt executable from the
independently implemented MIT source `assets/windows-pdf-host.cs`. MemoBranch does
not compile at runtime, invoke PowerShell while processing, install dependencies,
relax execution policies or change machine security settings.

An operator with an existing Windows PowerShell 5.1 / .NET Framework 4.5+ compiler
can build once in a directory they control. Use a new output path. This is a
documented provisioning command, **not a verified Windows build result**:

```powershell
Add-Type -TypeDefinition (Get-Content 'C:\source\memobranch\assets\windows-pdf-host.cs' -Raw) `
  -ReferencedAssemblies 'System.Core.dll','System.Runtime.Serialization.dll' `
  -OutputType ConsoleApplication -OutputAssembly 'C:\tools\memobranch-pdf-host.exe'
```

This command uses [Windows PowerShell 5.1 Add-Type](https://learn.microsoft.com/en-us/powershell/module/microsoft.powershell.utility/add-type?view=powershell-5.1).
PowerShell 7 does not support this console-executable output mode. A blocked or
unavailable compiler means provisioning is unavailable; do not bypass host policy.
Keep the executable and its directory controlled by the operator. Configure its
absolute path in the separate host JSON, alongside the normal processor paths:

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

Before use, the operator prepares the work directory with a protected DACL (no
inherited grants), owned by the running user. Allow rules may name only that user,
Local System or the local Administrators group. The owner's Full Control rule
must inherit to both files and directories, with no propagation restriction.
The helper checks these rules before any source bytes are staged, then checks the
new operation directory before writing its PDF. It never changes the ACL. Reject
reparse-point work directories. Keep the work root dedicated to this feature.

## Process ownership and cleanup

The helper uses [PROC_THREAD_ATTRIBUTE_JOB_LIST](https://learn.microsoft.com/en-us/windows/win32/api/processthreadsapi/nf-processthreadsapi-updateprocthreadattribute)
to assign the processor to a named [Job Object](https://learn.microsoft.com/en-us/windows/win32/procthread/job-objects)
at process creation, while suspended. It enables kill-on-last-handle-close,
passes only NUL input and output/error handles to the processor, and resumes it
only after ownership is established. Descendants remain in the job when their
leader exits. The helper terminates remaining processes and waits for the job's
active process count to reach zero before returning its completion receipt.

The JSON request is bounded and uses the helper's input pipe; it is not a shell
command. The remaining open input is a cancellation/parent-death channel. Native
processors receive only the existing minimal environment and private work path.
The helper itself runs from the configured Windows System32 directory. Its hash
and protocol version are bound into immutable processing provenance and checked
again before capture; changing the helper requires a new preview.

Each work directory has a random job identity in version-2 `owner.json`. Cleanup
uses that job identity, not a possibly reused processor PID. On ordinary exit,
failure or cancellation the result is accepted only after confirmed cleanup.
After a one-second cooperative grace period, MemoBranch can terminate its helper
and start a separate cleanup request with a ten-second budget. An uncertain
cleanup refuses the result and preserves the private directory for inspection.
There is no guarantee that Windows kernel/driver termination completes instantly.

Crash recovery considers only verified owned directories whose original parent
is no longer alive. Legacy Windows version-1 work directories are refused rather
than guessing which processes belong to them; an operator must inspect/recover
them manually. POSIX version-1 ownership remains unchanged. Missing/invalid
helpers or unsupported Windows APIs refuse selected processing, without affecting
the default text-layer workflow. No actual host settings have been changed by
adding these source files or instructions.

[中文说明](windows-pdf-host_CN.md)
