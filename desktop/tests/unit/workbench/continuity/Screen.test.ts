import { describe, expect, it, vi } from 'vitest';
const mock = vi.hoisted(() => ({
  display: {
    id: 1,
    label: 'synthetic',
    size: { width: 1000, height: 600 },
    bounds: { x: -100, y: 0, width: 1000, height: 600 },
  },
}));
vi.mock('electron', () => ({
  globalShortcut: { register: () => true, unregister: vi.fn() },
  screen: {
    getAllDisplays: () => [mock.display],
    getPrimaryDisplay: () => mock.display,
    dipToScreenPoint: (point: unknown) => point,
  },
  desktopCapturer: {
    getSources: async () => [
      {
        display_id: '1',
        thumbnail: {
          isEmpty: () => false,
          getSize: () => ({ width: 1000, height: 600 }),
          toJPEG: () => Buffer.from('synthetic'),
        },
      },
    ],
  },
}));
import { ComputerScreen } from '@/process/services/computer/screen';
describe('Lease-bound screen drag', () => {
  it('maps both endpoints into the active display and sends a single atomic native drag', async () => {
    const send = vi.fn().mockResolvedValue({ sent: true }),
      screen = new ComputerScreen({ send, cancel: vi.fn() });
    try {
      screen.start('chat', 'human');
      const frame = await screen.capture('chat');
      await screen.input(
        'chat',
        { type: 'drag', frameId: frame.frameId, x: 0.1, y: 0.2, toX: 0.9, toY: 0.8 },
        'desktop'
      );
      expect(send).toHaveBeenCalledWith({ type: 'drag', x: 0, y: 120, toX: 799, toY: 479, button: 'left' });
    } finally {
      screen.close();
    }
  });
  it('refuses off-screen endpoints and stale frames after pause', async () => {
    const send = vi.fn(),
      screen = new ComputerScreen({ send, cancel: vi.fn() });
    try {
      screen.start('chat', 'human');
      const frame = await screen.capture('chat');
      await expect(
        screen.input('chat', { type: 'drag', frameId: frame.frameId, x: 0, y: 0, toX: 1.1, toY: 0 }, 'desktop')
      ).rejects.toThrow('INPUT_INVALID');
      screen.pause('chat');
      await expect(
        screen.input('chat', { type: 'drag', frameId: frame.frameId, x: 0, y: 0, toX: 1, toY: 1 }, 'desktop')
      ).rejects.toThrow('SCREEN_NOT_SHARED');
      expect(send).not.toHaveBeenCalled();
    } finally {
      screen.close();
    }
  });
});
