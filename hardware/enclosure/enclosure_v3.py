"""3D-printable enclosure for the ESP32 Micronova interface (v3.1).

Layout (no perfboard: ESP32 + PC817s wired with Dupont jumpers):
- X- wall: the DB9 screw-terminal breakout is FLUSH-MOUNTED. The DB9 plug sticks out,
  the screw terminals stay inside. The breakout flange is glued from the inside.
- X+ wall: USB-C opening (tall slot, the ESP can sit either way up).
- Y+ wall: optional 5 mm cable pass-through (e.g. an external temperature probe).
- Inside: 4 standoffs with snap pegs hold the ESP32 (pins down), lots of room for wires.
- Lid: 4 x M3 self-tapping countersunk screws, ventilation slots.

v3.1 = the printed v3 + two fixes learned during assembly:
- DB9 cut-out 0.5 mm larger (v3 had to be trimmed with a cutter);
- no holes for the DB9 hex standoffs by default: the standoffs must stay on the
  breakout to screw it onto the stove, so the breakout is glued instead.

All dimensions in mm. Origin = inner bottom-left corner, top of the floor.

Usage:  pip install manifold3d trimesh numpy
        python enclosure_v3.py [output_dir]
"""
import numpy as np
import trimesh
from manifold3d import Manifold, CrossSection, JoinType

# ---------------- parameters ----------------
WALL, FLOOR, LID_T = 2.4, 2.0, 2.0
IN_L, IN_W, IN_H = 112.0, 64.0, 42.0        # inner volume (roomy, for the bundle of jumpers)
R_OUT = 4.0
SEG = 64

# ESP32 dev board, 30 pins, USB-C (HW-394 type): ~53 x 29.5 mm, 4 x Ø3 holes, 47.2 x 23.5 spacing
HOLE_DX, HOLE_DY, HOLE_D = 47.2, 23.5, 3.0
ESP_AXIS_Y = 22.5                            # ESP (and USB socket) axis along Y
USB_PROTRUDE = 1.7                           # USB-C socket overhang past the board edge
HOLE_FROM_EDGE = 2.4                         # USB-side hole centre -> board edge
STANDOFF_H = 28.0                            # under the board: headers + Dupont housings + wire bend
STANDOFF_D, STANDOFF_BASE_D = 4.6, 8.0       # thin columns (fit between Dupont housings), wider foot
PEG_D = 2.3                                  # peg in the Ø3 hole (clearance absorbs spacing tolerance)
PEG_HEAD_D, PEG_HEAD_H = 3.4, 1.8            # conical snap head
PEG_SLOT = 0.8                               # slot that makes the peg flexible
PCB_T = 1.6
USB_W, USB_H, USB_R = 13.0, 12.0, 2.5        # USB-C opening (X+ wall)

# DB9 breakout (male plug, standard shell: 30.8 x 12.5 flange, 25.0 screw spacing)
DB9_Y = IN_W / 2                             # centre along Y
DB9_Z = 11.0                                 # centre height (breakout sits on 3 mm shims)
DB9_CLEARANCE = 0.5                          # v3.1: extra clearance (v3 = 0.0, too tight)
DB9_D_TOP, DB9_D_BOT, DB9_D_H = 20.0 + DB9_CLEARANCE, 16.6 + DB9_CLEARANCE, 11.2 + DB9_CLEARANCE     # D-shaped cut-out (with clearance)
DB9_SCREW_E, DB9_SCREW_D = 25.0, 3.4         # standoff holes (slotted ±1.5 mm in Z)
DB9_SLOT = 1.5
DB9_STANDOFF_HOLES = False                   # v3: True. Keep False if the standoffs must screw onto the stove
SHIM_H = 3.0                                 # shims under the breakout board

PROBE_D, PROBE_X, PROBE_Z = 5.0, 40.0, 10.0  # cable pass-through (Y+ wall)

BOSS_D, PILOT_D, PILOT_DEPTH = 7.0, 2.6, 14.0
SCREW_D, CSK_D = 3.4, 6.4
LIP_GAP, LIP_H, LIP_W = 0.35, 3.0, 1.6


def rbox(x, y, r, h):
    cs = CrossSection.square([x - 2 * r, y - 2 * r]).translate([r, r]).offset(r, JoinType.Round, circular_segments=SEG)
    return Manifold.extrude(cs, h)


