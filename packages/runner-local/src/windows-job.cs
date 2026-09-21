using System;
using System.Text;
using System.IO;
using System.Linq;
using System.Collections.Generic;
using System.Threading.Tasks;
using System.Runtime.InteropServices;
public static class StackGateJob {
 [StructLayout(LayoutKind.Sequential)] struct ProcessInfo {public IntPtr process,thread;public uint pid,tid;}
 [StructLayout(LayoutKind.Sequential,CharSet=CharSet.Unicode)] struct Startup {public uint cb;public string reserved,desktop,title;public uint x,y,width,height,columns,rows,fill,flags;public short show,reservedSize;public IntPtr reservedPtr,input,output,error;}
 [StructLayout(LayoutKind.Sequential)] struct StartupEx {public Startup startup;public IntPtr attributes;}
 [StructLayout(LayoutKind.Sequential)] struct BasicLimit {public long processTime,jobTime;public uint flags;public UIntPtr minimum,maximum;public uint active;public UIntPtr affinity;public uint priority,scheduling;}
 [StructLayout(LayoutKind.Sequential)] struct Counters {public ulong readOps,writeOps,otherOps,readBytes,writeBytes,otherBytes;}
 [StructLayout(LayoutKind.Sequential)] struct ExtendedLimit {public BasicLimit basic;public Counters io;public UIntPtr processMemory,jobMemory,peakProcess,peakJob;}
 [StructLayout(LayoutKind.Sequential)] struct FileTime {public uint low,high;}
 [DllImport("kernel32.dll",SetLastError=true,CharSet=CharSet.Unicode)] static extern IntPtr CreateJobObjectW(IntPtr attributes,string name);
 [DllImport("kernel32.dll",SetLastError=true)] static extern bool SetInformationJobObject(IntPtr job,int kind,ref ExtendedLimit value,uint length);
 [DllImport("kernel32.dll",SetLastError=true)] static extern bool IsProcessInJob(IntPtr process,IntPtr job,out bool member);
 [DllImport("kernel32.dll",SetLastError=true)] static extern bool TerminateJobObject(IntPtr job,uint exit);
 [DllImport("kernel32.dll",SetLastError=true,CharSet=CharSet.Unicode)] static extern bool CreateProcessW(string application,StringBuilder command,IntPtr processSecurity,IntPtr threadSecurity,bool inherit,uint flags,IntPtr environment,string cwd,ref StartupEx startup,out ProcessInfo process);
 [DllImport("kernel32.dll",SetLastError=true)] static extern uint ResumeThread(IntPtr thread);
 [DllImport("kernel32.dll",SetLastError=true)] static extern uint WaitForSingleObject(IntPtr handle,uint milliseconds);
 [DllImport("kernel32.dll",SetLastError=true)] static extern bool GetExitCodeProcess(IntPtr process,out uint code);
 [DllImport("kernel32.dll",SetLastError=true)] static extern bool GetProcessTimes(IntPtr process,out FileTime created,out FileTime exited,out FileTime kernel,out FileTime user);
 [DllImport("kernel32.dll",SetLastError=true)] static extern bool TerminateProcess(IntPtr process,uint code);
 [DllImport("kernel32.dll",SetLastError=true)] static extern bool CloseHandle(IntPtr handle);
 [DllImport("kernel32.dll",SetLastError=true,CharSet=CharSet.Unicode)] static extern IntPtr CreateFileW(string name,uint access,uint sharing,IntPtr security,uint disposition,uint flags,IntPtr template);
 [DllImport("kernel32.dll")] static extern IntPtr GetStdHandle(int id);
 [DllImport("kernel32.dll")] static extern IntPtr GetCurrentProcess();
 [DllImport("kernel32.dll",SetLastError=true)] static extern bool DuplicateHandle(IntPtr sourceProcess,IntPtr source,IntPtr targetProcess,out IntPtr target,uint access,bool inherit,uint options);
 [DllImport("kernel32.dll",SetLastError=true)] static extern bool InitializeProcThreadAttributeList(IntPtr list,int count,uint flags,ref IntPtr bytes);
 [DllImport("kernel32.dll",SetLastError=true)] static extern bool UpdateProcThreadAttribute(IntPtr list,uint flags,IntPtr attribute,IntPtr value,IntPtr bytes,IntPtr previous,IntPtr returned);
 [DllImport("kernel32.dll")] static extern void DeleteProcThreadAttributeList(IntPtr list);
 static void Check(bool success,string stage){if(!success)throw new InvalidOperationException(stage+":"+Marshal.GetLastWin32Error());}
 static string Quote(string input){var result=new StringBuilder("\"");int slash=0;foreach(char c in input){if(c=='\\'){slash++;continue;}if(c=='\"'){result.Append('\\',slash*2+1);result.Append(c);}else{result.Append('\\',slash);result.Append(c);}slash=0;}result.Append('\\',slash*2);return result.Append('"').ToString();}
 static void Record(string directory,string name,string json){string temporary=Path.Combine(directory,name+".tmp");using(var file=new FileStream(temporary,FileMode.CreateNew,FileAccess.Write,FileShare.None)){byte[] bytes=new UTF8Encoding(false).GetBytes(json);file.Write(bytes,0,bytes.Length);file.Flush(true);}File.Move(temporary,Path.Combine(directory,name));}
 public static void Run(string executable,string[] args,string cwd,Dictionary<string,string> environment,string directory,string token,string version){
  IntPtr job=IntPtr.Zero,environmentBlock=IntPtr.Zero,attributes=IntPtr.Zero,handleArray=IntPtr.Zero,jobArray=IntPtr.Zero;var handles=new List<IntPtr>();var process=new ProcessInfo();bool resumed=false;
  // The parent keeps stdin open after one request line. EOF proves the actual pipe owner exited.
  var parentConnection=Task.Factory.StartNew(()=>Console.In.ReadToEnd());
  try{
   string earlyCancel=Path.Combine(directory,"cancel.txt");if(File.Exists(earlyCancel)){string request=File.ReadAllText(earlyCancel);if(request==token+"\nCANCELED"||request==token+"\nTIMED_OUT"||request==token+"\nERROR"){Record(directory,"finished.json","{\"raw_exit_code\":null,\"cleanup_complete\":true,\"not_started\":true,\"owner_token\":\""+token+"\"}");return;}}
   job=CreateJobObjectW(IntPtr.Zero,null);Check(job!=IntPtr.Zero,"CREATE_JOB");
   var limits=new ExtendedLimit();limits.basic.flags=0x2000;Check(SetInformationJobObject(job,9,ref limits,(uint)Marshal.SizeOf(typeof(ExtendedLimit))),"JOB_LIMITS");
   IntPtr nul=CreateFileW("NUL",0x80000000,3,IntPtr.Zero,3,0,IntPtr.Zero);Check(nul!=new IntPtr(-1),"OPEN_STDIN_NULL");
   try{IntPtr input;Check(DuplicateHandle(GetCurrentProcess(),nul,GetCurrentProcess(),out input,0,true,2),"DUPLICATE_STDIN");handles.Add(input);}finally{CloseHandle(nul);}
   foreach(int stream in new[]{-11,-12}){IntPtr copy;Check(DuplicateHandle(GetCurrentProcess(),GetStdHandle(stream),GetCurrentProcess(),out copy,0,true,2),"DUPLICATE_STDIO");handles.Add(copy);}
   IntPtr size=IntPtr.Zero;InitializeProcThreadAttributeList(IntPtr.Zero,2,0,ref size);attributes=Marshal.AllocHGlobal(size);Check(InitializeProcThreadAttributeList(attributes,2,0,ref size),"INIT_ATTRIBUTES");
   handleArray=Marshal.AllocHGlobal(IntPtr.Size*handles.Count);for(int i=0;i<handles.Count;i++)Marshal.WriteIntPtr(handleArray,i*IntPtr.Size,handles[i]);
   Check(UpdateProcThreadAttribute(attributes,0,new IntPtr(0x20002),handleArray,new IntPtr(IntPtr.Size*handles.Count),IntPtr.Zero,IntPtr.Zero),"HANDLE_LIST");
   // Atomic creation-time membership closes the suspended-but-not-yet-assigned orphan window.
   jobArray=Marshal.AllocHGlobal(IntPtr.Size);Marshal.WriteIntPtr(jobArray,job);Check(UpdateProcThreadAttribute(attributes,0,new IntPtr(0x2000D),jobArray,new IntPtr(IntPtr.Size),IntPtr.Zero,IntPtr.Zero),"JOB_LIST");
   var startup=new StartupEx();startup.startup.cb=(uint)Marshal.SizeOf(typeof(StartupEx));startup.startup.flags=0x100;startup.startup.input=handles[0];startup.startup.output=handles[1];startup.startup.error=handles[2];startup.attributes=attributes;
   string env=String.Join("\0",environment.OrderBy(item=>item.Key,StringComparer.OrdinalIgnoreCase).Select(item=>item.Key+"="+item.Value))+"\0\0";environmentBlock=Marshal.StringToHGlobalUni(env);
   string command=Quote(executable)+" "+String.Join(" ",args.Select(Quote));
   Check(CreateProcessW(executable,new StringBuilder(command),IntPtr.Zero,IntPtr.Zero,true,0x4|0x400|0x80000|0x08000000,environmentBlock,cwd,ref startup,out process),"CREATE_PROCESS");
   bool member;Check(IsProcessInJob(process.process,job,out member)&&member,"VERIFY_JOB");
   FileTime created,exited,kernel,user;Check(GetProcessTimes(process.process,out created,out exited,out kernel,out user),"PROCESS_IDENTITY");
   string identity=(((ulong)created.high<<32)|created.low).ToString();
   Record(directory,"started.json","{\"pid\":"+process.pid+",\"creation_identity\":\""+identity+"\",\"owner_token\":\""+token+"\",\"job_assigned\":true,\"broker_version\":\""+version+"\"}");
   Check(ResumeThread(process.thread)!=0xffffffff,"RESUME");resumed=true;
   string termination=null;uint wait;
   while((wait=WaitForSingleObject(process.process,25))==258){if(parentConnection.IsCompleted){termination="ERROR";break;}string cancel=Path.Combine(directory,"cancel.txt");if(File.Exists(cancel)){string request=File.ReadAllText(cancel);if(request==token+"\nCANCELED"||request==token+"\nTIMED_OUT"||request==token+"\nERROR"){termination=request.Substring(token.Length+1);break;}}}
   Check(wait==0||termination!=null,"WAIT_PROCESS");uint code=0;if(termination==null)Check(GetExitCodeProcess(process.process,out code),"EXIT_CODE");
   // Only this private noninherited job handle can target the owned process tree.
   Check(TerminateJobObject(job,0),"CLEANUP_JOB");Check(WaitForSingleObject(job,5000)==0,"WAIT_JOB_EMPTY");
   Record(directory,"finished.json","{\"raw_exit_code\":"+(termination==null?code.ToString():"null")+",\"cleanup_complete\":true,\"termination\":"+(termination==null?"null":"\""+termination+"\"")+",\"owner_token\":\""+token+"\"}");
  }catch(Exception error){if(process.process!=IntPtr.Zero&&!resumed)TerminateProcess(process.process,3);Record(directory,"error.json","{\"error\":\""+error.Message.Replace("\\","/").Replace("\"","")+"\"}");throw;}
  finally{if(job!=IntPtr.Zero)CloseHandle(job);if(process.thread!=IntPtr.Zero)CloseHandle(process.thread);if(process.process!=IntPtr.Zero)CloseHandle(process.process);foreach(var handle in handles)CloseHandle(handle);if(attributes!=IntPtr.Zero){DeleteProcThreadAttributeList(attributes);Marshal.FreeHGlobal(attributes);}if(handleArray!=IntPtr.Zero)Marshal.FreeHGlobal(handleArray);if(jobArray!=IntPtr.Zero)Marshal.FreeHGlobal(jobArray);if(environmentBlock!=IntPtr.Zero)Marshal.FreeHGlobal(environmentBlock);}
 }
}
