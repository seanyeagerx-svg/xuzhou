$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[Console]::InputEncoding = New-Object System.Text.UTF8Encoding($false)
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
Add-Type -TypeDefinition @'
using System;
using System.Diagnostics;
using System.Runtime.InteropServices;
public static class WorkbenchWindow {
  [StructLayout(LayoutKind.Sequential)] public struct Rect { public int Left,Top,Right,Bottom; }
  [StructLayout(LayoutKind.Sequential)] public struct Point { public int X,Y; }
  [StructLayout(LayoutKind.Sequential)] public struct Placement { public int Length,Flags,Show; public Point Min,Max; public Rect Normal; }
  [DllImport("user32.dll")] public static extern bool IsWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] public static extern IntPtr GetParent(IntPtr h);
  [DllImport("user32.dll",SetLastError=true)] public static extern IntPtr SetParent(IntPtr child,IntPtr parent);
  [DllImport("user32.dll",EntryPoint="GetWindowLongPtrW")] public static extern IntPtr GetStyle(IntPtr h,int index);
  [DllImport("user32.dll",EntryPoint="SetWindowLongPtrW",SetLastError=true)] public static extern IntPtr SetStyle(IntPtr h,int index,IntPtr value);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h,out Rect r);
  [DllImport("user32.dll")] public static extern bool GetClientRect(IntPtr h,out Rect r);
  [DllImport("user32.dll")] public static extern bool GetWindowPlacement(IntPtr h,ref Placement p);
  [DllImport("user32.dll")] public static extern bool SetWindowPlacement(IntPtr h,ref Placement p);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h,int n);
  [DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr h,IntPtr after,int x,int y,int w,int height,uint flags);
  [DllImport("user32.dll")] public static extern uint GetDpiForWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h,out uint pid);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern IntPtr SetThreadDpiAwarenessContext(IntPtr context);
  public static void UsePhysicalCoordinates() { SetThreadDpiAwarenessContext(new IntPtr(-4)); }
  public static IntPtr Child=IntPtr.Zero,Parent=IntPtr.Zero,OldParent=IntPtr.Zero,OldStyle=IntPtr.Zero,OldExStyle=IntPtr.Zero;
  public static Rect OldRect;
  public static Placement OldPlacement;
  public static bool Docked { get { return IsWindow(Child)&&GetParent(Child)==Parent&&Parent!=IntPtr.Zero; } }
  public static void Attach(IntPtr child,IntPtr parent) {
    if(!IsWindow(child)||!IsWindow(parent)||child==parent)throw new Exception("Window unavailable");
    if(Docked&&Child==child&&Parent==parent)return;
    Restore();Child=child;Parent=parent;OldParent=GetParent(child);OldStyle=GetStyle(child,-16);OldExStyle=GetStyle(child,-20);GetWindowRect(child,out OldRect);
    OldPlacement=new Placement();OldPlacement.Length=Marshal.SizeOf(typeof(Placement));GetWindowPlacement(child,ref OldPlacement);
    ShowWindow(child,9);
    SetStyle(child,-16,new IntPtr((OldStyle.ToInt64()&~0x80CF0000L)|0x40000000L));
    SetStyle(child,-20,new IntPtr(OldExStyle.ToInt64()&~0x00040000L));
    SetParent(child,parent);
    if(!Docked){Restore();throw new Exception("Window attachment failed");}
  }
  public static void Layout(double x,double y,double width,double height,bool visible) {
    if(!Docked)return;
    if(!visible){ShowWindow(Child,0);return;}
    var scale=Math.Max(1.0,GetDpiForWindow(Parent)/96.0);Rect client;GetClientRect(Parent,out client);
    int px=Math.Max(0,(int)Math.Round(x*scale)),py=Math.Max(0,(int)Math.Round(y*scale));
    int w=Math.Min(Math.Max(1,(int)Math.Round(width*scale)),Math.Max(1,client.Right-px));
    int h=Math.Min(Math.Max(1,(int)Math.Round(height*scale)),Math.Max(1,client.Bottom-py));
    SetWindowPos(Child,IntPtr.Zero,px,py,w,h,0x0070);ShowWindow(Child,5);
  }
  public static void Restore() {
    if(IsWindow(Child)){
      ShowWindow(Child,0);SetParent(Child,IsWindow(OldParent)?OldParent:IntPtr.Zero);
      SetStyle(Child,-16,OldStyle);SetStyle(Child,-20,OldExStyle);
      SetWindowPos(Child,IntPtr.Zero,OldRect.Left,OldRect.Top,Math.Max(400,OldRect.Right-OldRect.Left),Math.Max(300,OldRect.Bottom-OldRect.Top),0x0070);
      SetWindowPlacement(Child,ref OldPlacement);ShowWindow(Child,OldPlacement.Show==3?3:5);
    }
    Child=IntPtr.Zero;Parent=IntPtr.Zero;
  }
}
'@
try {
  while ($null -ne ($line = [Console]::ReadLine())) {
    $msg = $null
    try {
      $msg = $line | ConvertFrom-Json
      # Keep all Win32 rectangles in physical pixels before applying the host DPI.
      # A DPI-unaware PowerShell thread would otherwise scale and then clamp twice.
      [WorkbenchWindow]::UsePhysicalCoordinates()
      switch ($msg.action) {
        'attach' {
          if (-not [WorkbenchWindow]::Docked) {
            $native = Get-Process | Where-Object { $_.MainWindowHandle -ne 0 -and $_.Path -eq $msg.executable } | Select-Object -First 1
            if (-not $native) { throw '还没有找到 Grok Bot 主窗口，请等待它启动后重试。' }
            [WorkbenchWindow]::Attach($native.MainWindowHandle,[IntPtr]([long]$msg.parent))
          }
          [WorkbenchWindow]::Layout($msg.bounds.x,$msg.bounds.y,$msg.bounds.width,$msg.bounds.height,$msg.visible)
        }
        'layout' { [WorkbenchWindow]::Layout($msg.bounds.x,$msg.bounds.y,$msg.bounds.width,$msg.bounds.height,$msg.visible) }
        'hide' { [WorkbenchWindow]::Layout(0,0,1,1,$false) }
        'detach' { [WorkbenchWindow]::Restore() }
        'status' { }
        'close' { [WorkbenchWindow]::Restore() }
        default { throw 'Unsupported window operation' }
      }
      $rect = New-Object WorkbenchWindow+Rect
      if ([WorkbenchWindow]::Docked) { [void][WorkbenchWindow]::GetWindowRect([WorkbenchWindow]::Child,[ref]$rect) }
      $result = @{ id=$msg.id; result=@{ attached=[WorkbenchWindow]::Docked; child=([WorkbenchWindow]::Child.ToInt64().ToString()); parent=([WorkbenchWindow]::Parent.ToInt64().ToString()); visible=([WorkbenchWindow]::IsWindowVisible([WorkbenchWindow]::Child)); bounds=@{x=$rect.Left;y=$rect.Top;width=($rect.Right-$rect.Left);height=($rect.Bottom-$rect.Top)} } }
      [Console]::WriteLine(($result | ConvertTo-Json -Depth 6 -Compress))
      if ($msg.action -eq 'close') { break }
    } catch {
      [Console]::WriteLine((@{id=$msg.id;error=$_.Exception.Message} | ConvertTo-Json -Compress))
    }
  }
} finally { [WorkbenchWindow]::Restore() }