def cyl(d, h, x, y, z=0.0):
    return Manifold.cylinder(h, d / 2, d / 2, SEG).translate([x, y, z])


def cube(sx, sy, sz, x=0.0, y=0.0, z=0.0):
    return Manifold.cube([sx, sy, sz]).translate([x, y, z])


def rounded_rect_prism(w, h, r, depth):
    """Rounded-rectangle prism (w along Y, h along Z), extruded along X by `depth`."""
    cs = CrossSection.square([w - 2 * r, h - 2 * r]).translate([r, r]).offset(r, JoinType.Round, circular_segments=SEG)
    return Manifold.extrude(cs, depth).rotate([0, 90, 0]).rotate([90, 0, 0]).rotate([0, 0, 0])


OUT_L, OUT_W = IN_L + 2 * WALL, IN_W + 2 * WALL
BOSS_C = BOSS_D / 2 - 0.6
boss_xy = [(BOSS_C, BOSS_C), (IN_L - BOSS_C, BOSS_C), (BOSS_C, IN_W - BOSS_C), (IN_L - BOSS_C, IN_W - BOSS_C)]

# ---------------- box ----------------
shell = rbox(OUT_L, OUT_W, R_OUT, FLOOR + IN_H).translate([-WALL, -WALL, -FLOOR])
cavity = rbox(IN_L, IN_W, max(R_OUT - WALL, 0.8), IN_H + 1)
box = shell - cavity

for (bx, by) in boss_xy:
    box = box + cyl(BOSS_D, IN_H, bx, by)
    box = box - cyl(PILOT_D, PILOT_DEPTH + 0.1, bx, by, IN_H - PILOT_DEPTH)

# 4 standoffs + snap pegs for the ESP (pins and Dupont housings facing down)
usb_hole_x = IN_L - 0.5 - USB_PROTRUDE - HOLE_FROM_EDGE
esp_holes = [(usb_hole_x - dx, ESP_AXIS_Y + dy) for dx in (0.0, HOLE_DX) for dy in (-HOLE_DY / 2, HOLE_DY / 2)]
for (hx_, hy_) in esp_holes:
    box = box + cyl(STANDOFF_BASE_D, 3.0, hx_, hy_) + Manifold.cylinder(2.0, STANDOFF_BASE_D / 2, STANDOFF_D / 2, SEG).translate([hx_, hy_, 3.0])
    box = box + cyl(STANDOFF_D, STANDOFF_H - 5.0, hx_, hy_, 5.0)
    peg = cyl(PEG_D, PCB_T + 0.1, hx_, hy_, STANDOFF_H - 0.05)
    peg = peg + Manifold.cylinder(PEG_HEAD_H, PEG_HEAD_D / 2, 1.0, SEG).translate([hx_, hy_, STANDOFF_H + PCB_T])
    peg = peg - cube(PEG_SLOT, PEG_HEAD_D + 1, PCB_T + PEG_HEAD_H + 1.5, hx_ - PEG_SLOT / 2, hy_ - (PEG_HEAD_D + 1) / 2, STANDOFF_H - 1.0)
    box = box + peg
board_top = STANDOFF_H + PCB_T

# USB-C slot (X+ wall), centred on the ESP axis
usb_y = ESP_AXIS_Y
USB_Z0 = board_top + 1.6 - USB_H / 2      # USB-C socket centred ~1.6 mm above the board
usb_cs = CrossSection.square([USB_H - 2 * USB_R, USB_W - 2 * USB_R]).translate([USB_R, USB_R]).offset(USB_R, JoinType.Round, circular_segments=SEG)
usb = Manifold.extrude(usb_cs, WALL + 2)                 # XY plane, Z extrusion
usb = usb.rotate([0, 90, 0])                             # extrusion along X; section in (Z,Y)
# re-align using the bounding box after rotation
b = usb.bounding_box()
usb = usb.translate([IN_L - 1 - b[0], usb_y - (b[1] + b[4]) / 2, USB_Z0 - b[2]])
box = box - usb

