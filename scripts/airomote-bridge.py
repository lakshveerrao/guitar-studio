"""
AiroMote -> WebSocket bridge for hardware testing.

Connects to the AiroMote boards over BLE from this PC and forwards every raw
notification to any connected WebSocket client as  <slot byte> + packets.
Run the app in dev with  ?bridge=ws://<this-pc-ip>:8765  to drive it with the
real controllers (works in any browser, no Web Bluetooth needed).

  python scripts/airomote-bridge.py [--slot0 AiroMote-1] [--slot1 AiroMote-2] [--seconds N]
"""
import argparse
import asyncio
import json
import sys

import websockets
from bleak import BleakClient, BleakScanner
import serial
import serial.tools.list_ports

TX = '7a3e0002-4d6f-7469-6f6e-416572304d43'
clients: set = set()
attached_slots: dict = {}  # slot -> name, replayed to late-joining clients


async def broadcast(msg):
    dead = []
    for ws in list(clients):
        try:
            await ws.send(msg)
        except Exception:
            dead.append(ws)
    for ws in dead:
        clients.discard(ws)


async def run_board(slot: int, name_prefix: str, stop: asyncio.Event):
    while not stop.is_set():
        dev = None
        devs = await BleakScanner.discover(timeout=6, return_adv=True)
        for d, adv in devs.values():
            n = adv.local_name or d.name or ''
            if n.startswith(name_prefix):
                dev = (d, n)
                break
        if not dev:
            print(f'[slot {slot}] {name_prefix} not advertising, retrying', flush=True)
            await asyncio.sleep(2)
            continue
        d, n = dev
        try:
            async with BleakClient(d.address, timeout=15) as cl:
                print(f'[slot {slot}] connected {n} {d.address}', flush=True)
                attached_slots[slot] = n
                await broadcast(json.dumps({'slot': slot, 'name': n, 'event': 'attach'}))
                loop = asyncio.get_event_loop()

                def cb(_, data, slot=slot):
                    loop.create_task(broadcast(bytes([slot]) + bytes(data)))

                await cl.start_notify(TX, cb)
                while cl.is_connected and not stop.is_set():
                    await asyncio.sleep(0.2)
                try:
                    await cl.stop_notify(TX)
                except Exception:
                    pass
        except Exception as e:
            print(f'[slot {slot}] error: {e}', flush=True)
        attached_slots.pop(slot, None)
        await broadcast(json.dumps({'slot': slot, 'event': 'detach'}))
        if not stop.is_set():
            await asyncio.sleep(1.5)


def crc16(b):
    c = 0xFFFF
    for x in b:
        c ^= x << 8
        for _ in range(8):
            c = ((c << 1) ^ 0x1021) & 0xFFFF if c & 0x8000 else (c << 1) & 0xFFFF
    return c


async def run_serial(stop: asyncio.Event):
    """Boards on USB stream the same 32-byte packets over their serial port, even while BLE is busy elsewhere."""
    opened = {}
    attached = {}
    while not stop.is_set():
        ports = [p for p in serial.tools.list_ports.comports() if p.vid == 0x303A]
        for p in ports:
            if p.device in opened:
                continue
            try:
                s = serial.Serial()
                s.port, s.baudrate, s.timeout, s.dtr, s.rts = p.device, 115200, 0, False, False
                s.open()
                opened[p.device] = (s, bytearray())
                print(f'[serial] opened {p.device} ({p.serial_number})', flush=True)
            except Exception as e:
                print(f'[serial] {p.device}: {e}', flush=True)
        for dev, (s, buf) in list(opened.items()):
            try:
                buf += s.read(4096)
            except Exception:
                s.close()
                opened.pop(dev)
                slot = attached.pop(dev, None)
                if slot is not None:
                    await broadcast(json.dumps({'slot': slot, 'event': 'detach'}))
                continue
            while True:
                i = buf.find(bytes([0xA5]))
                if i < 0 or len(buf) - i < 32:
                    if i > 0:
                        del buf[:i]
                    break
                pkt = bytes(buf[i:i + 32])
                if pkt[1] == 1 and int.from_bytes(pkt[30:32], 'little') == crc16(pkt[:30]):
                    slot = max(0, min(1, pkt[3] - 1))
                    if attached.get(dev) != slot:
                        attached[dev] = slot
                        await broadcast(json.dumps({'slot': slot, 'name': f'AiroMote-{pkt[3]} (USB {dev})', 'event': 'attach'}))
                    await broadcast(bytes([slot]) + pkt)
                    del buf[:i + 32]
                else:
                    del buf[:i + 1]
        await asyncio.sleep(0.01)
    for s, _ in opened.values():
        s.close()


async def handler(ws):
    clients.add(ws)
    print(f'client connected ({len(clients)})', flush=True)
    for slot, name in attached_slots.items():
        await ws.send(json.dumps({'slot': slot, 'name': name, 'event': 'attach'}))
    try:
        async for _ in ws:
            pass
    finally:
        clients.discard(ws)
        print(f'client left ({len(clients)})', flush=True)


async def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--slot0', default='AiroMote-1')
    ap.add_argument('--slot1', default='AiroMote-2')
    ap.add_argument('--port', type=int, default=8765)
    ap.add_argument('--seconds', type=int, default=0, help='auto-stop after N seconds (0 = run forever)')
    a = ap.parse_args()
    stop = asyncio.Event()
    async with websockets.serve(handler, '0.0.0.0', a.port):
        print(f'bridge listening on ws://0.0.0.0:{a.port}', flush=True)
        tasks = [asyncio.create_task(run_board(0, a.slot0, stop)), asyncio.create_task(run_board(1, a.slot1, stop)), asyncio.create_task(run_serial(stop))]
        if a.seconds:
            await asyncio.sleep(a.seconds)
            stop.set()
        else:
            await asyncio.gather(*tasks)
        await asyncio.gather(*tasks, return_exceptions=True)


if __name__ == '__main__':
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        sys.exit(0)
