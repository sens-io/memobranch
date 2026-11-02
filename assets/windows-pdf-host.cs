// Independently implemented, MIT licensed. Build once on Windows; no runtime compiler.
// Windows 10+/Server 2016+: atomically assign the target to a kill-on-close Job Object.
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Runtime.InteropServices;
using System.Runtime.Serialization;
using System.Runtime.Serialization.Json;
using System.Security.AccessControl;
using System.Security.Principal;
using System.Text;
using System.Threading;
using System.Threading.Tasks;

[DataContract] public sealed class PdfHostRequest {
  [DataMember(Name="version")] public int Version;
  [DataMember(Name="operation")] public string Operation;
  [DataMember(Name="root")] public string Root;
  [DataMember(Name="parentPid")] public int ParentPid;
  [DataMember(Name="deadline")] public long Deadline;
  [DataMember(Name="token")] public string Token;
  [DataMember(Name="executable")] public string Executable;
  [DataMember(Name="arguments")] public string[] Arguments;
  [DataMember(Name="environment")] public string[] Environment;
}
[DataContract] public sealed class PdfHostOwner {
  [DataMember(Name="version")] public int Version;
  [DataMember(Name="pid")] public int Pid;
  [DataMember(Name="jobToken")] public string JobToken;
}
public static class MemoBranchPdfHost {
  [StructLayout(LayoutKind.Sequential)] public struct BasicLimits {
    public long ProcessTime, JobTime; public uint Flags; public UIntPtr MinimumWorkingSet, MaximumWorkingSet;
    public uint ActiveLimit; public UIntPtr Affinity; public uint Priority, Scheduling;
  }
  [StructLayout(LayoutKind.Sequential)] public struct IoCounters { public ulong R1,R2,R3,B1,B2,B3; }
  [StructLayout(LayoutKind.Sequential)] public struct ExtendedLimits {
    public BasicLimits Basic; public IoCounters Io; public UIntPtr ProcessMemory,JobMemory,PeakProcessMemory,PeakJobMemory;
  }
  [StructLayout(LayoutKind.Sequential)] public struct Accounting {
    public long User,Kernel,PeriodUser,PeriodKernel; public uint Faults,Total,Active,Terminated;
  }
  [StructLayout(LayoutKind.Sequential,CharSet=CharSet.Unicode)] public struct Startup {
    public uint Size; public IntPtr Reserved,Desktop,Title; public uint X,Y,Width,Height,Columns,Rows,Fill,Flags;
    public ushort Show,ReservedSize; public IntPtr ReservedBytes,Input,Output,Error;
  }
  [StructLayout(LayoutKind.Sequential)] public struct StartupEx { public Startup Info; public IntPtr Attributes; }
  [StructLayout(LayoutKind.Sequential)] public struct ProcessInfo { public IntPtr Process,Thread; public uint Pid,Tid; }
  [DllImport("kernel32.dll",CharSet=CharSet.Unicode,SetLastError=true)] static extern IntPtr CreateJobObjectW(IntPtr security,string name);
  [DllImport("kernel32.dll",CharSet=CharSet.Unicode,SetLastError=true)] static extern IntPtr OpenJobObjectW(uint access,bool inherit,string name);
  [DllImport("kernel32.dll",SetLastError=true)] static extern bool SetInformationJobObject(IntPtr job,int kind,ref ExtendedLimits value,uint size);
  [DllImport("kernel32.dll",SetLastError=true)] static extern bool QueryInformationJobObject(IntPtr job,int kind,out Accounting value,uint size,out uint actual);
  [DllImport("kernel32.dll",SetLastError=true)] static extern bool TerminateJobObject(IntPtr job,uint code);
  [DllImport("kernel32.dll",SetLastError=true)] static extern bool InitializeProcThreadAttributeList(IntPtr list,int count,uint flags,ref IntPtr bytes);
  [DllImport("kernel32.dll",SetLastError=true)] static extern bool UpdateProcThreadAttribute(IntPtr list,uint flags,IntPtr attribute,IntPtr value,IntPtr size,IntPtr previous,IntPtr returned);
  [DllImport("kernel32.dll")] static extern void DeleteProcThreadAttributeList(IntPtr list);
  [DllImport("kernel32.dll",CharSet=CharSet.Unicode,SetLastError=true)] static extern bool CreateProcessW(string image,StringBuilder command,IntPtr ps,IntPtr ts,bool inherit,uint flags,IntPtr env,string cwd,ref StartupEx startup,out ProcessInfo process);
  [DllImport("kernel32.dll",SetLastError=true)] static extern uint ResumeThread(IntPtr thread);
  [DllImport("kernel32.dll",SetLastError=true)] static extern bool GetExitCodeProcess(IntPtr process,out uint code);
  [DllImport("kernel32.dll",SetLastError=true)] static extern uint WaitForSingleObject(IntPtr handle,uint timeout);
  [DllImport("kernel32.dll",SetLastError=true)] static extern IntPtr OpenProcess(uint access,bool inherit,uint pid);
  [DllImport("kernel32.dll")] static extern IntPtr GetCurrentProcess();
  [DllImport("kernel32.dll")] static extern IntPtr GetStdHandle(int index);
  [DllImport("kernel32.dll",SetLastError=true)] static extern bool DuplicateHandle(IntPtr source,IntPtr handle,IntPtr target,out IntPtr copy,uint access,bool inherit,uint options);
  [DllImport("kernel32.dll",CharSet=CharSet.Unicode,SetLastError=true)] static extern IntPtr CreateFileW(string path,uint access,uint sharing,IntPtr security,uint creation,uint attributes,IntPtr template);
  [DllImport("kernel32.dll",SetLastError=true)] static extern bool WriteFile(IntPtr file,byte[] bytes,uint size,out uint written,IntPtr overlapped);
  [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr handle);

