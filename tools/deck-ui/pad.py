#!/usr/bin/env python3
"""Virtual gamepad for driving Steam on the Deck: press buttons over SSH.

Runs ON the Deck with the system Python (standard library only). Creates an
Xbox 360 pad through /dev/uinput (writable by the logged-in `deck` user via
the uaccess ACL), presses the named buttons in order, then removes the pad.
Normally run through pad.sh from the development machine.

  python3 pad.py [--delay MS] [--settle MS] BUTTON...

Buttons: a b x y lb rb lt rt view menu guide l3 r3 up down left right
(lb/rb are L1/R1, lt/rt are L2/R2, menu is the Deck's ☰, view is ⧉).
`wait:MS` pauses. `hold:BUTTON:MS` holds a button.
"""

from __future__ import annotations

import fcntl
import os
import struct
import sys
import time

EV_SYN, EV_KEY, EV_ABS = 0x00, 0x01, 0x03
SYN_REPORT = 0
UI_SET_EVBIT, UI_SET_KEYBIT, UI_SET_ABSBIT = 0x40045564, 0x40045565, 0x40045567
UI_DEV_CREATE, UI_DEV_DESTROY = 0x5501, 0x5502
BUS_USB = 0x03
ABS_CNT = 64

# Steam reads the face buttons of this pad by position, not by xpad's names:
# BTN_A (0x130) arrived as B, BTN_X (0x133) as Y (DEVICE 2026-10-20, Steam's
# vgp_onbuttondown codes). So each label sends the code Steam takes for it.
KEYS = {
    "a": 0x131, "b": 0x130, "x": 0x134, "y": 0x133,
    "lb": 0x136, "rb": 0x137, "view": 0x13A, "menu": 0x13B, "guide": 0x13C,
    "l3": 0x13D, "r3": 0x13E,
}
ABS_X, ABS_Y, ABS_Z, ABS_RX, ABS_RY, ABS_RZ, ABS_HAT0X, ABS_HAT0Y = 0x00, 0x01, 0x02, 0x03, 0x04, 0x05, 0x10, 0x11
AXES = {  # axis: (min, max)
    ABS_X: (-32768, 32767), ABS_Y: (-32768, 32767), ABS_RX: (-32768, 32767), ABS_RY: (-32768, 32767),
    ABS_Z: (0, 255), ABS_RZ: (0, 255), ABS_HAT0X: (-1, 1), ABS_HAT0Y: (-1, 1),
}
DPAD = {"up": (ABS_HAT0Y, -1), "down": (ABS_HAT0Y, 1), "left": (ABS_HAT0X, -1), "right": (ABS_HAT0X, 1)}
TRIGGERS = {"lt": ABS_Z, "rt": ABS_RZ}


class Pad:
    def __init__(self) -> None:
        self.fd = os.open("/dev/uinput", os.O_WRONLY | os.O_NONBLOCK)
        for ev in (EV_SYN, EV_KEY, EV_ABS):
            fcntl.ioctl(self.fd, UI_SET_EVBIT, ev)
        for code in KEYS.values():
            fcntl.ioctl(self.fd, UI_SET_KEYBIT, code)
        absmax, absmin = [0] * ABS_CNT, [0] * ABS_CNT
        for code, (lo, hi) in AXES.items():
            fcntl.ioctl(self.fd, UI_SET_ABSBIT, code)
            absmin[code], absmax[code] = lo, hi
        name = b"Microsoft X-Box 360 pad"
        dev = struct.pack("80sHHHHI", name, BUS_USB, 0x045E, 0x028E, 0x0110, 0)
        dev += struct.pack(f"{ABS_CNT}i", *absmax) + struct.pack(f"{ABS_CNT}i", *absmin)
        dev += struct.pack(f"{ABS_CNT}i", *([0] * ABS_CNT)) * 2  # fuzz, flat
        os.write(self.fd, dev)
        fcntl.ioctl(self.fd, UI_DEV_CREATE)

    def emit(self, etype: int, code: int, value: int) -> None:
        now = time.time()
        sec = int(now)
        os.write(self.fd, struct.pack("llHHi", sec, int((now - sec) * 1e6), etype, code, value))

    def set(self, button: str, down: bool) -> None:
        if button in KEYS:
            self.emit(EV_KEY, KEYS[button], 1 if down else 0)
        elif button in DPAD:
            axis, value = DPAD[button]
            self.emit(EV_ABS, axis, value if down else 0)
        elif button in TRIGGERS:
            self.emit(EV_ABS, TRIGGERS[button], 255 if down else 0)
        else:
            raise ValueError(f"unknown button: {button}")
        self.emit(EV_SYN, SYN_REPORT, 0)

    def close(self) -> None:
        fcntl.ioctl(self.fd, UI_DEV_DESTROY)
        os.close(self.fd)


def main(argv: list[str]) -> int:
    delay, settle, steps = 0.25, 1.5, []
    args = iter(argv)
    for arg in args:
        if arg == "--delay":
            delay = int(next(args)) / 1000
        elif arg == "--settle":
            settle = int(next(args)) / 1000
        else:
            steps.append(arg.lower())
    if not steps:
        print(__doc__, file=sys.stderr)
        return 2
    for step in steps:  # validate before creating the device
        name = step.split(":")[1] if step.startswith("hold:") else step
        if not step.startswith("wait:") and name not in KEYS and name not in DPAD and name not in TRIGGERS:
            print(f"unknown button: {name}", file=sys.stderr)
            return 2
    pad = Pad()
    try:
        time.sleep(settle)  # let Steam notice the new controller
        for step in steps:
            if step.startswith("wait:"):
                time.sleep(int(step[5:]) / 1000)
                continue
            hold = 0.08
            if step.startswith("hold:"):
                _, step, ms = step.split(":")
                hold = int(ms) / 1000
            pad.set(step, True)
            time.sleep(hold)
            pad.set(step, False)
            time.sleep(delay)
            print(step, flush=True)
    finally:
        time.sleep(0.2)
        pad.close()
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
