import { desktopCapturer, globalShortcut, screen } from 'electron';
import crypto from 'node:crypto';

export type NativeInput = { send: (input: Record<string, unknown>) => Promise<unknown>; cancel: () => void };
type Lease = {
  conversationId: string;
  mode: 'human' | 'ai' | 'paused';
  actor: string;
  displayId: string;
  epoch: number;
  expiresAt: number;
};
type Frame = { epoch: number; capturedAt: number; bounds: Electron.Rectangle };
const STOP_SHORTCUTS = ['Control+Alt+Shift+P', 'Control+Alt+Shift+X', 'Control+Alt+Shift+F10'];
const fault = (code: string): never => {
  throw new Error('XUZHOU_DEVICE_' + code);
};

/** One physical screen lease across all chats and paired devices. Nothing is captured before owner activation. */
export class ComputerScreen {
  private lease?: Lease;
  private frames = new Map<string, Frame>();
  private epoch = 0;
  private stopShortcut?: string;
  private timer: ReturnType<typeof setInterval>;
  constructor(private readonly inputBridge: NativeInput) {
    this.timer = setInterval(() => {
      if (this.lease && this.lease.expiresAt <= Date.now()) this.pause(this.lease.conversationId);
    }, 1000);
    this.timer.unref();
  }
  status(conversationId: string) {
    const lease = this.lease;
    return {
      available: process.platform === 'win32',
      mode: lease?.conversationId === conversationId ? lease.mode : 'off',
      displayId: lease?.conversationId === conversationId ? lease.displayId : undefined,
      actor: lease?.conversationId === conversationId ? lease.actor : undefined,
      displays: screen
        .getAllDisplays()
        .map((d) => ({ id: String(d.id), name: d.label || String(d.id), width: d.size.width, height: d.size.height })),
      stopShortcut: (this.stopShortcut || STOP_SHORTCUTS[0]).replace('Control', 'Ctrl'),
    };
  }
  start(conversationId: string, mode: 'human' | 'ai', displayId?: string, actor = 'desktop') {
    if (process.platform !== 'win32') fault('SCREEN_UNAVAILABLE');
    if (this.lease && this.lease.conversationId !== conversationId && this.lease.mode !== 'paused')
      fault('SCREEN_BUSY');
    const display = screen.getAllDisplays().find((d) => String(d.id) === displayId) || screen.getPrimaryDisplay();
    if (!this.stopShortcut) {
      for (const shortcut of STOP_SHORTCUTS) {
        if (
          globalShortcut.register(shortcut, () => {
            if (this.lease) this.pause(this.lease.conversationId);
          })
        ) {
          this.stopShortcut = shortcut;
          break;
        }
      }
      if (!this.stopShortcut) fault('SCREEN_SHORTCUT_UNAVAILABLE');
    }
    this.inputBridge.cancel();
    this.frames.clear();
    this.lease = {
      conversationId,
      mode,
      actor: mode === 'ai' ? 'ai' : actor,
      displayId: String(display.id),
      epoch: ++this.epoch,
      expiresAt: Date.now() + 20 * 60000,
    };
    return this.status(conversationId);
  }
  private active(conversationId: string): Lease {
    const lease = this.lease;
    if (!lease || lease.conversationId !== conversationId || lease.mode === 'paused' || lease.expiresAt <= Date.now())
      fault('SCREEN_NOT_SHARED');
    return lease;
  }
  claim(conversationId: string, actor: string) {
    const lease = this.active(conversationId);
    this.inputBridge.cancel();
    this.frames.clear();
    lease.mode = 'human';
    lease.actor = actor;
    lease.epoch = ++this.epoch;
    return this.status(conversationId);
  }
  async capture(conversationId: string) {
    const lease = this.active(conversationId),
      epoch = lease.epoch;
    const display = screen.getAllDisplays().find((d) => String(d.id) === lease.displayId);
    if (!display) {
      this.pause(conversationId);
      fault('SCREEN_CHANGED');
    }
    const sources = await desktopCapturer.getSources({
      types: ['screen'],
      thumbnailSize: { width: 1440, height: 1000 },
    });
    if (this.active(conversationId).epoch !== epoch) fault('SCREEN_CHANGED');
    const source = sources.find((s) => s.display_id === lease.displayId);
    if (!source || source.thumbnail.isEmpty()) fault('SCREEN_UNAVAILABLE');
    const size = source.thumbnail.getSize(),
      frameId = crypto.randomUUID(),
      capturedAt = Date.now();
    for (const [id, frame] of this.frames) if (frame.capturedAt < capturedAt - 8000) this.frames.delete(id);
    this.frames.set(frameId, { epoch, capturedAt, bounds: display.bounds });
    return {
      frameId,
      width: size.width,
      height: size.height,
      capturedAt,
      base64: source.thumbnail.toJPEG(65).toString('base64'),
    };
  }
  async input(conversationId: string, value: Record<string, unknown>, actor: string) {
    const lease = this.active(conversationId);
    if (!value || typeof value !== 'object' || lease.actor !== actor || (actor === 'ai' && lease.mode !== 'ai'))
      fault('SCREEN_CONTROL_REQUIRED');
    const frame = this.frames.get(String(value.frameId));
    if (!frame || frame.epoch !== lease.epoch || Date.now() - frame.capturedAt > 8000) fault('SCREEN_FRAME_EXPIRED');
    const input: Record<string, unknown> = { type: value.type };
    if (value.type === 'click' || value.type === 'move' || value.type === 'drag') {
      if (
        typeof value.x !== 'number' ||
        typeof value.y !== 'number' ||
        !Number.isFinite(value.x) ||
        !Number.isFinite(value.y) ||
        value.x < 0 ||
        value.x > 1 ||
        value.y < 0 ||
        value.y > 1
      )
        fault('INPUT_INVALID');
      const point = screen.dipToScreenPoint({
        x: frame.bounds.x + Math.round(Number(value.x) * (frame.bounds.width - 1)),
        y: frame.bounds.y + Math.round(Number(value.y) * (frame.bounds.height - 1)),
      });
      Object.assign(input, point, { button: value.button === 'right' ? 'right' : 'left' });
      if (value.type === 'drag') {
        if (
          typeof value.toX !== 'number' ||
          typeof value.toY !== 'number' ||
          !Number.isFinite(value.toX) ||
          !Number.isFinite(value.toY) ||
          value.toX < 0 ||
          value.toX > 1 ||
          value.toY < 0 ||
          value.toY > 1
        )
          fault('INPUT_INVALID');
        const destination = screen.dipToScreenPoint({
          x: frame.bounds.x + Math.round(Number(value.toX) * (frame.bounds.width - 1)),
          y: frame.bounds.y + Math.round(Number(value.toY) * (frame.bounds.height - 1)),
        });
        Object.assign(input, { toX: destination.x, toY: destination.y });
      }
    } else if (value.type === 'scroll') {
      if (!Number.isInteger(value.delta) || Math.abs(Number(value.delta)) > 10) fault('INPUT_INVALID');
      input.delta = value.delta;
    } else if (value.type === 'text') {
      if (typeof value.text !== 'string' || value.text.length > 2000) fault('INPUT_INVALID');
      input.text = value.text;
    } else if (value.type === 'key') {
      if (
        typeof value.key !== 'string' ||
        value.key.length > 80 ||
        !/^[A-Za-z0-9]+(?:\+[A-Za-z0-9]+)*$/.test(value.key)
      )
        fault('INPUT_INVALID');
      input.key = value.key;
    } else fault('INPUT_INVALID');
    lease.expiresAt = Date.now() + 20 * 60000;
    return this.inputBridge.send(input);
  }
  pause(conversationId: string) {
    if (this.lease?.conversationId === conversationId) {
      this.lease.mode = 'paused';
      this.lease.epoch = ++this.epoch;
      this.frames.clear();
      this.inputBridge.cancel();
      if (this.stopShortcut) globalShortcut.unregister(this.stopShortcut);
      this.stopShortcut = undefined;
    }
    return this.status(conversationId);
  }
  revoke(actor: string) {
    if (this.lease?.actor === actor) this.pause(this.lease.conversationId);
  }
  close() {
    clearInterval(this.timer);
    if (this.lease) this.pause(this.lease.conversationId);
    this.inputBridge.cancel();
  }
}