# DB9 D cut-out + optional standoff holes (X- wall)
d_pts = [(-DB9_D_TOP / 2, DB9_D_H / 2), (DB9_D_TOP / 2, DB9_D_H / 2), (DB9_D_BOT / 2, -DB9_D_H / 2), (-DB9_D_BOT / 2, -DB9_D_H / 2)]
d_cs = CrossSection([d_pts[::-1]]).offset(1.0, JoinType.Round, circular_segments=SEG).offset(-1.0, JoinType.Round, circular_segments=SEG)
d_cut = Manifold.extrude(d_cs, WALL + 2)                 # section (u=Y, v=Z) in the XY plane
d_cut = d_cut.rotate([90, 0, 0]).rotate([0, 0, 90])      # -> extrusion along X
b = d_cut.bounding_box()
d_cut = d_cut.translate([-WALL - 1 - b[0], DB9_Y - (b[1] + b[4]) / 2, DB9_Z - (b[2] + b[5]) / 2])
box = box - d_cut
for sy in ((-DB9_SCREW_E / 2, DB9_SCREW_E / 2) if DB9_STANDOFF_HOLES else ()):
    for dz in (-DB9_SLOT, 0.0, DB9_SLOT):
        h = Manifold.cylinder(WALL + 2, DB9_SCREW_D / 2, DB9_SCREW_D / 2, SEG).rotate([0, 90, 0]).translate([-WALL - 1, DB9_Y + sy, DB9_Z + dz])
        box = box - h
# 2 shims under the breakout board
for sy in (-11.0, 11.0):
    box = box + cube(6, 4, SHIM_H, 6, DB9_Y + sy - 2)

# cable pass-through (Y+ wall) + cable-tie posts
probe = Manifold.cylinder(WALL + 2, PROBE_D / 2, PROBE_D / 2, SEG).rotate([-90, 0, 0]).translate([PROBE_X, IN_W - 1, PROBE_Z])
box = box - probe
for dx in (-6.5, 4.5):
    box = box + cube(2, 3, 6, PROBE_X + dx, IN_W - 7)

# ---------------- lid ----------------
lid = rbox(OUT_L, OUT_W, R_OUT, LID_T).translate([-WALL, -WALL, 0])
lip_out = rbox(IN_L - 2 * LIP_GAP, IN_W - 2 * LIP_GAP, max(R_OUT - WALL - LIP_GAP, 0.8), LIP_H).translate([LIP_GAP, LIP_GAP, -LIP_H])
lip_in = rbox(IN_L - 2 * (LIP_GAP + LIP_W), IN_W - 2 * (LIP_GAP + LIP_W), 0.8, LIP_H + 0.2).translate([LIP_GAP + LIP_W, LIP_GAP + LIP_W, -LIP_H - 0.1])
lid = lid + (lip_out - lip_in)
for (bx, by) in boss_xy:
    lid = lid - cyl(BOSS_D + 1.0, LIP_H + 0.2, bx, by, -LIP_H - 0.1)
    lid = lid - cyl(SCREW_D, LID_T + 2, bx, by, -1)
    lid = lid - Manifold.cylinder(1.6, SCREW_D / 2, CSK_D / 2, SEG).translate([bx, by, LID_T - 1.6 + 0.01])
for i in range(8):
    lid = lid - cube(2.5, 26, LID_T + 2, 30 + i * 7, IN_W / 2 - 13, -1)
# hollow pressers: cap the pegs and hold the board down (backup if a snap breaks)
cap_len = IN_H - board_top - 0.3
for (hx_, hy_) in esp_holes:
    lid = lid + (cyl(6.4, cap_len, hx_, hy_, -cap_len) - cyl(4.0, PEG_HEAD_H + 1.0, hx_, hy_, -cap_len - 0.1))


def export(m, path):
    mesh = m.to_mesh()
    t = trimesh.Trimesh(vertices=np.asarray(mesh.vert_properties)[:, :3], faces=np.asarray(mesh.tri_verts), process=False)
    t.export(path)
    return t


if __name__ == "__main__":
    import sys
    out = sys.argv[1] if len(sys.argv) > 1 else "."
    tb = export(box.translate([WALL, WALL, FLOOR]), f"{out}/enclosure_v3_box.stl")
    tl = export(lid.rotate([180, 0, 0]).translate([WALL, OUT_W - WALL, LID_T]), f"{out}/enclosure_v3_lid.stl")
    for name, t in (("box", tb), ("lid", tl)):
        e = t.bounds[1] - t.bounds[0]
        print(f"{name}: {e[0]:.1f} x {e[1]:.1f} x {e[2]:.1f} mm, watertight={t.is_watertight}, volume={t.volume/1000:.1f} cm3")
