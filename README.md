<div align="center">

# 🔥 Moretti pellet stove × ESP32 × Home Assistant

**Take local control of a Micronova-based pellet stove: ESP32 + ESPHome, a real thermostat with schedules in Home Assistant, and a custom animated dashboard card.**

<img src="docs/img/stove_anim.gif" height="230" alt="Animated stove illustration from the dashboard card">

[![ESPHome](https://img.shields.io/badge/ESPHome-micronova-000?logo=esphome)](https://esphome.io/components/micronova.html)
[![Home Assistant](https://img.shields.io/badge/Home%20Assistant-package-41BDF5?logo=homeassistant&logoColor=white)](https://www.home-assistant.io/)
[![License: MIT](https://img.shields.io/badge/license-MIT-green.svg)](LICENSE)

🇬🇧 English · [🇫🇷 Français](README.fr.md)

</div>

> [!TIP]
> The official Wi-Fi module costs [more than €230](https://www.lacentraledupoele.com/produit/17253-systeme-wifi-navel-micronova-moretti-design) (without installation) and relies on a proprietary app [rated 2.1/5](https://play.google.com/store/apps/details?id=com.micronovasrl.ninamoretti). This project does better, locally, for about €20 of parts.

---

## Table of contents

- [Why](#why)
- [What you get](#what-you-get)
- [How it works](#how-it-works)
- [Bill of materials](#bill-of-materials)
- [Wiring](#wiring)
- [Enclosure](#enclosure)
- [Enable remote control on the stove](#enable-remote-control-on-the-stove)
- [ESPHome firmware](#esphome-firmware)
- [Home Assistant: thermostat & schedule](#home-assistant-thermostat--schedule)
- [Dashboard card](#dashboard-card)
- [Room thermometer (Bluetooth)](#room-thermometer-bluetooth)
- [Troubleshooting & lessons learned](#troubleshooting--lessons-learned)
- [Repository layout](#repository-layout)
- [Credits & disclaimer](#credits--disclaimer)

---

## Why

The stove (a **Moretti Design A7 SAT Glass**, Micronova controller board) came with a remote control that also acts as the room thermostat. Its temperature reading was off by several degrees, even after two technician calibrations, and there was no way to schedule anything sensible or to see what the stove was doing from a phone.

This project replaces all of that with:

- an **ESP32** talking directly to the Micronova board over its serial bus (DB9 socket at the back of the stove);
- **ESPHome** exposing the stove to Home Assistant (on/off, state, flame power, fumes temperature…);
- a **Home Assistant package** that turns any thermometer into the stove thermostat, with time slots and anti short-cycle protection;
- a **custom Lovelace card** with an animated stove, a dial thermostat and a 24 h history.

The original remote now lives in a drawer. 🧦

> **Other stoves:** many Italian pellet stoves use a Micronova board (Extraflame, La Nordica and many others). If yours has the same DB9/RJ11 serial port, most of this applies. Memory addresses can differ between models: check the [ESPHome micronova docs](https://esphome.io/components/micronova.html).

## What you get

| Dashboard (stove heating) | Dashboard (stove off) |
|:---:|:---:|
| <img src="docs/img/card_on.png" alt="Card, stove heating"> | <img src="docs/img/card_off.png" alt="Card, stove off"> |

<details>
<summary>📱 Phone layout</summary>
<p align="center"><img src="docs/img/card_mobile.png" width="320" alt="Card on a phone"></p>
</details>

<sub>Screenshots rendered with fake data. The card UI is in French.</sub>

- 🔌 **Local control**, no cloud, no vendor app: on/off, flame level P1–P5, live state (ignition, heating, cleaning, alarms…).
- 📱 **From anywhere**: with remote access to Home Assistant (Home Assistant Cloud, a VPN or your own reverse proxy), light the stove on your way home when it's cold, and come back to a warm house.
- 🌡️ **Real thermostat**: setpoint ±0.5 °C hysteresis, using any Home Assistant thermometer, with automatic fallback to the stove's own probe.
- 🗓️ **Schedules**: "time slots + temperature", "time slots only" or "temperature only", editable from the card.
- 🛡️ **Protections**: never restarts a stove that hasn't finished its cooling cycle, minimum 30 min off / 45 min on.
- 📶 **Bluetooth proxy**: the stove ESP also relays BLE sensors to Home Assistant (handy for the room thermometer).
- 🎨 **Animated card**: flame, glow and smoke follow the real stove state; offline state; pending-command feedback.
- 🖨️ **3D-printed enclosure** with the DB9 connector built into the wall.

## How it works

```mermaid
flowchart LR
    subgraph Stove["🔥 Pellet stove"]
        MB["Micronova board"]
    end
    subgraph Module["📦 3D-printed module"]
        IF["3 × PC817<br/>bus interface"]
        ESP["ESP32<br/>ESPHome"]
    end
    T["🌡️ BLE thermometer<br/>(room)"]
    subgraph HA["🏠 Home Assistant"]
        API["ESPHome integration"]
        PKG["Package:<br/>helpers + automation"]
        CARD["poele-card<br/>(Lovelace)"]
    end

    MB <-- "DB9 · single wire<br/>1200 baud 8N2" --> IF
    IF <--> ESP
    T -. "BLE adverts" .-> ESP
    ESP <-- "Wi-Fi · native API<br/>+ Bluetooth proxy" --> API
    API --> PKG
    PKG -- "switch.turn_on / off" --> API
    API --> CARD
    PKG --> CARD
```

The Micronova board exposes a **half-duplex, single-wire serial bus** (5 V idle). The ESP reads and writes the board's RAM/EEPROM through the ESPHome [`micronova`](https://esphome.io/components/micronova.html) component:

| Direction | What | How |
|---|---|---|
| ESP → stove | send frames | GPIO17 drives U1, whose transistor pulls the DATA line low |
| stove → ESP | read replies | U2's LED follows the DATA line, its transistor pulls GPIO16 low |
| echo cancel | ignore our own frames | GPIO4 drives U3, in series with U2: RX is cut while the ESP transmits |

The stove keeps doing what it does best (ignition, pellet feeding, cleaning cycles, safety). Home Assistant only decides **when** it should run.

## Bill of materials

Links are plain product pages on amazon.fr (no affiliate tag), given as examples: any equivalent part works.

| Part | Qty | Notes |
|---|:---:|---|
| ESP32 dev board, 30 pins, USB-C (WROOM-32, "HW-394" type) | 1 | any ESP32 DevKit works; the enclosure is sized for this one (~53 × 29.5 mm) |
| PC817 optocoupler (DIP-4) | 3 | [PC817C, pack of 100](https://www.amazon.fr/dp/B0F3D13MKL) |
| Resistor 470 Ω | 2 | R1, R3 |
| Resistor 1 kΩ | 1 | R2 |
| DB9 **male** breakout with screw terminals | 1 | plugs straight into the stove socket · [DB9-F-8A breakout](https://www.amazon.fr/dp/B08LYR2KDD) |
| Dupont jumpers (F-F and M-F) | ~15 | or solder everything on a perfboard |
| 5 V USB-C power supply + cable | 1 | the ESP is **not** powered by the stove |
| M3 × 10 countersunk self-tapping screws | 4 | enclosure lid |
| PLA or PETG filament | < 100 g | |
| *Optional:* BLE thermometer supported by Home Assistant | 1 | the one used here: [SwitchBot Meter, pack of 3](https://www.amazon.fr/dp/B0F8HG1CXV) · Xiaomi LYWSD03MMC also works |

## Wiring

<p align="center"><img src="docs/wiring.svg" alt="Interface schematic: ESP32, three PC817 optocouplers, DB9 stove socket"></p>

> [!CAUTION]
> **Measure your own stove first.** On this stove the DB9 socket gave, against pin 7: **pin 8 ≈ 5 V (DATA)** and **pin 3 ≈ 17 V**. Connecting a signal to the 17 V pin will destroy the optocoupler at best, the ESP at worst. The DB9 shell is earth, not the board ground: leave it alone. Unplug the stove from mains before plugging/unplugging the connector.

<details>
<summary>🔧 Point-to-point wire list (Dupont build, 15 wires)</summary>

PC817 pin 1 is marked with a dot. Pins: 1 = LED anode, 2 = LED cathode, 3 = emitter, 4 = collector.

| # | From | To | Net |
|:-:|---|---|---|
| 1 | ESP **3V3** | R1 (470 Ω) | +3V3 |
| 2 | R1 | **U1 pin 1** | |
| 3 | ESP **GPIO17** | **U1 pin 2** | TX |
| 4 | ESP **GND** | **U1 pin 3** | GND |
| 5 | **U1 pin 4** | DB9 terminal **8** | DATA |
| 6 | ESP **VIN** (5 V) | R2 (1 kΩ) | +5V |
| 7 | R2 | **U2 pin 1** | |
| 8 | **U2 pin 2** | DB9 terminal **8** | DATA |
| 9 | **U2 pin 4** | ESP **GPIO16** | RX |
| 10 | **U2 pin 3** | **U3 pin 4** | |
| 11 | ESP **GPIO18** | R3 (470 Ω) | U3 supply |
| 12 | R3 | **U3 pin 1** | |
| 13 | **U3 pin 2** | ESP **GPIO4** | RX enable |
| 14 | **U3 pin 3** | DB9 terminal **7** | GND |
| 15 | ESP **GND** | DB9 terminal **7** | GND |

Tips: wrap each resistor and PC817 in electrical tape once plugged in, so bare legs can't touch. Two wires share terminal 8 and two share terminal 7: tighten hard and give each wire a gentle pull.

</details>

**Variants**

- R3 can go to **3V3** instead of GPIO18 (U3 then always powered). Delete the `u3_supply` switch from the YAML.
- A 10 kΩ pull-up from GPIO16 to 3V3 is optional: the ESP32 internal pull-up is enabled in the config.

## Enclosure

| Exploded | Closed (USB-C side) |
|:---:|:---:|
| <img src="docs/img/enclosure_exploded.png" width="380" alt="Enclosure, exploded view"> | <img src="docs/img/enclosure_closed.png" width="380" alt="Enclosure, closed"> |

Files in [`hardware/enclosure/`](hardware/enclosure/):

- `enclosure_v3_box.stl`, `enclosure_v3_lid.stl`: ready to print, no supports (0.2 mm layers, 3 walls, 20 % infill).
- `enclosure_v3.py`: parametric source (Python + [manifold3d](https://github.com/elalish/manifold)). `pip install manifold3d trimesh numpy && python enclosure_v3.py`.

Design: the DB9 breakout is flush-mounted in one wall (plug outside, screw terminals inside), USB-C opening on the opposite wall, the ESP clips onto 4 snap pegs with its pins facing down, 4 × M3 screws close the lid. Outer size 117 × 69 × 46 mm.

> [!NOTE]
> The STLs are **v3.1** = the printed v3 plus two fixes learned during assembly: the DB9 cut-out is 0.5 mm larger (v3 needed a cutter), and the holes for the DB9 hex standoffs are gone. The standoffs have to stay on the breakout to screw it onto the stove, so the breakout flange is **glued** inside the wall (fast glue or epoxy). Both are parameters at the top of the script. v3.1 itself has not been reprinted yet.

**PLA is fine here:** on this stove the back panel (where the DB9 socket is) stays at room temperature. If the back of your stove gets warm, print in PETG or ASA instead (PLA softens around 55 °C).

## Enable remote control on the stove

> [!IMPORTANT]
> **Do this first.** Out of the box, the Micronova board ignores commands coming from its serial port. As long as remote activation is off, the ESP can't control the stove, however good the wiring is.

The setting lives in the stove's hidden **technician menu**, reached from the original remote (the menu labels below are the French ones shown on this remote).

1. On the remote, open the system / technician menu: it asks for an access code (a `00` field).
2. Enter the code. On **Moretti Design** stoves it is **`M0`** (letter M, then the number zero; `MO` on some models). The arrows scroll the field through the numbers, then the letters. Confirm with **OK**. Other brands use other codes: ask your installer or the manufacturer.
3. The menu lists entries such as *TYPE PELLET, RÉGLAGE USINE, SETTING GÉNÉRAL, TEST SORTIE, EFFACER ALARME, BANQUE DONNÉE…*
4. Open the sub-menus *RÉGLAGE USINE* / *SETTING GÉNÉRAL*. Careful, in these sub-menus **OK moves to the next parameter, the arrows change the value**. Scroll with OK until you reach **ACTIVATION À DISTANCE** (remote activation, parameter *Pr46* in Micronova manuals).
5. Set it to **ON** with an arrow, confirm with **OK**, then leave the menu without touching anything else.
6. Switch the stove off with the switch at the back, wait 10 seconds, switch it back on so the board reloads its settings.

> [!WARNING]
> Every other parameter of this menu drives combustion. **Take a photo of each screen before changing anything**, change only remote activation, and never enter *TEST SORTIE* (it runs the motors), *EFFACER…* or *BANQUE DONNÉE* (it can reload the factory parameters). Changing technician settings may void your warranty.

## ESPHome firmware

1. In the ESPHome dashboard, create a new device and paste [`esphome/pellet-stove.yaml`](esphome/pellet-stove.yaml).
2. Add the missing keys to your ESPHome `secrets.yaml` (template: [`esphome/secrets.example.yaml`](esphome/secrets.example.yaml)).
3. Flash over USB **before** connecting the stove. Later updates go over Wi-Fi.
4. Stove unplugged from mains: plug the module into the DB9 socket, then power the stove again.
5. Check the logs: the state and temperatures should show plausible values. **Don't touch the on/off switch until reads work.**
6. Home Assistant discovers the device: accept it in *Settings → Devices & services*.

Keep `name: poele`, or adapt the entity IDs in the package and the card. The entities you get:

| Entity | Meaning |
|---|---|
| `switch.poele_poele` | stove on/off |
| `sensor.poele_etat` | state (French by default, English if you remove the `map` filter) |
| `number.poele_niveau_de_flamme` | flame power level 1–5 |
| `sensor.poele_puissance` | actual power level |
| `sensor.poele_temperature_fumees` | fumes temperature |
| `sensor.poele_temperature_ambiante` | stove's own room temperature (fallback only) |
| `sensor.poele_signal_wifi`, `sensor.poele_adresse_ip`, `sensor.poele_version_esphome`, `sensor.poele_dernier_redemarrage_esp` | diagnostics |

Notes on the config:

- **Fumes temperature** is read at `0x00:0x58` on this stove (checked hot and cold). Your model may differ.
- **Polling is slow on purpose** (60–300 s): if the original remote is still used, each frame can collide with it.
- **Bluetooth proxy**: optional; it requires dropping `power_save_mode: none` (Wi-Fi and BLE share the radio). Keep the scan **passive**: active scanning made the ESP drop off Wi-Fi every few hours.

## Home Assistant: thermostat & schedule

[`homeassistant/packages/pellet_stove.yaml`](homeassistant/packages/pellet_stove.yaml) creates everything in one file:

| Helper | Role |
|---|---|
| `input_boolean.poele_programmation` | master switch for the automation |
| `input_number.poele_consigne` | setpoint, 15–25 °C, 0.5 steps |
| `input_select.poele_mode_programmation` | `Horaire + température` / `Horaire seul` / `Température seule` |
| `schedule.poele_plages_horaires` | weekly time slots (the file ships example slots) |
| `input_datetime.poele_dernier_changement_marche_arret` + `automation.poele_memo_bascule` | time of the last real on/off change, immune to ESP disconnections |
| `automation.poele_programmation` | the logic below |

**Install:** enable packages in `configuration.yaml`, copy the file, then replace `sensor.room_temperature` with your thermometer:

```yaml
homeassistant:
  packages: !include_dir_named packages
```

**Decision logic** (runs every 5 min and on every helper change):

```mermaid
flowchart TD
    A([Every 5 min or helper changed]) --> B{Programming ON<br/>and ESP online?}
    B -- no --> Z([do nothing])
    B -- yes --> C["T = room thermometer<br/>(fallback: stove probe)"]
    C --> D{Mode}
    D -- "Horaire seul" --> E["wanted = in a time slot"]
    D -- "Température seule" --> F["wanted = T below setpoint*"]
    D -- "Horaire + température" --> G["wanted = in a time slot<br/>AND T below setpoint*"]
    E & F & G --> H{wanted?}
    H -- "yes, stove off" --> I{"fully cooled down<br/>and off ≥ 30 min?"}
    I -- yes --> ON([switch ON])
    I -- no --> Z
    H -- "no, stove on" --> J{"on ≥ 45 min?"}
    J -- yes --> OFF([switch OFF])
    J -- no --> Z
```

<sub>* hysteresis: while running, keep heating up to setpoint + 0.5 °C; when stopped, restart below setpoint − 0.5 °C. A reading ≤ 3 °C is treated as invalid; "time slots + temperature" then falls back to time slots only.</sub>

The stove modulates its own power between those on/off decisions (set the flame level from the card).

## Dashboard card

[`lovelace/poele-card.js`](lovelace/poele-card.js), a single file with no dependencies.

1. Copy it to `<config>/www/poele-card.js`.
2. *Settings → Dashboards → ⋮ → Resources → Add*: `/local/poele-card.js`, type **JavaScript module**. Bump `?v=2` at the end of the URL after each update to bypass caches.
3. Add a card in YAML mode:

```yaml
type: custom:poele-card
room: sensor.your_room_thermometer   # the only option you usually need
```

In a *sections* dashboard, give its section the full width (the card asks for it). All options, with their defaults:

| Option | Default |
|---|---|
| `title` | `Poêle` |
| `room` | `sensor.room_temperature` |
| `room_remote` | `sensor.poele_temperature_ambiante` |
| `switch` | `switch.poele_poele` |
| `state` | `sensor.poele_etat` |
| `setpoint` | `input_number.poele_consigne` |
| `flame` | `number.poele_niveau_de_flamme` |
| `power` | `sensor.poele_puissance` |
| `fumes` | `sensor.poele_temperature_fumees` |
| `prog` / `mode` / `schedule` / `automation` | the package helpers |
| `wifi` / `ip` / `uptime` / `version` | ESP diagnostics |

What it shows: the stove illustration (flame, glow and smoke follow the actual state, grey when off), the current room temperature, a dial for the setpoint, on/off with confirmation, flame level P1–P5, today's time slots with the next change and an in-place editor, a 24 h graph (room temperature, setpoint, running periods), ignitions and heating time over 24 h, fumes temperature, and a collapsible diagnostics panel. When the ESP is offline, controls are disabled and a notification explains why a command failed.

## Room thermometer (Bluetooth)

Any temperature entity works. A cheap BLE thermometer is perfect, and the stove ESP is already a **Bluetooth proxy**, so it relays the sensor even when your Home Assistant host is far away.

- SwitchBot Meter / Outdoor Meter: the built-in **SwitchBot Bluetooth** integration reads it locally. **No SwitchBot account, no hub, no cloud.**
- Place it in the room, at body height, away from the stove's radiation and from windows.
- A pellet stove is a big steel box: it blocks 2.4 GHz. If the signal is weak (around −90 dBm), give the thermometer line of sight to the ESP.

## Troubleshooting & lessons learned

<details>
<summary><b>The stove never answers</b></summary>

Check that **ACTIVATION À DISTANCE** is ON in the technician menu ([see above](#enable-remote-control-on-the-stove)), and that DATA is really on the pin you measured at ≈ 5 V.
</details>

<details>
<summary><b>ESP online but stove "unavailable", or commands ignored</b></summary>

Nine times out of ten: the DB9 plug isn't fully seated. A printed enclosure wall that's a little too thick, or a bit of glue, is enough to keep it out by a millimetre. Trim, reseat, check the logs.
</details>

<details>
<summary><b>The on button bounces back to "off"</b></summary>

The write didn't reach the stove (bad contact, or a collision with the original remote). Check the ESPHome logs for frames and replies. With the remote out of the way, writes succeed first time.
</details>

<details>
<summary><b>Room temperature from the stove reads 0.0</b></summary>

On this stove, RAM `0x01` (room temperature) comes from the remote's probe. Remove the remote and it reads 0. That's why the package and the card use an external thermometer and ignore anything ≤ 3 °C.
</details>

<details>
<summary><b>Keeping or retiring the original remote</b></summary>

The remote talks on the same bus. Both can coexist (hence the slow polling), but collisions happen. With an external thermometer, Home Assistant does everything the remote did, better: removing its batteries made the bus noticeably more reliable.
</details>

<details>
<summary><b>The stove keeps heating after the time slot / setpoint</b></summary>

Seen in real life: the ESP dropped off Home Assistant for a few minutes several times, and each time it came back the switch went `unavailable → on`. An automation measuring "running for 45 min" from the switch's `last_changed` restarts from zero at every reconnection, so it never turns the stove off. The package therefore stores the time of real on/off changes in `input_datetime.poele_dernier_changement_marche_arret`. If the ESP drops often, also check the Bluetooth scan is passive (see below) and the Wi-Fi signal (better than −75 dBm).
</details>

<details>
<summary><b>ESPHome refuses to compile with bluetooth_proxy</b></summary>

Remove `power_save_mode: none` from the `wifi:` block. Wi-Fi and BLE coexistence needs the default power-save mode.
</details>

<details>
<summary><b>Enclosure: the DB9 breakout can't be screwed through the wall</b></summary>

If you screw the breakout's hex standoffs through the wall from outside, nothing is left to screw onto the stove socket. Glue the flange inside instead (that's what v3.1 does).
</details>

## Repository layout

```
.
├── esphome/
│   ├── pellet-stove.yaml          ESPHome config (micronova + BLE proxy)
│   └── secrets.example.yaml
├── homeassistant/packages/
│   └── pellet_stove.yaml          helpers + schedule + thermostat automation
├── lovelace/
│   └── poele-card.js              custom dashboard card
├── hardware/enclosure/
│   ├── enclosure_v3.py            parametric enclosure (Python / manifold3d)
│   ├── enclosure_v3_box.stl
│   └── enclosure_v3_lid.stl
└── docs/
    ├── wiring.svg
    └── img/
```

## Credits & disclaimer

- [ESPHome `micronova` component](https://esphome.io/components/micronova.html) and the community that reverse-engineered the Micronova protocol; the 3-optocoupler interface is the classic circuit from those projects.
- Built step by step with Claude (Anthropic).

> [!WARNING]
> A pellet stove is a combustion appliance. This project only uses the stove's own commands (the same ones as the remote): ignition, shutdown, cleaning and every safety feature stay under control of the Micronova board. Never leave a stove running in a way you wouldn't with its original remote.

### Liability

This project is shared for information and educational purposes, **as is, without any warranty**. By reproducing it, you accept that:

- you open, wire and modify your appliance **entirely at your own risk and under your own responsibility**;
- the author **cannot be held liable** for any damage, direct or indirect: to your stove, its controller board, your electrical installation, your home or any other property, nor for any injury, fire, malfunction, loss of warranty or loss of manufacturer support;
- you are responsible for checking the pinout, voltages and settings of **your own** stove, and for complying with the manufacturer's instructions and the regulations in force where you live;
- if you are not comfortable with electronics or with the technician menu of your stove, ask a qualified professional.

Released under the [MIT License](LICENSE).