  static long Now() { return (DateTime.UtcNow.Ticks-new DateTime(1970,1,1,0,0,0,DateTimeKind.Utc).Ticks)/10000; }
  static void Check(bool ok) { if(!ok) throw new InvalidOperationException("Owned PDF host operation failed"); }
  static bool Hex(string value) { if(value==null||value.Length!=32)return false;foreach(char c in value)if(!((c>='0'&&c<='9')||(c>='a'&&c<='f')))return false;return true; }
  static bool ValidHandle(IntPtr value) { return value!=IntPtr.Zero&&value!=new IntPtr(-1); }
  static void Close(IntPtr value) { if(ValidHandle(value))CloseHandle(value); }
  static IntPtr Duplicate(IntPtr handle) { IntPtr value=IntPtr.Zero;Check(ValidHandle(handle)&&DuplicateHandle(GetCurrentProcess(),handle,GetCurrentProcess(),out value,0,true,2));return value; }
  static byte[] ReadBounded(Stream input,int maximum) {
    using(MemoryStream output=new MemoryStream()){byte[] bytes=new byte[4096];int read;while((read=input.Read(bytes,0,Math.Min(bytes.Length,maximum+1-(int)output.Length)))>0){output.Write(bytes,0,read);Check(output.Length<=maximum);}return output.ToArray();}
  }
  static void Private(string path,bool protectedRoot) {
    Check(Path.IsPathRooted(path)&&Directory.Exists(path)&&(File.GetAttributes(path)&FileAttributes.ReparsePoint)==0);
    DirectorySecurity acl=new DirectoryInfo(path).GetAccessControl(AccessControlSections.Owner|AccessControlSections.Access);
    SecurityIdentifier user=WindowsIdentity.GetCurrent().User;
    Check(user!=null&&user.Equals(acl.GetOwner(typeof(SecurityIdentifier)))&&(!protectedRoot||acl.AreAccessRulesProtected));
    bool inheritsOwner=false;
    foreach(FileSystemAccessRule rule in acl.GetAccessRules(true,true,typeof(SecurityIdentifier))) {
      if(rule.AccessControlType!=AccessControlType.Allow)continue;
      SecurityIdentifier sid=(SecurityIdentifier)rule.IdentityReference;
      Check(user.Equals(sid)||sid.IsWellKnown(WellKnownSidType.LocalSystemSid)||sid.IsWellKnown(WellKnownSidType.BuiltinAdministratorsSid));
      InheritanceFlags both=InheritanceFlags.ContainerInherit|InheritanceFlags.ObjectInherit;
      if(user.Equals(sid)&&(rule.FileSystemRights&FileSystemRights.FullControl)==FileSystemRights.FullControl
        &&(rule.InheritanceFlags&both)==both&&rule.PropagationFlags==PropagationFlags.None)inheritsOwner=true;
    }
    Check(inheritsOwner);
  }
  static string Job(PdfHostRequest request) {
    string path=Path.Combine(request.Root,"owner.json");Check((File.GetAttributes(path)&FileAttributes.ReparsePoint)==0);
    PdfHostOwner owner;
    using(FileStream file=new FileStream(path,FileMode.Open,FileAccess.Read,FileShare.Read))using(MemoryStream bytes=new MemoryStream(ReadBounded(file,1000))) {
      owner=(PdfHostOwner)new DataContractJsonSerializer(typeof(PdfHostOwner)).ReadObject(bytes);
    }
    Check(owner.Version==2&&owner.Pid>0&&Hex(owner.JobToken));
    if(owner.Pid!=request.ParentPid){try{using(Process p=Process.GetProcessById(owner.Pid)){Check(p.HasExited);}}catch(ArgumentException){}}
    return "Local\\MemoBranch.Pdf."+owner.JobToken;
  }
  static uint Active(IntPtr job) { Accounting value;uint actual;Check(QueryInformationJobObject(job,1,out value,(uint)Marshal.SizeOf(typeof(Accounting)),out actual));Check(actual==(uint)Marshal.SizeOf(typeof(Accounting)));return value.Active; }
  static void Settle(IntPtr job,long deadline) {
    if(Active(job)!=0)Check(TerminateJobObject(job,125));
    while(Active(job)!=0){Check(Now()<deadline);Thread.Sleep(10);}
  }
  static void Cleanup(PdfHostRequest request) {
    IntPtr job=OpenJobObjectW(0x000c,false,Job(request));
    if(!ValidHandle(job)){Check(Marshal.GetLastWin32Error()==2);return;}
    try{Settle(job,request.Deadline);}finally{Close(job);}
  }
  public static string Quote(string value) {
    StringBuilder output=new StringBuilder("\"");int slashes=0;
    foreach(char c in value){if(c=='\\'){slashes++;continue;}output.Append('\\',c=='\"'?2*slashes+1:slashes);output.Append(c);slashes=0;}
    return output.Append('\\',2*slashes).Append('"').ToString();
  }
  static int Run(PdfHostRequest request,out bool settled) {
    settled=false;Check(request.Executable!=null&&request.Executable.IndexOf('\0')<0&&Path.IsPathRooted(request.Executable)&&request.Arguments!=null&&request.Arguments.Length<=32&&request.Environment!=null&&request.Environment.Length<=32);
    IntPtr job=IntPtr.Zero,attributes=IntPtr.Zero,jobs=IntPtr.Zero,handles=IntPtr.Zero,environment=IntPtr.Zero,parent=IntPtr.Zero,input=IntPtr.Zero,output=IntPtr.Zero,error=IntPtr.Zero;
    ProcessInfo process=new ProcessInfo();bool owned=false,initialized=false;
    try {
      job=CreateJobObjectW(IntPtr.Zero,Job(request));int created=Marshal.GetLastWin32Error();Check(ValidHandle(job)&&created!=183);owned=true;
      ExtendedLimits limits=new ExtendedLimits();limits.Basic.Flags=0x2000;Check(SetInformationJobObject(job,9,ref limits,(uint)Marshal.SizeOf(typeof(ExtendedLimits))));
      parent=OpenProcess(0x00100000,false,(uint)request.ParentPid);Check(ValidHandle(parent));
      // Console.In is synchronized on .NET Framework; ReadAsync can block synchronously.
      Task<int> cancel=Task.Run(delegate { return Console.In.Read(); });
      if(cancel.IsCompleted||Now()>=request.Deadline||WaitForSingleObject(parent,0)!=258)return 125;
      IntPtr nul=CreateFileW("NUL",0x80000000,3,IntPtr.Zero,3,0,IntPtr.Zero);try{input=Duplicate(nul);}finally{Close(nul);}
      output=Duplicate(GetStdHandle(-11));error=Duplicate(GetStdHandle(-12));
      IntPtr bytes=IntPtr.Zero;InitializeProcThreadAttributeList(IntPtr.Zero,2,0,ref bytes);Check(bytes.ToInt64()>0&&bytes.ToInt64()<=65536);
      attributes=Marshal.AllocHGlobal(bytes);Check(InitializeProcThreadAttributeList(attributes,2,0,ref bytes));initialized=true;
      jobs=Marshal.AllocHGlobal(IntPtr.Size);Marshal.WriteIntPtr(jobs,job);
      handles=Marshal.AllocHGlobal(3*IntPtr.Size);Marshal.WriteIntPtr(handles,0,input);Marshal.WriteIntPtr(handles,IntPtr.Size,output);Marshal.WriteIntPtr(handles,2*IntPtr.Size,error);
      Check(UpdateProcThreadAttribute(attributes,0,new IntPtr(0x2000d),jobs,new IntPtr(IntPtr.Size),IntPtr.Zero,IntPtr.Zero));
      Check(UpdateProcThreadAttribute(attributes,0,new IntPtr(0x20002),handles,new IntPtr(3*IntPtr.Size),IntPtr.Zero,IntPtr.Zero));
      List<string> vars=new List<string>();foreach(string item in request.Environment){Check(item!=null&&item.IndexOf('\0')<0&&item.IndexOf('=')>0);vars.Add(item);}vars.Sort(StringComparer.OrdinalIgnoreCase);
      string block=String.Join("\0",vars.ToArray())+"\0\0";Check(block.Length<=32760);environment=Marshal.StringToHGlobalUni(block);
      StringBuilder command=new StringBuilder(Quote(request.Executable));foreach(string item in request.Arguments){Check(item!=null&&item.IndexOf('\0')<0);command.Append(' ').Append(Quote(item));}Check(command.Length<32767);
      StartupEx startup=new StartupEx();startup.Info.Size=(uint)Marshal.SizeOf(typeof(StartupEx));startup.Info.Flags=0x100;startup.Info.Input=input;startup.Info.Output=output;startup.Info.Error=error;startup.Attributes=attributes;
      // JOB_LIST assigns at process creation, before even a suspended target can escape.
      Check(CreateProcessW(request.Executable,command,IntPtr.Zero,IntPtr.Zero,true,0x08080404,environment,request.Root,ref startup,out process));
      Check(ResumeThread(process.Thread)!=0xffffffff);
      while(WaitForSingleObject(process.Process,20)==258){if(cancel.IsCompleted||Now()>=request.Deadline||WaitForSingleObject(parent,0)!=258)return 125;}
      uint code;Check(GetExitCodeProcess(process.Process,out code));return unchecked((int)code);
    } finally {
      try { if(owned) { Settle(job,Math.Max(request.Deadline,Now()+5000));settled=true; } }
      finally {
        Close(process.Thread);Close(process.Process);Close(parent);Close(input);Close(output);Close(error);
        if(initialized)DeleteProcThreadAttributeList(attributes);if(attributes!=IntPtr.Zero)Marshal.FreeHGlobal(attributes);
        if(jobs!=IntPtr.Zero)Marshal.FreeHGlobal(jobs);if(handles!=IntPtr.Zero)Marshal.FreeHGlobal(handles);if(environment!=IntPtr.Zero)Marshal.FreeHGlobal(environment);Close(job);
      }
    }
  }
  static void Marker(string token) { byte[] bytes=Encoding.ASCII.GetBytes("\nMEMOBRANCH_PDF_SETTLED:"+token+"\n");uint written;Check(WriteFile(GetStdHandle(-12),bytes,(uint)bytes.Length,out written,IntPtr.Zero)&&written==bytes.Length); }
  public static int Main(string[] args) {
    PdfHostRequest request=null;bool settled=false;int result=1;
    try {
      Check(args.Length==0);Console.InputEncoding=new UTF8Encoding(false,true);StringBuilder line=new StringBuilder();int c;
      while((c=Console.In.Read())!=-1&&c!='\n'){line.Append((char)c);Check(line.Length<=32768);}Check(c=='\n');
      using(MemoryStream bytes=new MemoryStream(new UTF8Encoding(false,true).GetBytes(line.ToString())))request=(PdfHostRequest)new DataContractJsonSerializer(typeof(PdfHostRequest)).ReadObject(bytes);
      Check(request.Version==1&&Hex(request.Token)&&request.ParentPid>0&&request.Deadline>Now());
      Private(request.Root,request.Operation=="check");
      if(request.Operation=="check"||request.Operation=="check-work"){Console.WriteLine("memobranch-pdf-host 1.0.0");settled=true;result=0;}
      else if(request.Operation=="cleanup"){Cleanup(request);settled=true;result=0;}
      else if(request.Operation=="run")result=Run(request,out settled);
      else Check(false);
    } catch { Console.Error.WriteLine("Owned PDF host refused or could not complete its operation"); }
    if(settled&&request!=null){try{Marker(request.Token);}catch{return 1;}}
    return result;
  }
}
