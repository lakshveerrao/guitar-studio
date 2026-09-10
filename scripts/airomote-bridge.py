"""
AiroMote -> WebSocket bridge for hardware testing.

Connects to the AiroMote boards over BLE from this PC and forwards every raw
notification to any connected WebSocket client as  <slot byte> + packets.
Run the app in dev with  ?bridge=ws://<this-pc-ip>:8765  to drive it with the
real controllers (works in any browser, no Web Bluetooth needed).

  python scripts/airomote-bridge.py [--slot0 AiroMote-1] [--slot1 AiroMote-2] [--seconds N]

A board that is also plugged in over USB streams the same packets on its
serial port. The serial link is the faster, lower-latency source (no BLE
connection interval), so when a board is seen on serial its BLE link is
skipped / dropped and every packet is forwarded exactly once.
"""
import argparse
import asyncio
import json
import re
import sys

import websockets
from bleak import BleakClient, BleakScanner
import serial
import serial.tools.list_ports

TX = '7a3e0002-4d6f-7469-6f6e-416572304d43'
MAGIC = 0xA5
PACKET = 32
clients: set = set()
attached_slots: dict = {}  # slot -> name, replayed to late-joining clients
serial_slots: dict = {}  # slot -> serial port name, while a board streams over USB
ble_slots: dict = {}  # slot -> BLE name, while a board streams over BLE


async def broadcast(msg):
    dead = []
    for ws in list(clients):
        try:
            await ws.send(msg)
        except Exception:
            dead.append(ws)
    for ws in dead:
        clients.discard(ws)


async def attach(slot: int, name: str):
    attached_slots[slot] = name
    await broadcast(json.dumps({'slot': slot, 'name': name, 'event': 'attach'}))


async def detach(slot: int):
    attached_slots.pop(slot, None)
    await broadcast(json.dumps({'slot': slot, 'event': 'detach'}))


def crc16(b):
    c = 0xFFFF
    for x in b:
        c ^= x << 8
        for _ in range(8):
            c = ((c << 1) ^ 0x1021) & 0xFFFF if c & 0x8000 else (c << 1) & 0xFFFF
    return c


def packet_slot(pkt: bytes):
    """Slot derived from the packet's own device id (byte 3), or None for a non-AiroMote frame."""
    if len(pkt) < PACKET or pkt[0] != MAGIC or pkt[1] != 1:
        return None
    if int.from_bytes(pkt[30:32], 'little') != crc16(pkt[:30]):
        return None
    return max(0, min(1, pkt[3] - 1))


def slot_from_prefix(prefix: str, default: int) -> int:
    """`AiroMote-2` -> slot 1; anything else keeps the CLI slot."""
    m = re.search(r'-(\d+)', prefix)
    if m:
        return max(0, min(1, int(m.group(1)) - 1))
    return default


async def run_board(cli_slot: int, name_prefix: str, stop: asyncio.Event):
    expected_slot = slot_from_prefix(name_prefix, cli_slot)
    skipped_logged = False
    while not stop.is_set():
        if expected_slot in serial_slots:
            if not skipped_logged:
                print(f'[slot {expected_slot}] {name_prefix} is streaming over USB ({serial_slots[expected_slot]}); BLE skipped', flush=True)
                skipped_logged = True
            await asyncio.sleep(1)
            continue
        skipped_logged = False
        dev = None
        devs = await BleakScanner.discover(timeout=6, return_adv=True)
        for d, adv in devs.values():
            n = adv.local_name or d.name or ''
            if n.startswith(name_prefix):
                dev = (d, n)
                break
        if not dev:
            print(f'[slot {expected_slot}] {name_prefix} not advertising, retrying', flush=True)
            await asyncio.sleep(2)
            continue
        d, n = dev
        slot = expected_slot
        try:
            async with BleakClient(d.address, timeout=15) as cl:
                print(f'[slot {slot}] connected {n} {d.address} over BLE', flush=True)
                ble_slots[slot] = n
                await attach(slot, n)
                loop = asyncio.get_event_loop()
                state = {'slot': slot}

                async def forward(data: bytes):
                    # the packet's own device id wins over the CLI slot so both transports agree
                    s = packet_slot(bytes(data[:PACKET]))
                    if s is None:
                        s = state['slot']
                    elif s != state['slot']:
                        print(f'[slot {state["slot"]}] {n} reports device id {s + 1}; re-attaching as slot {s}', flush=True)
                        await detach(state['slot'])
                        ble_slots.pop(state['slot'], None)
                        state['slot'] = s
                        ble_slots[s] = n
                        await attach(s, n)
                    if s in serial_slots:
                        return  # USB has this board: do not forward the BLE copy as well
                    await broadcast(bytes([s]) + bytes(data))

                def cb(_, data):
                    loop.create_task(forward(bytes(data)))

                await cl.start_notify(TX, cb)
                while cl.is_connected and not stop.is_set():
                    if state['slot'] in serial_slots:
                        print(f'[slot {state["slot"]}] {n} now streaming over USB; dropping the BLE link', flush=True)
                        break
                    await asyncio.sleep(0.2)
                try:
                    await cl.stop_notify(TX)
                except Exception:
                    pass
                slot = state['slot']
        except Exception as e:
            print(f'[slot {slot}] error: {e}', flush=True)
        ble_slots.pop(slot, None)
        if slot not in serial_slots:
            await detach(slot)
        if not stop.is_set():
            await asyncio.sleep(1.5)


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
                    serial_slots.pop(slot, None)
                    await detach(slot)
                continue
            while True:
                i = buf.find(bytes([MAGIC]))
                if i < 0:
                    # console text / boot logs: nothing to keep (0xA5 never occurs in ASCII)
                    del buf[:]
                    break
                if len(buf) - i < PACKET:
                    # partial packet: keep only the tail that starts at the magic byte
                    del buf[:i]
                    break
                pkt = bytes(buf[i:i + PACKET])
                slot = packet_slot(pkt)
                if slot is not None:
                    if attached.get(dev) != slot:
                        old = attached.get(dev)
                        if old is not None:
                            serial_slots.pop(old, None)
                            await detach(old)
                        attached[dev] = slot
                        serial_slots[slot] = dev
                        source = 'USB' + (' (BLE link will be dropped)' if slot in ble_slots else '')
                        print(f'[slot {slot}] AiroMote-{pkt[3]} streaming over {source} {dev}', flush=True)
                        await attach(slot, f'AiroMote-{pkt[3]} (USB {dev})')
                    await broadcast(bytes([slot]) + pkt)
                    del buf[:i + PACKET]
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
