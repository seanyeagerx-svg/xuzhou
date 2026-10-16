$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[Console]::InputEncoding = New-Object Text.UTF8Encoding($false)
[Console]::OutputEncoding = New-Object Text.UTF8Encoding($false)
Add-Type -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
public static class XuzhouInput {
  [StructLayout(LayoutKind.Sequential)] public struct Mouse { public int X,Y; public uint Data,Flags,Time; public UIntPtr Extra; }
  [StructLayout(LayoutKind.Sequential)] public struct Keyboard { public ushort Key,Scan; public uint Flags,Time; public UIntPtr Extra; }
  [StructLayout(LayoutKind.Explicit)] public struct Payload { [FieldOffset(0)] public Mouse M; [FieldOffset(0)] public Keyboard K; }
  [StructLayout(LayoutKind.Sequential)] public struct Input { public uint Type; public Payload Value; }
  [DllImport("user32.dll",SetLastError=true)] static extern uint SendInput(uint count, Input[] values, int size);
  [DllImport("user32.dll",SetLastError=true)] static extern bool SetCursorPos(int x,int y);
  [DllImport("user32.dll")] static extern IntPtr SetThreadDpiAwarenessContext(IntPtr context);
  [DllImport("user32.dll")] static extern int GetSystemMetrics(int index);
  static void Send(List<Input> values) { var inputs=values.ToArray(); if(SendInput((uint)inputs.Length,inputs,Marshal.SizeOf(typeof(Input)))!=inputs.Length)throw new Exception("Input blocked"); }
  static Input Key(ushort key,ushort scan,uint flags) { return new Input{Type=1,Value=new Payload{K=new Keyboard{Key=key,Scan=scan,Flags=flags}}}; }
  static Input MouseEvent(uint flags,uint data=0) { return new Input{Type=0,Value=new Payload{M=new Mouse{Flags=flags,Data=data}}}; }
  public static void Position(int x,int y) { SetThreadDpiAwarenessContext(new IntPtr(-4)); if(!SetCursorPos(x,y))throw new Exception("Position blocked"); }
  public static void Click(bool right) { Send(new List<Input>{MouseEvent(right?0x8u:0x2u),MouseEvent(right?0x10u:0x4u)}); }
  public static void Drag(int x,int y,int toX,int toY) {
    SetThreadDpiAwarenessContext(new IntPtr(-4));
    int left=GetSystemMetrics(76),top=GetSystemMetrics(77),width=GetSystemMetrics(78),height=GetSystemMetrics(79);
    if(width<2||height<2)throw new Exception("Display unavailable");
    var values=new List<Input>();
    for(int i=0;i<=8;i++){
      int px=x+(toX-x)*i/8,py=y+(toY-y)*i/8;
      values.Add(new Input{Type=0,Value=new Payload{M=new Mouse{X=(px-left)*65535/(width-1),Y=(py-top)*65535/(height-1),Flags=0xC001}}});
      if(i==0)values.Add(MouseEvent(0x2));
    }
    values.Add(MouseEvent(0x4));Send(values);
  }
  public static void Scroll(int delta) { Send(new List<Input>{MouseEvent(0x800,unchecked((uint)(delta*120)))}); }
  public static void Text(string text) { var values=new List<Input>();foreach(char c in text){values.Add(Key(0,c,4));values.Add(Key(0,c,6));}if(values.Count>0)Send(values); }
  public static void Keys(string shortcut) {
    var names=shortcut.Split('+');var keys=new List<ushort>();
    foreach(string item in names){ushort key;switch(item.ToUpperInvariant()){
      case "CTRL":case "CONTROL":key=0x11;break;case "ALT":key=0x12;break;case "SHIFT":key=0x10;break;case "WIN":case "META":key=0x5B;break;
      case "ENTER":key=13;break;case "TAB":key=9;break;case "ESC":case "ESCAPE":key=27;break;case "BACKSPACE":key=8;break;case "DELETE":key=46;break;
      case "LEFT":case "ARROWLEFT":key=37;break;case "UP":case "ARROWUP":key=38;break;case "RIGHT":case "ARROWRIGHT":key=39;break;case "DOWN":case "ARROWDOWN":key=40;break;
      case "HOME":key=36;break;case "END":key=35;break;case "PAGEUP":key=33;break;case "PAGEDOWN":key=34;break;case "SPACE":key=32;break;
      default:if(item.Length!=1||!char.IsLetterOrDigit(item[0])||item[0]>127)throw new Exception("Unsupported key");key=(ushort)char.ToUpperInvariant(item[0]);break;
    }keys.Add(key);}
    var values=new List<Input>();foreach(ushort k in keys)values.Add(Key(k,0,0));keys.Reverse();foreach(ushort k in keys)values.Add(Key(k,0,2));Send(values);
  }
}
'@
while ($null -ne ($taskLine = [Console]::ReadLine())) {
  $taskRequest = $null
  try {
    $taskRequest = $taskLine | ConvertFrom-Json
    switch ($taskRequest.type) {
      'move' { [XuzhouInput]::Position([int]$taskRequest.x,[int]$taskRequest.y) }
      'click' { [XuzhouInput]::Position([int]$taskRequest.x,[int]$taskRequest.y); [XuzhouInput]::Click($taskRequest.button -eq 'right') }
      'drag' { [XuzhouInput]::Drag([int]$taskRequest.x,[int]$taskRequest.y,[int]$taskRequest.toX,[int]$taskRequest.toY) }
      'scroll' { [XuzhouInput]::Scroll([int]$taskRequest.delta) }
      'text' { [XuzhouInput]::Text([string]$taskRequest.text) }
      'key' { [XuzhouInput]::Keys([string]$taskRequest.key) }
      default { throw 'Unsupported input' }
    }
    [Console]::WriteLine((@{id=$taskRequest.id;result=@{sent=$true}} | ConvertTo-Json -Compress))
  } catch { [Console]::WriteLine((@{id=$taskRequest.id;error='INPUT_FAILED'} | ConvertTo-Json -Compress)) }
}
